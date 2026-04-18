// db.js
// =========================================================================
// Require & Connect to SQLite
// =========================================================================
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SQLite = require('sqlite3').verbose();
const {
  createLedgerService,
  stableStringify,
  PRIMARY_BALANCE_ACCOUNT,
} = require('./ledgerService');
const { createEventLedgerService } = require('./eventLedgerService');
const { rebuildStateFromLedgers, projectStateFromPayloads } = require('./stateRecovery');

let ledgerService;
let eventLedgerService;
let ledgerBootstrapPromise = null;
let systemEventSnapshotPromise = null;
let discordClient = null;
let databaseInitializationPromise = null;
let databaseInitializationReady = false;
let recoverableMaintenancePromise = null;
let sharedWriteQueue = Promise.resolve();

const DB_PATH = process.env.VOLT_DB_PATH || './points.db';
const VOLT_INSTANCE_SECRET_ENV = 'VOLT_INSTANCE_SECRET';
const PROFILE_CIPHER_PREFIX = 'voltenc:v1:';
const PROTECTED_PROFILE_MASK = '*** protected ***';
const LEGACY_USER_MESSAGE_COUNTS_PATH = path.join(__dirname, 'userMessageCounts.json');
const LEGACY_RPS_WIN_TRACKER_PATH = path.join(__dirname, 'rpsWinTracker.json');
const LEGACY_RPS_GAMES_PATH = path.join(__dirname, 'data', 'rpsGames.json');

function upsertEnvFileValue(filePath, key, value) {
  const nextLine = `${key}=${value}`;
  let lines = [];

  if (fs.existsSync(filePath)) {
    lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  }

  let replaced = false;
  lines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (!replaced) {
    lines.push(nextLine);
  }

  fs.writeFileSync(filePath, `${lines.filter((line, index, arr) => !(index === arr.length - 1 && line === '')).join('\n')}\n`, 'utf8');
}

function enqueueDatabaseWrite(task) {
  const runTask = sharedWriteQueue.then(task, task);
  sharedWriteQueue = runTask.catch(() => {});
  return runTask;
}

function quoteSqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function ensureInstanceSecret() {
  const existing = String(process.env[VOLT_INSTANCE_SECRET_ENV] || '').trim();
  if (existing) {
    return existing;
  }

  const generated = crypto.randomBytes(32).toString('base64url');
  process.env[VOLT_INSTANCE_SECRET_ENV] = generated;

  try {
    const envPath = path.join(process.cwd(), '.env');
    upsertEnvFileValue(envPath, VOLT_INSTANCE_SECRET_ENV, generated);
    console.log(`🔐 Generated ${VOLT_INSTANCE_SECRET_ENV} and saved it to ${envPath}`);
  } catch (error) {
    console.error(`❌ Failed to persist generated ${VOLT_INSTANCE_SECRET_ENV}:`, error);
  }

  return generated;
}

function getInstanceCipherKey() {
  const secret = ensureInstanceSecret();
  return crypto.scryptSync(secret, 'volt-instance-profile-v1', 32);
}

function isProtectedProfileValue(value) {
  return typeof value === 'string' && value.startsWith(PROFILE_CIPHER_PREFIX);
}

function encryptProtectedProfileValue(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  if (isProtectedProfileValue(value)) {
    return value;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getInstanceCipherKey(), iv);
  const plaintext = String(value);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  });
  return `${PROFILE_CIPHER_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

function decryptProtectedProfileValue(value, options = {}) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  if (!isProtectedProfileValue(value)) {
    return String(value);
  }

  try {
    const encoded = String(value).slice(PROFILE_CIPHER_PREFIX.length);
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getInstanceCipherKey(),
      Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (error) {
    return options.maskOnFailure ? PROTECTED_PROFILE_MASK : null;
  }
}

function decodeProfileRow(row, options = {}) {
  if (!row) return null;
  return {
    ...row,
    profile_about_me: decryptProtectedProfileValue(row.profile_about_me, options),
    profile_specialties: decryptProtectedProfileValue(row.profile_specialties, options),
    profile_location: decryptProtectedProfileValue(row.profile_location, options),
  };
}

function decodeItemRedemptionRow(row, options = {}) {
  if (!row) return null;
  return {
    ...row,
    wallet_address: decryptProtectedProfileValue(row.wallet_address, options),
  };
}

function decodeItemRedemptionRows(rows, options = {}) {
  return Array.isArray(rows) ? rows.map((row) => decodeItemRedemptionRow(row, options)) : [];
}

function redactWalletCommandText(value) {
  const text = String(value || '').trim();
  if (!text) return value ?? null;
  return text
    .replace(/(wallet\s*=\s*")([^"]+)(")/gi, '$1[redacted]$3')
    .replace(/(wallet_address\s*=\s*")([^"]+)(")/gi, '$1[redacted]$3');
}

function decodeRedemptionMetadataFields(value, options = {}) {
  if (value === null || typeof value === 'undefined') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => decodeRedemptionMetadataFields(entry, options));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        if (key === 'walletAddress' || key === 'wallet_address') {
          return [key, decryptProtectedProfileValue(nestedValue, options)];
        }
        if (key === 'commandText' || key === 'command_text') {
          return [key, redactWalletCommandText(nestedValue)];
        }
        return [key, decodeRedemptionMetadataFields(nestedValue, options)];
      })
    );
  }

  return value;
}

const db = new SQLite.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
    if (process.env.VOLT_SKIP_DB_AUTO_INIT !== '1') {
      setImmediate(() => initializeDatabase()); // Automatically initialize DB on connection
    }
  }
});
db.configure('busyTimeout', 5000);
db.run('PRAGMA journal_mode = WAL', (err) => {
  if (err) {
    console.error('❌ Failed to enable SQLite WAL mode:', err);
  }
});
db.run('PRAGMA foreign_keys = ON', (err) => {
  if (err) {
    console.error('❌ Failed to enable SQLite foreign keys:', err);
  }
});

ledgerService = createLedgerService({
  db,
  enqueueWrite: enqueueDatabaseWrite,
  ensureUserEconomyRow: async (userID) => initUserEconomy(userID),
  syncUserProjection: async ({ userId, balance, wallet, executor }) => {
    if (!userId) return;
    const projectedBalance = Number(balance ?? wallet ?? 0);
    await executor.run(
      `UPDATE economy
       SET wallet = ?, bank = ?
       WHERE userID = ?`,
      [projectedBalance, 0, userId]
    );
  },
});

eventLedgerService = createEventLedgerService({
  db,
  enqueueWrite: enqueueDatabaseWrite,
});

function ensureDatabaseInitialized() {
  if (databaseInitializationReady) {
    return Promise.resolve();
  }
  if (!databaseInitializationPromise) {
    initializeDatabase();
  }
  return databaseInitializationPromise || Promise.resolve();
}

async function runSql(sql, params = []) {
  await ensureDatabaseInitialized();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes ?? 0, lastID: this.lastID ?? null });
    });
  });
}

async function getSql(sql, params = []) {
  await ensureDatabaseInitialized();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

async function allSql(sql, params = []) {
  await ensureDatabaseInitialized();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function getLedgerExecutor(database = db) {
  return ledgerService.createExecutor(database);
}

function getEventLedgerExecutor(database = db) {
  return eventLedgerService.createExecutor(database);
}

function setDiscordClient(clientInstance) {
  discordClient = clientInstance || null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function getCurrentESTDateString() {
  const now = new Date();
  const estTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
  return estTime.toISOString().split('T')[0];
}

ensureInstanceSecret();

async function ensureLegacyImportTable() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS ledger_legacy_imports (
      userID TEXT NOT NULL,
      account TEXT NOT NULL,
      imported_balance INTEGER NOT NULL,
      imported_at INTEGER NOT NULL,
      transaction_id INTEGER,
      PRIMARY KEY(userID, account)
    )
  `);
}

async function mergeLegacyEconomyIntoLedger() {
  await ledgerService.initialize();
  await ensureLegacyImportTable();

  const executor = getLedgerExecutor(db);
  const now = Math.floor(Date.now() / 1000);

  await executor.run('BEGIN IMMEDIATE');
  try {
    const importedRows = await executor.all(
      `SELECT userID, account, imported_balance
       FROM ledger_legacy_imports`
    );
    const importedKeys = new Set(importedRows.map((row) => `${row.userID}:${row.account}`));

    const balances = await executor.all(
      `SELECT TRIM(userID) AS userID,
              COALESCE(wallet, 0) AS wallet,
              COALESCE(bank, 0) AS bank
       FROM economy
       WHERE TRIM(COALESCE(userID, '')) != ''
         AND (COALESCE(wallet, 0) != 0 OR COALESCE(bank, 0) != 0)
       ORDER BY userID ASC`
    );

    let createdTransactions = 0;
    const importedUsers = new Set();

    for (const balance of balances) {
      for (const account of ['wallet', 'bank']) {
        const amount = Number(balance[account] || 0);
        if (!amount) continue;

        const key = `${balance.userID}:${account}`;
        if (importedKeys.has(key)) {
          continue;
        }

        const transaction = await ledgerService.appendTransaction({
          type: 'legacy_balance_import',
          fromUserId: amount > 0 ? null : balance.userID,
          toUserId: amount > 0 ? balance.userID : null,
          amount: Math.abs(amount),
          metadata: {
            fromAccount: amount > 0 ? 'system' : account,
            toAccount: amount > 0 ? account : 'system',
            source: 'economy_legacy_merge',
            importedFromTable: 'economy',
            importedColumn: account,
            importedBalance: amount,
          },
        }, { executor, inTransaction: true });

        await executor.run(
          `INSERT INTO ledger_legacy_imports (
             userID,
             account,
             imported_balance,
             imported_at,
             transaction_id
           )
           VALUES (?, ?, ?, ?, ?)`,
          [balance.userID, account, amount, now, transaction.id]
        );

        importedKeys.add(key);
        importedUsers.add(balance.userID);
        createdTransactions += 1;
      }
    }

    await executor.run('COMMIT');

    if (createdTransactions > 0) {
      console.log(`✅ Imported ${createdTransactions} legacy balance transaction(s) for ${importedUsers.size} user(s).`);
    } else {
      console.log('✅ Legacy economy balances already merged into the ledger.');
    }

    return {
      migrated: true,
      createdTransactions,
      importedUsers: importedUsers.size,
    };
  } catch (error) {
    await executor.run('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function ensureLedgerBootstrap() {
  if (!ledgerBootstrapPromise) {
    ledgerBootstrapPromise = mergeLegacyEconomyIntoLedger().catch((error) => {
      ledgerBootstrapPromise = null;
      console.error('❌ Failed to bootstrap ledger from legacy economy balances:', error);
      throw error;
    });
  }

  return ledgerBootstrapPromise;
}

async function appendSystemEvent(entry, options = {}) {
  if (!options.skipBootstrap) {
    await ensureSystemEventBootstrap();
  }
  await eventLedgerService.initialize();
  return eventLedgerService.appendEvent(entry, options);
}

async function getSystemEvents(options = {}) {
  await ensureSystemEventBootstrap();
  await eventLedgerService.initialize();
  return eventLedgerService.getEvents(options);
}

async function verifySystemEventIntegrity() {
  await ensureSystemEventBootstrap();
  await eventLedgerService.initialize();
  return eventLedgerService.verifyIntegrity();
}

async function exportSystemEvents(options = {}) {
  await ensureSystemEventBootstrap();
  await eventLedgerService.initialize();
  return eventLedgerService.exportEvents(options);
}

async function collectProjectionSnapshot(database = db) {
  const queryAll = (sql, params = []) => new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows || []);
    });
  });
  const querySchema = (tableName) => new Promise((resolve, reject) => {
    database.all(`PRAGMA table_info(${tableName})`, (error, rows) => {
      if (error) return reject(error);
      resolve(rows || []);
    });
  });

  const [giveawayColumns, titleGiveawayColumns, raffleColumns] = await Promise.all([
    querySchema('giveaways'),
    querySchema('title_giveaways'),
    querySchema('raffles'),
  ]);
  const hasGiveawayCompleted = giveawayColumns.some((column) => column.name === 'is_completed');
  const hasTitleGiveawayCompleted = titleGiveawayColumns.some((column) => column.name === 'is_completed');
  const hasRaffleCompleted = raffleColumns.some((column) => column.name === 'is_completed');

  const [
    economy,
    items,
    inventory,
    dailyUserActivity,
    rpsGames,
    giveaways,
    giveawayEntries,
    titleGiveaways,
    titleGiveawayEntries,
    raffles,
    raffleEntries,
    raffleTicketPurchases,
  ] = await Promise.all([
    queryAll(`SELECT userID, username, profile_about_me, profile_specialties, profile_location, profile_twitter_handle, wallet, bank
              FROM economy
              WHERE userID IS NOT NULL AND TRIM(userID) != ''
              ORDER BY userID ASC`),
    queryAll(`SELECT itemID, name, description, price, isAvailable, isHidden, isRedeemable, quantity FROM items ORDER BY itemID ASC`),
    queryAll(`SELECT userID, itemID, quantity FROM inventory ORDER BY userID ASC, itemID ASC`),
    queryAll(`SELECT userID, activity_date, message_count, reacted, first_message_bonus_given, rps_wins
              FROM daily_user_activity
              ORDER BY activity_date ASC, userID ASC`),
    queryAll(`SELECT game_id, challenger_id, opponent_id, channel_id, wager, challenger_choice, opponent_choice, created_at, expires_at
              FROM rps_games
              ORDER BY game_id ASC`),
    queryAll(`SELECT id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, ${hasGiveawayCompleted ? 'COALESCE(is_completed, 0)' : '0'} AS is_completed FROM giveaways ORDER BY id ASC`),
    queryAll(`SELECT giveaway_id, user_id FROM giveaway_entries ORDER BY giveaway_id ASC, user_id ASC`),
    queryAll(`SELECT id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, ${hasTitleGiveawayCompleted ? 'is_completed' : '0 AS is_completed'} FROM title_giveaways ORDER BY id ASC`),
    queryAll(`SELECT title_giveaway_id, user_id FROM title_giveaway_entries ORDER BY title_giveaway_id ASC, user_id ASC`),
    queryAll(`SELECT id, channel_id, name, prize, cost, quantity, winners, end_time, ${hasRaffleCompleted ? 'COALESCE(is_completed, 0)' : '0'} AS is_completed FROM raffles ORDER BY id ASC`),
    queryAll(`SELECT entry_id, raffle_id, user_id FROM raffle_entries ORDER BY entry_id ASC`),
    queryAll(`SELECT raffle_id, user_id, purchased_count, bonus_10_given, bonus_25_given, bonus_50_given FROM raffle_ticket_purchases ORDER BY raffle_id ASC, user_id ASC`),
  ]);

  const snapshot = {
    economy,
    items,
    inventory,
    dailyUserActivity,
    rpsGames,
    giveaways,
    giveawayEntries,
    titleGiveaways,
    titleGiveawayEntries,
    raffles,
    raffleEntries,
    raffleTicketPurchases,
  };

  return {
    snapshot,
    counts: Object.fromEntries(
      Object.entries(snapshot).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0])
    ),
    fingerprint: sha256(stableStringify(snapshot)),
  };
}

async function getProjectionFingerprint(database = db) {
  return collectProjectionSnapshot(database);
}

async function getReplayedProjectionFingerprint() {
  const [ledgerPayload, eventPayload] = await Promise.all([
    exportLedger(),
    exportSystemEvents(),
  ]);

  const replayed = projectStateFromPayloads({ ledgerPayload, eventPayload });
  return {
    snapshot: replayed.snapshot,
    counts: replayed.projectionCounts,
    fingerprint: replayed.projectionFingerprint,
  };
}

const RECOVERABLE_PROJECTION_KEYS = [
  'economy',
  'items',
  'inventory',
  'dailyUserActivity',
  'rpsGames',
  'giveaways',
  'giveawayEntries',
  'titleGiveaways',
  'titleGiveawayEntries',
  'raffles',
  'raffleEntries',
  'raffleTicketPurchases',
];

function pickRecoverableProjectionTables(snapshot = {}) {
  return Object.fromEntries(
    RECOVERABLE_PROJECTION_KEYS.map((key) => [key, Array.isArray(snapshot[key]) ? snapshot[key] : []])
  );
}

function buildRecoverableProjectionSummary(snapshot = {}) {
  const recoverableSnapshot = pickRecoverableProjectionTables(snapshot);
  return {
    snapshot: recoverableSnapshot,
    counts: Object.fromEntries(
      Object.entries(recoverableSnapshot).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0])
    ),
    fingerprint: sha256(stableStringify(recoverableSnapshot)),
  };
}

async function rebuildStateMirror(targetPath, options = {}) {
  const [ledgerPayload, eventPayload] = await Promise.all([
    exportLedger(),
    exportSystemEvents(),
  ]);

  return rebuildStateFromLedgers({
    targetPath,
    ledgerPayload,
    eventPayload,
    overwrite: options.overwrite !== false,
  });
}

async function reconcileRecoverableProjectionToEventLedger() {
  const [ledgerPayload, eventPayload, liveProjection] = await Promise.all([
    exportLedger(),
    exportSystemEvents(),
    collectProjectionSnapshot(db),
  ]);

  const replayed = projectStateFromPayloads({ ledgerPayload, eventPayload });
  const liveRecoverable = buildRecoverableProjectionSummary(liveProjection.snapshot);
  const replayRecoverable = buildRecoverableProjectionSummary(replayed.snapshot);

  if (liveRecoverable.fingerprint === replayRecoverable.fingerprint) {
    return {
      reconciled: false,
      liveFingerprint: liveRecoverable.fingerprint,
      replayFingerprint: replayRecoverable.fingerprint,
      counts: liveRecoverable.counts,
    };
  }

  await eventLedgerService.initialize();
  const executor = getEventLedgerExecutor(db);
  await executor.run('BEGIN IMMEDIATE');
  try {
    await eventLedgerService.appendEvent({
      domain: 'projection',
      action: 'replace_snapshot',
      entityType: 'recoverable_state',
      entityId: 'main',
      metadata: {
        source: 'state_reconciliation',
        recoverableKeys: RECOVERABLE_PROJECTION_KEYS,
        fingerprint: liveRecoverable.fingerprint,
        counts: liveRecoverable.counts,
        snapshot: liveRecoverable.snapshot,
      },
    }, { executor, inTransaction: true });
    await executor.run('COMMIT');
  } catch (error) {
    await executor.run('ROLLBACK').catch(() => {});
    throw error;
  }

  return {
    reconciled: true,
    liveFingerprint: liveRecoverable.fingerprint,
    replayFingerprint: replayRecoverable.fingerprint,
    counts: liveRecoverable.counts,
  };
}

async function reconcileLiveProjectionFromRails() {
  const tempPath = path.join(os.tmpdir(), 'volt-live-reconcile.db');
  let attached = false;

  await rebuildStateMirror(tempPath, { overwrite: true });

  try {
    await runSql('PRAGMA foreign_keys = OFF');
    await runSql('BEGIN IMMEDIATE');
    await runSql(`ATTACH DATABASE ${quoteSqlString(tempPath)} AS recovered`);
    attached = true;

    await runSql(`DELETE FROM economy WHERE userID IS NULL OR TRIM(userID) = ''`);

    await runSql(`
      UPDATE economy
         SET username = COALESCE((SELECT r.username FROM recovered.economy r WHERE r.userID = economy.userID), username),
             profile_about_me = COALESCE((SELECT r.profile_about_me FROM recovered.economy r WHERE r.userID = economy.userID), profile_about_me),
             profile_specialties = COALESCE((SELECT r.profile_specialties FROM recovered.economy r WHERE r.userID = economy.userID), profile_specialties),
             profile_location = COALESCE((SELECT r.profile_location FROM recovered.economy r WHERE r.userID = economy.userID), profile_location),
             profile_twitter_handle = COALESCE((SELECT r.profile_twitter_handle FROM recovered.economy r WHERE r.userID = economy.userID), profile_twitter_handle),
             last_dao_call_reward_at = COALESCE((SELECT r.last_dao_call_reward_at FROM recovered.economy r WHERE r.userID = economy.userID), last_dao_call_reward_at),
             wallet = COALESCE((SELECT r.wallet FROM recovered.economy r WHERE r.userID = economy.userID), 0),
             bank = COALESCE((SELECT r.bank FROM recovered.economy r WHERE r.userID = economy.userID), 0)
       WHERE userID IS NOT NULL
         AND TRIM(userID) != ''
    `);

    await runSql(`
      INSERT INTO economy (
        userID, username, password, profile_about_me, profile_specialties, profile_location,
        profile_twitter_handle, last_dao_call_reward_at, wallet, bank
      )
      SELECT
        r.userID,
        r.username,
        NULL,
        r.profile_about_me,
        r.profile_specialties,
        r.profile_location,
        r.profile_twitter_handle,
        r.last_dao_call_reward_at,
        r.wallet,
        r.bank
      FROM recovered.economy r
      LEFT JOIN economy e ON e.userID = r.userID
      WHERE e.userID IS NULL
    `);

    const deleteOrder = [
      'chat_messages',
      'chat_presence',
      'robot_oil_history',
      'robot_oil_market',
      'item_redemptions',
      'dao_call_attendance',
      'raffle_ticket_purchases',
      'raffle_entries',
      'raffles',
      'title_giveaway_entries',
      'title_giveaways',
      'giveaway_entries',
      'giveaways',
      'job_submissions',
      'job_assignees',
      'job_cycle',
      'joblist',
      'inventory',
      'rps_games',
      'daily_user_activity',
      'items',
      'admins',
    ];
    for (const table of deleteOrder) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(`DELETE FROM ${table}`);
    }

    const insertStatements = [
      `INSERT INTO admins (userID) SELECT userID FROM recovered.admins`,
      `INSERT INTO items (itemID, name, description, price, isAvailable, isHidden, isRedeemable, quantity)
       SELECT itemID, name, description, price, isAvailable, isHidden, isRedeemable, quantity FROM recovered.items`,
      `INSERT INTO inventory (userID, itemID, quantity)
       SELECT userID, itemID, quantity FROM recovered.inventory`,
      `INSERT INTO daily_user_activity (userID, activity_date, message_count, reacted, first_message_bonus_given, rps_wins)
       SELECT userID, activity_date, message_count, reacted, first_message_bonus_given, rps_wins FROM recovered.daily_user_activity`,
      `INSERT INTO rps_games (game_id, challenger_id, opponent_id, channel_id, wager, challenger_choice, opponent_choice, created_at, expires_at)
       SELECT game_id, challenger_id, opponent_id, channel_id, wager, challenger_choice, opponent_choice, created_at, expires_at FROM recovered.rps_games`,
      `INSERT INTO joblist (jobID, description, cooldown_value, cooldown_unit)
       SELECT jobID, description, cooldown_value, cooldown_unit FROM recovered.joblist`,
      `INSERT INTO job_cycle (current_index)
       SELECT current_index FROM recovered.job_cycle`,
      `INSERT INTO job_assignees (jobID, userID)
       SELECT jobID, userID FROM recovered.job_assignees`,
      `INSERT INTO job_submissions (submission_id, userID, jobID, title, description, image_url, status, reward_amount, created_at, completed_at)
       SELECT submission_id, userID, jobID, title, description, image_url, status, reward_amount, created_at, completed_at FROM recovered.job_submissions`,
      `INSERT INTO giveaways (id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, is_completed)
       SELECT id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, COALESCE(is_completed, 0) FROM recovered.giveaways`,
      `INSERT INTO giveaway_entries (giveaway_id, user_id)
       SELECT giveaway_id, user_id FROM recovered.giveaway_entries`,
      `INSERT INTO title_giveaways (id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, is_completed)
       SELECT id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, COALESCE(is_completed, 0) FROM recovered.title_giveaways`,
      `INSERT INTO title_giveaway_entries (title_giveaway_id, user_id)
       SELECT title_giveaway_id, user_id FROM recovered.title_giveaway_entries`,
      `INSERT INTO raffles (id, channel_id, name, prize, cost, quantity, winners, end_time, is_completed)
       SELECT id, channel_id, name, prize, cost, quantity, winners, end_time, COALESCE(is_completed, 0) FROM recovered.raffles`,
      `INSERT INTO raffle_entries (entry_id, raffle_id, user_id)
       SELECT entry_id, raffle_id, user_id FROM recovered.raffle_entries`,
      `INSERT INTO raffle_ticket_purchases (raffle_id, user_id, purchased_count, bonus_10_given, bonus_25_given, bonus_50_given)
       SELECT raffle_id, user_id, purchased_count, bonus_10_given, bonus_25_given, bonus_50_given FROM recovered.raffle_ticket_purchases`,
      `INSERT INTO dao_call_attendance (attendance_id, userID, meeting_started_at, rewarded_at, minutes_attended, reward_amount)
       SELECT attendance_id, userID, meeting_started_at, rewarded_at, minutes_attended, reward_amount FROM recovered.dao_call_attendance`,
      `INSERT INTO item_redemptions (redemption_id, userID, user_tag, item_name, wallet_address, source, channel_name, channel_id, message_link, command_text, inventory_before, inventory_after, created_at)
       SELECT redemption_id, userID, user_tag, item_name, wallet_address, source, channel_name, channel_id, message_link, command_text, inventory_before, inventory_after, created_at FROM recovered.item_redemptions`,
      `INSERT INTO robot_oil_market (listing_id, seller_id, quantity, price_per_unit, type, created_at)
       SELECT listing_id, seller_id, quantity, price_per_unit, type, created_at FROM recovered.robot_oil_market`,
      `INSERT INTO robot_oil_history (history_id, event_type, buyer_id, seller_id, quantity, price_per_unit, total_price, created_at)
       SELECT history_id, event_type, buyer_id, seller_id, quantity, price_per_unit, total_price, created_at FROM recovered.robot_oil_history`,
      `INSERT INTO chat_messages (id, userID, username, message, is_admin, created_at)
       SELECT id, userID, username, message, is_admin, created_at FROM recovered.chat_messages`,
      `INSERT INTO chat_presence (userID, username, last_seen)
       SELECT userID, username, last_seen FROM recovered.chat_presence`,
    ];

    for (const statement of insertStatements) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(statement);
    }

    await runSql('COMMIT');
    await runSql('DETACH DATABASE recovered');
    attached = false;
    await runSql('PRAGMA foreign_keys = ON');
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    if (attached) {
      await runSql('DETACH DATABASE recovered').catch(() => {});
    }
    await runSql('PRAGMA foreign_keys = ON').catch(() => {});
    throw error;
  } finally {
    try {
      await fs.promises.unlink(tempPath);
    } catch (error) {
      // ignore temp cleanup errors
    }
  }
}

async function getReadableProfileDetails(userID, options = {}) {
  const row = await getSql(
    `SELECT username, profile_about_me, profile_specialties, profile_location, profile_twitter_handle
     FROM economy
     WHERE userID = ?`,
    [userID]
  );

  if (!row) {
    return null;
  }

  const decoded = decodeProfileRow(row, {
    maskOnFailure: options.maskOnFailure !== false,
  });

  return {
    username: decoded?.username || null,
    aboutMe: decoded?.profile_about_me || null,
    specialties: decoded?.profile_specialties || null,
    location: decoded?.profile_location || null,
    twitterHandle: decoded?.profile_twitter_handle || null,
  };
}

function compareActivityEntries(left, right) {
  const leftTimestamp = Number(left?.timestamp || 0);
  const rightTimestamp = Number(right?.timestamp || 0);
  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }

  const leftKind = String(left?.kind || '');
  const rightKind = String(right?.kind || '');
  if (leftKind !== rightKind) {
    return leftKind.localeCompare(rightKind);
  }

  return Number(left?.sequence || 0) - Number(right?.sequence || 0);
}

async function getCombinedActivity(options = {}) {
  const ledgerRows = await getFullLedger({ parse: true });
  const eventRows = (await getSystemEvents({ parse: true })).map((row) => ({
    ...row,
    metadata: decodeRedemptionMetadataFields(row.metadata),
  }));

  const merged = [
    ...ledgerRows.map((row) => ({
      kind: 'transaction',
      sequence: Number(row.id),
      timestamp: Number(row.timestamp),
      transactionId: Number(row.id),
      eventId: null,
      type: row.type,
      domain: 'ledger',
      action: row.type,
      actorUserId: row.from_user_id || row.to_user_id || null,
      entityType: 'transaction',
      entityId: String(row.id),
      amount: Number(row.amount),
      fromUserId: row.from_user_id || null,
      toUserId: row.to_user_id || null,
      metadata: row.metadata || {},
      previous_hash: row.previous_hash,
      hash: row.hash,
      chain: 'transactions',
      raw: row,
    })),
    ...eventRows.map((row) => ({
      kind: 'system_event',
      sequence: Number(row.id),
      timestamp: Number(row.timestamp),
      transactionId: null,
      eventId: Number(row.id),
      type: `${row.domain}.${row.action}`,
      domain: row.domain,
      action: row.action,
      actorUserId: row.actor_user_id || null,
      entityType: row.entity_type || null,
      entityId: row.entity_id || null,
      amount: null,
      fromUserId: null,
      toUserId: null,
      metadata: row.metadata || {},
      previous_hash: row.previous_hash,
      hash: row.hash,
      chain: 'system_events',
      raw: row,
    })),
  ].sort(compareActivityEntries);

  const sinceTimestamp = Number(options.sinceTimestamp || 0);
  const kindFilter = String(options.kind || '').trim().toLowerCase();
  const domainFilter = String(options.domain || '').trim().toLowerCase();
  const actorUserIdFilter = String(options.actorUserId || '').trim();
  const userIdFilter = String(options.userId || '').trim();
  const typeFilter = String(options.type || '').trim().toLowerCase();
  const query = String(options.q || '').trim().toLowerCase();

  let filtered = merged.filter((entry) => Number(entry.timestamp || 0) >= sinceTimestamp);

  if (kindFilter) {
    filtered = filtered.filter((entry) => String(entry.kind || '').toLowerCase() === kindFilter);
  }

  if (domainFilter) {
    filtered = filtered.filter((entry) => String(entry.domain || '').toLowerCase() === domainFilter);
  }

  if (actorUserIdFilter) {
    filtered = filtered.filter((entry) => String(entry.actorUserId || '') === actorUserIdFilter);
  }

  if (userIdFilter) {
    filtered = filtered.filter((entry) =>
      String(entry.actorUserId || '') === userIdFilter ||
      String(entry.fromUserId || '') === userIdFilter ||
      String(entry.toUserId || '') === userIdFilter ||
      String(entry.metadata?.userId || '') === userIdFilter ||
      String(entry.metadata?.userID || '') === userIdFilter ||
      String(entry.metadata?.fromUserID || '') === userIdFilter ||
      String(entry.metadata?.toUserID || '') === userIdFilter
    );
  }

  if (typeFilter) {
    filtered = filtered.filter((entry) =>
      String(entry.type || '').toLowerCase() === typeFilter ||
      String(entry.domain || '').toLowerCase() === typeFilter ||
      String(`${entry.domain}.${entry.action}` || '').toLowerCase() === typeFilter ||
      String(entry.action || '').toLowerCase() === typeFilter
    );
  }

  if (query) {
    filtered = filtered.filter((entry) => {
      const haystack = JSON.stringify({
        kind: entry.kind,
        type: entry.type,
        domain: entry.domain,
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        fromUserId: entry.fromUserId,
        toUserId: entry.toUserId,
        metadata: entry.metadata,
      }).toLowerCase();
      return haystack.includes(query);
    });
  }

  const totalCount = filtered.length;
  const order = String(options.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  if (order === 'desc') {
    filtered = filtered.slice().reverse();
  }

  const offset = Math.max(0, Number(options.offset || 0));
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  const entries = filtered.slice(offset, offset + limit);

  return {
    summary: {
      totalCount,
      transactionCount: ledgerRows.length,
      systemEventCount: eventRows.length,
      latestTimestamp: Number(merged[merged.length - 1]?.timestamp || 0),
      earliestTimestamp: Number(merged[0]?.timestamp || 0),
    },
    pagination: {
      limit,
      offset,
      hasMore: offset + entries.length < totalCount,
      order,
    },
    entries,
  };
}

async function exportCombinedActivity(options = {}) {
  await ensureLedgerBootstrap();
  await ensureSystemEventBootstrap();
  const ledgerIntegrity = await verifyLedgerIntegrity();
  const eventIntegrity = await verifySystemEventIntegrity();
  const activity = await getCombinedActivity({
    ...options,
    order: 'asc',
    offset: 0,
    limit: Number.MAX_SAFE_INTEGER,
  });

  const payload = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    rails: {
      transactions: {
        count: Number(ledgerIntegrity.transactionCount || 0),
        latestHash: ledgerIntegrity.latestHash || null,
        valid: Boolean(ledgerIntegrity.valid),
      },
      systemEvents: {
        count: Number(eventIntegrity.eventCount || 0),
        latestHash: eventIntegrity.latestHash || null,
        valid: Boolean(eventIntegrity.valid),
      },
    },
    summary: activity.summary,
    entries: activity.entries,
  };

  if (options.outputPath) {
    const resolvedPath = path.resolve(options.outputPath);
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(resolvedPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  return payload;
}

const SYSTEM_EVENT_SNAPSHOT_NAME = 'legacy_system_state_v1';

async function ensureSystemEventSnapshotTable() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS system_event_snapshots (
      snapshot_name TEXT PRIMARY KEY,
      snapshot_at INTEGER NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      last_event_id INTEGER
    )
  `);
}

async function tableExists(tableName) {
  const row = await getSql(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return Boolean(row?.name);
}

async function snapshotSystemEventState(snapshotName = SYSTEM_EVENT_SNAPSHOT_NAME) {
  await eventLedgerService.initialize();
  await ensureSystemEventSnapshotTable();

  const existingSnapshot = await getSql(
    `SELECT snapshot_name, event_count, last_event_id
     FROM system_event_snapshots
     WHERE snapshot_name = ?`,
    [snapshotName]
  );

  if (existingSnapshot) {
    return {
      created: false,
      snapshotName,
      eventCount: existingSnapshot.event_count || 0,
      lastEventId: existingSnapshot.last_event_id || null,
    };
  }

  const snapshotConfigs = [
    {
      tableName: 'admins',
      query: `SELECT userID FROM admins ORDER BY userID ASC`,
      domain: 'admin',
      entityType: 'admin_user',
      entityId: (row) => row.userID,
    },
    {
      tableName: 'economy',
      query: `SELECT userID, username, profile_about_me, profile_specialties, profile_location, profile_twitter_handle, last_dao_call_reward_at
              FROM economy
              WHERE userID IS NOT NULL AND TRIM(userID) != ''
              ORDER BY userID ASC`,
      domain: 'accounts',
      entityType: 'economy_user',
      entityId: (row) => row.userID,
    },
    {
      tableName: 'items',
      query: `SELECT * FROM items ORDER BY itemID ASC`,
      domain: 'shop',
      entityType: 'item',
      entityId: (row) => row.itemID,
    },
    {
      tableName: 'inventory',
      query: `SELECT * FROM inventory ORDER BY userID ASC, itemID ASC`,
      domain: 'inventory',
      entityType: 'inventory_item',
      entityId: (row) => `${row.userID}:${row.itemID}`,
    },
    {
      tableName: 'daily_user_activity',
      query: `SELECT * FROM daily_user_activity ORDER BY activity_date ASC, userID ASC`,
      domain: 'daily_activity',
      entityType: 'daily_user_activity',
      entityId: (row) => `${row.userID}:${row.activity_date}`,
    },
    {
      tableName: 'rps_games',
      query: `SELECT * FROM rps_games ORDER BY game_id ASC`,
      domain: 'rps',
      entityType: 'rps_game',
      entityId: (row) => row.game_id,
    },
    {
      tableName: 'joblist',
      query: `SELECT * FROM joblist ORDER BY jobID ASC`,
      domain: 'jobs',
      entityType: 'job',
      entityId: (row) => row.jobID,
    },
    {
      tableName: 'job_assignees',
      query: `SELECT * FROM job_assignees ORDER BY userID ASC, jobID ASC`,
      domain: 'jobs',
      entityType: 'job_assignment',
      entityId: (row) => `${row.userID}:${row.jobID}`,
    },
    {
      tableName: 'job_submissions',
      query: `SELECT * FROM job_submissions ORDER BY submission_id ASC`,
      domain: 'jobs',
      entityType: 'job_submission',
      entityId: (row) => row.submission_id,
    },
    {
      tableName: 'job_cycle',
      query: `SELECT current_index FROM job_cycle`,
      domain: 'jobs',
      entityType: 'job_cycle',
      entityId: () => 'job_cycle',
    },
    {
      tableName: 'dao_call_attendance',
      query: `SELECT * FROM dao_call_attendance ORDER BY rewarded_at ASC, userID ASC`,
      domain: 'dao_calls',
      entityType: 'dao_call_attendance',
      entityId: (row) => `${row.userID}:${row.meeting_started_at}`,
    },
    {
      tableName: 'giveaways',
      query: `SELECT * FROM giveaways ORDER BY id ASC`,
      domain: 'giveaways',
      entityType: 'giveaway',
      entityId: (row) => row.id,
    },
    {
      tableName: 'giveaway_entries',
      query: `SELECT * FROM giveaway_entries ORDER BY giveaway_id ASC, user_id ASC`,
      domain: 'giveaways',
      entityType: 'giveaway_entry',
      entityId: (row) => `${row.giveaway_id}:${row.user_id}`,
    },
    {
      tableName: 'title_giveaways',
      query: `SELECT * FROM title_giveaways ORDER BY id ASC`,
      domain: 'title_giveaways',
      entityType: 'title_giveaway',
      entityId: (row) => row.id,
    },
    {
      tableName: 'title_giveaway_entries',
      query: `SELECT * FROM title_giveaway_entries ORDER BY title_giveaway_id ASC, user_id ASC`,
      domain: 'title_giveaways',
      entityType: 'title_giveaway_entry',
      entityId: (row) => `${row.title_giveaway_id}:${row.user_id}`,
    },
    {
      tableName: 'raffles',
      query: `SELECT * FROM raffles ORDER BY id ASC`,
      domain: 'raffles',
      entityType: 'raffle',
      entityId: (row) => row.id,
    },
    {
      tableName: 'raffle_entries',
      query: `SELECT * FROM raffle_entries ORDER BY entry_id ASC`,
      domain: 'raffles',
      entityType: 'raffle_entry',
      entityId: (row) => row.entry_id,
    },
    {
      tableName: 'raffle_ticket_purchases',
      query: `SELECT * FROM raffle_ticket_purchases ORDER BY raffle_id ASC, user_id ASC`,
      domain: 'raffles',
      entityType: 'raffle_ticket_purchase',
      entityId: (row) => `${row.raffle_id}:${row.user_id}`,
    },
    {
      tableName: 'robot_oil_market',
      query: `SELECT * FROM robot_oil_market ORDER BY listing_id ASC`,
      domain: 'robot_oil_market',
      entityType: 'robot_oil_listing',
      entityId: (row) => row.listing_id,
    },
    {
      tableName: 'robot_oil_history',
      query: `SELECT * FROM robot_oil_history ORDER BY history_id ASC`,
      domain: 'robot_oil_market',
      entityType: 'robot_oil_history',
      entityId: (row) => row.history_id,
    },
    {
      tableName: 'item_redemptions',
      query: `SELECT * FROM item_redemptions ORDER BY redemption_id ASC`,
      domain: 'inventory',
      entityType: 'item_redemption',
      entityId: (row) => row.redemption_id,
    },
    {
      tableName: 'chat_messages',
      query: `SELECT * FROM chat_messages ORDER BY id ASC`,
      domain: 'chat',
      entityType: 'chat_message',
      entityId: (row) => row.id,
    },
    {
      tableName: 'chat_presence',
      query: `SELECT * FROM chat_presence ORDER BY userID ASC`,
      domain: 'chat',
      entityType: 'chat_presence',
      entityId: (row) => row.userID,
    },
    {
      tableName: 'users',
      query: `SELECT id, username FROM users ORDER BY id ASC`,
      domain: 'web_auth',
      entityType: 'local_user',
      entityId: (row) => row.id,
    },
  ];

  const executor = getEventLedgerExecutor(db);
  const timestamp = Math.floor(Date.now() / 1000);
  let eventCount = 0;
  let lastEventId = null;

  await runSql('BEGIN IMMEDIATE');
  try {
    for (const config of snapshotConfigs) {
      // Skip website-only tables in environments where they do not exist yet.
      // This keeps bot-only and CLI contexts safe.
      // eslint-disable-next-line no-await-in-loop
      const exists = await tableExists(config.tableName);
      if (!exists) continue;

      // eslint-disable-next-line no-await-in-loop
      const rows = await allSql(config.query);
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        const event = await eventLedgerService.appendEvent({
          timestamp,
          domain: config.domain,
          action: 'snapshot_bootstrap',
          entityType: config.entityType,
          entityId: config.entityId(row),
          metadata: {
            snapshotName,
            tableName: config.tableName,
            row,
          },
        }, { executor, inTransaction: true });

        eventCount += 1;
        lastEventId = event.id;
      }
    }

    await runSql(
      `INSERT INTO system_event_snapshots (snapshot_name, snapshot_at, event_count, last_event_id)
       VALUES (?, ?, ?, ?)`,
      [snapshotName, timestamp, eventCount, lastEventId]
    );

    await runSql('COMMIT');
    return {
      created: true,
      snapshotName,
      eventCount,
      lastEventId,
    };
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function ensureSystemEventBootstrap() {
  if (!systemEventSnapshotPromise) {
    systemEventSnapshotPromise = snapshotSystemEventState().catch((error) => {
      systemEventSnapshotPromise = null;
      console.error('❌ Failed to bootstrap system event ledger from current application state:', error);
      throw error;
    });
  }

  return systemEventSnapshotPromise;
}

async function migrateProtectedProfilesToCiphertext() {
  const rawAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows || []);
    });
  });
  const rawRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ changes: this.changes ?? 0, lastID: this.lastID ?? null });
    });
  });

  const rows = await rawAll(
    `SELECT userID, username, profile_about_me, profile_specialties, profile_location, profile_twitter_handle
     FROM economy
     WHERE (profile_about_me IS NOT NULL AND TRIM(profile_about_me) != '')
        OR (profile_specialties IS NOT NULL AND TRIM(profile_specialties) != '')
        OR (profile_location IS NOT NULL AND TRIM(profile_location) != '')`
  );

  for (const row of rows) {
    const nextAbout = encryptProtectedProfileValue(row.profile_about_me);
    const nextSpecialties = encryptProtectedProfileValue(row.profile_specialties);
    const nextLocation = encryptProtectedProfileValue(row.profile_location);
    const changed =
      nextAbout !== (row.profile_about_me || null) ||
      nextSpecialties !== (row.profile_specialties || null) ||
      nextLocation !== (row.profile_location || null);

    if (!changed) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await rawRun(
      `UPDATE economy
       SET profile_about_me = ?,
           profile_specialties = ?,
           profile_location = ?
       WHERE userID = ?`,
      [nextAbout, nextSpecialties, nextLocation, row.userID]
    );

    // eslint-disable-next-line no-await-in-loop
    await appendSystemEvent({
      domain: 'profile',
      action: 'update',
      entityType: 'user_profile',
      entityId: row.userID,
      actorUserId: row.userID,
      metadata: {
        userID: row.userID,
        before: {
          username: row.username || null,
          aboutMe: row.profile_about_me || null,
          specialties: row.profile_specialties || null,
          location: row.profile_location || null,
          twitterHandle: row.profile_twitter_handle || null,
        },
        after: {
          username: row.username || null,
          aboutMe: nextAbout,
          specialties: nextSpecialties,
          location: nextLocation,
          twitterHandle: row.profile_twitter_handle || null,
        },
        source: 'profile_encryption_migration',
      },
    }, { skipBootstrap: true });
  }
}

async function migrateItemRedemptionWalletsToCiphertext() {
  const rawAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows || []);
    });
  });
  const rawRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ changes: this.changes ?? 0, lastID: this.lastID ?? null });
    });
  });

  const rows = await rawAll(
    `SELECT redemption_id, wallet_address, command_text
     FROM item_redemptions
     WHERE (wallet_address IS NOT NULL AND TRIM(wallet_address) != '')
        OR (command_text IS NOT NULL AND TRIM(command_text) != '')`
  );

  let migratedCount = 0;
  for (const row of rows) {
    const nextWalletAddress = encryptProtectedProfileValue(row.wallet_address);
    const nextCommandText = redactWalletCommandText(row.command_text);
    const walletChanged = nextWalletAddress !== (row.wallet_address || null);
    const commandChanged = nextCommandText !== (row.command_text || null);
    if (!walletChanged && !commandChanged) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await rawRun(
      `UPDATE item_redemptions
       SET wallet_address = ?,
           command_text = ?
       WHERE redemption_id = ?`,
      [nextWalletAddress, nextCommandText, row.redemption_id]
    );
    migratedCount += 1;
  }

  if (migratedCount > 0) {
    console.log(`🔐 Encrypted ${migratedCount} item redemption wallet entr${migratedCount === 1 ? 'y' : 'ies'}.`);
  }
}

function readLegacyTrackerMap(filePath) {
  try {
    if (!fs.existsSync(filePath)) return new Map();
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];
    return new Map(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    console.error(`⚠️ Failed to read legacy tracker ${filePath}:`, error);
    return new Map();
  }
}

async function migrateLegacyAncillaryStateToDb() {
  const rawGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row || null);
    });
  });
  const rawRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ changes: this.changes ?? 0, lastID: this.lastID ?? null });
    });
  });

  const [dailyActivityCountRow, rpsGamesCountRow] = await Promise.all([
    rawGet(`SELECT COUNT(*) AS count FROM daily_user_activity`),
    rawGet(`SELECT COUNT(*) AS count FROM rps_games`),
  ]);

  if (!Number(dailyActivityCountRow?.count || 0)) {
    const messageMap = readLegacyTrackerMap(LEGACY_USER_MESSAGE_COUNTS_PATH);
    const rpsWinMap = readLegacyTrackerMap(LEGACY_RPS_WIN_TRACKER_PATH);
    const keys = new Set([...messageMap.keys(), ...rpsWinMap.keys()]);

    for (const userID of keys) {
      const messageEntry = messageMap.get(userID) || {};
      const rpsEntry = rpsWinMap.get(userID) || {};
      const activityDate = String(messageEntry.date || rpsEntry.date || '').trim();
      if (!userID || !activityDate) continue;

      // eslint-disable-next-line no-await-in-loop
      await rawRun(
        `INSERT OR REPLACE INTO daily_user_activity (
           userID,
           activity_date,
           message_count,
           reacted,
           first_message_bonus_given,
           rps_wins
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userID,
          activityDate,
          Number(messageEntry.count || 0),
          messageEntry.reacted ? 1 : 0,
          (messageEntry.firstMessageBonusGiven || messageEntry.firstMessage) ? 1 : 0,
          Number(rpsEntry.wins || 0),
        ]
      );
    }
  }

  if (!Number(rpsGamesCountRow?.count || 0)) {
    const rpsGames = readLegacyTrackerMap(LEGACY_RPS_GAMES_PATH);
    const now = Date.now();

    for (const [gameId, game] of rpsGames.entries()) {
      if (!gameId || !game?.challengerId || !game?.opponentId || !game?.channelId) continue;
      const createdAt = Number(game.createdAt || now);
      const expiresAt = Number(game.expiresAt || (createdAt + (2 * 60 * 60 * 1000)));

      // eslint-disable-next-line no-await-in-loop
      await rawRun(
        `INSERT OR REPLACE INTO rps_games (
           game_id,
           challenger_id,
           opponent_id,
           channel_id,
           wager,
           challenger_choice,
           opponent_choice,
           created_at,
           expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          gameId,
          String(game.challengerId),
          String(game.opponentId),
          String(game.channelId),
          Number(game.wager || 0),
          game.choices?.[game.challengerId] || null,
          game.choices?.[game.opponentId] || null,
          createdAt,
          expiresAt,
        ]
      );
    }
  }
}

async function getDailyUserActivity(userID, activityDate = getCurrentESTDateString()) {
  if (!userID) return null;
  return getSql(
    `SELECT userID, activity_date, message_count, reacted, first_message_bonus_given, rps_wins
     FROM daily_user_activity
     WHERE userID = ? AND activity_date = ?`,
    [userID, activityDate]
  );
}

async function getDailyUserActivitySnapshot(userID, activityDate = getCurrentESTDateString()) {
  const row = await getDailyUserActivity(userID, activityDate);
  return {
    userID: String(userID || ''),
    date: activityDate,
    count: Number(row?.message_count || 0),
    reacted: Boolean(row?.reacted),
    firstMessageBonusGiven: Boolean(row?.first_message_bonus_given),
    rpsWins: Number(row?.rps_wins || 0),
  };
}

async function upsertDailyUserActivity(userID, activityDate, fields = {}, options = {}) {
  if (!userID || !activityDate) {
    throw new Error('userID and activityDate are required for daily user activity.');
  }

  const current = await getDailyUserActivitySnapshot(userID, activityDate);
  const next = {
    userID: String(userID),
    date: String(activityDate),
    count: Number(fields.count ?? current.count ?? 0),
    reacted: Boolean(fields.reacted ?? current.reacted),
    firstMessageBonusGiven: Boolean(fields.firstMessageBonusGiven ?? current.firstMessageBonusGiven),
    rpsWins: Number(fields.rpsWins ?? current.rpsWins ?? 0),
  };

  await runSql(
    `INSERT INTO daily_user_activity (
       userID,
       activity_date,
       message_count,
       reacted,
       first_message_bonus_given,
       rps_wins
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(userID, activity_date) DO UPDATE SET
       message_count = excluded.message_count,
       reacted = excluded.reacted,
       first_message_bonus_given = excluded.first_message_bonus_given,
       rps_wins = excluded.rps_wins`,
    [
      next.userID,
      next.date,
      next.count,
      next.reacted ? 1 : 0,
      next.firstMessageBonusGiven ? 1 : 0,
      next.rpsWins,
    ]
  );

  if (!options.skipEvent) {
    await appendSystemEvent({
      domain: 'daily_activity',
      action: 'upsert',
      entityType: 'daily_user_activity',
      entityId: `${next.userID}:${next.date}`,
      actorUserId: next.userID,
      metadata: {
        userID: next.userID,
        date: next.date,
        before: current,
        after: next,
        reason: options.reason || null,
      },
    });
  }

  return next;
}

async function saveRpsGame(gameId, game, options = {}) {
  if (!gameId || !game?.challengerId || !game?.opponentId || !game?.channelId) {
    throw new Error('gameId, challengerId, opponentId, and channelId are required.');
  }

  const existing = await getSql(
    `SELECT game_id, challenger_id, opponent_id, channel_id, wager, challenger_choice, opponent_choice, created_at, expires_at
     FROM rps_games
     WHERE game_id = ?`,
    [gameId]
  );

  const challengerChoice = game.choices?.[game.challengerId] || game.challenger_choice || null;
  const opponentChoice = game.choices?.[game.opponentId] || game.opponent_choice || null;
  const createdAt = Number(game.createdAt || game.created_at || Date.now());
  const expiresAt = Number(game.expiresAt || game.expires_at || createdAt);

  await runSql(
    `INSERT INTO rps_games (
       game_id,
       challenger_id,
       opponent_id,
       channel_id,
       wager,
       challenger_choice,
       opponent_choice,
       created_at,
       expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_id) DO UPDATE SET
       challenger_id = excluded.challenger_id,
       opponent_id = excluded.opponent_id,
       channel_id = excluded.channel_id,
       wager = excluded.wager,
       challenger_choice = excluded.challenger_choice,
       opponent_choice = excluded.opponent_choice,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
    [
      gameId,
      String(game.challengerId),
      String(game.opponentId),
      String(game.channelId),
      Number(game.wager || 0),
      challengerChoice,
      opponentChoice,
      createdAt,
      expiresAt,
    ]
  );

  if (!options.skipEvent) {
    await appendSystemEvent({
      domain: 'rps',
      action: existing ? 'update_game' : 'create_game',
      entityType: 'rps_game',
      entityId: gameId,
      actorUserId: String(game.challengerId),
      metadata: {
        gameId,
        before: existing ? {
          gameId: existing.game_id,
          challengerId: existing.challenger_id,
          opponentId: existing.opponent_id,
          channelId: existing.channel_id,
          wager: Number(existing.wager || 0),
          challengerChoice: existing.challenger_choice || null,
          opponentChoice: existing.opponent_choice || null,
          createdAt: Number(existing.created_at || 0),
          expiresAt: Number(existing.expires_at || 0),
        } : null,
        after: {
          gameId,
          challengerId: String(game.challengerId),
          opponentId: String(game.opponentId),
          channelId: String(game.channelId),
          wager: Number(game.wager || 0),
          challengerChoice,
          opponentChoice,
          createdAt,
          expiresAt,
        },
        reason: options.reason || null,
      },
    });
  }
}

async function deleteRpsGame(gameId, options = {}) {
  if (!gameId) return false;
  const existing = await getSql(
    `SELECT game_id, challenger_id, opponent_id, channel_id, wager, challenger_choice, opponent_choice, created_at, expires_at
     FROM rps_games
     WHERE game_id = ?`,
    [gameId]
  );
  if (!existing) return false;

  await runSql(`DELETE FROM rps_games WHERE game_id = ?`, [gameId]);

  if (!options.skipEvent) {
    await appendSystemEvent({
      domain: 'rps',
      action: 'delete_game',
      entityType: 'rps_game',
      entityId: gameId,
      actorUserId: existing.challenger_id,
      metadata: {
        gameId,
        before: {
          gameId: existing.game_id,
          challengerId: existing.challenger_id,
          opponentId: existing.opponent_id,
          channelId: existing.channel_id,
          wager: Number(existing.wager || 0),
          challengerChoice: existing.challenger_choice || null,
          opponentChoice: existing.opponent_choice || null,
          createdAt: Number(existing.created_at || 0),
          expiresAt: Number(existing.expires_at || 0),
        },
        reason: options.reason || null,
      },
    });
  }

  return true;
}

async function listActiveRpsGames() {
  const rows = await allSql(
    `SELECT game_id, challenger_id, opponent_id, channel_id, wager, challenger_choice, opponent_choice, created_at, expires_at
     FROM rps_games
     ORDER BY created_at ASC, game_id ASC`
  );

  return rows.map((row) => ({
    gameId: row.game_id,
    challengerId: row.challenger_id,
    opponentId: row.opponent_id,
    channelId: row.channel_id,
    wager: Number(row.wager || 0),
    choices: {
      [row.challenger_id]: row.challenger_choice || undefined,
      [row.opponent_id]: row.opponent_choice || undefined,
    },
    createdAt: Number(row.created_at || 0),
    expiresAt: Number(row.expires_at || 0),
  }));
}

async function backfillMissingShopItemsToEventLedger() {
  const [items, events] = await Promise.all([
    allSql(
      `SELECT itemID, name, description, price, isAvailable, isHidden, isRedeemable, quantity
       FROM items
       ORDER BY itemID ASC`
    ),
    getSystemEvents({ parse: true }),
  ]);
  await eventLedgerService.initialize();
  const executor = getEventLedgerExecutor(db);

  const trackedShopItemActions = new Set([
    'snapshot_bootstrap',
    'create_item',
    'upsert_item',
    'update_item',
    'deactivate_item',
    'delete_item',
  ]);
  const trackedItemIds = new Set();
  for (const event of events || []) {
    if (String(event?.domain || '') !== 'shop') continue;
    if (!trackedShopItemActions.has(String(event?.action || ''))) continue;

    const metadata = event?.metadata || {};
    const candidateIds = [
      event?.entity_id,
      metadata?.itemID,
      metadata?.row?.itemID,
      metadata?.before?.itemID,
      metadata?.after?.itemID,
    ];

    for (const candidate of candidateIds) {
      const normalized = Number(candidate);
      if (Number.isFinite(normalized) && normalized > 0) {
        trackedItemIds.add(normalized);
      }
    }
  }

  for (const item of items) {
    const itemId = Number(item?.itemID || 0);
    if (!itemId || trackedItemIds.has(itemId)) {
      continue;
    }

    await executor.run('BEGIN IMMEDIATE');
    try {
      await eventLedgerService.appendEvent({
        domain: 'shop',
        action: 'upsert_item',
        entityType: 'item',
        entityId: itemId,
        metadata: {
          itemID: itemId,
          source: 'state_reconciliation',
          before: null,
          after: {
            itemID: itemId,
            name: item.name,
            description: item.description,
            price: item.price,
            isAvailable: item.isAvailable,
            isHidden: item.isHidden,
            isRedeemable: item.isRedeemable,
            quantity: item.quantity,
          },
          quantityAdded: item.quantity,
          previousQuantity: 0,
          resultingQuantity: item.quantity,
        },
      }, { executor, inTransaction: true });
      await executor.run('COMMIT');
    } catch (error) {
      await executor.run('ROLLBACK').catch(() => {});
      throw error;
    }

    console.log(`🧰 Shop backfill: appended item ${itemId}`);
  }
}

async function cleanupOrphanedRecoverableRows() {
  const cleanupStatements = [
    `DELETE FROM giveaway_entries
     WHERE giveaway_id NOT IN (SELECT id FROM giveaways)`,
    `DELETE FROM title_giveaway_entries
     WHERE title_giveaway_id NOT IN (SELECT id FROM title_giveaways)`,
    `DELETE FROM raffle_entries
     WHERE raffle_id NOT IN (SELECT id FROM raffles)`,
    `DELETE FROM raffle_ticket_purchases
     WHERE raffle_id NOT IN (SELECT id FROM raffles)`,
    `DELETE FROM inventory
     WHERE itemID NOT IN (SELECT itemID FROM items)`,
  ];

  await runSql('BEGIN IMMEDIATE');
  try {
    for (const statement of cleanupStatements) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(statement);
    }
    await runSql('COMMIT');
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function runRecoverableProjectionMaintenance() {
  await ensureLedgerBootstrap();
  await syncAllEconomyBalancesFromLedger();
  await cleanupOrphanedRecoverableRows();
  await ensureSystemEventBootstrap();
  await backfillMissingShopItemsToEventLedger();
  return reconcileRecoverableProjectionToEventLedger();
}

function ensureRecoverableProjectionMaintenance() {
  if (!recoverableMaintenancePromise) {
    recoverableMaintenancePromise = runRecoverableProjectionMaintenance()
      .then((result) => {
        console.log('✅ Recoverable projection maintenance complete.');
        return result;
      })
      .catch((error) => {
        recoverableMaintenancePromise = null;
        console.error('❌ Recoverable projection maintenance failed:', error);
        throw error;
      });
  }

  return recoverableMaintenancePromise;
}

// =========================================================================
// Database Initialization
// =========================================================================
function initializeDatabase() {
  if (databaseInitializationPromise) {
    return databaseInitializationPromise;
  }

  databaseInitializationPromise = new Promise((resolve, reject) => {
    db.serialize(() => {
      console.log('🔄 Initializing database tables...');

    // Economy Table (Users, Wallet, Bank, Login Data)
    db.run(`
      CREATE TABLE IF NOT EXISTS economy (
        userID TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        profile_about_me TEXT,
        profile_specialties TEXT,
        profile_location TEXT,
        last_dao_call_reward_at INTEGER,
        wallet INTEGER DEFAULT 0,
        bank INTEGER DEFAULT 0
      )
    `, (err) => {
      if (err) console.error('❌ Error creating economy table:', err);
      else console.log('✅ Economy table is ready.');
    });

    // Ensure 'username' and 'password' columns exist
    db.all("PRAGMA table_info(economy)", (err, columns) => {
      if (err) {
        console.error("❌ Error checking economy table structure:", err);
      } else {
        const hasUsername = columns.some(col => col.name === "username");
        const hasPassword = columns.some(col => col.name === "password");
        const hasProfileAboutMe = columns.some(col => col.name === "profile_about_me");
        const hasProfileSpecialties = columns.some(col => col.name === "profile_specialties");
        const hasProfileLocation = columns.some(col => col.name === "profile_location");
        const hasProfileTwitterHandle = columns.some(col => col.name === "profile_twitter_handle");
        const hasLastDaoCallRewardAt = columns.some(col => col.name === "last_dao_call_reward_at");

        if (!hasUsername) {
          db.all("PRAGMA table_info(economy)", (err, columns) => {
            if (err) {
              console.error("❌ Error checking economy table structure:", err);
            } else {
              const hasUsername = columns.some(col => col.name === "username");
          
              if (!hasUsername) {
                console.log("➕ Adding missing 'username' column...");
                db.run("ALTER TABLE economy ADD COLUMN username TEXT", (alterErr) => {
                  if (alterErr) console.error("❌ Error adding 'username' column:", alterErr);
                  else console.log("✅ 'username' column added successfully.");
                });
              } else {
                console.log("✅ 'username' column already exists, skipping alteration.");
              }
            }
          });
          
        }

        if (!hasPassword) {
          console.log("➕ Adding missing 'password' column...");
          db.run("ALTER TABLE economy ADD COLUMN password TEXT", (alterErr) => {
            if (alterErr) console.error("❌ Error adding 'password' column:", alterErr);
            else console.log("✅ 'password' column added successfully.");
          });
        }

        if (!hasProfileAboutMe) {
          console.log("➕ Adding missing 'profile_about_me' column...");
          db.run("ALTER TABLE economy ADD COLUMN profile_about_me TEXT", (alterErr) => {
            if (alterErr) console.error("❌ Error adding 'profile_about_me' column:", alterErr);
            else console.log("✅ 'profile_about_me' column added successfully.");
          });
        }

        if (!hasProfileSpecialties) {
          console.log("➕ Adding missing 'profile_specialties' column...");
          db.run("ALTER TABLE economy ADD COLUMN profile_specialties TEXT", (alterErr) => {
            if (alterErr) console.error("❌ Error adding 'profile_specialties' column:", alterErr);
            else console.log("✅ 'profile_specialties' column added successfully.");
          });
        }

        if (!hasProfileLocation) {
          console.log("➕ Adding missing 'profile_location' column...");
          db.run("ALTER TABLE economy ADD COLUMN profile_location TEXT", (alterErr) => {
            if (alterErr) console.error("❌ Error adding 'profile_location' column:", alterErr);
            else console.log("✅ 'profile_location' column added successfully.");
          });
        }

        if (!hasProfileTwitterHandle) {
          console.log("➕ Adding missing 'profile_twitter_handle' column...");
          db.run("ALTER TABLE economy ADD COLUMN profile_twitter_handle TEXT", (alterErr) => {
            if (alterErr) console.error("❌ Error adding 'profile_twitter_handle' column:", alterErr);
            else console.log("✅ 'profile_twitter_handle' column added successfully.");
          });
        }

        if (!hasLastDaoCallRewardAt) {
          console.log("➕ Adding missing 'last_dao_call_reward_at' column...");
          db.run("ALTER TABLE economy ADD COLUMN last_dao_call_reward_at INTEGER", (alterErr) => {
            if (alterErr) console.error("❌ Error adding 'last_dao_call_reward_at' column:", alterErr);
            else console.log("✅ 'last_dao_call_reward_at' column added successfully.");
          });
        }
      }
    });



    // Items Table
    db.run(`
      CREATE TABLE IF NOT EXISTS items (
        itemID INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        description TEXT,
        price INTEGER,
        isAvailable BOOLEAN DEFAULT 1,
        isHidden BOOLEAN DEFAULT 0,
        isRedeemable BOOLEAN DEFAULT 1,
        quantity INTEGER DEFAULT 1
      )
    `, (err) => {
      if (err) console.error('❌ Error creating items table:', err);
      else console.log('✅ Items table is ready.');
    });

    db.all(`PRAGMA table_info(items)`, (err, columns) => {
      if (err) {
        console.error('❌ Failed to inspect items table:', err);
        return;
      }
      const hasIsHidden = columns.some(col => col.name === 'isHidden');
      if (!hasIsHidden) {
        console.log("➕ Adding missing 'isHidden' column to items table...");
        db.run("ALTER TABLE items ADD COLUMN isHidden BOOLEAN DEFAULT 0", (alterErr) => {
          if (alterErr) console.error("❌ Error adding 'isHidden' column:", alterErr);
          else console.log("✅ 'isHidden' column added successfully.");
        });
      }
      const hasIsRedeemable = columns.some(col => col.name === 'isRedeemable');
      if (!hasIsRedeemable) {
        console.log("➕ Adding missing 'isRedeemable' column to items table...");
        db.run("ALTER TABLE items ADD COLUMN isRedeemable BOOLEAN DEFAULT 1", (alterErr) => {
          if (alterErr) console.error("❌ Error adding 'isRedeemable' column:", alterErr);
          else console.log("✅ 'isRedeemable' column added successfully.");
        });
      }
    });

    
// Robot Oil Market Table
db.run(`
  CREATE TABLE IF NOT EXISTS robot_oil_market (
  listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_per_unit INTEGER NOT NULL,
  type TEXT DEFAULT 'sale',  -- ✅ Add this line
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
)

`, (err) => {
  if (err) {
    console.error('❌ Error creating robot_oil_market table:', err);
  } else {
    console.log('✅ Robot Oil Market table is ready.');

    // Check for and migrate 'type' column
    db.all(`PRAGMA table_info(robot_oil_market)`, (err, columns) => {
      if (err) {
        console.error('❌ Failed to inspect robot_oil_market table:', err);
        return;
      }

      const hasTypeColumn = columns.some(col => col.name === 'type');

      if (!hasTypeColumn) {
        db.serialize(() => {
          db.run(`ALTER TABLE robot_oil_market ADD COLUMN type TEXT DEFAULT 'sale'`);
          db.run(`UPDATE robot_oil_market SET type = 'sale' WHERE type IS NULL`);
          console.log('⚙️ Migrated: Added "type" column to robot_oil_market');
        });
      } else {
        console.log('✅ "type" column already exists in robot_oil_market');
      }
    });
  }
});

// Robot Oil History Table
db.run(`
  CREATE TABLE IF NOT EXISTS robot_oil_history (
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    buyer_id TEXT,
    seller_id TEXT,
    quantity INTEGER NOT NULL,
    price_per_unit INTEGER NOT NULL,
    total_price INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`, (err) => {
  if (err) console.error('❌ Error creating robot_oil_history table:', err);
  else console.log('✅ Robot Oil History table is ready.');
});




    // Inventory Table
    db.run(`
      CREATE TABLE IF NOT EXISTS inventory (
        userID TEXT,
        itemID INTEGER,
        quantity INTEGER DEFAULT 1,
        PRIMARY KEY(userID, itemID),
        FOREIGN KEY(itemID) REFERENCES items(itemID)
      )
    `, (err) => {
      if (err) console.error('❌ Error creating inventory table:', err);
      else console.log('✅ Inventory table is ready.');
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS daily_user_activity (
        userID TEXT NOT NULL,
        activity_date TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        reacted INTEGER DEFAULT 0,
        first_message_bonus_given INTEGER DEFAULT 0,
        rps_wins INTEGER DEFAULT 0,
        PRIMARY KEY(userID, activity_date)
      )
    `, (err) => {
      if (err) console.error('❌ Error creating daily_user_activity table:', err);
      else console.log('✅ Daily user activity table is ready.');
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS rps_games (
        game_id TEXT PRIMARY KEY,
        challenger_id TEXT NOT NULL,
        opponent_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        wager INTEGER NOT NULL,
        challenger_choice TEXT,
        opponent_choice TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `, (err) => {
      if (err) console.error('❌ Error creating rps_games table:', err);
      else console.log('✅ RPS games table is ready.');
    });

    // Admins Table
    db.run(`
      CREATE TABLE IF NOT EXISTS admins (
        userID TEXT PRIMARY KEY
      )
    `, (err) => {
      if (err) console.error('❌ Error creating admins table:', err);
      else console.log('✅ Admins table is ready.');
    });

    // Job System Tables
    db.run(`
      CREATE TABLE IF NOT EXISTS joblist (
        jobID INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        cooldown_value INTEGER,
        cooldown_unit TEXT
      )
    `, (err) => {
      if (err) console.error('❌ Error creating joblist table:', err);
      else console.log('✅ Joblist table is ready.');
    });

    db.all(`PRAGMA table_info(joblist)`, (err, columns) => {
      if (err) {
        console.error('❌ Error checking joblist schema:', err);
        return;
      }
      const hasCooldownValue = columns.some((col) => col.name === 'cooldown_value');
      if (!hasCooldownValue) {
        console.log("➕ Adding missing 'cooldown_value' column to joblist table...");
        db.run("ALTER TABLE joblist ADD COLUMN cooldown_value INTEGER", (alterErr) => {
          if (alterErr) console.error("❌ Error adding 'cooldown_value' column:", alterErr);
          else console.log("✅ 'cooldown_value' column added successfully.");
        });
      }
      const hasCooldownUnit = columns.some((col) => col.name === 'cooldown_unit');
      if (!hasCooldownUnit) {
        console.log("➕ Adding missing 'cooldown_unit' column to joblist table...");
        db.run("ALTER TABLE joblist ADD COLUMN cooldown_unit TEXT", (alterErr) => {
          if (alterErr) console.error("❌ Error adding 'cooldown_unit' column:", alterErr);
          else console.log("✅ 'cooldown_unit' column added successfully.");
        });
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS job_assignees (
        jobID INTEGER,
        userID TEXT,
        PRIMARY KEY(jobID, userID)
      )
    `, (err) => {
      if (err) console.error('❌ Error creating job_assignees table:', err);
      else console.log('✅ Job assignees table is ready.');
    });

    // Job Submissions (Admin Queue)
    db.run(
      `CREATE TABLE IF NOT EXISTS job_submissions (
        submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
        userID TEXT NOT NULL,
        jobID INTEGER,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        image_url TEXT,
        status TEXT DEFAULT 'pending',
        reward_amount INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        completed_at INTEGER
      )`,
      (err) => {
        if (err) console.error('❌ Error creating job_submissions table:', err);
        else console.log('✅ Job submissions table is ready.');
      }
    );

    db.all(`PRAGMA table_info(job_submissions)`, (err, columns) => {
      if (err) {
        console.error('❌ Error checking job_submissions schema:', err);
        return;
      }
      const hasJobId = columns.some((col) => col.name === 'jobID');
      if (!hasJobId) {
        console.log("➕ Adding missing 'jobID' column to job_submissions table...");
        db.run("ALTER TABLE job_submissions ADD COLUMN jobID INTEGER", (alterErr) => {
          if (alterErr) console.error("❌ Error adding 'jobID' column:", alterErr);
          else console.log("✅ 'jobID' column added successfully.");
        });
      }
    });

    // Item Redemptions (Audit Log)
    db.run(
      `CREATE TABLE IF NOT EXISTS item_redemptions (
        redemption_id INTEGER PRIMARY KEY AUTOINCREMENT,
        userID TEXT NOT NULL,
        user_tag TEXT,
        item_name TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        source TEXT NOT NULL,
        channel_name TEXT,
        channel_id TEXT,
        message_link TEXT,
        command_text TEXT,
        inventory_before INTEGER,
        inventory_after INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
      (err) => {
        if (err) console.error('❌ Error creating item_redemptions table:', err);
        else console.log('✅ Item redemptions table is ready.');
      }
    );

    // Job Cycle (Round-Robin Assignments)
    db.run(`
      CREATE TABLE IF NOT EXISTS job_cycle (
        current_index INTEGER NOT NULL
      )
    `, (err) => {
      if (err) console.error('❌ Error creating job_cycle table:', err);
      else console.log('✅ Job cycle table is ready.');

      db.get("SELECT current_index FROM job_cycle LIMIT 1", (err, row) => {
        if (err) console.error("❌ Error checking job_cycle table:", err);
        else if (!row) {
          db.run("INSERT INTO job_cycle (current_index) VALUES (0)", (err) => {
            if (err) console.error("❌ Error inserting initial job_cycle value:", err);
            else console.log("✅ Job cycle initialized with current_index = 0.");
          });
        }
      });
    });

    // Giveaways Table
    db.run(`
      CREATE TABLE IF NOT EXISTS giveaways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        end_time INTEGER NOT NULL,
        prize TEXT NOT NULL,
        winners INTEGER NOT NULL,
        giveaway_name TEXT NOT NULL DEFAULT 'Untitled Giveaway',
        repeat INTEGER DEFAULT 0,
        is_completed INTEGER DEFAULT 0
      )
    `, (err) => {
      if (err) console.error('❌ Error creating giveaways table:', err);
      else console.log('✅ Giveaways table is ready.');
    });

    // Giveaway Entries
    db.run(`
      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveaway_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (giveaway_id, user_id),
        FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('❌ Error creating giveaway_entries table:', err);
      else console.log('✅ Giveaway entries table is ready.');
    });

    // Raffles Table
    db.run(`
      CREATE TABLE IF NOT EXISTS raffles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        prize TEXT NOT NULL,
        cost INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        winners INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        is_completed INTEGER DEFAULT 0
      )
    `, (err) => {
      if (err) console.error('❌ Error creating raffles table:', err);
      else console.log('✅ Raffles table is ready.');
    });

    // Raffle Entries Table
    db.run(`
      CREATE TABLE IF NOT EXISTS raffle_entries (
        entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
        raffle_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('❌ Error creating raffle_entries table:', err);
      else console.log('✅ Raffle entries table is ready.');
    });

    // Raffle Ticket Purchase Tracking (for bonus tickets)
    db.run(`
      CREATE TABLE IF NOT EXISTS raffle_ticket_purchases (
        raffle_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        purchased_count INTEGER NOT NULL DEFAULT 0,
        bonus_10_given INTEGER NOT NULL DEFAULT 0,
        bonus_25_given INTEGER NOT NULL DEFAULT 0,
        bonus_50_given INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (raffle_id, user_id),
        FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('❌ Error creating raffle_ticket_purchases table:', err);
      else console.log('✅ Raffle ticket purchase tracking table is ready.');
    });

    // DAO Call Attendance History
    db.run(`
      CREATE TABLE IF NOT EXISTS dao_call_attendance (
        attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
        userID TEXT NOT NULL,
        meeting_started_at INTEGER NOT NULL,
        rewarded_at INTEGER NOT NULL,
        minutes_attended INTEGER NOT NULL,
        reward_amount INTEGER NOT NULL,
        UNIQUE(userID, meeting_started_at)
      )
    `, (err) => {
      if (err) console.error('❌ Error creating dao_call_attendance table:', err);
      else console.log('✅ DAO call attendance table is ready.');
    });

      db.get('SELECT 1 AS ready', [], async (readyErr) => {
        if (readyErr) {
          databaseInitializationPromise = null;
          return reject(readyErr);
        }

        try {
          await ledgerService.initialize();
          await eventLedgerService.initialize();
          await migrateLegacyAncillaryStateToDb();
          await migrateProtectedProfilesToCiphertext();
          await migrateItemRedemptionWalletsToCiphertext();
          databaseInitializationReady = true;
          console.log('✅ Database initialization complete.');
          resolve();
        } catch (error) {
          databaseInitializationReady = false;
          databaseInitializationPromise = null;
          reject(error);
        }
      });
    });
  });

  databaseInitializationPromise.catch((error) => {
    console.error('❌ Database initialization failed:', error);
  });

  return databaseInitializationPromise;
}


// =========================================================================
// Core Economy Functions
// =========================================================================

async function initUserEconomy(userID) {
  const result = await runSql(
    `INSERT OR IGNORE INTO economy (userID, wallet, bank) VALUES (?, 0, 0)`,
    [userID]
  );

  if (result.changes > 0) {
    await appendSystemEvent({
      domain: 'accounts',
      action: 'initialize_economy_row',
      entityType: 'economy_user',
      entityId: userID,
      actorUserId: userID,
      metadata: {
        userID,
      },
    });
  }
}

async function getLeaderboard(limit = 10) {
  await ensureLedgerBootstrap();
  try {
    return await ledgerService.getLeaderboard(limit);
  } catch (error) {
    console.error('Failed to retrieve leaderboard from ledger:', error);
    throw new Error('Failed to retrieve leaderboard.');
  }
}


async function getBalances(userID) {
  await initUserEconomy(userID);
  await ensureLedgerBootstrap();
  try {
    const balance = await ledgerService.getBalance(userID);
    const mergedBalance = Number((balance.balance ?? balance.total ?? balance.wallet) || 0);
    return {
      balance: mergedBalance,
      wallet: mergedBalance,
      bank: 0,
      totalBalance: mergedBalance,
    };
  } catch (error) {
    console.error('Balance check failed:', error);
    throw new Error('Balance check failed');
  }
}

async function syncAllEconomyBalancesFromLedger() {
  await ensureLedgerBootstrap();
  const replay = await ledgerService.replayLedger();
  const users = replay?.users || {};

  const executor = getLedgerExecutor(db);
  await executor.run('BEGIN IMMEDIATE');
  try {
    for (const [userId, balances] of Object.entries(users)) {
      if (!userId) continue;
      // Keep maintenance side-effect free: no event emission while syncing projections.
      // eslint-disable-next-line no-await-in-loop
      await executor.run(
        `INSERT OR IGNORE INTO economy (userID, wallet, bank) VALUES (?, 0, 0)`,
        [userId]
      );
      // eslint-disable-next-line no-await-in-loop
      await executor.run(
        `UPDATE economy
         SET wallet = ?, bank = ?
         WHERE userID = ?`,
        [Number((balances.balance ?? balances.wallet ?? balances.total) || 0), 0, userId]
      );
    }
    await executor.run('COMMIT');
  } catch (error) {
    await executor.run('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function addAdmin(userID, options = {}) {
  const result = await runSql(
    `INSERT OR IGNORE INTO admins (userID) VALUES (?)`,
    [userID]
  ).catch(() => {
    throw new Error('Failed to add admin.');
  });

  if (result.changes > 0) {
    await appendSystemEvent({
      domain: 'admin',
      action: 'add',
      entityType: 'admin_user',
      entityId: userID,
      actorUserId: options.actorUserId || userID,
      metadata: {
        userID,
        source: options.source || 'admin_command',
      },
    });
  }
}

async function getAdmins() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT userID FROM admins`, [], (err, rows) => {
      if (err) return reject('Failed to retrieve admins.');
      else resolve(rows.map((row) => row.userID));
    });
  });
}

async function removeAdmin(userID, options = {}) {
  const result = await runSql(`DELETE FROM admins WHERE userID = ?`, [userID]).catch(() => {
    throw new Error('Failed to remove admin.');
  });

  if (result.changes > 0) {
    await appendSystemEvent({
      domain: 'admin',
      action: 'remove',
      entityType: 'admin_user',
      entityId: userID,
      actorUserId: options.actorUserId || userID,
      metadata: {
        userID,
        source: options.source || 'admin_command',
      },
    });
  }

  return { changes: result.changes };
}

async function updateWallet(userID, amount, metadata = {}) {
  await initUserEconomy(userID);
  await ensureLedgerBootstrap();
  const normalizedAmount = Number(amount);

  if (!Number.isInteger(normalizedAmount)) {
    throw new Error('Failed to update Volt balance.');
  }

  if (normalizedAmount === 0) {
    return { changes: 0 };
  }

  const baseMetadata = {
    ...metadata,
    fromAccount: metadata.fromAccount || (normalizedAmount > 0 ? 'system' : PRIMARY_BALANCE_ACCOUNT),
    toAccount: metadata.toAccount || (normalizedAmount > 0 ? PRIMARY_BALANCE_ACCOUNT : 'system'),
  };

  try {
    const transaction = await ledgerService.appendTransaction({
      type: metadata.type || (normalizedAmount > 0 ? 'reward' : 'debit'),
      fromUserId: normalizedAmount > 0 ? null : userID,
      toUserId: normalizedAmount > 0 ? userID : null,
      amount: Math.abs(normalizedAmount),
      metadata: baseMetadata,
      enforceSufficientFunds: Boolean(metadata.enforceSufficientFunds),
    });

    return { changes: 1, transaction };
  } catch (error) {
    console.error('Failed to update Volt balance:', error);
    throw new Error(error.message || 'Failed to update Volt balance.');
  }
}

async function updateDaoCallRewardTimestamp(userID, rewardTimestamp = Math.floor(Date.now() / 1000)) {
  await initUserEconomy(userID);
  const result = await runSql(
    `UPDATE economy SET last_dao_call_reward_at = ? WHERE userID = ?`,
    [rewardTimestamp, userID]
  );

  if (result.changes > 0) {
    await appendSystemEvent({
      domain: 'dao_calls',
      action: 'update_reward_timestamp',
      entityType: 'economy_user',
      entityId: userID,
      actorUserId: userID,
      metadata: {
        userID,
        rewardTimestamp,
      },
    });
  }

  return { changes: result.changes };
}

async function recordDaoCallAttendance({
  userID,
  meetingStartedAt,
  rewardedAt = Math.floor(Date.now() / 1000),
  minutesAttended,
  rewardAmount,
}) {
  await initUserEconomy(userID);
  await runSql('BEGIN IMMEDIATE');
  try {
    const result = await runSql(
      `INSERT INTO dao_call_attendance (
         userID,
         meeting_started_at,
         rewarded_at,
         minutes_attended,
         reward_amount
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(userID, meeting_started_at) DO UPDATE SET
         rewarded_at = excluded.rewarded_at,
         minutes_attended = excluded.minutes_attended,
         reward_amount = excluded.reward_amount`,
      [userID, meetingStartedAt, rewardedAt, minutesAttended, rewardAmount]
    );

    await appendSystemEvent({
      domain: 'dao_calls',
      action: 'record_attendance',
      entityType: 'dao_call_attendance',
      entityId: `${userID}:${meetingStartedAt}`,
      actorUserId: userID,
      metadata: {
        userID,
        meetingStartedAt,
        rewardedAt,
        minutesAttended,
        rewardAmount,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
    return { changes: result.changes };
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw new Error(error.message || 'Failed to record DAO call attendance.');
  }
}

function getDaoCallAttendanceCountForYear(userID, year) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) AS meetingsJoined
       FROM dao_call_attendance
       WHERE userID = ?
         AND strftime('%Y', rewarded_at, 'unixepoch') = ?`,
      [userID, String(year)],
      (err, row) => {
        if (err) return reject('Failed to retrieve DAO call attendance count.');
        resolve(row?.meetingsJoined || 0);
      }
    );
  });
}

async function transferFromWallet(fromUserID, toUserID, amount, metadata = {}) {
  if (amount <= 0) throw new Error('Invalid transfer amount.');
  await Promise.all([initUserEconomy(fromUserID), initUserEconomy(toUserID)]);
  await ensureLedgerBootstrap();
  await ledgerService.appendTransaction({
    type: metadata.type || 'transfer',
    fromUserId: fromUserID,
    toUserId: toUserID,
    amount,
    metadata: {
      ...metadata,
      fromAccount: PRIMARY_BALANCE_ACCOUNT,
      toAccount: PRIMARY_BALANCE_ACCOUNT,
    },
    enforceSufficientFunds: true,
  });
}

async function withdraw(userID, amount, metadata = {}) {
  if (amount <= 0) throw new Error('Invalid withdrawal amount.');
  await initUserEconomy(userID);
  await ensureLedgerBootstrap();
  return {
    changes: 0,
    mergedBalance: true,
    message: 'Volt balances are unified now.',
  };
}

async function deposit(userID, amount, metadata = {}) {
  if (amount <= 0) throw new Error('Invalid deposit amount.');
  await initUserEconomy(userID);
  await ensureLedgerBootstrap();
  return {
    changes: 0,
    mergedBalance: true,
    message: 'Volt balances are unified now.',
  };
}

async function robUser(robberId, targetId) {
  await Promise.all([initUserEconomy(robberId), initUserEconomy(targetId)]);
  await ensureLedgerBootstrap();
  const targetBalance = await getBalances(targetId);
  const targetWallet = targetBalance.balance || 0;

  if (targetWallet <= 0) {
    return {
      success: false,
      message: 'Target has no money to rob!',
    };
  }

  const isSuccessful = Math.random() < 0.5;
  const amountStolen = Math.min(targetWallet, 50);
  const penalty = 50;

  if (isSuccessful) {
    await ledgerService.appendTransaction({
      type: 'robbery',
      fromUserId: targetId,
      toUserId: robberId,
      amount: amountStolen,
        metadata: {
          fromAccount: PRIMARY_BALANCE_ACCOUNT,
          toAccount: PRIMARY_BALANCE_ACCOUNT,
          outcome: 'success',
        },
      enforceSufficientFunds: true,
    });

    return {
      success: true,
      outcome: 'success',
      amountStolen,
    };
  }

  await ledgerService.appendTransaction({
    type: 'robbery_penalty',
    fromUserId: robberId,
    toUserId: targetId,
    amount: penalty,
    metadata: {
      fromAccount: PRIMARY_BALANCE_ACCOUNT,
      toAccount: PRIMARY_BALANCE_ACCOUNT,
      outcome: 'fail',
    },
  });

  return {
    success: true,
    outcome: 'fail',
    penalty,
  };
}

// =========================================================================
// Job System (Updated for Cycled Assignment)
// =========================================================================

// Note: This snippet assumes that `db` is loaded elsewhere (e.g., via require('../../db')).

// --------------------- Original Functions ---------------------

function normalizeEpochSeconds(value) {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  // If stored as ms, convert to seconds.
  return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
}

function cooldownToSeconds(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const multipliers = {
    minute: 60,
    hour: 60 * 60,
    day: 24 * 60 * 60,
    month: 30 * 24 * 60 * 60,
  };
  const normalizedUnit = String(unit || '').toLowerCase().replace(/s$/, '');
  return Math.floor(amount * (multipliers[normalizedUnit] || 0));
}

function formatRemainingSeconds(seconds) {
  const remaining = Math.max(0, Math.ceil(seconds));
  const units = [
    { label: 'month', seconds: 30 * 24 * 60 * 60 },
    { label: 'day', seconds: 24 * 60 * 60 },
    { label: 'hour', seconds: 60 * 60 },
    { label: 'minute', seconds: 60 },
    { label: 'second', seconds: 1 },
  ];
  const parts = [];
  let remainder = remaining;
  for (const unit of units) {
    if (remainder < unit.seconds) continue;
    const value = Math.floor(remainder / unit.seconds);
    remainder -= value * unit.seconds;
    parts.push(`${value} ${value === 1 ? unit.label : `${unit.label}s`}`);
    if (parts.length >= 2) break;
  }
  return parts.length ? parts.join(' ') : 'less than a minute';
}

function checkJobCooldown(userID, jobID, cooldownValue, cooldownUnit) {
  return new Promise((resolve, reject) => {
    const cooldownSeconds = cooldownToSeconds(cooldownValue, cooldownUnit);
    if (!cooldownSeconds) {
      return resolve({ onCooldown: false, remainingSeconds: 0 });
    }
    db.get(
      `SELECT created_at FROM job_submissions
       WHERE userID = ? AND jobID = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userID, jobID],
      (err, row) => {
        if (err) return reject(new Error('Database error while checking cooldown'));
        if (!row) return resolve({ onCooldown: false, remainingSeconds: 0 });
        const submittedAt = normalizeEpochSeconds(row.created_at);
        if (!submittedAt) return resolve({ onCooldown: false, remainingSeconds: 0 });
        const nowSeconds = Math.floor(Date.now() / 1000);
        const expiresAt = submittedAt + cooldownSeconds;
        if (nowSeconds < expiresAt) {
          return resolve({ onCooldown: true, remainingSeconds: expiresAt - nowSeconds });
        }
        return resolve({ onCooldown: false, remainingSeconds: 0 });
      }
    );
  });
}

function assignJobById(userID, jobID) {
  return new Promise((resolve, reject) => {
    if (!userID || !jobID) {
      return reject(new Error("Invalid user or job ID"));
    }
    db.serialize(() => {
      // Check if the user already has an assigned job
      db.get(
        `SELECT jobID FROM job_assignees WHERE userID = ?`,
        [userID],
        (err, row) => {
          if (err) return reject(new Error("Database error while checking active job"));
          if (row) return reject(new Error("User already has a job"));
          
          // Verify that the job exists
          db.get(
            `SELECT jobID, description, cooldown_value, cooldown_unit FROM joblist WHERE jobID = ?`,
            [jobID],
            (err, job) => {
              if (err) return reject(new Error("Database error while verifying job"));
              if (!job) return reject(new Error("Job not found"));

              checkJobCooldown(userID, jobID, job.cooldown_value, job.cooldown_unit)
                .then(({ onCooldown, remainingSeconds }) => {
                  if (onCooldown) {
                    return reject(
                      new Error(`Quest is on cooldown for ${formatRemainingSeconds(remainingSeconds)}.`)
                    );
                  }
                  // Insert the assignment (this does not change your job cycle)
                  db.run(
                    `INSERT INTO job_assignees (jobID, userID) VALUES (?, ?)`,
                    [jobID, userID],
                    async function (err2) {
                      if (err2) return reject(new Error("Failed to assign job"));
                      try {
                        await appendSystemEvent({
                          domain: 'jobs',
                          action: 'assign',
                          entityType: 'job_assignment',
                          entityId: `${userID}:${job.jobID}`,
                          actorUserId: userID,
                          metadata: {
                            userID,
                            jobID: job.jobID,
                            description: job.description,
                            mode: 'direct',
                          },
                        });
                      } catch (eventError) {
                        return reject(eventError);
                      }
                      resolve(job);
                    }
                  );
                })
                .catch(reject);
            }
          );
        }
      );
    });
  });
}

function getAllJobs() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT jobID, description, cooldown_value, cooldown_unit FROM joblist ORDER BY jobID ASC`, [], (err, rows) => {
      if (err) {
        console.error('Error fetching jobs from the database:', err);
        return reject('🚫 Failed to fetch jobs.');
      }
      resolve(rows);
    });
  });
}


/**
 * Retrieves the currently assigned job for a given user.
 */
function getAssignedJob(userID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT j.jobID, j.description 
       FROM joblist j
       JOIN job_assignees ja ON j.jobID = ja.jobID
       WHERE ja.userID = ?`,
      [userID],
      (err, row) => {
        if (err) {
          return reject('Failed to check active job.');
        }
        return resolve(row || null);
      }
    );
  });
}

/**
 * Retrieves the active job for a given user, including pending web submissions.
 */
function getActiveJob(userID) {
  return new Promise((resolve, reject) => {
    getAssignedJob(userID)
      .then((assignedJob) => {
        if (assignedJob) {
          return resolve(assignedJob);
        }

        db.get(
          `SELECT js.jobID, COALESCE(j.description, js.title) AS description
           FROM job_submissions js
           LEFT JOIN joblist j ON j.jobID = js.jobID
           WHERE js.userID = ? AND js.status = 'pending'
           ORDER BY js.created_at DESC
           LIMIT 1`,
          [userID],
          (pendingErr, pendingRow) => {
            if (pendingErr) {
              return reject('Failed to check pending job submission.');
            }
            resolve(pendingRow || null);
          }
        );
      })
      .catch(reject);
  });
}

/**
 * Retrieves the description of the current job for a given user.
 */
function getUserJob(userID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT j.description 
       FROM joblist j
       JOIN job_assignees ja ON j.jobID = ja.jobID
       WHERE ja.userID = ?`,
      [userID],
      (err, row) => {
        if (err) {
          reject('Failed to check current job.');
        } else {
          resolve(row ? row.description : null);
        }
      }
    );
  });
}

/**
 * Adds a new job to the job list and renumbers jobs.
 */
function normalizeJobCooldownInput(cooldownValue, cooldownUnit) {
  let normalizedValue = null;
  let normalizedUnit = null;
  const allowedUnits = new Set(['minute', 'hour', 'day', 'month']);

  if (cooldownValue !== null && cooldownValue !== undefined && cooldownValue !== '') {
    const parsedValue = Number(cooldownValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      throw new Error('Cooldown value must be a positive number');
    }
    normalizedValue = Math.floor(parsedValue);
    if (!cooldownUnit || typeof cooldownUnit !== 'string') {
      throw new Error('Cooldown unit is required when cooldown value is set');
    }
    const unit = cooldownUnit.trim().toLowerCase().replace(/s$/, '');
    if (!allowedUnits.has(unit)) {
      throw new Error('Cooldown unit must be minute, hour, day, or month');
    }
    normalizedUnit = unit;
  } else if (cooldownUnit) {
    throw new Error('Cooldown value is required when cooldown unit is set');
  }

  return { normalizedValue, normalizedUnit };
}

function addJob(description, cooldownValue = null, cooldownUnit = null) {
  return new Promise((resolve, reject) => {
    if (!description || typeof description !== 'string') {
      return reject('Invalid job description');
    }
    let normalizedValue = null;
    let normalizedUnit = null;
    try {
      ({ normalizedValue, normalizedUnit } = normalizeJobCooldownInput(cooldownValue, cooldownUnit));
    } catch (error) {
      return reject(error.message);
    }

    db.run(
      `INSERT INTO joblist (description, cooldown_value, cooldown_unit) VALUES (?, ?, ?)`,
      [description, normalizedValue, normalizedUnit],
      async function (err) {
      if (err) return reject('Failed to add job');
      // Renumber job IDs after adding a new job.
      renumberJobs()
        .then(async () => {
          const job = {
            jobID: this.lastID,
            description,
            cooldown_value: normalizedValue,
            cooldown_unit: normalizedUnit,
          };
          await appendSystemEvent({
            domain: 'jobs',
            action: 'create',
            entityType: 'job',
            entityId: job.jobID,
            metadata: job,
          });
          resolve(job);
        })
        .catch(reject);
      }
    );
  });
}

async function updateJobById(jobID, description, cooldownValue = null, cooldownUnit = null, options = {}) {
  if (!description || typeof description !== 'string') {
    throw new Error('Description required.');
  }

  const existing = await getSql(
    `SELECT description, cooldown_value, cooldown_unit FROM joblist WHERE jobID = ?`,
    [jobID]
  );
  if (!existing) {
    throw new Error('Job not found.');
  }

  const { normalizedValue, normalizedUnit } = normalizeJobCooldownInput(cooldownValue, cooldownUnit);

  await runSql(
    `UPDATE joblist SET description = ?, cooldown_value = ?, cooldown_unit = ? WHERE jobID = ?`,
    [description, normalizedValue, normalizedUnit, jobID]
  );

  await appendSystemEvent({
    domain: 'jobs',
    action: 'update',
    entityType: 'job',
    entityId: jobID,
    actorUserId: options.actorUserId || null,
    metadata: {
      jobID,
      before: existing,
      after: {
        description,
        cooldown_value: normalizedValue,
        cooldown_unit: normalizedUnit,
      },
    },
  });
}

/**
 * Retrieves the job list along with assigned users.
 */
function getJobList() {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT 
        j.jobID,
        j.description,
        j.cooldown_value,
        j.cooldown_unit,
        GROUP_CONCAT(ja.userID) as assignees
      FROM joblist j
      LEFT JOIN job_assignees ja ON j.jobID = ja.jobID
      GROUP BY j.jobID
      `,
      [],
      (err, rows) => {
        if (err) return reject('Failed to retrieve job list');
        const jobs = rows.map((row) => ({
          jobID: row.jobID,
          description: row.description,
          cooldown_value: row.cooldown_value ?? null,
          cooldown_unit: row.cooldown_unit ?? null,
          assignees: row.assignees ? row.assignees.split(',') : [],
        }));
        resolve(jobs);
      }
    );
  });
}

/**
 * Completes a job for a user and adds a reward to their wallet.
 */
async function completeJob(userID, reward) {
  await ensureLedgerBootstrap();
  const assignedJob = await getSql(
    `SELECT jobID FROM job_assignees WHERE userID = ?`,
    [userID]
  ).catch(() => {
    throw new Error('Database error while checking job assignment');
  });

  if (!assignedJob) {
    const pendingSubmission = await getSql(
      `SELECT submission_id FROM job_submissions
       WHERE userID = ? AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userID]
    ).catch(() => {
      throw new Error('Database error while checking pending job submission');
    });

    if (!pendingSubmission) {
      return { success: false, message: 'No active job found.' };
    }
  }

  const rewardAmount = Number(reward);
  const executor = getLedgerExecutor(db);

  await runSql('BEGIN TRANSACTION');
  try {
    await runSql(`DELETE FROM job_assignees WHERE userID = ?`, [userID]);

    if (Number.isFinite(rewardAmount) && rewardAmount > 0) {
      await ledgerService.appendTransaction({
        type: 'quest_reward',
        fromUserId: null,
        toUserId: userID,
        amount: Math.floor(rewardAmount),
        metadata: {
          fromAccount: 'system',
          toAccount: PRIMARY_BALANCE_ACCOUNT,
          source: 'completeJob',
        },
      }, { executor, inTransaction: true });
    }

    await appendSystemEvent({
      domain: 'jobs',
      action: 'complete',
      entityType: 'job_assignment',
      entityId: assignedJob ? `${userID}:${assignedJob.jobID}` : userID,
      actorUserId: userID,
      metadata: {
        userID,
        jobID: assignedJob?.jobID || null,
        reward: Number.isFinite(rewardAmount) ? Math.max(0, Math.floor(rewardAmount)) : 0,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
    return { success: true };
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw new Error(error.message || 'Failed to complete job.');
  }
}

async function quitAssignedJob(userID, options = {}) {
  const activeJob = await getSql(`SELECT jobID FROM job_assignees WHERE userID = ?`, [userID]);
  if (!activeJob) {
    return { success: false, removed: false, jobID: null };
  }

  await runSql(`DELETE FROM job_assignees WHERE userID = ?`, [userID]);
  await appendSystemEvent({
    domain: 'jobs',
    action: 'quit',
    entityType: 'job_assignment',
    entityId: `${userID}:${activeJob.jobID}`,
    actorUserId: options.actorUserId || userID,
    metadata: {
      userID,
      jobID: activeJob.jobID,
      source: options.source || 'quit',
    },
  });

  return {
    success: true,
    removed: true,
    jobID: activeJob.jobID,
  };
}

/**
 * Marks the latest pending job submission as completed for a user.
 */
function markLatestSubmissionCompleted(userID, reward) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE job_submissions
       SET status = 'completed',
           reward_amount = ?,
           completed_at = strftime('%s', 'now')
       WHERE submission_id = (
         SELECT submission_id
         FROM job_submissions
         WHERE userID = ? AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [reward, userID],
      async function onUpdate(err) {
        if (err) return reject('Failed to update job submission status.');
        if ((this.changes || 0) > 0) {
          try {
            await appendSystemEvent({
              domain: 'jobs',
              action: 'mark_latest_submission_completed',
              entityType: 'job_submission',
              entityId: userID,
              actorUserId: userID,
              metadata: {
                userID,
                reward,
              },
            });
          } catch (eventError) {
            return reject(eventError);
          }
        }
        resolve({ updated: this.changes || 0 });
      }
    );
  });
}

async function submitJobSubmission({ userID, jobID, title, description, imageUrl = null }, options = {}) {
  if (!userID || !jobID || !title || !description) {
    throw new Error('Missing submission fields.');
  }

  await runSql('BEGIN IMMEDIATE');
  try {
    const result = await runSql(
      `INSERT INTO job_submissions (userID, jobID, title, description, image_url)
       VALUES (?, ?, ?, ?, ?)`,
      [userID, jobID, title, description, imageUrl]
    );

    const assignmentDelete = await runSql(`DELETE FROM job_assignees WHERE userID = ?`, [userID]);

    await appendSystemEvent({
      domain: 'jobs',
      action: 'submit',
      entityType: 'job_submission',
      entityId: result.lastID,
      actorUserId: options.actorUserId || userID,
      metadata: {
        submissionId: result.lastID,
        userID,
        jobID,
        title,
        description,
        imageUrl,
        clearedAssignments: assignmentDelete.changes || 0,
        source: options.source || 'submission',
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
    return {
      submissionId: result.lastID,
    };
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw new Error(error.message || 'Failed to submit job.');
  }
}

/**
 * Retrieves all pending quest submissions for a user.
 */
function getPendingJobSubmissions(userID) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT js.submission_id, js.userID, js.jobID, COALESCE(j.description, js.title) AS title,
              js.description, js.image_url, js.created_at
       FROM job_submissions js
       LEFT JOIN joblist j ON j.jobID = js.jobID
       WHERE js.userID = ? AND js.status = 'pending'
       ORDER BY js.created_at ASC, js.submission_id ASC`,
      [userID],
      (err, rows) => {
        if (err) {
          return reject('Failed to retrieve pending job submissions.');
        }
        resolve(rows || []);
      }
    );
  });
}

/**
 * Marks a set of pending submissions complete and applies the same reward to each one.
 */
async function completePendingJobSubmissions(userID, submissionIDs, rewardPerSubmission) {
  await ensureLedgerBootstrap();
  const ids = [...new Set((submissionIDs || []).map((id) => Number(id)).filter(Number.isInteger))];
  const rewardAmount = Number(rewardPerSubmission);

  if (!userID || !ids.length) {
    return { success: false, completedCount: 0, totalReward: 0 };
  }
  if (!Number.isFinite(rewardAmount) || rewardAmount < 0) {
    throw new Error('Invalid reward amount.');
  }

  const placeholders = ids.map(() => '?').join(', ');
  const completedAt = Math.floor(Date.now() / 1000);
  const executor = getLedgerExecutor(db);

  await runSql('BEGIN TRANSACTION');
  try {
    const updateResult = await runSql(
      `UPDATE job_submissions
       SET status = 'completed',
           reward_amount = ?,
           completed_at = ?
       WHERE userID = ?
         AND status = 'pending'
         AND submission_id IN (${placeholders})`,
      [rewardAmount, completedAt, userID, ...ids]
    );

    const completedCount = updateResult.changes || 0;
    if (!completedCount) {
      await runSql('ROLLBACK');
      return { success: false, completedCount: 0, totalReward: 0 };
    }

    const totalReward = rewardAmount * completedCount;
    if (totalReward > 0) {
      await ledgerService.appendTransaction({
        type: 'quest_reward',
        fromUserId: null,
        toUserId: userID,
        amount: totalReward,
        metadata: {
          fromAccount: 'system',
          toAccount: PRIMARY_BALANCE_ACCOUNT,
          source: 'completePendingJobSubmissions',
          submissionIds: ids,
          rewardPerSubmission: rewardAmount,
          completedCount,
        },
      }, { executor, inTransaction: true });
    }

    await appendSystemEvent({
      domain: 'jobs',
      action: 'complete_submission_batch',
      entityType: 'job_submission_batch',
      entityId: `${userID}:${completedAt}`,
      actorUserId: userID,
      metadata: {
        userID,
        submissionIds: ids,
        completedCount,
        rewardPerSubmission: rewardAmount,
        totalReward,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
    return {
      success: true,
      completedCount,
      rewardPerSubmission: rewardAmount,
      totalReward,
    };
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw new Error(error.message || 'Failed to commit submission completion.');
  }
}

/**
 * Renumbers jobs in the job list.
 */
function renumberJobs() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT jobID FROM joblist ORDER BY jobID`, [], (err, rows) => {
      if (err) return reject('Failed to retrieve jobs for renumbering');
      const jobs = rows.map((row, index) => ({ oldID: row.jobID, newID: index + 1 }));
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let errorOccurred = false;
        jobs.forEach(({ oldID, newID }) => {
          db.run(
            `UPDATE joblist SET jobID = ? WHERE jobID = ?`,
            [newID, oldID],
            (err2) => {
              if (err2) {
                errorOccurred = true;
                db.run('ROLLBACK');
                return reject('Failed to renumber job IDs');
              }
            }
          );
        });
        if (!errorOccurred) {
          db.run('COMMIT', async (err3) => {
            if (err3) return reject('Failed to commit renumbering');
            try {
              await appendSystemEvent({
                domain: 'jobs',
                action: 'renumber',
                entityType: 'joblist',
                entityId: 'joblist',
                metadata: {
                  mappings: jobs,
                },
              });
            } catch (eventError) {
              return reject(eventError);
            }
            resolve();
          });
        }
      });
    });
  });
}

async function deleteJobById(jobID, options = {}) {
  const existing = await getSql(`SELECT * FROM joblist WHERE jobID = ?`, [jobID]);
  if (!existing) {
    throw new Error('Job not found.');
  }

  await runSql('BEGIN IMMEDIATE');
  try {
    const assigneeDelete = await runSql(`DELETE FROM job_assignees WHERE jobID = ?`, [jobID]);
    await runSql(`DELETE FROM joblist WHERE jobID = ?`, [jobID]);
    await runSql('COMMIT');
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw new Error(error.message || 'Failed to delete job.');
  }

  await renumberJobs();

  await appendSystemEvent({
    domain: 'jobs',
    action: 'delete',
    entityType: 'job',
    entityId: jobID,
    actorUserId: options.actorUserId || null,
    metadata: {
      jobID,
      description: existing.description,
      cooldown_value: existing.cooldown_value,
      cooldown_unit: existing.cooldown_unit,
    },
  });
}

// --------------------- New Functions for Cycled Assignment ---------------------

/**
 * Retrieves the current job index from the job_cycle table.
 * If the table is empty (or no row exists) it initializes it to 0.
 */
function getCurrentJobIndex() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT current_index FROM job_cycle LIMIT 1`, [], (err, row) => {
      if (err) {
        return reject('Failed to retrieve current job index');
      }
      if (!row) {
        // No row exists yet—initialize it with 0.
        db.run(`INSERT INTO job_cycle (current_index) VALUES (0)`, [], function (err2) {
          if (err2) return reject('Failed to initialize job cycle');
          resolve(0);
        });
      } else {
        resolve(row.current_index);
      }
    });
  });
}

/**
 * Updates the current job index in the job_cycle table.
 */
async function setCurrentJobIndex(index, options = {}) {
  const previous = await getSql(`SELECT current_index FROM job_cycle LIMIT 1`);

  if (!previous) {
    await runSql(`INSERT INTO job_cycle (current_index) VALUES (?)`, [index]);
  } else {
    await runSql(`UPDATE job_cycle SET current_index = ?`, [index]);
  }

  if (!previous || Number(previous.current_index) !== Number(index)) {
    await appendSystemEvent({
      domain: 'jobs',
      action: previous ? 'rotate_cycle' : 'initialize_cycle',
      entityType: 'job_cycle',
      entityId: 'job_cycle',
      actorUserId: options.actorUserId || null,
      metadata: {
        previousIndex: previous?.current_index ?? null,
        currentIndex: index,
        source: options.source || 'job_cycle',
        ...(options.metadata || {}),
      },
    }, {
      executor: options.executor || getEventLedgerExecutor(db),
      inTransaction: Boolean(options.inTransaction),
    });
  }
}

/**
 * Assigns a job to a user using round-robin (cycled) logic.
 *
 * The steps are:
 * 1. Verify the user does not already have an active job.
 * 2. Retrieve the full list of jobs in a consistent order (ordered by jobID).
 * 3. Get the current index from the job_cycle table.
 * 4. Choose the job at that index.
 * 5. Increment the index (wrapping around to 0 if necessary) and update the table.
 * 6. Insert the assignment into job_assignees.
 */
function assignCycledJob(userID) {
  return new Promise((resolve, reject) => {
    if (!userID) return reject('Invalid user ID');
    db.serialize(() => {
      // Begin transaction for consistency.
      db.run('BEGIN TRANSACTION');
      // Verify the user does not already have an active job.
      db.get(`SELECT jobID FROM job_assignees WHERE userID = ?`, [userID], (err, row) => {
        if (err) {
          db.run('ROLLBACK');
          return reject('Failed to check existing assignments');
        }
        if (row) {
          db.run('ROLLBACK');
          return reject('User already has an assigned job');
        }
        // Retrieve all jobs (ordered by jobID for a consistent cycle).
        db.all(`SELECT jobID, description, cooldown_value, cooldown_unit FROM joblist ORDER BY jobID ASC`, [], (err, jobs) => {
          if (err) {
            db.run('ROLLBACK');
            return reject('Failed to retrieve job list');
          }
          if (!jobs || jobs.length === 0) {
            db.run('ROLLBACK');
            return reject('No jobs available');
          }
          // Get the current job index.
          getCurrentJobIndex()
            .then((currentIndex) => {
              // Normalize index if out-of-bounds.
              if (currentIndex < 0 || currentIndex >= jobs.length) {
                currentIndex = 0;
              }
              const tryAssign = (attempt) => {
                if (attempt >= jobs.length) {
                  db.run('ROLLBACK');
                  return reject('No quests available (all on cooldown).');
                }
                const index = (currentIndex + attempt) % jobs.length;
                const job = jobs[index];
                checkJobCooldown(userID, job.jobID, job.cooldown_value, job.cooldown_unit)
                  .then(({ onCooldown }) => {
                    if (onCooldown) {
                      return tryAssign(attempt + 1);
                    }
                    const nextIndex = (index + 1) % jobs.length;
                    setCurrentJobIndex(nextIndex, {
                      actorUserId: userID,
                      executor: getEventLedgerExecutor(db),
                      inTransaction: true,
                      source: 'assign_cycled_job',
                      metadata: {
                        userID,
                        jobID: job.jobID,
                        description: job.description,
                      },
                    })
                      .then(() => {
                        db.run(
                          `INSERT INTO job_assignees (jobID, userID) VALUES (?, ?)`,
                          [job.jobID, userID],
                          async (err2) => {
                            if (err2) {
                              db.run('ROLLBACK');
                              return reject('Failed to assign job');
                            }
                            db.run('COMMIT', async (commitErr) => {
                              if (commitErr) {
                                db.run('ROLLBACK');
                                return reject('Failed to commit job assignment');
                              }
                              try {
                                await appendSystemEvent({
                                  domain: 'jobs',
                                  action: 'assign',
                                  entityType: 'job_assignment',
                                  entityId: `${userID}:${job.jobID}`,
                                  actorUserId: userID,
                                  metadata: {
                                    userID,
                                    jobID: job.jobID,
                                    description: job.description,
                                    mode: 'cycled',
                                  },
                                });
                              } catch (eventError) {
                                return reject(eventError);
                              }
                              resolve({
                                jobID: job.jobID,
                                description: job.description,
                              });
                            });
                          }
                        );
                      })
                      .catch((err) => {
                        db.run('ROLLBACK');
                        reject(err);
                      });
                  })
                  .catch((err) => {
                    db.run('ROLLBACK');
                    reject(err);
                  });
              };

              tryAssign(0);
            })
            .catch((err) => {
              db.run('ROLLBACK');
              reject(err);
            });
        });
      });
    });
  });
}

// =========================================================================
// Shop System
// =========================================================================

function getShopItems() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM items WHERE isAvailable = 1 AND quantity > 0 AND COALESCE(isHidden, 0) = 0`,
      [],
      (err, rows) => {
        if (err) {
          console.error('Error retrieving shop items:', err);
          return reject('🚫 Shop is currently unavailable. Please try again later.');
        }
        resolve(rows || []);
      }
    );
  });
}

function getAllShopItems() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM items`,
      [],
      (err, rows) => {
        if (err) {
          console.error('Error retrieving all shop items:', err);
          return reject('🚫 Shop items are currently unavailable. Please try again later.');
        }
        resolve(rows || []);
      }
    );
  });
}

function getShopItemByName(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM items WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND isAvailable = 1`,
      [name],
      (err, row) => {
      if (err) {
        console.error(`Error looking up item "${name}":`, err);
        return reject('🚫 Unable to retrieve item information. Please try again.');
      }
      // Resolve with null if not found — callers must check for null
      resolve(row || null);
      }
    );
  });
}

function getPrizeShopItemByName(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM items
       WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`,
      [name],
      (err, row) => {
        if (err) {
          console.error(`Error looking up prize item "${name}":`, err);
          return reject('🚫 Unable to retrieve prize item information. Please try again.');
        }
        resolve(row || null);
      }
    );
  });
}

function getAnyShopItemByName(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM items WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`,
      [name],
      (err, row) => {
      if (err) {
        console.error(`Error looking up item "${name}":`, err);
        return reject('🚫 Unable to retrieve item information. Please try again.');
      }
      resolve(row || null);
      }
    );
  });
}

function addShopItem(price, name, description, quantity = 1, isHidden = 0, isRedeemable = 1, isAvailable = null) {
  return new Promise((resolve, reject) => {
    const normalizedHidden = isHidden ? 1 : 0;
    const normalizedAvailable =
      isAvailable === null || typeof isAvailable === 'undefined'
        ? (normalizedHidden ? 0 : 1)
        : (isAvailable ? 1 : 0);

    db.run(
      `INSERT INTO items (price, name, description, quantity, isAvailable, isHidden, isRedeemable) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [price, name, description, quantity, normalizedAvailable, normalizedHidden, isRedeemable ? 1 : 0],
      async function (err) {
        if (err) {
          console.error('Error adding new shop item:', err);
          return reject(new Error('🚫 Failed to add the item to the shop. Please try again.'));
        }
        try {
          await appendSystemEvent({
            domain: 'shop',
            action: 'create_item',
            entityType: 'item',
            entityId: this.lastID,
            metadata: {
              itemID: this.lastID,
              price,
              name,
              description,
              quantity,
              isAvailable: normalizedAvailable,
              isHidden: normalizedHidden,
              isRedeemable: isRedeemable ? 1 : 0,
            },
          });
        } catch (eventError) {
          return reject(eventError);
        }
        resolve();
      }
    );
  });
}

function removeShopItem(name) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM items WHERE name = ?`, [name], (lookupErr, existing) => {
      if (lookupErr) {
        console.error(`Error looking up item "${name}" before removal:`, lookupErr);
        return reject('🚫 Failed to remove the item from the shop. Please try again.');
      }
      if (!existing) {
        return reject('🚫 Item not found.');
      }

      db.run(`UPDATE items SET isAvailable = 0 WHERE name = ?`, [name], async (err) => {
        if (err) {
          console.error(`Error removing item "${name}" from the shop:`, err);
          return reject('🚫 Failed to remove the item from the shop. Please try again.');
        }
        try {
          await appendSystemEvent({
            domain: 'shop',
            action: 'deactivate_item',
            entityType: 'item',
            entityId: existing.itemID,
            metadata: {
              itemID: existing.itemID,
              before: existing,
              after: {
                ...existing,
                isAvailable: 0,
              },
            },
          });
        } catch (eventError) {
          return reject(eventError);
        }
        resolve();
      });
    });
  });
}

async function updateShopItemQuantity(itemID, newQuantity) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT quantity FROM items WHERE itemID = ?`, [itemID], (lookupErr, existing) => {
      if (lookupErr) {
        console.error('Error fetching current item quantity:', lookupErr);
        return reject('🚫 Failed to update item stock.');
      }
      if (!existing) {
        return reject('🚫 Item not found.');
      }

      db.run('UPDATE items SET quantity = ? WHERE itemID = ?', [newQuantity, itemID], async (err) => {
        if (err) {
          console.error('Error updating item quantity:', err);
          return reject('🚫 Failed to update item stock.');
        }
        try {
          await appendSystemEvent({
            domain: 'inventory',
            action: 'set_item_stock',
            entityType: 'item',
            entityId: itemID,
            metadata: {
              itemID,
              previousQuantity: existing.quantity,
              newQuantity,
            },
          });
        } catch (eventError) {
          return reject(eventError);
        }
        resolve();
      });
    });
  });
}

async function updateShopItemById(itemID, fields = {}, options = {}) {
  const existing = await getSql(`SELECT * FROM items WHERE itemID = ?`, [itemID]);
  if (!existing) {
    throw new Error('Item not found.');
  }

  const updated = {
    name: fields.name ?? existing.name,
    description: fields.description ?? existing.description,
    price: fields.price ?? existing.price,
    quantity: fields.quantity ?? existing.quantity,
    isAvailable: fields.isAvailable ?? existing.isAvailable,
    isHidden: fields.isHidden ?? existing.isHidden ?? 0,
    isRedeemable: fields.isRedeemable ?? existing.isRedeemable ?? 1,
  };

  await runSql(
    `UPDATE items
     SET name = ?, description = ?, price = ?, quantity = ?, isAvailable = ?, isHidden = ?, isRedeemable = ?
     WHERE itemID = ?`,
    [
      updated.name,
      updated.description,
      updated.price,
      updated.quantity,
      updated.isAvailable,
      updated.isHidden,
      updated.isRedeemable,
      itemID,
    ]
  );

  await appendSystemEvent({
    domain: 'shop',
    action: 'update_item',
    entityType: 'item',
    entityId: itemID,
    actorUserId: options.actorUserId || null,
    metadata: {
      itemID,
      before: {
        name: existing.name,
        description: existing.description,
        price: existing.price,
        quantity: existing.quantity,
        isAvailable: existing.isAvailable,
        isHidden: existing.isHidden ?? 0,
        isRedeemable: existing.isRedeemable ?? 1,
      },
      after: updated,
    },
  });

  return updated;
}

async function deleteShopItemById(itemID, options = {}) {
  const existing = await getSql(`SELECT * FROM items WHERE itemID = ?`, [itemID]);
  if (!existing) {
    throw new Error('Item not found.');
  }

  await runSql('BEGIN IMMEDIATE');
  try {
    const inventoryRows = await allSql(
      `SELECT userID, itemID, quantity
       FROM inventory
       WHERE itemID = ?
       ORDER BY userID ASC`,
      [itemID]
    );
    const inventoryDelete = await runSql(`DELETE FROM inventory WHERE itemID = ?`, [itemID]);
    await runSql(`DELETE FROM items WHERE itemID = ?`, [itemID]);

    await appendSystemEvent({
      domain: 'shop',
      action: 'delete_item',
      entityType: 'item',
      entityId: itemID,
      actorUserId: options.actorUserId || null,
      metadata: {
        itemID,
        item: existing,
        inventoryRowsRemoved: inventoryDelete.changes || 0,
        removedInventoryRows: inventoryRows,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw new Error(error.message || 'Failed to delete item.');
  }
}

function getInventory(userID) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT i.name, i.description, inv.quantity
       FROM inventory inv
       JOIN items i ON inv.itemID = i.itemID
       WHERE inv.userID = ?`,
      [userID],
      (err, rows) => {
        if (err) {
          console.error(`Error retrieving inventory for user ${userID}:`, err);
          return reject('🚫 Failed to retrieve inventory. Please try again later.');
        }
        resolve(rows || []);
      }
    );
  });
}

async function addItemToInventory(userID, itemID, quantity = 1) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT name FROM items WHERE itemID = ?`, [itemID], (err, row) => {
      if (err) {
        console.error('Error finding existing inventory row:', err);
        return reject(new Error('Failed to find existing inventory.'));
      }

      if (!row) return reject(new Error('Item does not exist.'));
      const itemName = row.name;

      // Add the item to inventory
      db.get(`SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`, [userID, itemID], (err, invRow) => {
        if (err) {
          console.error('Error finding existing inventory row:', err);
          return reject(new Error('Failed to find existing inventory.'));
        }

        if (!invRow) {
          db.run(`INSERT INTO inventory (userID, itemID, quantity) VALUES (?, ?, ?)`, [userID, itemID, quantity], async (insertErr) => {
            if (insertErr) {
              console.error('Error inserting new inventory row:', insertErr);
              return reject(new Error('Failed to add item to inventory.'));
            }

            // ✅ Only trigger raffle entry if the item is a "Raffle Ticket"
            if (itemName.toLowerCase().includes('raffle ticket')) {
              autoEnterRaffle(userID, itemName, quantity);
            }

            try {
              await appendSystemEvent({
                domain: 'inventory',
                action: 'add_item',
                entityType: 'inventory_item',
                entityId: `${userID}:${itemID}`,
                actorUserId: userID,
                metadata: {
                  userID,
                  itemID,
                  itemName,
                  quantity,
                  resultingQuantity: quantity,
                },
              });
            } catch (eventError) {
              return reject(eventError);
            }

            resolve();
          });
        } else {
          const newQuantity = invRow.quantity + quantity;
          db.run(`UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`, [newQuantity, userID, itemID], async (updateErr) => {
            if (updateErr) {
              console.error('Error updating inventory quantity:', updateErr);
              return reject(new Error('Failed to update inventory quantity.'));
            }

            // ✅ Only trigger raffle entry if the item is a "Raffle Ticket"
            if (itemName.toLowerCase().includes('raffle ticket')) {
              autoEnterRaffle(userID, itemName, quantity);
            }

            try {
              await appendSystemEvent({
                domain: 'inventory',
                action: 'add_item',
                entityType: 'inventory_item',
                entityId: `${userID}:${itemID}`,
                actorUserId: userID,
                metadata: {
                  userID,
                  itemID,
                  itemName,
                  quantity,
                  resultingQuantity: newQuantity,
                },
              });
            } catch (eventError) {
              return reject(eventError);
            }

            resolve();
          });
        }
      });
    });
  });
}

async function transferInventoryItem(fromUserID, toUserID, itemID, quantity = 1, options = {}) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('Quantity must be at least 1.');
  }
  if (String(fromUserID) === String(toUserID)) {
    throw new Error('You cannot transfer items to yourself.');
  }

  const item = await getSql(`SELECT itemID, name FROM items WHERE itemID = ?`, [itemID]);
  if (!item) {
    throw new Error('Item does not exist.');
  }

  await runSql('BEGIN IMMEDIATE');
  try {
    const senderRow = await getSql(
      `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`,
      [fromUserID, itemID]
    );

    if (!senderRow || senderRow.quantity < qty) {
      throw new Error(`You do not have enough of "${item.name}" to transfer.`);
    }

    const senderResultingQuantity = senderRow.quantity - qty;
    if (senderResultingQuantity > 0) {
      await runSql(
        `UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`,
        [senderResultingQuantity, fromUserID, itemID]
      );
    } else {
      await runSql(
        `DELETE FROM inventory WHERE userID = ? AND itemID = ?`,
        [fromUserID, itemID]
      );
    }

    const recipientRow = await getSql(
      `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`,
      [toUserID, itemID]
    );
    const recipientResultingQuantity = (recipientRow?.quantity || 0) + qty;

    await runSql(
      `INSERT INTO inventory (userID, itemID, quantity)
       VALUES (?, ?, ?)
       ON CONFLICT(userID, itemID) DO UPDATE SET quantity = quantity + excluded.quantity`,
      [toUserID, itemID, qty]
    );

    await appendSystemEvent({
      domain: 'inventory',
      action: 'transfer_item',
      entityType: 'inventory_item',
      entityId: `${itemID}:${fromUserID}:${toUserID}`,
      actorUserId: options.actorUserId || fromUserID,
      metadata: {
        itemID,
        itemName: item.name,
        quantity: qty,
        fromUserID,
        toUserID,
        senderQuantityBefore: senderRow.quantity,
        senderQuantityAfter: senderResultingQuantity,
        recipientQuantityBefore: recipientRow?.quantity || 0,
        recipientQuantityAfter: recipientResultingQuantity,
        source: options.source || 'transfer',
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');

    if (item.name.toLowerCase().includes('raffle ticket')) {
      await autoEnterRaffle(toUserID, item.name, qty);
    }

    return {
      item,
      quantity: qty,
      fromUserID,
      toUserID,
    };
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw new Error(error.message || 'Failed to transfer item.');
  }
}

async function purchaseShopItem(userID, itemName, quantity = 1, options = {}) {
  await ensureLedgerBootstrap();
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('Quantity must be a positive whole number.');
  }

  await initUserEconomy(userID);

  const executor = getLedgerExecutor(db);
  let purchasedItem = null;
  let totalCost = 0;

  await runSql('BEGIN IMMEDIATE');
  try {
    const item = await getSql(
      `SELECT *
       FROM items
       WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
         AND isAvailable = 1`,
      [itemName]
    );

    if (!item || item.isHidden) {
      throw new Error(`"${itemName}" is not available in the shop.`);
    }

    if (item.quantity < qty) {
      throw new Error(`Only ${item.quantity} left in stock for "${item.name}".`);
    }

    totalCost = item.price * qty;
    purchasedItem = item;

    await ledgerService.appendTransaction({
      type: options.type || 'shop_purchase',
      fromUserId: userID,
      toUserId: null,
      amount: totalCost,
      metadata: {
        ...(options.metadata || {}),
        fromAccount: PRIMARY_BALANCE_ACCOUNT,
        toAccount: 'system',
        source: options.source || 'shop',
        itemID: item.itemID,
        itemName: item.name,
        quantity: qty,
      },
      enforceSufficientFunds: true,
    }, { executor, inTransaction: true });

    await runSql(`UPDATE items SET quantity = quantity - ? WHERE itemID = ?`, [qty, item.itemID]);
    await runSql(
      `INSERT INTO inventory (userID, itemID, quantity)
       VALUES (?, ?, ?)
       ON CONFLICT(userID, itemID) DO UPDATE SET quantity = quantity + excluded.quantity`,
      [userID, item.itemID, qty]
    );

    await appendSystemEvent({
      domain: 'shop',
      action: 'purchase_item',
      entityType: 'item',
      entityId: item.itemID,
      actorUserId: userID,
      metadata: {
        userID,
        itemID: item.itemID,
        itemName: item.name,
        quantity: qty,
        totalCost,
        source: options.source || 'shop',
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }

  if (purchasedItem?.name?.toLowerCase().includes('raffle ticket')) {
    await autoEnterRaffle(userID, purchasedItem.name, qty);
  }

  const bonusInfo = await applyRafflePurchaseBonus(userID, purchasedItem.name, qty);
  return {
    item: purchasedItem,
    quantity: qty,
    totalCost,
    bonusInfo,
  };
}


async function redeemItem(userID, itemName) {
  await runSql('BEGIN IMMEDIATE');
  try {
    const itemRow = await getSql(
      `SELECT itemID, name, COALESCE(isRedeemable, 1) AS isRedeemable
       FROM items
       WHERE name = ?`,
      [itemName]
    );

    if (!itemRow) {
      throw new Error(`🚫 The item "${itemName}" does not exist or is not available.`);
    }
    if (!itemRow.isRedeemable) {
      throw new Error(`🚫 "${itemName}" cannot be redeemed.`);
    }

    const inventoryRow = await getSql(
      `SELECT quantity
       FROM inventory
       WHERE userID = ? AND itemID = ?`,
      [userID, itemRow.itemID]
    );

    if (!inventoryRow || Number(inventoryRow.quantity) <= 0) {
      throw new Error(`🚫 You do not own any "${itemName}" to redeem!`);
    }

    const nextQuantity = Math.max(0, Number(inventoryRow.quantity) - 1);
    if (nextQuantity === 0) {
      await runSql(
        `DELETE FROM inventory
         WHERE userID = ? AND itemID = ?`,
        [userID, itemRow.itemID]
      );
    } else {
      const updateResult = await runSql(
        `UPDATE inventory
         SET quantity = quantity - 1
         WHERE userID = ? AND itemID = ?
           AND quantity > 0`,
        [userID, itemRow.itemID]
      );
      if (!updateResult.changes) {
        throw new Error(`🚫 You do not own any "${itemName}" to redeem!`);
      }
    }

    await appendSystemEvent({
      domain: 'inventory',
      action: 'redeem_item',
      entityType: 'inventory_item',
      entityId: `${userID}:${itemRow.itemID}`,
      actorUserId: userID,
      metadata: {
        userID,
        itemID: itemRow.itemID,
        itemName,
        resultingQuantity: nextQuantity,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');

    if (nextQuantity === 0) {
      return `✅ You have successfully used (and removed) your last "${itemName}".`;
    }
    return `✅ You have successfully used one "${itemName}". You now have ${nextQuantity} left.`;
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    const message = error?.message || error?.toString() || '🚫 Failed to redeem item.';
    if (!String(message).startsWith('🚫')) {
      console.error('Database error in redeemItem:', error);
      throw new Error('🚫 Failed to update your inventory.');
    }
    throw new Error(message);
  }
}

function logItemRedemption({
  userID,
  userTag,
  itemName,
  walletAddress,
  source,
  channelName,
  channelId,
  messageLink,
  commandText,
  inventoryBefore,
  inventoryAfter,
}) {
  return new Promise((resolve, reject) => {
    const encryptedWalletAddress = encryptProtectedProfileValue(walletAddress);
    const query = `
      INSERT INTO item_redemptions (
        userID, user_tag, item_name, wallet_address, source,
        channel_name, channel_id, message_link, command_text,
        inventory_before, inventory_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      userID,
      userTag || null,
      itemName,
      encryptedWalletAddress,
      source,
      channelName || null,
      channelId || null,
      messageLink || null,
      commandText || null,
      Number.isFinite(inventoryBefore) ? inventoryBefore : null,
      Number.isFinite(inventoryAfter) ? inventoryAfter : null,
    ];
    db.run(query, params, async function onInsert(err) {
      if (err) {
        console.error('Database error in logItemRedemption:', err);
        return reject(err);
      }
      try {
        await appendSystemEvent({
          domain: 'inventory',
          action: 'log_redemption',
          entityType: 'item_redemption',
          entityId: this.lastID,
          actorUserId: userID,
          metadata: {
            redemptionId: this.lastID,
            userID,
            userTag: userTag || null,
            itemName,
            walletAddress: encryptedWalletAddress,
            source,
            channelName: channelName || null,
            channelId: channelId || null,
            messageLink: messageLink || null,
            commandText: commandText || null,
            inventoryBefore: Number.isFinite(inventoryBefore) ? inventoryBefore : null,
            inventoryAfter: Number.isFinite(inventoryAfter) ? inventoryAfter : null,
          },
        });
      } catch (eventError) {
        return reject(eventError);
      }
      resolve();
    });
  });
}




// =========================================================================
// Giveaway Functions
// =========================================================================

// Save a new giveaway and return its auto-generated id.
async function saveGiveaway(discordMessageId, channelId, endTime, prize, winners, name, repeat) {
  const result = await runSql(
    `INSERT INTO giveaways (message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, is_completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [discordMessageId, channelId, endTime, prize, winners, name, repeat]
  );

  await appendSystemEvent({
    domain: 'giveaways',
    action: 'create',
    entityType: 'giveaway',
    entityId: result.lastID,
    metadata: {
      giveawayId: result.lastID,
      messageId: discordMessageId,
      channelId,
      endTime,
      prize,
      winners,
      name,
      repeat,
    },
  });

  return result.lastID;
}



// Get all active giveaways.
async function getActiveGiveaways() {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM giveaways WHERE end_time > ? AND COALESCE(is_completed, 0) = 0',
      [Date.now()],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

async function getPendingGiveaways() {
  return allSql(
    `SELECT *
     FROM giveaways
     WHERE COALESCE(is_completed, 0) = 0
     ORDER BY end_time ASC, id ASC`
  );
}

function ensureGiveawayCompletionColumn() {
  db.all(`PRAGMA table_info(giveaways)`, (err, columns) => {
    if (err) {
      console.error('❌ Error checking giveaways table structure:', err);
      return;
    }
    if (!Array.isArray(columns) || columns.length === 0) {
      return;
    }
    const hasCompleted = columns.some((column) => column.name === 'is_completed');
    if (hasCompleted) {
      return;
    }
    db.run(`ALTER TABLE giveaways ADD COLUMN is_completed INTEGER DEFAULT 0`, (alterErr) => {
      if (alterErr) {
        console.error('❌ Error adding "is_completed" column to giveaways:', alterErr);
      } else {
        console.log('✅ Migration complete: giveaways now track is_completed.');
      }
    });
  });
}

ensureGiveawayCompletionColumn();

async function markGiveawayCompleted(giveawayId, options = {}) {
  const result = await runSql(
    `UPDATE giveaways
     SET is_completed = 1
     WHERE id = ?
       AND COALESCE(is_completed, 0) = 0`,
    [giveawayId]
  );

  if (!result.changes) {
    return false;
  }

  await appendSystemEvent({
    domain: 'giveaways',
    action: 'complete',
    entityType: 'giveaway',
    entityId: giveawayId,
    actorUserId: options.actorUserId || null,
    metadata: {
      giveawayId,
      source: options.source || 'giveaway',
    },
  });

  return true;
}

// Delete a giveaway by its message_id.
async function deleteGiveaway(messageId) {
  const existing = await getSql('SELECT * FROM giveaways WHERE message_id = ?', [messageId]);
  if (!existing) {
    return;
  }

  await runSql('BEGIN IMMEDIATE');
  try {
    const removedEntries = await allSql(
      `SELECT user_id
       FROM giveaway_entries
       WHERE giveaway_id = ?
       ORDER BY user_id ASC`,
      [existing.id]
    );
    const entryDelete = await runSql('DELETE FROM giveaway_entries WHERE giveaway_id = ?', [existing.id]);
    const result = await runSql('DELETE FROM giveaways WHERE message_id = ?', [messageId]);

    await appendSystemEvent({
      domain: 'giveaways',
      action: 'delete',
      entityType: 'giveaway',
      entityId: existing.id,
      metadata: {
        giveawayId: existing.id,
        messageId,
        giveawayName: existing.giveaway_name,
        prize: existing.prize,
        removedEntryCount: entryDelete.changes || 0,
        removedEntryUserIds: removedEntries.map((entry) => entry.user_id),
        deleted: Boolean(result.changes),
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }
}

// Get a giveaway by its message_id.
async function getGiveawayByMessageId(messageId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM giveaways WHERE message_id = ?',
      [messageId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Record a giveaway entry (i.e. when a user reacts).
async function addGiveawayEntry(giveawayId, userId) {
  try {
    // ✅ Force a real-time check from the database
    const existingEntry = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?',
        [giveawayId, userId],
        (err, row) => {
          if (err) {
            console.error(`❌ Database error checking entry for user ${userId} in giveaway ${giveawayId}:`, err);
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    if (existingEntry) {
      console.log(`⚠️ User ${userId} already entered in giveaway ${giveawayId}. Skipping duplicate.`);
      return;
    }

    await runSql(
      'INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)',
      [giveawayId, userId]
    );

    await appendSystemEvent({
      domain: 'giveaways',
      action: 'add_entry',
      entityType: 'giveaway_entry',
      entityId: `${giveawayId}:${userId}`,
      actorUserId: userId,
      metadata: {
        giveawayId,
        userId,
      },
    });

    console.log(`✅ Successfully added user ${userId} to giveaway ${giveawayId}.`);

  } catch (error) {
    console.error(`❌ Error adding user ${userId} to giveaway ${giveawayId}:`, error);
    throw error;
  }
}



// Get all giveaway entries (user IDs) for a specific giveaway.
async function getGiveawayEntries(giveawayId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?',
      [giveawayId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => row.user_id));
      }
    );
  });
}


// Remove a giveaway entry when a reaction is removed.
async function removeGiveawayEntry(giveawayId, userId) {
  const result = await runSql(
    'DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?',
    [giveawayId, userId]
  );

  if (!result.changes) {
    console.warn(`⚠️ No entry found for user ${userId} in giveaway ${giveawayId}.`);
    return false;
  }

  await appendSystemEvent({
    domain: 'giveaways',
    action: 'remove_entry',
    entityType: 'giveaway_entry',
    entityId: `${giveawayId}:${userId}`,
    actorUserId: userId,
    metadata: {
      giveawayId,
      userId,
    },
  });

  console.log(`✅ Successfully removed user ${userId} from giveaway ${giveawayId}.`);
  return true;
}


// Clear all giveaway entries for a given giveaway (used when syncing reactions).
async function clearGiveawayEntries(giveawayId) {
  const result = await runSql(
    'DELETE FROM giveaway_entries WHERE giveaway_id = ?',
    [giveawayId]
  );

  await appendSystemEvent({
    domain: 'giveaways',
    action: 'clear_entries',
    entityType: 'giveaway',
    entityId: giveawayId,
    metadata: {
      giveawayId,
      removedEntries: result.changes || 0,
    },
  });
}

async function updateGiveawayById(giveawayId, fields = {}, options = {}) {
  const existing = await getSql(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
  if (!existing) {
    throw new Error('Giveaway not found.');
  }

  const updated = {
    giveaway_name: fields.giveaway_name ?? existing.giveaway_name,
    prize: fields.prize ?? existing.prize,
    winners: fields.winners ?? existing.winners,
    end_time: fields.end_time ?? existing.end_time,
    repeat: fields.repeat ?? existing.repeat,
  };

  await runSql(
    `UPDATE giveaways
     SET giveaway_name = ?, prize = ?, winners = ?, end_time = ?, repeat = ?
     WHERE id = ?`,
    [
      updated.giveaway_name,
      updated.prize,
      updated.winners,
      updated.end_time,
      updated.repeat,
      giveawayId,
    ]
  );

  await appendSystemEvent({
    domain: 'giveaways',
    action: 'update',
    entityType: 'giveaway',
    entityId: giveawayId,
    actorUserId: options.actorUserId || null,
    metadata: {
      giveawayId,
      before: existing,
      after: updated,
    },
  });

  return updated;
}
// =========================================================================
// Title Giveaways (separate rails from giveaways)
// =========================================================================
//
// IMPORTANT:
// - This is for "title-giveaway" as a *separate giveaway rail*, but prize = volts OR shop item.
// - So we store the prize in a column named `prize` (NOT `title`).
//
// If you already created the old version with a `title` column:
// - easiest dev fix: DROP the two tables and recreate (you’ll lose only title giveaway data)
//   db.run(`DROP TABLE IF EXISTS title_giveaway_entries`);
//   db.run(`DROP TABLE IF EXISTS title_giveaways`);
//
// Or ask me and I’ll give you a migration that preserves data.


// =========================================================================
// Title Giveaways Tables
// =========================================================================
db.run(`
  CREATE TABLE IF NOT EXISTS title_giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    end_time INTEGER NOT NULL,
    prize TEXT NOT NULL,
    winners INTEGER NOT NULL,
    giveaway_name TEXT NOT NULL DEFAULT 'Untitled Title Giveaway',
    repeat INTEGER DEFAULT 0,
    is_completed INTEGER DEFAULT 0
  )
`, (err) => {
  if (err) console.error('❌ Error creating title_giveaways table:', err);
  else console.log('✅ Title giveaways table is ready.');
});

db.run(`
  CREATE TABLE IF NOT EXISTS title_giveaway_entries (
    title_giveaway_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (title_giveaway_id, user_id),
    FOREIGN KEY (title_giveaway_id) REFERENCES title_giveaways(id) ON DELETE CASCADE
  )
`, (err) => {
  if (err) console.error('❌ Error creating title_giveaway_entries table:', err);
  else console.log('✅ Title giveaway entries table is ready.');
});


// =========================================================================
// Title Giveaway Functions (PATCHED: supports old `title` column + new `prize`)
// =========================================================================
//
// What this does:
// 1) On load, it checks if `title_giveaways` is missing the `prize` column.
// 2) If missing, it ALTERs the table to add `prize`.
// 3) If the old `title` column exists, it backfills prize = title for existing rows.
// 4) All functions below use `prize` going forward.
//
// Paste this WHOLE block in place of your current "Title Giveaway Functions" block.
// (You can put the migration helper right above the functions, same section.)

function ensureTitleGiveawayPrizeColumn() {
  db.all(`PRAGMA table_info(title_giveaways)`, (err, columns) => {
    if (err) {
      console.error('❌ Error checking title_giveaways table structure:', err);
      return;
    }
    if (!Array.isArray(columns) || columns.length === 0) {
      return;
    }

    const hasPrize = columns.some(col => col.name === 'prize');
    const hasTitle = columns.some(col => col.name === 'title');

    if (!hasPrize) {
      console.log('➕ Migrating title_giveaways: adding missing "prize" column...');
      db.serialize(() => {
        db.run(`ALTER TABLE title_giveaways ADD COLUMN prize TEXT`, (alterErr) => {
          if (alterErr) {
            console.error('❌ Error adding "prize" column to title_giveaways:', alterErr);
            return;
          }

          if (hasTitle) {
            db.run(`UPDATE title_giveaways SET prize = title WHERE prize IS NULL`, (copyErr) => {
              if (copyErr) console.error('⚠️ Error backfilling prize from title:', copyErr);
              else console.log('✅ Backfilled prize from old "title" column.');
            });
          }

          console.log('✅ Migration complete: title_giveaways now has "prize".');
        });
      });
    } else {
      // Optional: keep quiet or log once
      // console.log('✅ title_giveaways already has "prize" column.');
    }
  });
}

// Call this once on startup (db.js loads once, so this is fine)
ensureTitleGiveawayPrizeColumn();

function ensureRaffleCompletionColumn() {
  db.all(`PRAGMA table_info(raffles)`, (err, columns) => {
    if (err) {
      console.error('❌ Error checking raffles table structure:', err);
      return;
    }
    if (!Array.isArray(columns) || columns.length === 0) {
      return;
    }
    const hasCompleted = columns.some((column) => column.name === 'is_completed');
    if (hasCompleted) {
      return;
    }
    db.run(`ALTER TABLE raffles ADD COLUMN is_completed INTEGER DEFAULT 0`, (alterErr) => {
      if (alterErr) {
        console.error('❌ Error adding "is_completed" column to raffles:', alterErr);
      } else {
        console.log('✅ Migration complete: raffles now track is_completed.');
      }
    });
  });
}

ensureRaffleCompletionColumn();


// Save a new title giveaway (separate rails) and return its auto-generated id.
async function saveTitleGiveaway(discordMessageId, channelId, endTime, prize, winners, name, repeat) {
  const result = await runSql(
    `INSERT INTO title_giveaways (message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, is_completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [discordMessageId, channelId, endTime, prize, winners, name, repeat]
  );

  await appendSystemEvent({
    domain: 'title_giveaways',
    action: 'create',
    entityType: 'title_giveaway',
    entityId: result.lastID,
    metadata: {
      titleGiveawayId: result.lastID,
      messageId: discordMessageId,
      channelId,
      endTime,
      prize,
      winners,
      name,
      repeat,
    },
  });

  return result.lastID;
}

// Get all active title giveaways.
async function getActiveTitleGiveaways() {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM title_giveaways WHERE end_time > ? AND is_completed = 0',
      [Date.now()],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

async function getPendingTitleGiveaways() {
  return allSql(
    `SELECT *
     FROM title_giveaways
     WHERE is_completed = 0
     ORDER BY end_time ASC, id ASC`
  );
}

// Get a title giveaway by its message_id.
async function getTitleGiveawayByMessageId(messageId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM title_giveaways WHERE message_id = ?',
      [messageId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
}

// Delete a title giveaway by its message_id.
async function deleteTitleGiveaway(messageId) {
  const existing = await getSql('SELECT * FROM title_giveaways WHERE message_id = ?', [messageId]);
  if (!existing) {
    return;
  }

  await runSql('BEGIN IMMEDIATE');
  try {
    const removedEntries = await allSql(
      `SELECT user_id
       FROM title_giveaway_entries
       WHERE title_giveaway_id = ?
       ORDER BY user_id ASC`,
      [existing.id]
    );
    const entryDelete = await runSql(
      'DELETE FROM title_giveaway_entries WHERE title_giveaway_id = ?',
      [existing.id]
    );
    const result = await runSql(
      'DELETE FROM title_giveaways WHERE message_id = ?',
      [messageId]
    );

    await appendSystemEvent({
      domain: 'title_giveaways',
      action: 'delete',
      entityType: 'title_giveaway',
      entityId: existing.id,
      metadata: {
        titleGiveawayId: existing.id,
        messageId,
        giveawayName: existing.giveaway_name,
        prize: existing.prize,
        removedEntryCount: entryDelete.changes || 0,
        removedEntryUserIds: removedEntries.map((entry) => entry.user_id),
        deleted: Boolean(result.changes),
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }
}

// Record a title giveaway entry (i.e. when a user reacts).
async function addTitleGiveawayEntry(titleGiveawayId, userId) {
  try {
    const existingEntry = await new Promise((resolve, reject) => {
      db.get(
        'SELECT 1 FROM title_giveaway_entries WHERE title_giveaway_id = ? AND user_id = ?',
        [titleGiveawayId, userId],
        (err, row) => {
          if (err) {
            console.error(`❌ DB error checking entry for user ${userId} in title_giveaway ${titleGiveawayId}:`, err);
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    if (existingEntry) {
      console.log(`⚠️ User ${userId} already entered title_giveaway ${titleGiveawayId}. Skipping duplicate.`);
      return;
    }

    await runSql(
      'INSERT INTO title_giveaway_entries (title_giveaway_id, user_id) VALUES (?, ?)',
      [titleGiveawayId, userId]
    );

    await appendSystemEvent({
      domain: 'title_giveaways',
      action: 'add_entry',
      entityType: 'title_giveaway_entry',
      entityId: `${titleGiveawayId}:${userId}`,
      actorUserId: userId,
      metadata: {
        titleGiveawayId,
        userId,
      },
    });

    console.log(`✅ Successfully added user ${userId} to title_giveaway ${titleGiveawayId}.`);
  } catch (error) {
    console.error(`❌ Error adding user ${userId} to title_giveaway ${titleGiveawayId}:`, error);
    throw error;
  }
}

// Get all title giveaway entries (user IDs) for a specific title giveaway.
async function getTitleGiveawayEntries(titleGiveawayId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT user_id FROM title_giveaway_entries WHERE title_giveaway_id = ?',
      [titleGiveawayId],
      (err, rows) => {
        if (err) reject(err);
        else resolve((rows || []).map(row => row.user_id));
      }
    );
  });
}

// Remove a title giveaway entry when a reaction is removed.
async function removeTitleGiveawayEntry(titleGiveawayId, userId) {
  const result = await runSql(
    'DELETE FROM title_giveaway_entries WHERE title_giveaway_id = ? AND user_id = ?',
    [titleGiveawayId, userId]
  );

  if (!result.changes) {
    console.warn(`⚠️ No entry found for user ${userId} in title_giveaway ${titleGiveawayId}.`);
    return false;
  }

  await appendSystemEvent({
    domain: 'title_giveaways',
    action: 'remove_entry',
    entityType: 'title_giveaway_entry',
    entityId: `${titleGiveawayId}:${userId}`,
    actorUserId: userId,
    metadata: {
      titleGiveawayId,
      userId,
    },
  });

  console.log(`✅ Successfully removed user ${userId} from title_giveaway ${titleGiveawayId}.`);
  return true;
}

// Clear all title giveaway entries for a given title giveaway (useful when syncing reactions).
async function clearTitleGiveawayEntries(titleGiveawayId) {
  const result = await runSql(
    'DELETE FROM title_giveaway_entries WHERE title_giveaway_id = ?',
    [titleGiveawayId]
  );

  await appendSystemEvent({
    domain: 'title_giveaways',
    action: 'clear_entries',
    entityType: 'title_giveaway',
    entityId: titleGiveawayId,
    metadata: {
      titleGiveawayId,
      removedEntries: result.changes || 0,
    },
  });
}

/**
 * Prevent double-awarding.
 * Returns true if it successfully marked the giveaway complete,
 * false if it was already completed.
 */
async function markTitleGiveawayCompleted(titleGiveawayId) {
  const result = await runSql(
    'UPDATE title_giveaways SET is_completed = 1 WHERE id = ? AND is_completed = 0',
    [titleGiveawayId]
  );

  if (result.changes === 1) {
    await appendSystemEvent({
      domain: 'title_giveaways',
      action: 'complete',
      entityType: 'title_giveaway',
      entityId: titleGiveawayId,
      metadata: {
        titleGiveawayId,
      },
    });
  }

  return result.changes === 1;
}

async function updateTitleGiveawayById(titleGiveawayId, fields = {}, options = {}) {
  const existing = await getSql(`SELECT * FROM title_giveaways WHERE id = ?`, [titleGiveawayId]);
  if (!existing) {
    throw new Error('Title giveaway not found.');
  }

  const updated = {
    giveaway_name: fields.giveaway_name ?? existing.giveaway_name,
    prize: fields.prize ?? existing.prize,
    winners: fields.winners ?? existing.winners,
    end_time: fields.end_time ?? existing.end_time,
    repeat: fields.repeat ?? existing.repeat,
    is_completed: fields.is_completed ?? existing.is_completed,
  };

  await runSql(
    `UPDATE title_giveaways
     SET giveaway_name = ?, prize = ?, winners = ?, end_time = ?, repeat = ?, is_completed = ?
     WHERE id = ?`,
    [
      updated.giveaway_name,
      updated.prize,
      updated.winners,
      updated.end_time,
      updated.repeat,
      updated.is_completed,
      titleGiveawayId,
    ]
  );

  await appendSystemEvent({
    domain: 'title_giveaways',
    action: 'update',
    entityType: 'title_giveaway',
    entityId: titleGiveawayId,
    actorUserId: options.actorUserId || null,
    metadata: {
      titleGiveawayId,
      before: existing,
      after: updated,
    },
  });

  return updated;
}

// =========================================================================
// MIGRATION: title_giveaways title->prize (fix NOT NULL constraint)
// =========================================================================
function migrateTitleGiveawaysToPrizeColumn() {
  db.all(`PRAGMA table_info(title_giveaways)`, (err, cols) => {
    if (err) {
      console.error('❌ Failed to inspect title_giveaways:', err);
      return;
    }
    if (!cols || cols.length === 0) return; // table might not exist yet

    const hasTitle = cols.some(c => c.name === 'title');
    const hasPrize = cols.some(c => c.name === 'prize');

    // We need full migration if:
    // - title exists and is NOT NULL (old schema), and/or
    // - prize missing, or
    // - title is still required in practice
    const titleCol = cols.find(c => c.name === 'title');
    const titleNotNull = titleCol ? titleCol.notnull === 1 : false;

    if (!hasTitle) {
      // Already on new schema (or different), nothing to do
      return;
    }

    if (hasPrize && !titleNotNull) {
      // You already added prize and title isn't blocking inserts anymore
      return;
    }

    console.log('⚙️ Migrating title_giveaways schema: replacing NOT NULL `title` with NOT NULL `prize`...');

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // 1) Create new table with correct schema
      db.run(`
        CREATE TABLE IF NOT EXISTS title_giveaways_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          end_time INTEGER NOT NULL,
          prize TEXT NOT NULL,
          winners INTEGER NOT NULL,
          giveaway_name TEXT NOT NULL DEFAULT 'Untitled Title Giveaway',
          repeat INTEGER DEFAULT 0,
          is_completed INTEGER DEFAULT 0
        )
      `);

      // 2) Copy data over (use existing prize if present, else fall back to old title)
      //    Also preserve ids so foreign keys / references keep working.
      db.run(`
        INSERT INTO title_giveaways_new (id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, is_completed)
        SELECT
          id,
          message_id,
          channel_id,
          end_time,
          COALESCE(prize, title),
          winners,
          giveaway_name,
          repeat,
          is_completed
        FROM title_giveaways
      `);

      // 3) Swap tables
      db.run(`DROP TABLE title_giveaways`);
      db.run(`ALTER TABLE title_giveaways_new RENAME TO title_giveaways`);

      // 4) Recreate entries table FK cleanly (safest)
      //    (Because the old entries table FK referenced the old table definition)
      db.run(`DROP TABLE IF EXISTS title_giveaway_entries`);
      db.run(`
        CREATE TABLE IF NOT EXISTS title_giveaway_entries (
          title_giveaway_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          PRIMARY KEY (title_giveaway_id, user_id),
          FOREIGN KEY (title_giveaway_id) REFERENCES title_giveaways(id) ON DELETE CASCADE
        )
      `);

      db.run('COMMIT', (commitErr) => {
        if (commitErr) {
          console.error('❌ Migration commit failed:', commitErr);
          db.run('ROLLBACK');
        } else {
          console.log('✅ Migration complete: title_giveaways now uses `prize` correctly.');
        }
      });
    });
  });
}
//================
// 🎟️ Raffles
//================


//--------------------------------------
// 1) Raffle Entry Methods
//--------------------------------------

/**
 * getRaffleParticipants(raffle_id)
 * Returns an array of row objects for each ticket:
 * [{ entry_id, raffle_id, user_id }, ...].
 *
 * This is more future-proof if you need to remove
 * a single winning ticket while keeping the user's other tickets.
 */
async function getRaffleParticipants(raffle_id) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT entry_id, raffle_id, user_id
       FROM raffle_entries
       WHERE raffle_id = ?`,
      [raffle_id],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

/**
 * addRaffleEntry(raffle_id, user_id)
 * Inserts a new row for each ticket purchased.
 * Allows multiple entries per user for the same raffle.
 */
async function addRaffleEntry(raffle_id, user_id) {
  await runSql(
    `INSERT INTO raffle_entries (raffle_id, user_id) VALUES (?, ?)`,
    [raffle_id, user_id]
  );

  await appendSystemEvent({
    domain: 'raffles',
    action: 'add_entry',
    entityType: 'raffle_entry',
    entityId: `${raffle_id}:${user_id}`,
    actorUserId: user_id,
    metadata: {
      raffleId: raffle_id,
      userId: user_id,
      quantity: 1,
    },
  });
}

/**
 * clearRaffleEntries(raffle_id)
 * Removes all entries for a specific raffle.
 */
async function clearRaffleEntries(raffle_id) {
  const result = await runSql(
    `DELETE FROM raffle_entries WHERE raffle_id = ?`,
    [raffle_id]
  );

  await appendSystemEvent({
    domain: 'raffles',
    action: 'clear_entries',
    entityType: 'raffle',
    entityId: raffle_id,
    metadata: {
      raffleId: raffle_id,
      removedEntries: result.changes || 0,
    },
  });
}

//--------------------------------------
// 2) Creating & Fetching Raffles
//--------------------------------------

async function upsertShopItem(price, name, description, quantity) {
  const existing = await getSql(
    `SELECT itemID, quantity, description, price FROM items WHERE name = ?`,
    [name]
  );

  const result = await runSql(
    `INSERT INTO items (price, name, description, quantity, isAvailable)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(name) DO UPDATE
     SET description = excluded.description,
         quantity = items.quantity + excluded.quantity`,
    [price, name, description, quantity]
  );

  const current = await getSql(
    `SELECT itemID, quantity, description, price FROM items WHERE name = ?`,
    [name]
  );

  await appendSystemEvent({
    domain: 'shop',
    action: existing ? 'upsert_item' : 'create_item',
    entityType: 'item',
    entityId: current?.itemID || result.lastID || name,
    metadata: {
      itemID: current?.itemID || result.lastID || null,
      name,
      description,
      price,
      quantityAdded: quantity,
      previousQuantity: existing?.quantity ?? 0,
      resultingQuantity: current?.quantity ?? quantity,
      previousDescription: existing?.description ?? null,
    },
  });
}



/**
 * createRaffle(channelId, name, prize, cost, quantity, winners, endTime)
 * Creates a new raffle in the "raffles" table,
 * Also adds (or increments) a "RaffleName Ticket" to the shop.
 */
const { format } = require('date-fns'); // ✅ Import date-fns for formatting

function buildRaffleTicketDescription(name, winners, endTime) {
  const formattedEndTime = format(new Date(endTime), "MMM d 'at' h:mm a");
  return `Entry ticket for the ${name} raffle. 🏆 ${winners} winner(s) will be selected! ⏳ Ends on ${formattedEndTime} UTC.`;
}

async function createRaffle(channelId, name, prize, cost, quantity, winners, endTime) {
  const ticketName = `${name} Raffle Ticket`;
  const ticketDesc = buildRaffleTicketDescription(name, winners, endTime);

  await runSql('BEGIN IMMEDIATE');
  try {
    const existingTicket = await getSql(
      `SELECT itemID, name, description, price, isAvailable, isHidden, isRedeemable, quantity
       FROM items
       WHERE name = ?`,
      [ticketName]
    );

    const raffleResult = await runSql(
      `INSERT INTO raffles (channel_id, name, prize, cost, quantity, winners, end_time, is_completed)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [channelId, name, prize, cost, quantity, winners, endTime]
    );

    await runSql(
      `INSERT INTO items (name, description, price, isAvailable, isHidden, isRedeemable, quantity)
       VALUES (?, ?, ?, 1, 0, 0, ?)
       ON CONFLICT(name)
       DO UPDATE SET
         description = excluded.description,
         price = excluded.price,
         quantity = excluded.quantity,
         isAvailable = 1,
         isHidden = 0,
         isRedeemable = 0`,
      [ticketName, ticketDesc, cost, quantity]
    );

    const currentTicket = await getSql(
      `SELECT itemID, name, description, price, isAvailable, isHidden, isRedeemable, quantity
       FROM items
       WHERE name = ?`,
      [ticketName]
    );

    await appendSystemEvent({
      domain: 'shop',
      action: existingTicket ? 'upsert_item' : 'create_item',
      entityType: 'item',
      entityId: currentTicket?.itemID || ticketName,
      metadata: {
        itemID: currentTicket?.itemID || null,
        source: 'raffle_ticket',
        before: existingTicket || null,
        after: currentTicket || null,
        quantityAdded: quantity,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await appendSystemEvent({
      domain: 'raffles',
      action: 'create',
      entityType: 'raffle',
      entityId: raffleResult.lastID,
      metadata: {
        raffleId: raffleResult.lastID,
        channelId,
        name,
        prize,
        cost,
        quantity,
        winners,
        endTime,
        ticketName,
        ticketItemID: currentTicket?.itemID || null,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
    console.log(`✅ Upserted raffle ticket '${ticketName}' successfully.`);
    return raffleResult.lastID;
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    console.error(`⚠️ Upsert Error for '${ticketName}':`, error);
    throw new Error(error.message || '🚫 Failed to add or update raffle ticket in the shop.');
  }
}





/**
 * getRaffleByName(name)
 * Fetches an active raffle by its name (end_time > now).
 * Useful for auto-entering users when they buy a "RaffleName Ticket".
 */
async function getRaffleByName(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM raffles
       WHERE name = ?
       AND end_time > ?`,  // Only fetch active raffles
      [name, Date.now()],
      (err, row) => {
        if (err) {
          console.error(`❌ Error finding raffle by name '${name}':`, err);
          return reject(err);
        }
        if (!row) {
          console.warn(`⚠️ No active raffle found for '${name}'`);
          return resolve(null); // Return null if no raffle found
        }
        console.log(`✅ Found active raffle: ${row.name} (ID: ${row.id})`);
        resolve(row);
      }
    );
  });
}

function extractRaffleNameFromTicket(itemName) {
  if (!itemName) return null;
  if (!/raffle ticket/i.test(itemName)) return null;
  return itemName.replace(/\s*raffle ticket\s*$/i, '').trim();
}

async function recordRaffleTicketPurchase(userID, itemName, quantity = 1) {
  const raffleName = extractRaffleNameFromTicket(itemName);
  if (!raffleName) return null;

  const raffle = await getRaffleByName(raffleName);
  if (!raffle) return null;

  const safeQty = Math.max(0, Number(quantity) || 0);
  if (!safeQty) return { raffle, bonusTickets: 0, milestones: [], previousCount: 0, newCount: 0 };

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      db.run(
        `INSERT OR IGNORE INTO raffle_ticket_purchases
         (raffle_id, user_id, purchased_count, bonus_10_given, bonus_25_given, bonus_50_given)
         VALUES (?, ?, 0, 0, 0, 0)`,
        [raffle.id, userID],
        (insertErr) => {
          if (insertErr) {
            db.run('ROLLBACK');
            console.error('Error initializing raffle ticket purchase tracking:', insertErr);
            return reject(insertErr);
          }

          db.get(
            `SELECT purchased_count, bonus_10_given, bonus_25_given, bonus_50_given
             FROM raffle_ticket_purchases
             WHERE raffle_id = ? AND user_id = ?`,
            [raffle.id, userID],
            (selectErr, row) => {
              if (selectErr) {
                db.run('ROLLBACK');
                console.error('Error fetching raffle ticket purchase tracking:', selectErr);
                return reject(selectErr);
              }

              const previousCount = row?.purchased_count || 0;
              const newCount = previousCount + safeQty;

              let bonusTickets = 0;
              const milestones = [];

              let bonus10 = row?.bonus_10_given ? 1 : 0;
              let bonus25 = row?.bonus_25_given ? 1 : 0;
              let bonus50 = row?.bonus_50_given ? 1 : 0;

              const thresholds = [
                { count: 10, bonus: 1, flag: 'bonus10' },
                { count: 25, bonus: 2, flag: 'bonus25' },
                { count: 50, bonus: 3, flag: 'bonus50' },
              ];

              for (const threshold of thresholds) {
                const alreadyGiven =
                  (threshold.flag === 'bonus10' && bonus10) ||
                  (threshold.flag === 'bonus25' && bonus25) ||
                  (threshold.flag === 'bonus50' && bonus50);

                if (!alreadyGiven && previousCount < threshold.count && newCount >= threshold.count) {
                  bonusTickets += threshold.bonus;
                  milestones.push({ threshold: threshold.count, bonus: threshold.bonus });
                  if (threshold.flag === 'bonus10') bonus10 = 1;
                  if (threshold.flag === 'bonus25') bonus25 = 1;
                  if (threshold.flag === 'bonus50') bonus50 = 1;
                }
              }

              db.run(
                `UPDATE raffle_ticket_purchases
                 SET purchased_count = ?,
                     bonus_10_given = ?,
                     bonus_25_given = ?,
                     bonus_50_given = ?
                 WHERE raffle_id = ? AND user_id = ?`,
                [newCount, bonus10, bonus25, bonus50, raffle.id, userID],
                async (updateErr) => {
                  if (updateErr) {
                    db.run('ROLLBACK');
                    console.error('Error updating raffle ticket purchase tracking:', updateErr);
                    return reject(updateErr);
                  }

                  try {
                    await appendSystemEvent({
                      domain: 'raffles',
                      action: 'track_ticket_purchase',
                      entityType: 'raffle_ticket_purchase',
                      entityId: `${raffle.id}:${userID}`,
                      actorUserId: userID,
                      metadata: {
                        raffleId: raffle.id,
                        raffleName: raffle.name,
                        userID,
                        quantityPurchased: safeQty,
                        previousCount,
                        newCount,
                        bonusTickets,
                        milestones,
                      },
                    }, { executor: getEventLedgerExecutor(db), inTransaction: true });
                  } catch (eventError) {
                    db.run('ROLLBACK');
                    return reject(eventError);
                  }

                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      console.error('Error committing raffle ticket purchase tracking:', commitErr);
                      return reject(commitErr);
                    }
                    resolve({ raffle, bonusTickets, milestones, previousCount, newCount });
                  });
                }
              );
            }
          );
        }
      );
    });
  });
}

async function applyRafflePurchaseBonus(userID, itemName, quantity = 1) {
  const result = await recordRaffleTicketPurchase(userID, itemName, quantity);
  if (!result || !result.bonusTickets) return result;

  try {
    const ticketItem = await getShopItemByName(itemName);
    if (ticketItem) {
      await addItemToInventory(userID, ticketItem.itemID, result.bonusTickets);
    } else {
      console.warn(`⚠️ Could not find raffle ticket item "${itemName}" to award bonus tickets.`);
    }
  } catch (err) {
    console.error('❌ Failed to award bonus raffle tickets:', err);
  }

  return result;
}


/**
 * getRaffleById(raffle_id)
 * Fetches a raffle by its ID (used during conclusion).
 */
async function getRaffleById(raffle_id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM raffles
       WHERE id = ?`,
      [raffle_id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

/**
 * getActiveRaffles()
 * Returns all raffles that haven't ended yet (end_time > now).
 */
async function getActiveRaffles() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT *
       FROM raffles
       WHERE end_time > ?
         AND COALESCE(is_completed, 0) = 0`,
      [Date.now()],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

async function getPendingRaffles() {
  return allSql(
    `SELECT *
     FROM raffles
     WHERE COALESCE(is_completed, 0) = 0
     ORDER BY end_time ASC, id ASC`
  );
}

async function updateRaffleById(raffleId, fields = {}, options = {}) {
  const existing = await getSql(`SELECT * FROM raffles WHERE id = ?`, [raffleId]);
  if (!existing) {
    throw new Error('Raffle not found.');
  }

  const updated = {
    name: fields.name ?? existing.name,
    prize: fields.prize ?? existing.prize,
    cost: fields.cost ?? existing.cost,
    quantity: fields.quantity ?? existing.quantity,
    winners: fields.winners ?? existing.winners,
    end_time: fields.end_time ?? existing.end_time,
    is_completed: fields.is_completed ?? existing.is_completed,
  };

  await runSql(
    `UPDATE raffles
     SET name = ?, prize = ?, cost = ?, quantity = ?, winners = ?, end_time = ?, is_completed = ?
     WHERE id = ?`,
    [
      updated.name,
      updated.prize,
      updated.cost,
      updated.quantity,
      updated.winners,
      updated.end_time,
      updated.is_completed,
      raffleId,
    ]
  );

  await appendSystemEvent({
    domain: 'raffles',
    action: 'update',
    entityType: 'raffle',
    entityId: raffleId,
    actorUserId: options.actorUserId || null,
    metadata: {
      raffleId,
      before: existing,
      after: updated,
    },
  });

  return updated;
}

async function restartRaffleById(raffleId, endTime, options = {}) {
  const existing = await getSql(`SELECT * FROM raffles WHERE id = ?`, [raffleId]);
  if (!existing) {
    throw new Error('Raffle not found.');
  }

  const updated = {
    ...existing,
    end_time: endTime,
    is_completed: 0,
  };
  const ticketName = `${existing.name} Raffle Ticket`;
  const ticketDesc = buildRaffleTicketDescription(existing.name, existing.winners, endTime);

  await runSql('BEGIN IMMEDIATE');
  try {
    const existingTicket = await getSql(
      `SELECT itemID, name, description, price, isAvailable, isHidden, isRedeemable, quantity
       FROM items
       WHERE name = ?`,
      [ticketName]
    );

    await runSql(
      `UPDATE raffles
       SET end_time = ?, is_completed = 0
       WHERE id = ?`,
      [endTime, raffleId]
    );

    await runSql(
      `INSERT INTO items (name, description, price, isAvailable, isHidden, isRedeemable, quantity)
       VALUES (?, ?, ?, 1, 0, 0, ?)
       ON CONFLICT(name)
       DO UPDATE SET
         description = excluded.description,
         price = excluded.price,
         isAvailable = 1,
         isHidden = 0,
         isRedeemable = 0,
         quantity = excluded.quantity`,
      [ticketName, ticketDesc, existing.cost, existing.quantity]
    );

    const currentTicket = await getSql(
      `SELECT itemID, name, description, price, isAvailable, isHidden, isRedeemable, quantity
       FROM items
       WHERE name = ?`,
      [ticketName]
    );

    await runSql(`DELETE FROM raffle_entries WHERE raffle_id = ?`, [raffleId]);
    await runSql(`DELETE FROM raffle_ticket_purchases WHERE raffle_id = ?`, [raffleId]);

    await appendSystemEvent({
      domain: 'shop',
      action: existingTicket ? 'upsert_item' : 'create_item',
      entityType: 'item',
      entityId: currentTicket?.itemID || ticketName,
      metadata: {
        itemID: currentTicket?.itemID || null,
        source: 'raffle_restart',
        before: existingTicket || null,
        after: currentTicket || null,
        quantityAdded: existingTicket ? 0 : existing.quantity,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await appendSystemEvent({
      domain: 'raffles',
      action: 'update',
      entityType: 'raffle',
      entityId: raffleId,
      actorUserId: options.actorUserId || null,
      metadata: {
        raffleId,
        before: existing,
        after: updated,
        source: 'raffle_restart',
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await appendSystemEvent({
      domain: 'raffles',
      action: 'clear_entries',
      entityType: 'raffle',
      entityId: raffleId,
      actorUserId: options.actorUserId || null,
      metadata: {
        raffleId,
        source: 'raffle_restart',
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
    return updated;
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function getUserTickets(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT r.name AS raffleName, COUNT(re.user_id) AS quantity
       FROM raffle_entries re
       JOIN raffles r ON re.raffle_id = r.id
       WHERE re.user_id = ?
       GROUP BY r.name`,
      [userId],
      (err, rows) => {
        if (err) {
          console.error("❌ Error fetching user tickets:", err);
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}


//--------------------------------------
// 3) Auto-Entering a Raffle
//--------------------------------------

/**
 * autoEnterRaffle(userID, ticketName)
 * Called when a user buys a "RaffleName Ticket" from the shop.
 * Finds the raffle by name and calls addRaffleEntry.
 */
async function autoEnterRaffle(userID, itemName, quantity = 1) {
  const raffleName = itemName.replace(" Raffle Ticket", "").trim();
  const raffle = await getSql(
    `SELECT id FROM raffles WHERE name = ? AND end_time > ?`,
    [raffleName, Date.now()]
  );

  if (!raffle) {
    console.warn(`⚠️ No active raffle found for "${raffleName}". Skipping entry.`);
    return;
  }

  const count = Math.max(0, Number(quantity) || 0);
  if (!count) return;

  await runSql('BEGIN IMMEDIATE');
  try {
    for (let i = 0; i < count; i += 1) {
      await runSql(
        `INSERT INTO raffle_entries (raffle_id, user_id) VALUES (?, ?)`,
        [raffle.id, userID]
      );
    }

    await appendSystemEvent({
      domain: 'raffles',
      action: 'auto_enter',
      entityType: 'raffle_entry_batch',
      entityId: `${raffle.id}:${userID}`,
      actorUserId: userID,
      metadata: {
        raffleId: raffle.id,
        raffleName,
        userID,
        itemName,
        quantity: count,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
    console.log(`✅ User ${userID} entered into raffle ${raffle.id} with ${count} ticket(s) from "${itemName}".`);
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw new Error(error.message || '🚫 Failed to enter raffle.');
  }
}


//--------------------------------------
// 4) Removing Raffle Shop Item
//--------------------------------------

/**
 * removeRaffleShopItem(raffleName)
 * Removes the "RaffleName Ticket" item from the shop,
 * and clears that item from all user inventories.
 */
async function removeRaffleShopItem(raffleName) {
  const ticketName = `${raffleName} Raffle Ticket`;
  const item = await getSql(`SELECT * FROM items WHERE name = ?`, [ticketName]);

  await runSql('BEGIN IMMEDIATE');
  try {
    let inventoryRemoved = 0;
    let inventoryRows = [];

    if (item?.itemID) {
      inventoryRows = await allSql(
        `SELECT userID, itemID, quantity
         FROM inventory
         WHERE itemID = ?
         ORDER BY userID ASC`,
        [item.itemID]
      );
      const inventoryDelete = await runSql(
        `DELETE FROM inventory WHERE itemID = ?`,
        [item.itemID]
      );
      inventoryRemoved = inventoryDelete.changes || 0;

      await runSql(`DELETE FROM items WHERE itemID = ?`, [item.itemID]);

      await appendSystemEvent({
        domain: 'shop',
        action: 'delete_item',
        entityType: 'item',
        entityId: item.itemID,
        metadata: {
          itemID: item.itemID,
          item,
          removedInventoryRows: inventoryRows,
          inventoryRowsRemoved: inventoryRemoved,
          source: 'raffle_cleanup',
        },
      }, { executor: getEventLedgerExecutor(db), inTransaction: true });
    }

    await appendSystemEvent({
      domain: 'raffles',
      action: 'remove_ticket_item',
      entityType: 'item',
      entityId: item?.itemID || ticketName,
      metadata: {
        raffleName,
        ticketName,
        itemID: item?.itemID || null,
        inventoryRowsRemoved: inventoryRemoved,
        removedInventoryRows: inventoryRows,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
    console.log(`✅ Raffle shop item "${ticketName}" removed successfully.`);
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    console.error(`⚠️ Error removing raffle shop item "${ticketName}":`, error);
    throw new Error('🚫 Failed to remove raffle item.');
  }
}

async function markRaffleCompleted(raffleId, options = {}) {
  const result = await runSql(
    `UPDATE raffles
     SET is_completed = 1
     WHERE id = ?
       AND COALESCE(is_completed, 0) = 0`,
    [raffleId]
  );

  if (!result.changes) {
    return false;
  }

  await appendSystemEvent({
    domain: 'raffles',
    action: 'complete',
    entityType: 'raffle',
    entityId: raffleId,
    actorUserId: options.actorUserId || null,
    metadata: {
      raffleId,
      source: options.source || 'raffle',
    },
  });

  return true;
}

//--------------------------------------
// 5) Conclude a Raffle
//--------------------------------------
async function concludeRaffle(raffle) {
  try {
    const locked = await markRaffleCompleted(raffle.id, { source: 'raffle_conclusion' });
    if (!locked) {
      console.warn(`⚠️ Raffle "${raffle.name}" (ID: ${raffle.id}) was already completed. Skipping.`);
      return;
    }

    console.log(`🎟️ Concluding raffle: ${raffle.name} (ID: ${raffle.id})`);

    // 1) Fetch participants
    const participants = await getRaffleParticipants(raffle.id);
    if (participants.length === 0) {
      console.log(`🚫 No participants found for raffle "${raffle.name}".`);
      const channel = discordClient
        ? await discordClient.channels.fetch(raffle.channel_id).catch(() => null)
        : null;
      if (channel) {
        await channel.send(`🚫 The **${raffle.name}** raffle ended, but no one entered.`);
      }
      await appendSystemEvent({
        domain: 'raffles',
        action: 'conclude_empty',
        entityType: 'raffle',
        entityId: raffle.id,
        metadata: {
          raffleId: raffle.id,
          raffleName: raffle.name,
        },
      });
      await removeRaffleShopItem(raffle.name);
      await clearRaffleEntries(raffle.id);
      return;
    }

    const uniqueUserIds = [...new Set(participants.map(p => p.user_id))];
    console.log(`📊 Found ${participants.length} total entries from ${uniqueUserIds.length} unique participants`);

    // 2) Shuffle and pick winners
    const shuffled = participants.sort(() => Math.random() - 0.5);
    const winningEntries = shuffled.slice(0, raffle.winners);
    console.log(`🎟️ Selected ${winningEntries.length} winners from ${participants.length} total entries`);

    if (winningEntries.length === 0) {
      console.error(`❌ No winners selected for raffle "${raffle.name}"`);
      return;
    }

    // 3) Award prizes
    if (!isNaN(raffle.prize)) {
      const prizeAmount = parseInt(raffle.prize, 10);
      for (const ticket of winningEntries) {
        await updateWallet(ticket.user_id, prizeAmount, {
          type: 'raffle_reward',
          raffleId: raffle.id,
          raffleName: raffle.name,
        });
        console.log(`💰 User ${ticket.user_id} won ${prizeAmount} coins`);
      }
    } else {
      const shopItem = await getPrizeShopItemByName(raffle.prize);
      if (!shopItem) {
        console.error(`⚠️ Shop item "${raffle.prize}" not found.`);
      } else {
        for (const ticket of winningEntries) {
          await addItemToInventory(ticket.user_id, shopItem.itemID);
          console.log(`🎁 User ${ticket.user_id} won "${shopItem.name}"`);
        }
      }
    }

    // 🛢️ 4) Award Robot Oil to ALL participants BEFORE cleanup
    try {
      console.log('🔍 [DEBUG] Attempting to fetch Robot Oil item...');
      console.log('🔍 [DEBUG] Participants list (unique users):', uniqueUserIds);

      const robotOilItem = await getAnyShopItemByName('Robot Oil');

      if (!robotOilItem) {
        console.log('⚠️ [DEBUG] Robot Oil item not found.');
      } else {
        console.log(`✅ [DEBUG] Robot Oil found: itemID ${robotOilItem.itemID}`);
        for (const userId of uniqueUserIds) {
          console.log(`🛢️ [DEBUG] Awarding Robot Oil to userID: ${userId}`);
          await addItemToInventory(userId, robotOilItem.itemID, 1);
        }
      }
    } catch (oilRewardError) {
      console.error('❌ Error awarding Robot Oil participation rewards:', oilRewardError);
    }

    // 5) Announce winners
    const channel = discordClient
      ? await discordClient.channels.fetch(raffle.channel_id).catch(() => null)
      : null;
    if (channel) {
      const winnerMentions = winningEntries.map(entry => `<@${entry.user_id}>`).join(', ');
      await channel.send(`🎉 The **${raffle.name}** raffle has ended! Winners: ${winnerMentions}`);
    }

    await appendSystemEvent({
      domain: 'raffles',
      action: 'conclude',
      entityType: 'raffle',
      entityId: raffle.id,
      metadata: {
        raffleId: raffle.id,
        raffleName: raffle.name,
        winnerIds: winningEntries.map((entry) => entry.user_id),
        participantCount: participants.length,
      },
    });

    // 6) Cleanup raffle tickets and entries
    await removeRaffleShopItem(raffle.name);
    await clearRaffleEntries(raffle.id);
    console.log(`✅ Raffle "${raffle.name}" concluded and cleaned up.`);
  } catch (err) {
    console.error(`❌ Error concluding raffle "${raffle.name}":`, err);
  }
}


// ==========================================================
// Robot Oil (Marketplace Logic)
// ==========================================================

async function listRobotOilForSale(userID, quantity, pricePerUnit) {
  await ensureLedgerBootstrap();
  const qty = Number(quantity);
  const unitPrice = Number(pricePerUnit);

  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('🚫 Quantity must be greater than zero.');
  }

  if (!Number.isInteger(unitPrice) || unitPrice <= 0) {
    throw new Error('🚫 Price must be greater than zero.');
  }

  const robotOil = await getShopItemByName('Robot Oil');
  if (!robotOil) throw new Error('Robot Oil item not found.');

  const userInventory = await getSql(
    `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`,
    [userID, robotOil.itemID]
  );

  if (!userInventory || userInventory.quantity < qty) {
    throw new Error('🚫 Not enough Robot Oil in inventory.');
  }

  await runSql('BEGIN IMMEDIATE');
  try {
    await runSql(
      `UPDATE inventory
       SET quantity = quantity - ?
       WHERE userID = ? AND itemID = ?`,
      [qty, userID, robotOil.itemID]
    );
    await runSql(
      `DELETE FROM inventory
       WHERE userID = ? AND itemID = ? AND quantity <= 0`,
      [userID, robotOil.itemID]
    );
    const listingResult = await runSql(
      `INSERT INTO robot_oil_market (seller_id, quantity, price_per_unit, type)
       VALUES (?, ?, ?, 'sale')`,
      [userID, qty, unitPrice]
    );

    await appendSystemEvent({
      domain: 'robot_oil_market',
      action: 'list_sale',
      entityType: 'robot_oil_listing',
      entityId: listingResult.lastID,
      actorUserId: userID,
      metadata: {
        listingId: listingResult.lastID,
        sellerId: userID,
        quantity: qty,
        pricePerUnit: unitPrice,
        type: 'sale',
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });
    await runSql('COMMIT');
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }

  return `✅ Listed ${qty} Robot Oil at ⚡${unitPrice} each.`;
}

async function placeRobotOilBid(userID, quantity, pricePerUnit) {
  await ensureLedgerBootstrap();
  const qty = Number(quantity);
  const unitPrice = Number(pricePerUnit);
  const totalCost = qty * unitPrice;
  const executor = getLedgerExecutor(db);

  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('🚫 Quantity must be greater than zero.');
  }

  if (!Number.isInteger(unitPrice) || unitPrice <= 0) {
    throw new Error('🚫 Price must be greater than zero.');
  }

  await runSql('BEGIN IMMEDIATE');
  try {
    await ledgerService.appendTransaction({
      type: 'robot_oil_bid_hold',
      fromUserId: userID,
      toUserId: null,
      amount: totalCost,
      metadata: {
        fromAccount: PRIMARY_BALANCE_ACCOUNT,
        toAccount: 'system',
        market: 'robot_oil',
        quantity: qty,
        pricePerUnit: unitPrice,
      },
      enforceSufficientFunds: true,
    }, { executor, inTransaction: true });

    const listingResult = await runSql(
      `INSERT INTO robot_oil_market (seller_id, quantity, price_per_unit, type)
       VALUES (?, ?, ?, 'purchase')`,
      [userID, qty, unitPrice]
    );

    await appendSystemEvent({
      domain: 'robot_oil_market',
      action: 'place_bid',
      entityType: 'robot_oil_listing',
      entityId: listingResult.lastID,
      actorUserId: userID,
      metadata: {
        listingId: listingResult.lastID,
        buyerId: userID,
        quantity: qty,
        pricePerUnit: unitPrice,
        totalCost,
        type: 'purchase',
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql('COMMIT');
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }

  return `✅ Bid placed for ${qty} Robot Oil at ⚡${unitPrice} each.`;
}

async function getRobotOilMarketListings() {
  await ensureLedgerBootstrap();
  return allSql(
    `SELECT * FROM robot_oil_market
     ORDER BY price_per_unit ASC, listing_id ASC`
  );
}

async function buyRobotOilFromMarket(buyerID, listingID, quantityRequested) {
  await ensureLedgerBootstrap();
  const qty = Number(quantityRequested);
  const executor = getLedgerExecutor(db);

  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('🚫 Quantity must be greater than zero.');
  }

  await runSql('BEGIN IMMEDIATE');
  try {
    const listing = await getSql(`SELECT * FROM robot_oil_market WHERE listing_id = ?`, [listingID]);
    if (!listing) throw new Error('🚫 Listing not found.');
    if (qty > listing.quantity) throw new Error('🚫 Not enough quantity available.');

    const totalCost = qty * listing.price_per_unit;
    const robotOil = await getShopItemByName('Robot Oil');
    if (!robotOil) throw new Error('🚫 Robot Oil item missing.');

    if (listing.type === 'sale') {
      if (String(buyerID) === String(listing.seller_id)) {
        throw new Error('🚫 You cannot buy your own sale listing.');
      }

      await ledgerService.appendTransaction({
        type: 'robot_oil_market_buy',
        fromUserId: buyerID,
        toUserId: listing.seller_id,
        amount: totalCost,
        metadata: {
          fromAccount: PRIMARY_BALANCE_ACCOUNT,
          toAccount: PRIMARY_BALANCE_ACCOUNT,
          market: 'robot_oil',
          listingId: listing.listing_id,
          quantity: qty,
          pricePerUnit: listing.price_per_unit,
        },
        enforceSufficientFunds: true,
      }, { executor, inTransaction: true });

      await runSql(
        `INSERT INTO inventory (userID, itemID, quantity)
         VALUES (?, ?, ?)
         ON CONFLICT(userID, itemID) DO UPDATE SET quantity = quantity + excluded.quantity`,
        [buyerID, robotOil.itemID, qty]
      );

      await runSql(
        `INSERT INTO robot_oil_history (event_type, buyer_id, seller_id, quantity, price_per_unit, total_price)
         VALUES ('purchase', ?, ?, ?, ?, ?)`,
        [buyerID, listing.seller_id, qty, listing.price_per_unit, totalCost]
      );

      await appendSystemEvent({
        domain: 'robot_oil_market',
        action: 'buy_listing',
        entityType: 'robot_oil_listing',
        entityId: listing.listing_id,
        actorUserId: buyerID,
        metadata: {
          listingId: listing.listing_id,
          listingType: listing.type,
          buyerId: buyerID,
          sellerId: listing.seller_id,
          quantity: qty,
          pricePerUnit: listing.price_per_unit,
          totalCost,
        },
      }, { executor: getEventLedgerExecutor(db), inTransaction: true });
    } else if (listing.type === 'purchase') {
      if (String(buyerID) === String(listing.seller_id)) {
        throw new Error('🚫 You cannot fulfill your own bid.');
      }

      const sellerInventory = await getSql(
        `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`,
        [buyerID, robotOil.itemID]
      );

      if (!sellerInventory || sellerInventory.quantity < qty) {
        throw new Error('🚫 Not enough Robot Oil to sell.');
      }

      await runSql(
        `UPDATE inventory SET quantity = quantity - ? WHERE userID = ? AND itemID = ?`,
        [qty, buyerID, robotOil.itemID]
      );
      await runSql(
        `DELETE FROM inventory WHERE userID = ? AND itemID = ? AND quantity <= 0`,
        [buyerID, robotOil.itemID]
      );

      await ledgerService.appendTransaction({
        type: 'robot_oil_bid_settlement',
        fromUserId: null,
        toUserId: buyerID,
        amount: totalCost,
        metadata: {
          fromAccount: 'system',
          toAccount: PRIMARY_BALANCE_ACCOUNT,
          market: 'robot_oil',
          listingId: listing.listing_id,
          bidOwnerId: listing.seller_id,
          quantity: qty,
          pricePerUnit: listing.price_per_unit,
        },
      }, { executor, inTransaction: true });

      await runSql(
        `INSERT INTO inventory (userID, itemID, quantity)
         VALUES (?, ?, ?)
         ON CONFLICT(userID, itemID) DO UPDATE SET quantity = quantity + excluded.quantity`,
        [listing.seller_id, robotOil.itemID, qty]
      );

      await runSql(
        `INSERT INTO robot_oil_history (event_type, buyer_id, seller_id, quantity, price_per_unit, total_price)
         VALUES ('market_sell', ?, ?, ?, ?, ?)`,
        [listing.seller_id, buyerID, qty, listing.price_per_unit, totalCost]
      );

      await appendSystemEvent({
        domain: 'robot_oil_market',
        action: 'fulfill_bid',
        entityType: 'robot_oil_listing',
        entityId: listing.listing_id,
        actorUserId: buyerID,
        metadata: {
          listingId: listing.listing_id,
          listingType: listing.type,
          bidOwnerId: listing.seller_id,
          sellerId: buyerID,
          quantity: qty,
          pricePerUnit: listing.price_per_unit,
          totalCost,
        },
      }, { executor: getEventLedgerExecutor(db), inTransaction: true });
    } else {
      throw new Error('🚫 Unsupported listing type.');
    }

    if (qty === listing.quantity) {
      await runSql(`DELETE FROM robot_oil_market WHERE listing_id = ?`, [listingID]);
    } else {
      await runSql(
        `UPDATE robot_oil_market SET quantity = quantity - ? WHERE listing_id = ?`,
        [qty, listingID]
      );
    }

    await runSql('COMMIT');
    return `✅ Completed market transaction for ${qty} unit(s).`;
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function cancelRobotOilListing(userID, listingID) {
  await ensureLedgerBootstrap();
  const executor = getLedgerExecutor(db);

  await runSql('BEGIN IMMEDIATE');
  try {
    const listing = await getSql(`SELECT * FROM robot_oil_market WHERE listing_id = ?`, [listingID]);
    if (!listing) throw new Error('🚫 Listing not found.');
    if (String(listing.seller_id) !== String(userID)) {
      throw new Error('🚫 You can only cancel your own listings.');
    }

    const robotOil = await getShopItemByName('Robot Oil');
    if (!robotOil) throw new Error('🚫 Robot Oil item missing.');

    if (listing.type === 'sale') {
      await runSql(
        `INSERT INTO inventory (userID, itemID, quantity)
         VALUES (?, ?, ?)
         ON CONFLICT(userID, itemID) DO UPDATE SET quantity = quantity + excluded.quantity`,
        [userID, robotOil.itemID, listing.quantity]
      );
    } else if (listing.type === 'purchase') {
      const refund = listing.quantity * listing.price_per_unit;
      await ledgerService.appendTransaction({
        type: 'robot_oil_bid_refund',
        fromUserId: null,
        toUserId: userID,
        amount: refund,
        metadata: {
          fromAccount: 'system',
          toAccount: PRIMARY_BALANCE_ACCOUNT,
          market: 'robot_oil',
          listingId: listing.listing_id,
          quantity: listing.quantity,
          pricePerUnit: listing.price_per_unit,
        },
      }, { executor, inTransaction: true });
    } else {
      throw new Error('🚫 Invalid listing type.');
    }

    await runSql(
      `INSERT INTO robot_oil_history (event_type, buyer_id, seller_id, quantity, price_per_unit, total_price)
       VALUES ('cancel', NULL, ?, ?, ?, ?)`,
      [userID, listing.quantity, listing.price_per_unit, listing.quantity * listing.price_per_unit]
    );

    await appendSystemEvent({
      domain: 'robot_oil_market',
      action: 'cancel_listing',
      entityType: 'robot_oil_listing',
      entityId: listing.listing_id,
      actorUserId: userID,
      metadata: {
        listingId: listing.listing_id,
        listingType: listing.type,
        ownerId: userID,
        quantity: listing.quantity,
        pricePerUnit: listing.price_per_unit,
      },
    }, { executor: getEventLedgerExecutor(db), inTransaction: true });

    await runSql(`DELETE FROM robot_oil_market WHERE listing_id = ?`, [listingID]);
    await runSql('COMMIT');

    return `✅ Listing canceled and resources returned.`;
  } catch (error) {
    await runSql('ROLLBACK').catch(() => {});
    throw error;
  }
}




// =========================================================================
// User Accounts (With Discord ID and Username Support)
// =========================================================================
const bcrypt = require('bcrypt');
const saltRounds = 10;

// =========================================================================
// User Account Functions
// =========================================================================

/**
 * Registers a user account with a username and password.
 * Ensures username uniqueness at the application level.
 * @param {string} discord_id - The Discord user ID.
 * @param {string|null} username - The chosen username (null if resetting password).
 * @param {string} password - The plain-text password.
 * @returns {Promise<object>} - Resolves when the user is registered or updated.
 */
function registerUser(discord_id, username, password) {
  return new Promise((resolve, reject) => {
    bcrypt.hash(password, saltRounds, (hashErr, hash) => {
      if (hashErr) return reject('Error hashing password');

      db.get(`SELECT username FROM economy WHERE userID = ?`, [discord_id], (currentErr, currentAccount) => {
        if (currentErr) return reject('Database error.');

        // Check if username is already taken (excluding the current user)
        db.get(`SELECT userID FROM economy WHERE username = ?`, [username], (err, existingUser) => {
        if (err) return reject('Database error.');
        if (existingUser && existingUser.userID !== discord_id) {
          return reject('Username is already taken.');
        }

        db.run(
          `INSERT INTO economy (userID, username, password)
           VALUES (?, ?, ?)
           ON CONFLICT(userID) DO UPDATE SET username = excluded.username, password = excluded.password`,
          [discord_id, username, hash],
          async function onRegister(insertErr) {
            if (insertErr) {
              console.error('Error registering user:', insertErr);
              return reject('Failed to register user.');
            }
            try {
              await appendSystemEvent({
                domain: 'accounts',
                action: currentAccount ? 'update_credentials' : 'register',
                entityType: 'account',
                entityId: discord_id,
                actorUserId: discord_id,
                metadata: {
                  userID: discord_id,
                  previousUsername: currentAccount?.username || null,
                  username,
                },
              });
            } catch (eventError) {
              return reject(eventError);
            }
            resolve({ discord_id, username });
          }
        );
      });
      });
    });
  });
}


/**
 * Authenticates a user using their username and password.
 * @param {string} username - The username.
 * @param {string} password - The plain-text password.
 * @returns {Promise<object>} - Resolves if authentication is successful.
 */
function authenticateUser(username, password) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT userID, password FROM economy WHERE username = ?`,
      [username],
      (err, user) => {
        if (err) return reject('Database error.');
        if (!user || !user.password) return reject('No account found.');

        bcrypt.compare(password, user.password, (compareErr, result) => {
          if (compareErr) return reject('Error verifying password.');
          if (!result) return reject('Invalid password.');
          resolve(user);
        });
      }
    );
  });
}

/**
 * Resets a user's password while keeping the existing username.
 * @param {string} discord_id - The Discord user ID.
 * @param {string} newPassword - The new plain-text password.
 * @returns {Promise<object>} - Resolves when the password is updated.
 */
function resetPassword(discord_id, newPassword) {
  return new Promise((resolve, reject) => {
    bcrypt.hash(newPassword, saltRounds, (hashErr, hash) => {
      if (hashErr) return reject('Error hashing password');

      db.run(
        `UPDATE economy SET password = ? WHERE userID = ?`,
        [hash, discord_id],
        async function onReset(err) {
          if (err) {
            console.error('Error updating password:', err);
            return reject('Failed to reset password.');
          }
          if (this.changes === 0) {
            return reject('No existing account found.');
          }
          try {
            await appendSystemEvent({
              domain: 'accounts',
              action: 'reset_password',
              entityType: 'account',
              entityId: discord_id,
              actorUserId: discord_id,
              metadata: {
                userID: discord_id,
              },
            });
          } catch (eventError) {
            return reject(eventError);
          }
          resolve({ discord_id });
        }
      );
    });
  });
}

async function updateUserProfile(userID, fields = {}, options = {}) {
  await initUserEconomy(userID);
  const existing = await getSql(
    `SELECT username, profile_about_me, profile_specialties, profile_location, profile_twitter_handle
     FROM economy
     WHERE userID = ?`,
    [userID]
  );
  const existingDecoded = decodeProfileRow(existing, { maskOnFailure: false });

  const updated = {
    username: fields.username ?? existing?.username ?? null,
    profile_about_me: Object.prototype.hasOwnProperty.call(fields, 'aboutMe')
      ? encryptProtectedProfileValue(fields.aboutMe)
      : (existing?.profile_about_me ?? null),
    profile_specialties: Object.prototype.hasOwnProperty.call(fields, 'specialties')
      ? encryptProtectedProfileValue(fields.specialties)
      : (existing?.profile_specialties ?? null),
    profile_location: Object.prototype.hasOwnProperty.call(fields, 'location')
      ? encryptProtectedProfileValue(fields.location)
      : (existing?.profile_location ?? null),
    profile_twitter_handle: fields.twitterHandle ?? existing?.profile_twitter_handle ?? null,
  };
  const updatedDecoded = decodeProfileRow(updated, { maskOnFailure: false });

  await runSql(
    `UPDATE economy
     SET username = ?,
         profile_about_me = ?,
         profile_specialties = ?,
         profile_location = ?,
         profile_twitter_handle = ?
     WHERE userID = ?`,
    [
      updated.username,
      updated.profile_about_me,
      updated.profile_specialties,
      updated.profile_location,
      updated.profile_twitter_handle,
      userID,
    ]
  );

  await appendSystemEvent({
    domain: 'profile',
    action: 'update',
    entityType: 'user_profile',
    entityId: userID,
    actorUserId: options.actorUserId || userID,
    metadata: {
      userID,
      before: existing || null,
      after: {
        username: updated.username,
        aboutMe: updated.profile_about_me,
        specialties: updated.profile_specialties,
        location: updated.profile_location,
        twitterHandle: updated.profile_twitter_handle,
      },
      source: options.source || 'profile',
    },
  });

  return {
    username: updated.username,
    aboutMe: updatedDecoded?.profile_about_me ?? existingDecoded?.profile_about_me ?? null,
    specialties: updatedDecoded?.profile_specialties ?? existingDecoded?.profile_specialties ?? null,
    location: updatedDecoded?.profile_location ?? existingDecoded?.profile_location ?? null,
    twitterHandle: updated.profile_twitter_handle,
  };
}

async function createChatMessage({ userID, username, message, isAdmin = 0 }, options = {}) {
  const result = await runSql(
    `INSERT INTO chat_messages (userID, username, message, is_admin) VALUES (?, ?, ?, ?)`,
    [userID, username, message, isAdmin ? 1 : 0]
  );

  await appendSystemEvent({
    domain: 'chat',
    action: 'post_message',
    entityType: 'chat_message',
    entityId: result.lastID,
    actorUserId: options.actorUserId || userID,
    metadata: {
      messageId: result.lastID,
      userID,
      username,
      message,
      isAdmin: isAdmin ? 1 : 0,
    },
  });

  return { messageId: result.lastID };
}

async function touchChatPresence({ userID, username, lastSeen = Math.floor(Date.now() / 1000) }, options = {}) {
  await runSql(
    `INSERT INTO chat_presence (userID, username, last_seen)
     VALUES (?, ?, ?)
     ON CONFLICT(userID) DO UPDATE SET
       username = excluded.username,
       last_seen = excluded.last_seen`,
    [userID, username, lastSeen]
  );

  await appendSystemEvent({
    domain: 'chat',
    action: 'presence_ping',
    entityType: 'chat_presence',
    entityId: userID,
    actorUserId: options.actorUserId || userID,
    metadata: {
      userID,
      username,
      lastSeen,
    },
  });

  return { userID, username, lastSeen };
}

function getInventoryByItemID(itemID) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT userID, quantity FROM inventory WHERE itemID = ?`,
      [itemID],
      (err, rows) => {
        if (err) {
          console.error(`Error fetching inventory for itemID ${itemID}:`, err);
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}

async function appendTransaction(entry, options = {}) {
  await ensureLedgerBootstrap();
  return ledgerService.appendTransaction(entry, options);
}

async function getFullLedger(options = {}) {
  await ensureLedgerBootstrap();
  return ledgerService.getFullLedger(options);
}

async function verifyLedgerIntegrity() {
  await ensureLedgerBootstrap();
  return ledgerService.verifyLedgerIntegrity();
}

async function replayLedger() {
  await ensureLedgerBootstrap();
  return ledgerService.replayLedger();
}

async function exportLedger(options = {}) {
  await ensureLedgerBootstrap();
  return ledgerService.exportLedger(options);
}

async function importLedger(source) {
  return ledgerService.importLedger(source);
}

async function importSystemEvents(source) {
  return eventLedgerService.importEvents(source);
}

// =========================================================================
// Exports
// =========================================================================
module.exports = {
  // Raw SQLite instance (if needed)
  db,
  ledgerService,
  eventLedgerService,
  setDiscordClient,
  ensureLedgerBootstrap,
  ensureSystemEventBootstrap,

  // Admin / Economy
  addAdmin,
  removeAdmin,
  getAdmins,
  initUserEconomy,
  getBalances,
  appendTransaction,
  appendSystemEvent,
  getFullLedger,
  verifyLedgerIntegrity,
  replayLedger,
  exportLedger,
  importLedger,
  importSystemEvents,
  getSystemEvents,
  verifySystemEventIntegrity,
  exportSystemEvents,
  getCombinedActivity,
  exportCombinedActivity,
  snapshotSystemEventState,
  getProjectionFingerprint,
  getReplayedProjectionFingerprint,
  getCurrentESTDateString,
  rebuildStateMirror,
  backfillMissingShopItemsToEventLedger,
  reconcileRecoverableProjectionToEventLedger,
  runRecoverableProjectionMaintenance,
  ensureRecoverableProjectionMaintenance,
  getReadableProfileDetails,
  getDailyUserActivity,
  getDailyUserActivitySnapshot,
  upsertDailyUserActivity,
  listActiveRpsGames,
  saveRpsGame,
  deleteRpsGame,
  migrateEconomyToLedger: ensureLedgerBootstrap,
  updateWallet,
  updateDaoCallRewardTimestamp,
  recordDaoCallAttendance,
  getDaoCallAttendanceCountForYear,
  transferFromWallet,
  robUser,
  withdraw,
  deposit,
  getLeaderboard,

  // Shop
  getShopItems,
  getAllShopItems,
  getShopItemByName,
  getPrizeShopItemByName,
  getAnyShopItemByName,
  addShopItem,
  updateShopItemById,
  deleteShopItemById,
  removeShopItem,
  getInventory,
  addItemToInventory,
  transferInventoryItem,
  purchaseShopItem,
  updateShopItemQuantity,
  redeemItem,
  logItemRedemption,
  getRaffleParticipants,
  addRaffleEntry,
  upsertShopItem,
  clearRaffleEntries,
  getActiveRaffles,
  getPendingRaffles,
  createRaffle,
  updateRaffleById,
  restartRaffleById,
  getRaffleByName,
  getRaffleById,
  getUserTickets,
  getInventoryByItemID,
  autoEnterRaffle,
  removeRaffleShopItem,
  concludeRaffle,
  applyRafflePurchaseBonus,

  // Jobs
  getAssignedJob,
  getActiveJob,
  getUserJob,
  addJob,
  updateJobById,
  deleteJobById,
  getJobList,
  completeJob,
  quitAssignedJob,
  submitJobSubmission,
  markLatestSubmissionCompleted,
  getPendingJobSubmissions,
  completePendingJobSubmissions,
  renumberJobs,
  getCurrentJobIndex,
  setCurrentJobIndex,
  assignCycledJob,
  assignJobById,
  getAllJobs,

  // Giveaway
  initializeDatabase,
  saveGiveaway,
  updateGiveawayById,
  getActiveGiveaways,
  getPendingGiveaways,
  markGiveawayCompleted,
  deleteGiveaway,
  getGiveawayByMessageId,
  addGiveawayEntry,
  getGiveawayEntries,
  removeGiveawayEntry,
  clearGiveawayEntries,

  // Title Giveaway
  saveTitleGiveaway,
  updateTitleGiveawayById,
  getActiveTitleGiveaways,
  getPendingTitleGiveaways,
  deleteTitleGiveaway,
  getTitleGiveawayByMessageId,
  addTitleGiveawayEntry,
  getTitleGiveawayEntries,
  removeTitleGiveawayEntry,
  clearTitleGiveawayEntries,
  markTitleGiveawayCompleted,

  // User Accounts
  registerUser,
  updateUserProfile,
  authenticateUser,
  resetPassword,
  decryptProtectedProfileValue,
  decodeItemRedemptionRow,
  decodeItemRedemptionRows,
  decodeRedemptionMetadataFields,
  createChatMessage,
  touchChatPresence,

  // Robot Oil
  listRobotOilForSale,
  placeRobotOilBid,
  getRobotOilMarketListings,
  buyRobotOilFromMarket,
  cancelRobotOilListing,
};
