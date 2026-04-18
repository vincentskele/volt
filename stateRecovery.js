const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SQLite = require('sqlite3').verbose();
const {
  createLedgerService,
  stableStringify,
  PRIMARY_BALANCE_ACCOUNT,
  normalizeLedgerAccount,
} = require('./ledgerService');
const { createEventLedgerService } = require('./eventLedgerService');

function normalizeText(value) {
  if (value === null || typeof value === 'undefined') return null;
  return String(value);
}

function normalizeInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildKey(...parts) {
  return parts.map((part) => normalizeText(part) ?? '').join(':');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function createDbHelpers(database) {
  return {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.run(sql, params, function onRun(error) {
          if (error) return reject(error);
          resolve({ changes: this.changes ?? 0, lastID: this.lastID ?? null });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => {
          if (error) return reject(error);
          resolve(row || null);
        });
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => {
          if (error) return reject(error);
          resolve(rows || []);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        database.close((error) => {
          if (error) return reject(error);
          resolve();
        });
      });
    },
  };
}

async function createRecoverySchema(exec) {
  const statements = [
    `PRAGMA foreign_keys = ON`,
    `CREATE TABLE IF NOT EXISTS economy (
      userID TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      profile_about_me TEXT,
      profile_specialties TEXT,
      profile_location TEXT,
      profile_twitter_handle TEXT,
      last_dao_call_reward_at INTEGER,
      wallet INTEGER DEFAULT 0,
      bank INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS admins (
      userID TEXT PRIMARY KEY
    )`,
    `CREATE TABLE IF NOT EXISTS items (
      itemID INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,
      price INTEGER,
      isAvailable BOOLEAN DEFAULT 1,
      isHidden BOOLEAN DEFAULT 0,
      isRedeemable BOOLEAN DEFAULT 1,
      quantity INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS inventory (
      userID TEXT,
      itemID INTEGER,
      quantity INTEGER DEFAULT 1,
      PRIMARY KEY(userID, itemID),
      FOREIGN KEY(itemID) REFERENCES items(itemID)
    )`,
    `CREATE TABLE IF NOT EXISTS daily_user_activity (
      userID TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      reacted INTEGER DEFAULT 0,
      first_message_bonus_given INTEGER DEFAULT 0,
      rps_wins INTEGER DEFAULT 0,
      PRIMARY KEY(userID, activity_date)
    )`,
    `CREATE TABLE IF NOT EXISTS rps_games (
      game_id TEXT PRIMARY KEY,
      challenger_id TEXT NOT NULL,
      opponent_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      wager INTEGER NOT NULL,
      challenger_choice TEXT,
      opponent_choice TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS joblist (
      jobID INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      cooldown_value INTEGER,
      cooldown_unit TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS job_assignees (
      jobID INTEGER,
      userID TEXT,
      PRIMARY KEY(jobID, userID)
    )`,
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
    `CREATE TABLE IF NOT EXISTS job_cycle (
      current_index INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS giveaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      end_time INTEGER NOT NULL,
      prize TEXT NOT NULL,
      winners INTEGER NOT NULL,
      giveaway_name TEXT NOT NULL DEFAULT 'Untitled Giveaway',
      repeat INTEGER DEFAULT 0,
      is_completed INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (giveaway_id, user_id),
      FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS title_giveaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      end_time INTEGER NOT NULL,
      prize TEXT NOT NULL,
      winners INTEGER NOT NULL,
      giveaway_name TEXT NOT NULL DEFAULT 'Untitled Title Giveaway',
      repeat INTEGER DEFAULT 0,
      is_completed INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS title_giveaway_entries (
      title_giveaway_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (title_giveaway_id, user_id),
      FOREIGN KEY (title_giveaway_id) REFERENCES title_giveaways(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS raffles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prize TEXT NOT NULL,
      cost INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      winners INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      is_completed INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS raffle_entries (
      entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      raffle_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS raffle_ticket_purchases (
      raffle_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      purchased_count INTEGER NOT NULL DEFAULT 0,
      bonus_10_given INTEGER NOT NULL DEFAULT 0,
      bonus_25_given INTEGER NOT NULL DEFAULT 0,
      bonus_50_given INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (raffle_id, user_id),
      FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS dao_call_attendance (
      attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
      userID TEXT NOT NULL,
      meeting_started_at INTEGER NOT NULL,
      rewarded_at INTEGER NOT NULL,
      minutes_attended INTEGER NOT NULL,
      reward_amount INTEGER NOT NULL,
      UNIQUE(userID, meeting_started_at)
    )`,
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
    `CREATE TABLE IF NOT EXISTS robot_oil_market (
      listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_per_unit INTEGER NOT NULL,
      type TEXT DEFAULT 'sale',
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS robot_oil_history (
      history_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      buyer_id TEXT,
      seller_id TEXT,
      quantity INTEGER NOT NULL,
      price_per_unit INTEGER NOT NULL,
      total_price INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userID TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS chat_presence (
      userID TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      last_seen INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ledger_legacy_imports (
      userID TEXT NOT NULL,
      account TEXT NOT NULL,
      imported_balance INTEGER NOT NULL,
      imported_at INTEGER NOT NULL,
      transaction_id INTEGER,
      PRIMARY KEY(userID, account)
    )`,
    `CREATE TABLE IF NOT EXISTS system_event_snapshots (
      snapshot_name TEXT PRIMARY KEY,
      snapshot_at INTEGER NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      last_event_id INTEGER
    )`,
  ];

  for (const statement of statements) {
    // eslint-disable-next-line no-await-in-loop
    await exec.run(statement);
  }
}

function createProjectionState() {
  return {
    admins: new Set(),
    economy: new Map(),
    users: new Map(),
    items: new Map(),
    inventory: new Map(),
    dailyUserActivity: new Map(),
    rpsGames: new Map(),
    joblist: new Map(),
    jobAssignees: new Map(),
    jobSubmissions: new Map(),
    jobCycle: { current_index: 0 },
    giveaways: new Map(),
    giveawayEntries: new Map(),
    titleGiveaways: new Map(),
    titleGiveawayEntries: new Map(),
    raffles: new Map(),
    raffleEntries: new Map(),
    raffleEntryCounter: 0,
    raffleTicketPurchases: new Map(),
    daoCallAttendance: new Map(),
    itemRedemptions: new Map(),
    robotOilMarket: new Map(),
    robotOilHistory: new Map(),
    robotOilHistoryCounter: 0,
    chatMessages: new Map(),
    chatPresence: new Map(),
  };
}

function ensureEconomyRow(state, userID) {
  const normalizedUserId = normalizeText(userID);
  if (!normalizedUserId) return null;

  if (!state.economy.has(normalizedUserId)) {
    state.economy.set(normalizedUserId, {
      userID: normalizedUserId,
      username: null,
      password: null,
      profile_about_me: null,
      profile_specialties: null,
      profile_location: null,
      profile_twitter_handle: null,
      last_dao_call_reward_at: null,
      wallet: 0,
      bank: 0,
    });
  }

  return state.economy.get(normalizedUserId);
}

function upsertMapRow(map, key, row) {
  map.set(key, { ...row });
}

function removeInventoryKey(state, userID, itemID) {
  state.inventory.delete(buildKey(userID, itemID));
}

function setInventoryQuantity(state, userID, itemID, quantity) {
  const normalizedQuantity = normalizeInt(quantity, 0);
  const key = buildKey(userID, itemID);
  if (normalizedQuantity <= 0) {
    state.inventory.delete(key);
    return;
  }

  state.inventory.set(key, {
    userID: normalizeText(userID),
    itemID: normalizeInt(itemID, 0),
    quantity: normalizedQuantity,
  });
}

function applySnapshotRow(state, tableName, row) {
  switch (tableName) {
    case 'admins':
      state.admins.add(normalizeText(row.userID));
      break;
    case 'economy': {
      const economyRow = ensureEconomyRow(state, row.userID);
      if (!economyRow) break;
      economyRow.username = normalizeText(row.username);
      economyRow.profile_about_me = normalizeText(row.profile_about_me);
      economyRow.profile_specialties = normalizeText(row.profile_specialties);
      economyRow.profile_location = normalizeText(row.profile_location);
      economyRow.profile_twitter_handle = normalizeText(row.profile_twitter_handle);
      economyRow.last_dao_call_reward_at = row.last_dao_call_reward_at ?? null;
      break;
    }
    case 'items':
      upsertMapRow(state.items, normalizeInt(row.itemID, 0), {
        itemID: normalizeInt(row.itemID, 0),
        name: normalizeText(row.name),
        description: normalizeText(row.description),
        price: normalizeInt(row.price, 0),
        isAvailable: normalizeInt(row.isAvailable, 0),
        isHidden: normalizeInt(row.isHidden, 0),
        isRedeemable: normalizeInt(row.isRedeemable, 1),
        quantity: normalizeInt(row.quantity, 0),
      });
      break;
    case 'inventory':
      setInventoryQuantity(state, row.userID, row.itemID, row.quantity);
      break;
    case 'daily_user_activity':
      upsertMapRow(state.dailyUserActivity, buildKey(row.userID, row.activity_date), {
        userID: normalizeText(row.userID),
        activity_date: normalizeText(row.activity_date),
        message_count: normalizeInt(row.message_count, 0),
        reacted: normalizeInt(row.reacted, 0),
        first_message_bonus_given: normalizeInt(row.first_message_bonus_given, 0),
        rps_wins: normalizeInt(row.rps_wins, 0),
      });
      break;
    case 'rps_games':
      upsertMapRow(state.rpsGames, normalizeText(row.game_id), {
        game_id: normalizeText(row.game_id),
        challenger_id: normalizeText(row.challenger_id),
        opponent_id: normalizeText(row.opponent_id),
        channel_id: normalizeText(row.channel_id),
        wager: normalizeInt(row.wager, 0),
        challenger_choice: normalizeText(row.challenger_choice),
        opponent_choice: normalizeText(row.opponent_choice),
        created_at: normalizeInt(row.created_at, 0),
        expires_at: normalizeInt(row.expires_at, 0),
      });
      break;
    case 'joblist':
      upsertMapRow(state.joblist, normalizeInt(row.jobID, 0), {
        jobID: normalizeInt(row.jobID, 0),
        description: normalizeText(row.description),
        cooldown_value: row.cooldown_value ?? null,
        cooldown_unit: normalizeText(row.cooldown_unit),
      });
      break;
    case 'job_assignees':
      upsertMapRow(state.jobAssignees, buildKey(row.jobID, row.userID), {
        jobID: normalizeInt(row.jobID, 0),
        userID: normalizeText(row.userID),
      });
      break;
    case 'job_submissions':
      upsertMapRow(state.jobSubmissions, normalizeInt(row.submission_id, 0), {
        submission_id: normalizeInt(row.submission_id, 0),
        userID: normalizeText(row.userID),
        jobID: row.jobID ?? null,
        title: normalizeText(row.title),
        description: normalizeText(row.description),
        image_url: normalizeText(row.image_url),
        status: normalizeText(row.status) || 'pending',
        reward_amount: normalizeInt(row.reward_amount, 0),
        created_at: normalizeInt(row.created_at, 0),
        completed_at: row.completed_at ?? null,
      });
      break;
    case 'job_cycle':
      state.jobCycle.current_index = normalizeInt(row.current_index, 0);
      break;
    case 'dao_call_attendance':
      upsertMapRow(state.daoCallAttendance, buildKey(row.userID, row.meeting_started_at), {
        attendance_id: normalizeInt(row.attendance_id, 0),
        userID: normalizeText(row.userID),
        meeting_started_at: normalizeInt(row.meeting_started_at, 0),
        rewarded_at: normalizeInt(row.rewarded_at, 0),
        minutes_attended: normalizeInt(row.minutes_attended, 0),
        reward_amount: normalizeInt(row.reward_amount, 0),
      });
      break;
    case 'giveaways':
      upsertMapRow(state.giveaways, normalizeInt(row.id, 0), {
        id: normalizeInt(row.id, 0),
        message_id: normalizeText(row.message_id),
        channel_id: normalizeText(row.channel_id),
        end_time: normalizeInt(row.end_time, 0),
        prize: normalizeText(row.prize),
        winners: normalizeInt(row.winners, 0),
        giveaway_name: normalizeText(row.giveaway_name),
        repeat: normalizeInt(row.repeat, 0),
        is_completed: normalizeInt(row.is_completed, 0),
      });
      break;
    case 'giveaway_entries':
      upsertMapRow(state.giveawayEntries, buildKey(row.giveaway_id, row.user_id), {
        giveaway_id: normalizeInt(row.giveaway_id, 0),
        user_id: normalizeText(row.user_id),
      });
      break;
    case 'title_giveaways':
      upsertMapRow(state.titleGiveaways, normalizeInt(row.id, 0), {
        id: normalizeInt(row.id, 0),
        message_id: normalizeText(row.message_id),
        channel_id: normalizeText(row.channel_id),
        end_time: normalizeInt(row.end_time, 0),
        prize: normalizeText(row.prize),
        winners: normalizeInt(row.winners, 0),
        giveaway_name: normalizeText(row.giveaway_name),
        repeat: normalizeInt(row.repeat, 0),
        is_completed: normalizeInt(row.is_completed, 0),
      });
      break;
    case 'title_giveaway_entries':
      upsertMapRow(state.titleGiveawayEntries, buildKey(row.title_giveaway_id, row.user_id), {
        title_giveaway_id: normalizeInt(row.title_giveaway_id, 0),
        user_id: normalizeText(row.user_id),
      });
      break;
    case 'raffles':
      upsertMapRow(state.raffles, normalizeInt(row.id, 0), {
        id: normalizeInt(row.id, 0),
        channel_id: normalizeText(row.channel_id),
        name: normalizeText(row.name),
        prize: normalizeText(row.prize),
        cost: normalizeInt(row.cost, 0),
        quantity: normalizeInt(row.quantity, 0),
        winners: normalizeInt(row.winners, 0),
        end_time: normalizeInt(row.end_time, 0),
        is_completed: normalizeInt(row.is_completed, 0),
      });
      break;
    case 'raffle_entries': {
      const entryId = normalizeInt(row.entry_id, 0);
      state.raffleEntryCounter = Math.max(state.raffleEntryCounter, entryId);
      upsertMapRow(state.raffleEntries, entryId, {
        entry_id: entryId,
        raffle_id: normalizeInt(row.raffle_id, 0),
        user_id: normalizeText(row.user_id),
      });
      break;
    }
    case 'raffle_ticket_purchases':
      upsertMapRow(state.raffleTicketPurchases, buildKey(row.raffle_id, row.user_id), {
        raffle_id: normalizeInt(row.raffle_id, 0),
        user_id: normalizeText(row.user_id),
        purchased_count: normalizeInt(row.purchased_count, 0),
        bonus_10_given: normalizeInt(row.bonus_10_given, 0),
        bonus_25_given: normalizeInt(row.bonus_25_given, 0),
        bonus_50_given: normalizeInt(row.bonus_50_given, 0),
      });
      break;
    case 'robot_oil_market':
      upsertMapRow(state.robotOilMarket, normalizeInt(row.listing_id, 0), {
        listing_id: normalizeInt(row.listing_id, 0),
        seller_id: normalizeText(row.seller_id),
        quantity: normalizeInt(row.quantity, 0),
        price_per_unit: normalizeInt(row.price_per_unit, 0),
        type: normalizeText(row.type) || 'sale',
        created_at: normalizeInt(row.created_at, 0),
      });
      break;
    case 'robot_oil_history': {
      const historyId = normalizeInt(row.history_id, 0);
      state.robotOilHistoryCounter = Math.max(state.robotOilHistoryCounter, historyId);
      upsertMapRow(state.robotOilHistory, historyId, {
        history_id: historyId,
        event_type: normalizeText(row.event_type),
        buyer_id: normalizeText(row.buyer_id),
        seller_id: normalizeText(row.seller_id),
        quantity: normalizeInt(row.quantity, 0),
        price_per_unit: normalizeInt(row.price_per_unit, 0),
        total_price: normalizeInt(row.total_price, 0),
        created_at: normalizeInt(row.created_at, 0),
      });
      break;
    }
    case 'item_redemptions':
      upsertMapRow(state.itemRedemptions, normalizeInt(row.redemption_id, 0), {
        redemption_id: normalizeInt(row.redemption_id, 0),
        userID: normalizeText(row.userID),
        user_tag: normalizeText(row.user_tag),
        item_name: normalizeText(row.item_name),
        wallet_address: normalizeText(row.wallet_address),
        source: normalizeText(row.source),
        channel_name: normalizeText(row.channel_name),
        channel_id: normalizeText(row.channel_id),
        message_link: normalizeText(row.message_link),
        command_text: normalizeText(row.command_text),
        inventory_before: row.inventory_before ?? null,
        inventory_after: row.inventory_after ?? null,
        created_at: normalizeInt(row.created_at, 0),
      });
      break;
    case 'chat_messages':
      upsertMapRow(state.chatMessages, normalizeInt(row.id, 0), {
        id: normalizeInt(row.id, 0),
        userID: normalizeText(row.userID),
        username: normalizeText(row.username),
        message: normalizeText(row.message),
        is_admin: normalizeInt(row.is_admin, 0),
        created_at: normalizeInt(row.created_at, 0),
      });
      break;
    case 'chat_presence':
      upsertMapRow(state.chatPresence, normalizeText(row.userID), {
        userID: normalizeText(row.userID),
        username: normalizeText(row.username),
        last_seen: normalizeInt(row.last_seen, 0),
      });
      break;
    case 'users':
      upsertMapRow(state.users, normalizeInt(row.id, 0), {
        id: normalizeInt(row.id, 0),
        username: normalizeText(row.username),
        password: row.password ?? null,
      });
      break;
    default:
      break;
  }
}

function getNextRaffleEntryId(state) {
  state.raffleEntryCounter += 1;
  return state.raffleEntryCounter;
}

function addRaffleEntryProjection(state, raffleId, userId, quantity = 1) {
  const count = Math.max(0, normalizeInt(quantity, 0));
  for (let index = 0; index < count; index += 1) {
    const entryId = getNextRaffleEntryId(state);
    state.raffleEntries.set(entryId, {
      entry_id: entryId,
      raffle_id: normalizeInt(raffleId, 0),
      user_id: normalizeText(userId),
    });
  }
}

function clearRaffleEntriesProjection(state, raffleId) {
  const normalizedRaffleId = normalizeInt(raffleId, 0);
  for (const [entryId, entry] of state.raffleEntries.entries()) {
    if (normalizeInt(entry.raffle_id, 0) === normalizedRaffleId) {
      state.raffleEntries.delete(entryId);
    }
  }
}

function removeRaffleTicketItemProjection(state, itemID, removedInventoryRows = []) {
  const normalizedItemId = itemID ? normalizeInt(itemID, 0) : null;
  if (normalizedItemId) {
    state.items.delete(normalizedItemId);
  }
  for (const row of removedInventoryRows || []) {
    removeInventoryKey(state, row.userID, row.itemID);
  }
}

function applySystemEvent(state, event) {
  const metadata = event.metadata || {};
  const key = `${event.domain}.${event.action}`;

  if (event.action === 'snapshot_bootstrap' && metadata.tableName && metadata.row) {
    applySnapshotRow(state, metadata.tableName, metadata.row);
    return;
  }

  switch (key) {
    case 'accounts.initialize_economy_row':
      ensureEconomyRow(state, metadata.userID || event.entity_id);
      break;
    case 'admin.add':
      state.admins.add(normalizeText(metadata.userID || event.entity_id));
      break;
    case 'admin.remove':
      state.admins.delete(normalizeText(metadata.userID || event.entity_id));
      break;
    case 'profile.update': {
      const row = ensureEconomyRow(state, metadata.userID || event.entity_id);
      if (!row) break;
      row.username = normalizeText(metadata.after?.username);
      row.profile_about_me = normalizeText(metadata.after?.aboutMe);
      row.profile_specialties = normalizeText(metadata.after?.specialties);
      row.profile_location = normalizeText(metadata.after?.location);
      row.profile_twitter_handle = normalizeText(metadata.after?.twitterHandle);
      break;
    }
    case 'dao_calls.update_reward_timestamp': {
      const row = ensureEconomyRow(state, metadata.userID || event.entity_id);
      if (row) {
        row.last_dao_call_reward_at = metadata.rewardTimestamp ?? null;
      }
      break;
    }
    case 'daily_activity.upsert': {
      const after = metadata.after || {};
      const userId = normalizeText(after.userID || metadata.userID);
      const activityDate = normalizeText(after.date || after.activity_date || metadata.date);
      if (!userId || !activityDate) break;
      upsertMapRow(state.dailyUserActivity, buildKey(userId, activityDate), {
        userID: userId,
        activity_date: activityDate,
        message_count: normalizeInt(after.count ?? after.message_count, 0),
        reacted: normalizeInt(after.reacted, 0),
        first_message_bonus_given: normalizeInt(after.firstMessageBonusGiven ?? after.first_message_bonus_given, 0),
        rps_wins: normalizeInt(after.rpsWins ?? after.rps_wins, 0),
      });
      break;
    }
    case 'rps.create_game':
    case 'rps.update_game': {
      const after = metadata.after || {};
      const gameId = normalizeText(after.gameId || after.game_id || metadata.gameId || event.entity_id);
      if (!gameId) break;
      upsertMapRow(state.rpsGames, gameId, {
        game_id: gameId,
        challenger_id: normalizeText(after.challengerId || after.challenger_id),
        opponent_id: normalizeText(after.opponentId || after.opponent_id),
        channel_id: normalizeText(after.channelId || after.channel_id),
        wager: normalizeInt(after.wager, 0),
        challenger_choice: normalizeText(after.challengerChoice || after.challenger_choice),
        opponent_choice: normalizeText(after.opponentChoice || after.opponent_choice),
        created_at: normalizeInt(after.createdAt || after.created_at, 0),
        expires_at: normalizeInt(after.expiresAt || after.expires_at, 0),
      });
      break;
    }
    case 'rps.delete_game':
      state.rpsGames.delete(normalizeText(metadata.gameId || event.entity_id));
      break;
    case 'dao_calls.record_attendance': {
      const row = {
        attendance_id: state.daoCallAttendance.size + 1,
        userID: normalizeText(metadata.userID),
        meeting_started_at: normalizeInt(metadata.meetingStartedAt, 0),
        rewarded_at: normalizeInt(metadata.rewardedAt, 0),
        minutes_attended: normalizeInt(metadata.minutesAttended, 0),
        reward_amount: normalizeInt(metadata.rewardAmount, 0),
      };
      state.daoCallAttendance.set(buildKey(row.userID, row.meeting_started_at), row);
      const economyRow = ensureEconomyRow(state, row.userID);
      if (economyRow) {
        economyRow.last_dao_call_reward_at = row.rewarded_at;
      }
      break;
    }
    case 'jobs.create':
      upsertMapRow(state.joblist, normalizeInt(metadata.jobID, 0), {
        jobID: normalizeInt(metadata.jobID, 0),
        description: normalizeText(metadata.description),
        cooldown_value: metadata.cooldown_value ?? null,
        cooldown_unit: normalizeText(metadata.cooldown_unit),
      });
      break;
    case 'jobs.update':
      upsertMapRow(state.joblist, normalizeInt(metadata.jobID || event.entity_id, 0), {
        jobID: normalizeInt(metadata.jobID || event.entity_id, 0),
        description: normalizeText(metadata.after?.description),
        cooldown_value: metadata.after?.cooldown_value ?? null,
        cooldown_unit: normalizeText(metadata.after?.cooldown_unit),
      });
      break;
    case 'jobs.delete': {
      const deletedJobId = normalizeInt(metadata.jobID || event.entity_id, 0);
      state.joblist.delete(deletedJobId);
      for (const [assignmentKey, assignment] of state.jobAssignees.entries()) {
        if (normalizeInt(assignment.jobID, 0) === deletedJobId) {
          state.jobAssignees.delete(assignmentKey);
        }
      }
      break;
    }
    case 'jobs.assign':
      upsertMapRow(state.jobAssignees, buildKey(metadata.jobID, metadata.userID), {
        jobID: normalizeInt(metadata.jobID, 0),
        userID: normalizeText(metadata.userID),
      });
      break;
    case 'jobs.quit':
    case 'jobs.complete':
      state.jobAssignees.delete(buildKey(metadata.jobID, metadata.userID));
      break;
    case 'jobs.submit':
      upsertMapRow(state.jobSubmissions, normalizeInt(metadata.submissionId, 0), {
        submission_id: normalizeInt(metadata.submissionId, 0),
        userID: normalizeText(metadata.userID),
        jobID: metadata.jobID ?? null,
        title: normalizeText(metadata.title),
        description: normalizeText(metadata.description),
        image_url: normalizeText(metadata.imageUrl),
        status: 'pending',
        reward_amount: 0,
        created_at: normalizeInt(event.timestamp, 0),
        completed_at: null,
      });
      for (const [assignmentKey, assignment] of state.jobAssignees.entries()) {
        if (normalizeText(assignment.userID) === normalizeText(metadata.userID)) {
          state.jobAssignees.delete(assignmentKey);
        }
      }
      break;
    case 'jobs.complete_submission_batch':
      for (const submissionId of metadata.submissionIds || []) {
        const submission = state.jobSubmissions.get(normalizeInt(submissionId, 0));
        if (submission) {
          submission.status = 'completed';
          submission.reward_amount = normalizeInt(metadata.rewardPerSubmission, 0);
          submission.completed_at = normalizeInt(event.timestamp, 0);
        }
      }
      break;
    case 'jobs.mark_latest_submission_completed': {
      const userId = normalizeText(metadata.userID);
      const pendingSubmissions = [...state.jobSubmissions.values()]
        .filter((row) => normalizeText(row.userID) === userId && normalizeText(row.status) === 'pending')
        .sort((left, right) => normalizeInt(right.created_at, 0) - normalizeInt(left.created_at, 0));
      if (pendingSubmissions[0]) {
        pendingSubmissions[0].status = 'completed';
        pendingSubmissions[0].reward_amount = normalizeInt(metadata.reward, 0);
        pendingSubmissions[0].completed_at = normalizeInt(event.timestamp, 0);
      }
      break;
    }
    case 'jobs.renumber': {
      const mappings = Array.isArray(metadata.mappings) ? metadata.mappings : [];
      for (const mapping of mappings) {
        const oldId = normalizeInt(mapping.oldID, 0);
        const newId = normalizeInt(mapping.newID, 0);
        if (oldId === newId || !state.joblist.has(oldId)) continue;
        const job = state.joblist.get(oldId);
        state.joblist.delete(oldId);
        state.joblist.set(newId, { ...job, jobID: newId });

        for (const [assignmentKey, assignment] of [...state.jobAssignees.entries()]) {
          if (normalizeInt(assignment.jobID, 0) === oldId) {
            state.jobAssignees.delete(assignmentKey);
            state.jobAssignees.set(buildKey(newId, assignment.userID), {
              ...assignment,
              jobID: newId,
            });
          }
        }

        for (const submission of state.jobSubmissions.values()) {
          if (normalizeInt(submission.jobID, 0) === oldId) {
            submission.jobID = newId;
          }
        }
      }
      break;
    }
    case 'jobs.rotate_cycle':
    case 'jobs.initialize_cycle':
      state.jobCycle.current_index = normalizeInt(metadata.currentIndex, 0);
      break;
    case 'shop.create_item':
    case 'shop.upsert_item': {
      const after = metadata.after || metadata.item || metadata;
      const itemId = normalizeInt(after.itemID || metadata.itemID || event.entity_id, 0);
      upsertMapRow(state.items, itemId, {
        itemID: itemId,
        name: normalizeText(after.name || metadata.name),
        description: normalizeText(after.description || metadata.description),
        price: normalizeInt(after.price ?? metadata.price, 0),
        isAvailable: normalizeInt(after.isAvailable ?? metadata.isAvailable, 0),
        isHidden: normalizeInt(after.isHidden ?? metadata.isHidden, 0),
        isRedeemable: normalizeInt(after.isRedeemable ?? metadata.isRedeemable, 1),
        quantity: normalizeInt(after.quantity ?? metadata.resultingQuantity ?? metadata.quantity, 0),
      });
      break;
    }
    case 'shop.update_item': {
      const itemId = normalizeInt(metadata.itemID || event.entity_id, 0);
      upsertMapRow(state.items, itemId, {
        itemID: itemId,
        name: normalizeText(metadata.after?.name),
        description: normalizeText(metadata.after?.description),
        price: normalizeInt(metadata.after?.price, 0),
        isAvailable: normalizeInt(metadata.after?.isAvailable, 0),
        isHidden: normalizeInt(metadata.after?.isHidden, 0),
        isRedeemable: normalizeInt(metadata.after?.isRedeemable, 1),
        quantity: normalizeInt(metadata.after?.quantity, 0),
      });
      break;
    }
    case 'shop.deactivate_item': {
      const itemId = normalizeInt(metadata.itemID || event.entity_id, 0);
      const existingItem = state.items.get(itemId);
      if (existingItem) {
        existingItem.isAvailable = 0;
      } else if (itemId) {
        upsertMapRow(state.items, itemId, {
          itemID: itemId,
          name: normalizeText(metadata.after?.name || metadata.before?.name),
          description: normalizeText(metadata.after?.description || metadata.before?.description),
          price: normalizeInt(metadata.after?.price ?? metadata.before?.price, 0),
          isAvailable: 0,
          isHidden: normalizeInt(metadata.after?.isHidden ?? metadata.before?.isHidden, 0),
          isRedeemable: normalizeInt(metadata.after?.isRedeemable ?? metadata.before?.isRedeemable, 1),
          quantity: normalizeInt(metadata.after?.quantity ?? metadata.before?.quantity, 0),
        });
      }
      break;
    }
    case 'shop.delete_item': {
      const itemId = normalizeInt(metadata.itemID || event.entity_id, 0);
      state.items.delete(itemId);
      for (const row of metadata.removedInventoryRows || []) {
        removeInventoryKey(state, row.userID, row.itemID);
      }
      break;
    }
    case 'shop.purchase_item': {
      const itemId = normalizeInt(metadata.itemID || event.entity_id, 0);
      const userId = normalizeText(metadata.userID);
      const quantity = Math.max(0, normalizeInt(metadata.quantity, 0));
      const existingItem = state.items.get(itemId);
      const existingInventory = state.inventory.get(buildKey(userId, itemId));
      if (existingItem) {
        existingItem.quantity = Math.max(0, normalizeInt(existingItem.quantity, 0) - quantity);
      }
      if (userId && itemId && quantity > 0) {
        setInventoryQuantity(
          state,
          userId,
          itemId,
          normalizeInt(existingInventory?.quantity, 0) + quantity
        );
      }
      break;
    }
    case 'inventory.add_item':
      setInventoryQuantity(state, metadata.userID, metadata.itemID, metadata.resultingQuantity);
      break;
    case 'inventory.transfer_item':
      setInventoryQuantity(state, metadata.fromUserID, metadata.itemID, metadata.senderQuantityAfter);
      setInventoryQuantity(state, metadata.toUserID, metadata.itemID, metadata.recipientQuantityAfter);
      break;
    case 'inventory.redeem_item':
      setInventoryQuantity(state, metadata.userID, metadata.itemID, metadata.resultingQuantity);
      break;
    case 'inventory.log_redemption':
      upsertMapRow(state.itemRedemptions, normalizeInt(metadata.redemptionId || event.entity_id, 0), {
        redemption_id: normalizeInt(metadata.redemptionId || event.entity_id, 0),
        userID: normalizeText(metadata.userID),
        user_tag: normalizeText(metadata.userTag),
        item_name: normalizeText(metadata.itemName),
        wallet_address: normalizeText(metadata.walletAddress),
        source: normalizeText(metadata.source),
        channel_name: normalizeText(metadata.channelName),
        channel_id: normalizeText(metadata.channelId),
        message_link: normalizeText(metadata.messageLink),
        command_text: normalizeText(metadata.commandText),
        inventory_before: metadata.inventoryBefore ?? null,
        inventory_after: metadata.inventoryAfter ?? null,
        created_at: normalizeInt(event.timestamp, 0),
      });
      break;
    case 'inventory.set_item_stock': {
      const item = state.items.get(normalizeInt(metadata.itemID || event.entity_id, 0));
      if (item) {
        item.quantity = normalizeInt(metadata.newQuantity, 0);
      }
      break;
    }
    case 'projection.replace_snapshot': {
      const snapshot = metadata.snapshot || {};

      state.economy.clear();
      for (const row of snapshot.economy || []) {
        const userId = normalizeText(row.userID);
        if (!userId) continue;
        const mergedBalance = normalizeInt(row.wallet, 0) + normalizeInt(row.bank, 0);
        upsertMapRow(state.economy, userId, {
          userID: userId,
          username: normalizeText(row.username),
          password: null,
          profile_about_me: normalizeText(row.profile_about_me),
          profile_specialties: normalizeText(row.profile_specialties),
          profile_location: normalizeText(row.profile_location),
          profile_twitter_handle: normalizeText(row.profile_twitter_handle),
          last_dao_call_reward_at: normalizeInt(row.last_dao_call_reward_at, 0),
          wallet: mergedBalance,
          bank: 0,
        });
      }

      state.items.clear();
      for (const row of snapshot.items || []) {
        const itemId = normalizeInt(row.itemID, 0);
        if (!itemId) continue;
        upsertMapRow(state.items, itemId, {
          itemID: itemId,
          name: normalizeText(row.name),
          description: normalizeText(row.description),
          price: normalizeInt(row.price, 0),
          isAvailable: normalizeInt(row.isAvailable, 0),
          isHidden: normalizeInt(row.isHidden, 0),
          isRedeemable: normalizeInt(row.isRedeemable, 1),
          quantity: normalizeInt(row.quantity, 0),
        });
      }

      state.inventory.clear();
      for (const row of snapshot.inventory || []) {
        setInventoryQuantity(state, row.userID, row.itemID, row.quantity);
      }

      state.dailyUserActivity.clear();
      for (const row of snapshot.dailyUserActivity || []) {
        const userId = normalizeText(row.userID);
        const activityDate = normalizeText(row.activity_date);
        if (!userId || !activityDate) continue;
        upsertMapRow(state.dailyUserActivity, buildKey(userId, activityDate), {
          userID: userId,
          activity_date: activityDate,
          message_count: normalizeInt(row.message_count, 0),
          reacted: normalizeInt(row.reacted, 0),
          first_message_bonus_given: normalizeInt(row.first_message_bonus_given, 0),
          rps_wins: normalizeInt(row.rps_wins, 0),
        });
      }

      state.rpsGames.clear();
      for (const row of snapshot.rpsGames || []) {
        const gameId = normalizeText(row.game_id);
        if (!gameId) continue;
        upsertMapRow(state.rpsGames, gameId, {
          game_id: gameId,
          challenger_id: normalizeText(row.challenger_id),
          opponent_id: normalizeText(row.opponent_id),
          channel_id: normalizeText(row.channel_id),
          wager: normalizeInt(row.wager, 0),
          challenger_choice: normalizeText(row.challenger_choice),
          opponent_choice: normalizeText(row.opponent_choice),
          created_at: normalizeInt(row.created_at, 0),
          expires_at: normalizeInt(row.expires_at, 0),
        });
      }

      state.giveaways.clear();
      for (const row of snapshot.giveaways || []) {
        const giveawayId = normalizeInt(row.id, 0);
        if (!giveawayId) continue;
        upsertMapRow(state.giveaways, giveawayId, {
          id: giveawayId,
          message_id: normalizeText(row.message_id),
          channel_id: normalizeText(row.channel_id),
          end_time: normalizeInt(row.end_time, 0),
          prize: normalizeText(row.prize),
          winners: normalizeInt(row.winners, 0),
          giveaway_name: normalizeText(row.giveaway_name),
          repeat: normalizeInt(row.repeat, 0),
          is_completed: normalizeInt(row.is_completed, 0),
        });
      }

      state.giveawayEntries.clear();
      for (const row of snapshot.giveawayEntries || []) {
        const giveawayId = normalizeInt(row.giveaway_id, 0);
        const userId = normalizeText(row.user_id);
        if (!giveawayId || !userId) continue;
        upsertMapRow(state.giveawayEntries, buildKey(giveawayId, userId), {
          giveaway_id: giveawayId,
          user_id: userId,
        });
      }

      state.titleGiveaways.clear();
      for (const row of snapshot.titleGiveaways || []) {
        const giveawayId = normalizeInt(row.id, 0);
        if (!giveawayId) continue;
        upsertMapRow(state.titleGiveaways, giveawayId, {
          id: giveawayId,
          message_id: normalizeText(row.message_id),
          channel_id: normalizeText(row.channel_id),
          end_time: normalizeInt(row.end_time, 0),
          prize: normalizeText(row.prize),
          winners: normalizeInt(row.winners, 0),
          giveaway_name: normalizeText(row.giveaway_name),
          repeat: normalizeInt(row.repeat, 0),
          is_completed: normalizeInt(row.is_completed, 0),
        });
      }

      state.titleGiveawayEntries.clear();
      for (const row of snapshot.titleGiveawayEntries || []) {
        const giveawayId = normalizeInt(row.title_giveaway_id, 0);
        const userId = normalizeText(row.user_id);
        if (!giveawayId || !userId) continue;
        upsertMapRow(state.titleGiveawayEntries, buildKey(giveawayId, userId), {
          title_giveaway_id: giveawayId,
          user_id: userId,
        });
      }

      state.raffles.clear();
      for (const row of snapshot.raffles || []) {
        const raffleId = normalizeInt(row.id, 0);
        if (!raffleId) continue;
        upsertMapRow(state.raffles, raffleId, {
          id: raffleId,
          channel_id: normalizeText(row.channel_id),
          name: normalizeText(row.name),
          prize: normalizeText(row.prize),
          cost: normalizeInt(row.cost, 0),
          quantity: normalizeInt(row.quantity, 0),
          winners: normalizeInt(row.winners, 0),
          end_time: normalizeInt(row.end_time, 0),
          is_completed: normalizeInt(row.is_completed, 0),
        });
      }

      state.raffleEntries.clear();
      for (const row of snapshot.raffleEntries || []) {
        const entryId = normalizeInt(row.entry_id, 0);
        if (!entryId) continue;
        upsertMapRow(state.raffleEntries, entryId, {
          entry_id: entryId,
          raffle_id: normalizeInt(row.raffle_id, 0),
          user_id: normalizeText(row.user_id),
        });
      }

      state.raffleTicketPurchases.clear();
      for (const row of snapshot.raffleTicketPurchases || []) {
        const raffleId = normalizeInt(row.raffle_id, 0);
        const userId = normalizeText(row.user_id);
        if (!raffleId || !userId) continue;
        upsertMapRow(state.raffleTicketPurchases, buildKey(raffleId, userId), {
          raffle_id: raffleId,
          user_id: userId,
          purchased_count: normalizeInt(row.purchased_count, 0),
          bonus_10_given: normalizeInt(row.bonus_10_given, 0),
          bonus_25_given: normalizeInt(row.bonus_25_given, 0),
          bonus_50_given: normalizeInt(row.bonus_50_given, 0),
        });
      }
      break;
    }
    case 'giveaways.create':
      upsertMapRow(state.giveaways, normalizeInt(metadata.giveawayId || event.entity_id, 0), {
        id: normalizeInt(metadata.giveawayId || event.entity_id, 0),
        message_id: normalizeText(metadata.messageId),
        channel_id: normalizeText(metadata.channelId),
        end_time: normalizeInt(metadata.endTime, 0),
        prize: normalizeText(metadata.prize),
        winners: normalizeInt(metadata.winners, 0),
        giveaway_name: normalizeText(metadata.name),
        repeat: normalizeInt(metadata.repeat, 0),
        is_completed: 0,
      });
      break;
    case 'giveaways.update': {
      const giveawayId = normalizeInt(metadata.giveawayId || event.entity_id, 0);
      const before = state.giveaways.get(giveawayId) || {};
      upsertMapRow(state.giveaways, giveawayId, {
        id: giveawayId,
        message_id: normalizeText(before.message_id),
        channel_id: normalizeText(before.channel_id),
        end_time: normalizeInt(metadata.after?.end_time, 0),
        prize: normalizeText(metadata.after?.prize),
        winners: normalizeInt(metadata.after?.winners, 0),
        giveaway_name: normalizeText(metadata.after?.giveaway_name),
        repeat: normalizeInt(metadata.after?.repeat, 0),
        is_completed: normalizeInt(
          metadata.after?.is_completed ?? before.is_completed,
          0
        ),
      });
      break;
    }
    case 'giveaways.complete': {
      const giveaway = state.giveaways.get(normalizeInt(metadata.giveawayId || event.entity_id, 0));
      if (giveaway) giveaway.is_completed = 1;
      break;
    }
    case 'giveaways.delete':
      state.giveaways.delete(normalizeInt(metadata.giveawayId || event.entity_id, 0));
      for (const [entryKey, entry] of [...state.giveawayEntries.entries()]) {
        if (normalizeInt(entry.giveaway_id, 0) === normalizeInt(metadata.giveawayId || event.entity_id, 0)) {
          state.giveawayEntries.delete(entryKey);
        }
      }
      for (const removedUserId of metadata.removedEntryUserIds || []) {
        state.giveawayEntries.delete(buildKey(metadata.giveawayId, removedUserId));
      }
      break;
    case 'giveaways.add_entry':
      upsertMapRow(state.giveawayEntries, buildKey(metadata.giveawayId, metadata.userId), {
        giveaway_id: normalizeInt(metadata.giveawayId, 0),
        user_id: normalizeText(metadata.userId),
      });
      break;
    case 'giveaways.remove_entry':
      state.giveawayEntries.delete(buildKey(metadata.giveawayId, metadata.userId));
      break;
    case 'giveaways.clear_entries':
      for (const [entryKey, entry] of [...state.giveawayEntries.entries()]) {
        if (normalizeInt(entry.giveaway_id, 0) === normalizeInt(metadata.giveawayId || event.entity_id, 0)) {
          state.giveawayEntries.delete(entryKey);
        }
      }
      break;
    case 'title_giveaways.create':
      upsertMapRow(state.titleGiveaways, normalizeInt(metadata.titleGiveawayId || event.entity_id, 0), {
        id: normalizeInt(metadata.titleGiveawayId || event.entity_id, 0),
        message_id: normalizeText(metadata.messageId),
        channel_id: normalizeText(metadata.channelId),
        end_time: normalizeInt(metadata.endTime, 0),
        prize: normalizeText(metadata.prize),
        winners: normalizeInt(metadata.winners, 0),
        giveaway_name: normalizeText(metadata.name),
        repeat: normalizeInt(metadata.repeat, 0),
        is_completed: 0,
      });
      break;
    case 'title_giveaways.update': {
      const giveawayId = normalizeInt(metadata.titleGiveawayId || event.entity_id, 0);
      const before = state.titleGiveaways.get(giveawayId) || {};
      upsertMapRow(state.titleGiveaways, giveawayId, {
        id: giveawayId,
        message_id: normalizeText(before.message_id),
        channel_id: normalizeText(before.channel_id),
        end_time: normalizeInt(metadata.after?.end_time, 0),
        prize: normalizeText(metadata.after?.prize),
        winners: normalizeInt(metadata.after?.winners, 0),
        giveaway_name: normalizeText(metadata.after?.giveaway_name),
        repeat: normalizeInt(metadata.after?.repeat, 0),
        is_completed: normalizeInt(metadata.after?.is_completed, 0),
      });
      break;
    }
    case 'title_giveaways.complete': {
      const giveaway = state.titleGiveaways.get(normalizeInt(metadata.titleGiveawayId || event.entity_id, 0));
      if (giveaway) giveaway.is_completed = 1;
      break;
    }
    case 'title_giveaways.delete':
      state.titleGiveaways.delete(normalizeInt(metadata.titleGiveawayId || event.entity_id, 0));
      for (const [entryKey, entry] of [...state.titleGiveawayEntries.entries()]) {
        if (normalizeInt(entry.title_giveaway_id, 0) === normalizeInt(metadata.titleGiveawayId || event.entity_id, 0)) {
          state.titleGiveawayEntries.delete(entryKey);
        }
      }
      for (const removedUserId of metadata.removedEntryUserIds || []) {
        state.titleGiveawayEntries.delete(buildKey(metadata.titleGiveawayId, removedUserId));
      }
      break;
    case 'title_giveaways.add_entry':
      upsertMapRow(state.titleGiveawayEntries, buildKey(metadata.titleGiveawayId, metadata.userId), {
        title_giveaway_id: normalizeInt(metadata.titleGiveawayId, 0),
        user_id: normalizeText(metadata.userId),
      });
      break;
    case 'title_giveaways.remove_entry':
      state.titleGiveawayEntries.delete(buildKey(metadata.titleGiveawayId, metadata.userId));
      break;
    case 'title_giveaways.clear_entries':
      for (const [entryKey, entry] of [...state.titleGiveawayEntries.entries()]) {
        if (normalizeInt(entry.title_giveaway_id, 0) === normalizeInt(metadata.titleGiveawayId || event.entity_id, 0)) {
          state.titleGiveawayEntries.delete(entryKey);
        }
      }
      break;
    case 'raffles.create':
      upsertMapRow(state.raffles, normalizeInt(metadata.raffleId || event.entity_id, 0), {
        id: normalizeInt(metadata.raffleId || event.entity_id, 0),
        channel_id: normalizeText(metadata.channelId),
        name: normalizeText(metadata.name),
        prize: normalizeText(metadata.prize),
        cost: normalizeInt(metadata.cost, 0),
        quantity: normalizeInt(metadata.quantity, 0),
        winners: normalizeInt(metadata.winners, 0),
        end_time: normalizeInt(metadata.endTime, 0),
        is_completed: 0,
      });
      break;
    case 'raffles.update':
      upsertMapRow(state.raffles, normalizeInt(metadata.raffleId || event.entity_id, 0), {
        id: normalizeInt(metadata.raffleId || event.entity_id, 0),
        channel_id: normalizeText(state.raffles.get(normalizeInt(metadata.raffleId || event.entity_id, 0))?.channel_id),
        name: normalizeText(metadata.after?.name),
        prize: normalizeText(metadata.after?.prize),
        cost: normalizeInt(metadata.after?.cost, 0),
        quantity: normalizeInt(metadata.after?.quantity, 0),
        winners: normalizeInt(metadata.after?.winners, 0),
        end_time: normalizeInt(metadata.after?.end_time, 0),
        is_completed: normalizeInt(
          metadata.after?.is_completed ?? state.raffles.get(normalizeInt(metadata.raffleId || event.entity_id, 0))?.is_completed,
          0
        ),
      });
      break;
    case 'raffles.complete': {
      const raffle = state.raffles.get(normalizeInt(metadata.raffleId || event.entity_id, 0));
      if (raffle) raffle.is_completed = 1;
      break;
    }
    case 'raffles.add_entry':
      addRaffleEntryProjection(state, metadata.raffleId, metadata.userId, metadata.quantity || 1);
      break;
    case 'raffles.auto_enter':
      addRaffleEntryProjection(state, metadata.raffleId, metadata.userID, metadata.quantity || 1);
      break;
    case 'raffles.clear_entries':
      clearRaffleEntriesProjection(state, metadata.raffleId || event.entity_id);
      break;
    case 'raffles.track_ticket_purchase':
      upsertMapRow(state.raffleTicketPurchases, buildKey(metadata.raffleId, metadata.userID), {
        raffle_id: normalizeInt(metadata.raffleId, 0),
        user_id: normalizeText(metadata.userID),
        purchased_count: normalizeInt(metadata.newCount, 0),
        bonus_10_given: normalizeInt(metadata.newCount, 0) >= 10 ? 1 : 0,
        bonus_25_given: normalizeInt(metadata.newCount, 0) >= 25 ? 1 : 0,
        bonus_50_given: normalizeInt(metadata.newCount, 0) >= 50 ? 1 : 0,
      });
      break;
    case 'raffles.remove_ticket_item':
      removeRaffleTicketItemProjection(state, metadata.itemID, metadata.removedInventoryRows || []);
      break;
    case 'robot_oil_market.list_sale':
    case 'robot_oil_market.place_bid':
      upsertMapRow(state.robotOilMarket, normalizeInt(metadata.listingId || event.entity_id, 0), {
        listing_id: normalizeInt(metadata.listingId || event.entity_id, 0),
        seller_id: normalizeText(metadata.sellerId || metadata.buyerId),
        quantity: normalizeInt(metadata.quantity, 0),
        price_per_unit: normalizeInt(metadata.pricePerUnit, 0),
        type: normalizeText(metadata.type) || 'sale',
        created_at: normalizeInt(event.timestamp, 0),
      });
      break;
    case 'robot_oil_market.buy_listing':
    case 'robot_oil_market.fulfill_bid': {
      const listingId = normalizeInt(metadata.listingId || event.entity_id, 0);
      const listing = state.robotOilMarket.get(listingId);
      if (listing) {
        const nextQuantity = normalizeInt(listing.quantity, 0) - normalizeInt(metadata.quantity, 0);
        if (nextQuantity > 0) {
          listing.quantity = nextQuantity;
        } else {
          state.robotOilMarket.delete(listingId);
        }
      }
      state.robotOilHistoryCounter += 1;
      state.robotOilHistory.set(state.robotOilHistoryCounter, {
        history_id: state.robotOilHistoryCounter,
        event_type: key === 'robot_oil_market.buy_listing' ? 'purchase' : 'market_sell',
        buyer_id: normalizeText(metadata.buyerId || metadata.bidOwnerId),
        seller_id: normalizeText(metadata.sellerId),
        quantity: normalizeInt(metadata.quantity, 0),
        price_per_unit: normalizeInt(metadata.pricePerUnit, 0),
        total_price: normalizeInt(metadata.totalCost, 0),
        created_at: normalizeInt(event.timestamp, 0),
      });
      break;
    }
    case 'robot_oil_market.cancel_listing': {
      const listingId = normalizeInt(metadata.listingId || event.entity_id, 0);
      state.robotOilMarket.delete(listingId);
      state.robotOilHistoryCounter += 1;
      state.robotOilHistory.set(state.robotOilHistoryCounter, {
        history_id: state.robotOilHistoryCounter,
        event_type: 'cancel',
        buyer_id: null,
        seller_id: normalizeText(metadata.ownerId),
        quantity: normalizeInt(metadata.quantity, 0),
        price_per_unit: normalizeInt(metadata.pricePerUnit, 0),
        total_price: normalizeInt(metadata.quantity, 0) * normalizeInt(metadata.pricePerUnit, 0),
        created_at: normalizeInt(event.timestamp, 0),
      });
      break;
    }
    case 'chat.post_message':
      upsertMapRow(state.chatMessages, normalizeInt(metadata.messageId || event.entity_id, 0), {
        id: normalizeInt(metadata.messageId || event.entity_id, 0),
        userID: normalizeText(metadata.userID),
        username: normalizeText(metadata.username),
        message: normalizeText(metadata.message),
        is_admin: normalizeInt(metadata.isAdmin, 0),
        created_at: normalizeInt(event.timestamp, 0),
      });
      break;
    case 'chat.presence_ping':
      upsertMapRow(state.chatPresence, normalizeText(metadata.userID || event.entity_id), {
        userID: normalizeText(metadata.userID || event.entity_id),
        username: normalizeText(metadata.username),
        last_seen: normalizeInt(metadata.lastSeen, 0),
      });
      break;
    case 'web_auth.register_local_user':
      upsertMapRow(state.users, normalizeInt(metadata.localUserId || event.entity_id, 0), {
        id: normalizeInt(metadata.localUserId || event.entity_id, 0),
        username: normalizeText(metadata.username),
        password: null,
      });
      break;
    default:
      break;
  }
}

function applyLedgerBalances(state, ledgerRows) {
  const balances = new Map();

  for (const row of state.economy.values()) {
    row.wallet = normalizeInt(row.wallet, 0) + normalizeInt(row.bank, 0);
    row.bank = 0;
  }

  for (const row of ledgerRows) {
    const metadata = typeof row.metadata === 'string'
      ? (() => {
        try {
          return JSON.parse(row.metadata);
        } catch (error) {
          return {};
        }
      })()
      : (row.metadata || {});

    const fromAccount = normalizeLedgerAccount(
      normalizeText(metadata.fromAccount),
      { defaultUserAccount: row.from_user_id ? PRIMARY_BALANCE_ACCOUNT : 'system' }
    );
    const toAccount = normalizeLedgerAccount(
      normalizeText(metadata.toAccount),
      { defaultUserAccount: row.to_user_id ? PRIMARY_BALANCE_ACCOUNT : 'system' }
    );
    const amount = normalizeInt(row.amount, 0);

    if (row.from_user_id) {
      const key = buildKey(row.from_user_id, fromAccount);
      balances.set(key, (balances.get(key) || 0) - amount);
    }
    if (row.to_user_id) {
      const key = buildKey(row.to_user_id, toAccount);
      balances.set(key, (balances.get(key) || 0) + amount);
    }
  }

  for (const [accountKey, amount] of balances.entries()) {
    const [userID, account] = accountKey.split(':');
    const row = ensureEconomyRow(state, userID);
    if (!row) continue;
    if (account === PRIMARY_BALANCE_ACCOUNT) {
      row.wallet = amount;
      row.bank = 0;
    }
  }
}

function buildProjectionSnapshotFromState(state) {
  return {
    economy: [...state.economy.values()]
      .sort((left, right) => left.userID.localeCompare(right.userID))
      .map((row) => ({
        userID: row.userID,
        username: row.username,
        profile_about_me: row.profile_about_me,
        profile_specialties: row.profile_specialties,
        profile_location: row.profile_location,
        profile_twitter_handle: row.profile_twitter_handle,
        wallet: row.wallet,
        bank: row.bank,
      })),
    items: [...state.items.values()].sort((left, right) => left.itemID - right.itemID),
    inventory: [...state.inventory.values()].sort((left, right) => {
      const userCompare = String(left.userID).localeCompare(String(right.userID));
      return userCompare || (Number(left.itemID) - Number(right.itemID));
    }),
    dailyUserActivity: [...state.dailyUserActivity.values()].sort((left, right) => {
      const dateCompare = String(left.activity_date).localeCompare(String(right.activity_date));
      return dateCompare || String(left.userID).localeCompare(String(right.userID));
    }),
    rpsGames: [...state.rpsGames.values()].sort((left, right) => String(left.game_id).localeCompare(String(right.game_id))),
    giveaways: [...state.giveaways.values()].sort((left, right) => left.id - right.id),
    giveawayEntries: [...state.giveawayEntries.values()].sort((left, right) => {
      const giveawayCompare = Number(left.giveaway_id) - Number(right.giveaway_id);
      return giveawayCompare || String(left.user_id).localeCompare(String(right.user_id));
    }),
    titleGiveaways: [...state.titleGiveaways.values()].sort((left, right) => left.id - right.id),
    titleGiveawayEntries: [...state.titleGiveawayEntries.values()].sort((left, right) => {
      const giveawayCompare = Number(left.title_giveaway_id) - Number(right.title_giveaway_id);
      return giveawayCompare || String(left.user_id).localeCompare(String(right.user_id));
    }),
    raffles: [...state.raffles.values()].sort((left, right) => left.id - right.id),
    raffleEntries: [...state.raffleEntries.values()].sort((left, right) => left.entry_id - right.entry_id),
    raffleTicketPurchases: [...state.raffleTicketPurchases.values()].sort((left, right) => {
      const raffleCompare = Number(left.raffle_id) - Number(right.raffle_id);
      return raffleCompare || String(left.user_id).localeCompare(String(right.user_id));
    }),
  };
}

function computeProjectionFingerprintFromState(state) {
  return sha256(stableStringify(buildProjectionSnapshotFromState(state)));
}

function buildProjectionCountsFromState(state) {
  return {
    economy: state.economy.size,
    items: state.items.size,
    inventory: state.inventory.size,
    dailyUserActivity: state.dailyUserActivity.size,
    rpsGames: state.rpsGames.size,
    giveaways: state.giveaways.size,
    giveawayEntries: state.giveawayEntries.size,
    titleGiveaways: state.titleGiveaways.size,
    titleGiveawayEntries: state.titleGiveawayEntries.size,
    raffles: state.raffles.size,
    raffleEntries: state.raffleEntries.size,
    raffleTicketPurchases: state.raffleTicketPurchases.size,
  };
}

function normalizeLedgerRows(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.transactions || [];
  return rows.map((row) => ({
    id: normalizeInt(row.id, 0),
    timestamp: normalizeInt(row.timestamp, 0),
    type: normalizeText(row.type),
    from_user_id: normalizeText(row.from_user_id),
    to_user_id: normalizeText(row.to_user_id),
    amount: normalizeInt(row.amount, 0),
    metadata: row.metadata,
    previous_hash: normalizeText(row.previous_hash),
    hash: normalizeText(row.hash),
  }));
}

function normalizeEventRows(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.events || [];
  return rows.map((row) => ({
    id: normalizeInt(row.id, 0),
    timestamp: normalizeInt(row.timestamp, 0),
    domain: normalizeText(row.domain),
    action: normalizeText(row.action),
    entity_type: normalizeText(row.entity_type),
    entity_id: normalizeText(row.entity_id),
    actor_user_id: normalizeText(row.actor_user_id),
    metadata: typeof row.metadata === 'string'
      ? (() => {
        try {
          return JSON.parse(row.metadata);
        } catch (error) {
          return {};
        }
      })()
      : (row.metadata || {}),
    metadata_raw: typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata || {}),
    previous_hash: normalizeText(row.previous_hash),
    hash: normalizeText(row.hash),
  }));
}

function projectStateFromPayloads({ ledgerPayload, eventPayload } = {}) {
  const ledgerRows = normalizeLedgerRows(ledgerPayload);
  const eventRows = normalizeEventRows(eventPayload);

  const state = createProjectionState();
  for (const event of eventRows) {
    applySystemEvent(state, event);
  }
  applyLedgerBalances(state, ledgerRows);

  return {
    state,
    ledgerRows,
    eventRows,
    snapshot: buildProjectionSnapshotFromState(state),
    projectionFingerprint: computeProjectionFingerprintFromState(state),
    projectionCounts: buildProjectionCountsFromState(state),
  };
}

async function writeProjectedState(exec, state) {
  const insertMany = async (sql, rows, mapper) => {
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      await exec.run(sql, mapper(row));
    }
  };

  await exec.run('PRAGMA foreign_keys = OFF');
  await exec.run('BEGIN IMMEDIATE');
  try {
    await insertMany(
      `INSERT INTO economy (
        userID, username, password, profile_about_me, profile_specialties, profile_location,
        profile_twitter_handle, last_dao_call_reward_at, wallet, bank
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...state.economy.values()].sort((left, right) => left.userID.localeCompare(right.userID)),
      (row) => [
        row.userID,
        row.username,
        row.password,
        row.profile_about_me,
        row.profile_specialties,
        row.profile_location,
        row.profile_twitter_handle,
        row.last_dao_call_reward_at,
        row.wallet,
        row.bank,
      ]
    );

    await insertMany(
      `INSERT INTO users (id, username, password) VALUES (?, ?, ?)`,
      [...state.users.values()].sort((left, right) => left.id - right.id),
      (row) => [row.id, row.username, row.password]
    );

    await insertMany(
      `INSERT INTO admins (userID) VALUES (?)`,
      [...state.admins.values()].sort((left, right) => left.localeCompare(right)),
      (userID) => [userID]
    );

    await insertMany(
      `INSERT INTO items (itemID, name, description, price, isAvailable, isHidden, isRedeemable, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [...state.items.values()].sort((left, right) => left.itemID - right.itemID),
      (row) => [row.itemID, row.name, row.description, row.price, row.isAvailable, row.isHidden, row.isRedeemable, row.quantity]
    );

    await insertMany(
      `INSERT INTO inventory (userID, itemID, quantity) VALUES (?, ?, ?)`,
      [...state.inventory.values()].sort((left, right) => {
        const userCompare = left.userID.localeCompare(right.userID);
        return userCompare || (left.itemID - right.itemID);
      }),
      (row) => [row.userID, row.itemID, row.quantity]
    );

    await insertMany(
      `INSERT INTO daily_user_activity (
        userID, activity_date, message_count, reacted, first_message_bonus_given, rps_wins
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [...state.dailyUserActivity.values()].sort((left, right) => {
        const dateCompare = String(left.activity_date).localeCompare(String(right.activity_date));
        return dateCompare || String(left.userID).localeCompare(String(right.userID));
      }),
      (row) => [row.userID, row.activity_date, row.message_count, row.reacted, row.first_message_bonus_given, row.rps_wins]
    );

    await insertMany(
      `INSERT INTO rps_games (
        game_id, challenger_id, opponent_id, channel_id, wager, challenger_choice, opponent_choice, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...state.rpsGames.values()].sort((left, right) => String(left.game_id).localeCompare(String(right.game_id))),
      (row) => [
        row.game_id,
        row.challenger_id,
        row.opponent_id,
        row.channel_id,
        row.wager,
        row.challenger_choice,
        row.opponent_choice,
        row.created_at,
        row.expires_at,
      ]
    );

    await insertMany(
      `INSERT INTO joblist (jobID, description, cooldown_value, cooldown_unit) VALUES (?, ?, ?, ?)`,
      [...state.joblist.values()].sort((left, right) => left.jobID - right.jobID),
      (row) => [row.jobID, row.description, row.cooldown_value, row.cooldown_unit]
    );

    await insertMany(
      `INSERT INTO job_assignees (jobID, userID) VALUES (?, ?)`,
      [...state.jobAssignees.values()],
      (row) => [row.jobID, row.userID]
    );

    await insertMany(
      `INSERT INTO job_submissions (
        submission_id, userID, jobID, title, description, image_url, status, reward_amount, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...state.jobSubmissions.values()].sort((left, right) => left.submission_id - right.submission_id),
      (row) => [row.submission_id, row.userID, row.jobID, row.title, row.description, row.image_url, row.status, row.reward_amount, row.created_at, row.completed_at]
    );

    await exec.run(`INSERT INTO job_cycle (current_index) VALUES (?)`, [state.jobCycle.current_index || 0]);

    await insertMany(
      `INSERT INTO giveaways (id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, is_completed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...state.giveaways.values()].sort((left, right) => left.id - right.id),
      (row) => [row.id, row.message_id, row.channel_id, row.end_time, row.prize, row.winners, row.giveaway_name, row.repeat, row.is_completed || 0]
    );

    await insertMany(
      `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)`,
      [...state.giveawayEntries.values()],
      (row) => [row.giveaway_id, row.user_id]
    );

    await insertMany(
      `INSERT INTO title_giveaways (id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, is_completed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...state.titleGiveaways.values()].sort((left, right) => left.id - right.id),
      (row) => [row.id, row.message_id, row.channel_id, row.end_time, row.prize, row.winners, row.giveaway_name, row.repeat, row.is_completed]
    );

    await insertMany(
      `INSERT INTO title_giveaway_entries (title_giveaway_id, user_id) VALUES (?, ?)`,
      [...state.titleGiveawayEntries.values()],
      (row) => [row.title_giveaway_id, row.user_id]
    );

    await insertMany(
      `INSERT INTO raffles (id, channel_id, name, prize, cost, quantity, winners, end_time, is_completed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...state.raffles.values()].sort((left, right) => left.id - right.id),
      (row) => [row.id, row.channel_id, row.name, row.prize, row.cost, row.quantity, row.winners, row.end_time, row.is_completed || 0]
    );

    await insertMany(
      `INSERT INTO raffle_entries (entry_id, raffle_id, user_id) VALUES (?, ?, ?)`,
      [...state.raffleEntries.values()].sort((left, right) => left.entry_id - right.entry_id),
      (row) => [row.entry_id, row.raffle_id, row.user_id]
    );

    await insertMany(
      `INSERT INTO raffle_ticket_purchases (
        raffle_id, user_id, purchased_count, bonus_10_given, bonus_25_given, bonus_50_given
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [...state.raffleTicketPurchases.values()],
      (row) => [row.raffle_id, row.user_id, row.purchased_count, row.bonus_10_given, row.bonus_25_given, row.bonus_50_given]
    );

    await insertMany(
      `INSERT INTO dao_call_attendance (
        attendance_id, userID, meeting_started_at, rewarded_at, minutes_attended, reward_amount
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [...state.daoCallAttendance.values()].sort((left, right) => left.attendance_id - right.attendance_id),
      (row) => [row.attendance_id, row.userID, row.meeting_started_at, row.rewarded_at, row.minutes_attended, row.reward_amount]
    );

    await insertMany(
      `INSERT INTO item_redemptions (
        redemption_id, userID, user_tag, item_name, wallet_address, source,
        channel_name, channel_id, message_link, command_text, inventory_before, inventory_after, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...state.itemRedemptions.values()].sort((left, right) => left.redemption_id - right.redemption_id),
      (row) => [
        row.redemption_id, row.userID, row.user_tag, row.item_name, row.wallet_address, row.source,
        row.channel_name, row.channel_id, row.message_link, row.command_text, row.inventory_before, row.inventory_after, row.created_at,
      ]
    );

    await insertMany(
      `INSERT INTO robot_oil_market (listing_id, seller_id, quantity, price_per_unit, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [...state.robotOilMarket.values()].sort((left, right) => left.listing_id - right.listing_id),
      (row) => [row.listing_id, row.seller_id, row.quantity, row.price_per_unit, row.type, row.created_at]
    );

    await insertMany(
      `INSERT INTO robot_oil_history (
        history_id, event_type, buyer_id, seller_id, quantity, price_per_unit, total_price, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [...state.robotOilHistory.values()].sort((left, right) => left.history_id - right.history_id),
      (row) => [row.history_id, row.event_type, row.buyer_id, row.seller_id, row.quantity, row.price_per_unit, row.total_price, row.created_at]
    );

    await insertMany(
      `INSERT INTO chat_messages (id, userID, username, message, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [...state.chatMessages.values()].sort((left, right) => left.id - right.id),
      (row) => [row.id, row.userID, row.username, row.message, row.is_admin, row.created_at]
    );

    await insertMany(
      `INSERT INTO chat_presence (userID, username, last_seen) VALUES (?, ?, ?)`,
      [...state.chatPresence.values()].sort((left, right) => left.userID.localeCompare(right.userID)),
      (row) => [row.userID, row.username, row.last_seen]
    );

    await exec.run('COMMIT');
    await exec.run('PRAGMA foreign_keys = ON');
  } catch (error) {
    await exec.run('ROLLBACK').catch(() => {});
    await exec.run('PRAGMA foreign_keys = ON').catch(() => {});
    throw error;
  }
}

async function rebuildStateFromLedgers({
  targetPath,
  ledgerPayload,
  eventPayload,
  overwrite = false,
} = {}) {
  if (!targetPath) {
    throw new Error('targetPath is required.');
  }
  if (!ledgerPayload || !eventPayload) {
    throw new Error('ledgerPayload and eventPayload are required.');
  }

  const resolvedTargetPath = path.resolve(targetPath);
  if (fs.existsSync(resolvedTargetPath)) {
    if (!overwrite) {
      throw new Error(`Target database already exists: ${resolvedTargetPath}`);
    }
    await fs.promises.unlink(resolvedTargetPath);
  }

  await fs.promises.mkdir(path.dirname(resolvedTargetPath), { recursive: true });

  const targetDb = new SQLite.Database(resolvedTargetPath);
  const exec = createDbHelpers(targetDb);

  try {
    await createRecoverySchema(exec);

    const ledgerRows = normalizeLedgerRows(ledgerPayload);
    const eventRows = normalizeEventRows(eventPayload);

    const ledgerService = createLedgerService({
      db: targetDb,
      ensureUserEconomyRow: async () => {},
    });
    const eventLedgerService = createEventLedgerService({ db: targetDb });

    await ledgerService.importLedger({ transactions: ledgerRows });
    await eventLedgerService.importEvents({
      events: eventRows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        domain: row.domain,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        actor_user_id: row.actor_user_id,
        metadata: row.metadata_raw,
        previous_hash: row.previous_hash,
        hash: row.hash,
      })),
    });

    const {
      state,
      projectionFingerprint,
      projectionCounts,
    } = projectStateFromPayloads({ ledgerPayload, eventPayload });
    await writeProjectedState(exec, state);

    return {
      targetPath: resolvedTargetPath,
      transactionCount: ledgerRows.length,
      systemEventCount: eventRows.length,
      projectionFingerprint,
      projectionCounts,
    };
  } finally {
    await exec.close();
  }
}

module.exports = {
  projectStateFromPayloads,
  rebuildStateFromLedgers,
};
