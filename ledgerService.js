const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GENESIS_HASH = 'VOLT_LEDGER_GENESIS_V1';
const LEDGER_EXPORT_VERSION = 1;
const PRIMARY_BALANCE_ACCOUNT = 'balance';
const MERGED_BALANCE_ALIASES = new Set([PRIMARY_BALANCE_ACCOUNT, 'wallet', 'bank']);

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function normalizeUserId(userId) {
  if (userId === null || typeof userId === 'undefined' || userId === '') {
    return null;
  }

  return String(userId);
}

function normalizeLedgerAccount(account, options = {}) {
  const fallback = options.defaultUserAccount || PRIMARY_BALANCE_ACCOUNT;
  if (account === null || typeof account === 'undefined' || account === '') {
    return fallback;
  }

  const normalized = String(account).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === 'system') {
    return 'system';
  }

  if (MERGED_BALANCE_ALIASES.has(normalized)) {
    return PRIMARY_BALANCE_ACCOUNT;
  }

  return normalized;
}

function parseMetadata(rawMetadata) {
  if (!rawMetadata) return {};
  if (typeof rawMetadata === 'object') return rawMetadata;

  try {
    return JSON.parse(rawMetadata);
  } catch (error) {
    return {};
  }
}

function normalizeMetadataForStorage(metadata, fromUserId, toUserId) {
  const baseMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};

  // Account routing lives inside metadata so balance movements remain replayable
  // and the routing data is covered by the transaction hash.
  baseMetadata.fromAccount = normalizeLedgerAccount(
    baseMetadata.fromAccount,
    { defaultUserAccount: fromUserId ? PRIMARY_BALANCE_ACCOUNT : 'system' }
  );
  baseMetadata.toAccount = normalizeLedgerAccount(
    baseMetadata.toAccount,
    { defaultUserAccount: toUserId ? PRIMARY_BALANCE_ACCOUNT : 'system' }
  );

  if (!baseMetadata.ledgerVersion) {
    baseMetadata.ledgerVersion = LEDGER_EXPORT_VERSION;
  }

  return stableStringify(baseMetadata);
}

function getLedgerAccounts(metadata, fromUserId, toUserId) {
  return {
    fromAccount: normalizeLedgerAccount(
      metadata.fromAccount,
      { defaultUserAccount: fromUserId ? PRIMARY_BALANCE_ACCOUNT : 'system' }
    ),
    toAccount: normalizeLedgerAccount(
      metadata.toAccount,
      { defaultUserAccount: toUserId ? PRIMARY_BALANCE_ACCOUNT : 'system' }
    ),
  };
}

function computeTransactionHash(transaction) {
  const payload = [
    transaction.id,
    transaction.timestamp,
    transaction.type,
    transaction.from_user_id ?? '',
    transaction.to_user_id ?? '',
    transaction.amount,
    transaction.metadata,
    transaction.previous_hash,
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

function formatTransactionRow(row, { parse = true } = {}) {
  const formatted = {
    id: Number(row.id),
    timestamp: Number(row.timestamp),
    type: row.type,
    from_user_id: normalizeUserId(row.from_user_id),
    to_user_id: normalizeUserId(row.to_user_id),
    amount: Number(row.amount),
    metadata_raw: row.metadata || '{}',
    previous_hash: row.previous_hash,
    hash: row.hash,
  };

  formatted.metadata = parse ? parseMetadata(formatted.metadata_raw) : formatted.metadata_raw;
  return formatted;
}

function createLedgerService({
  db,
  ensureUserEconomyRow = async () => {},
  syncUserProjection = async () => {},
  enqueueWrite = null,
}) {
  const cache = {
    loaded: false,
    latestId: 0,
    latestHash: GENESIS_HASH,
    users: new Map(),
  };

  let initializationPromise = null;
  let topLevelWriteQueue = Promise.resolve();

  function createExecutor(database = db) {
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
    };
  }

  const defaultExecutor = createExecutor(db);

  function enqueueTopLevelWrite(task) {
    const runTask = topLevelWriteQueue.then(task, task);
    topLevelWriteQueue = runTask.catch(() => {});
    return runTask;
  }

  async function initialize() {
    if (!initializationPromise) {
      initializationPromise = (async () => {
        await defaultExecutor.run(`
          CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            type TEXT NOT NULL,
            from_user_id TEXT,
            to_user_id TEXT,
            amount INTEGER NOT NULL CHECK(amount > 0),
            metadata TEXT NOT NULL DEFAULT '{}',
            previous_hash TEXT NOT NULL,
            hash TEXT NOT NULL UNIQUE
          )
        `);

        await defaultExecutor.run(
          `CREATE INDEX IF NOT EXISTS idx_transactions_from_user_id ON transactions(from_user_id)`
        );
        await defaultExecutor.run(
          `CREATE INDEX IF NOT EXISTS idx_transactions_to_user_id ON transactions(to_user_id)`
        );
        await defaultExecutor.run(
          `CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp)`
        );

        await defaultExecutor.run(`
          CREATE TRIGGER IF NOT EXISTS transactions_prevent_update
          BEFORE UPDATE ON transactions
          BEGIN
            SELECT RAISE(ABORT, 'transactions are append-only');
          END
        `);

        await defaultExecutor.run(`
          CREATE TRIGGER IF NOT EXISTS transactions_prevent_delete
          BEFORE DELETE ON transactions
          BEGIN
            SELECT RAISE(ABORT, 'transactions are append-only');
          END
        `);
      })().catch((error) => {
        initializationPromise = null;
        throw error;
      });
    }

    return initializationPromise;
  }

  function ensureUserState(state, userId) {
    if (!state.users.has(userId)) {
      state.users.set(userId, {
        balance: 0,
        wallet: 0,
        bank: 0,
        total: 0,
        accounts: {},
      });
    }

    return state.users.get(userId);
  }

  function recomputeUserTotal(userState) {
    userState.total = Object.values(userState.accounts).reduce((sum, value) => sum + value, 0);
    userState.balance = userState.accounts[PRIMARY_BALANCE_ACCOUNT] || 0;
    userState.wallet = userState.balance;
    userState.bank = 0;
  }

  function applyTransactionToState(state, row) {
    const metadata = parseMetadata(row.metadata);
    const { fromAccount, toAccount } = getLedgerAccounts(metadata, row.from_user_id, row.to_user_id);

    if (row.from_user_id) {
      const fromUserState = ensureUserState(state, row.from_user_id);
      fromUserState.accounts[fromAccount] = (fromUserState.accounts[fromAccount] || 0) - Number(row.amount);
      recomputeUserTotal(fromUserState);
    }

    if (row.to_user_id) {
      const toUserState = ensureUserState(state, row.to_user_id);
      toUserState.accounts[toAccount] = (toUserState.accounts[toAccount] || 0) + Number(row.amount);
      recomputeUserTotal(toUserState);
    }

    state.latestId = Number(row.id);
    state.latestHash = row.hash;
  }

  async function rebuildCache() {
    await initialize();

    const rows = await defaultExecutor.all(`SELECT * FROM transactions ORDER BY id ASC`);
    const nextState = {
      loaded: true,
      latestId: 0,
      latestHash: GENESIS_HASH,
      users: new Map(),
    };

    for (const row of rows) {
      applyTransactionToState(nextState, row);
    }

    cache.loaded = true;
    cache.latestId = nextState.latestId;
    cache.latestHash = nextState.latestHash;
    cache.users = nextState.users;
    return cache;
  }

  async function refreshCache() {
    await initialize();

    if (!cache.loaded) {
      return rebuildCache();
    }

    const latestRow = await defaultExecutor.get(`SELECT MAX(id) AS latestId FROM transactions`);
    const latestId = Number(latestRow?.latestId || 0);

    if (latestId < cache.latestId) {
      return rebuildCache();
    }

    if (latestId === cache.latestId) {
      return cache;
    }

    const rows = await defaultExecutor.all(
      `SELECT * FROM transactions WHERE id > ? ORDER BY id ASC`,
      [cache.latestId]
    );

    for (const row of rows) {
      applyTransactionToState(cache, row);
    }

    return cache;
  }

  async function getUserAccountBalance(userId, account = PRIMARY_BALANCE_ACCOUNT, { executor = defaultExecutor } = {}) {
    await initialize();
    const normalizedUserId = normalizeUserId(userId);
    const normalizedAccount = normalizeLedgerAccount(account);

    if (!normalizedUserId) {
      throw new Error('User ID is required.');
    }

    if (executor === defaultExecutor) {
      const balance = await getBalance(normalizedUserId);
      return balance.accounts?.[normalizedAccount] || 0;
    }

    const rows = await executor.all(
      `SELECT * FROM transactions WHERE from_user_id = ? OR to_user_id = ? ORDER BY id ASC`,
      [normalizedUserId, normalizedUserId]
    );

    let amount = 0;
    for (const row of rows) {
      const metadata = parseMetadata(row.metadata);
      const { fromAccount, toAccount } = getLedgerAccounts(metadata, row.from_user_id, row.to_user_id);

      if (normalizeUserId(row.from_user_id) === normalizedUserId && fromAccount === normalizedAccount) {
        amount -= Number(row.amount);
      }

      if (normalizeUserId(row.to_user_id) === normalizedUserId && toAccount === normalizedAccount) {
        amount += Number(row.amount);
      }
    }

    return amount;
  }

  async function appendTransactionInternal(entry, options = {}) {
    await initialize();

    const executor = options.executor || defaultExecutor;
    const inTransaction = Boolean(options.inTransaction);
    const fromUserId = normalizeUserId(entry.fromUserId);
    const toUserId = normalizeUserId(entry.toUserId);
    const amount = Number(entry.amount);

    if (!entry.type || typeof entry.type !== 'string') {
      throw new Error('Transaction type is required.');
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Transaction amount must be a positive integer.');
    }

    if (!fromUserId && !toUserId) {
      throw new Error('Transactions must have either a source user or destination user.');
    }

    const timestamp = Number(entry.timestamp || Math.floor(Date.now() / 1000));
    const metadata = normalizeMetadataForStorage(entry.metadata, fromUserId, toUserId);
    const parsedMetadata = parseMetadata(metadata);

    const distinctUsers = [...new Set([fromUserId, toUserId].filter(Boolean))];
    await Promise.all(distinctUsers.map((userId) => ensureUserEconomyRow(userId)));

    if (!inTransaction) {
      await executor.run('BEGIN IMMEDIATE');
    }

    try {
      if (entry.enforceSufficientFunds && fromUserId) {
        const fromAccount = normalizeLedgerAccount(
          parsedMetadata.fromAccount,
          { defaultUserAccount: PRIMARY_BALANCE_ACCOUNT }
        );
        const availableBalance = await getUserAccountBalance(fromUserId, fromAccount, { executor });

        if (availableBalance < amount) {
          throw new Error(`Insufficient funds in ${fromAccount}.`);
        }
      }

      const latestRow = await executor.get(`SELECT id, hash FROM transactions ORDER BY id DESC LIMIT 1`);
      const nextId = Number(latestRow?.id || 0) + 1;
      const previousHash = latestRow?.hash || GENESIS_HASH;
      const rowToInsert = {
        id: nextId,
        timestamp,
        type: entry.type,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        amount,
        metadata,
        previous_hash: previousHash,
      };

      const hash = computeTransactionHash(rowToInsert);

      await executor.run(
        `INSERT INTO transactions (
           id,
           timestamp,
           type,
           from_user_id,
           to_user_id,
           amount,
           metadata,
           previous_hash,
           hash
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rowToInsert.id,
          rowToInsert.timestamp,
          rowToInsert.type,
          rowToInsert.from_user_id,
          rowToInsert.to_user_id,
          rowToInsert.amount,
          rowToInsert.metadata,
          rowToInsert.previous_hash,
          hash,
        ]
      );

      const projectionBalances = {};
      for (const userId of distinctUsers) {
        // eslint-disable-next-line no-await-in-loop
        const balance = await getUserAccountBalance(userId, PRIMARY_BALANCE_ACCOUNT, { executor });
        projectionBalances[userId] = {
          balance,
          wallet: balance,
          bank: 0,
          total: balance,
        };
      }

      for (const userId of distinctUsers) {
        // eslint-disable-next-line no-await-in-loop
        await syncUserProjection({
          userId,
          ...projectionBalances[userId],
          executor,
        });
      }

      if (!inTransaction) {
        await executor.run('COMMIT');
      }

      const insertedRow = {
        ...rowToInsert,
        hash,
      };

      if (executor === defaultExecutor && cache.loaded) {
        if (insertedRow.id === cache.latestId + 1) {
          applyTransactionToState(cache, insertedRow);
        } else {
          cache.loaded = false;
          cache.latestId = 0;
          cache.latestHash = GENESIS_HASH;
          cache.users = new Map();
        }
      }

      return formatTransactionRow(insertedRow);
    } catch (error) {
      if (!inTransaction) {
        try {
          await executor.run('ROLLBACK');
        } catch (rollbackError) {
          // Ignore rollback errors so the original failure is preserved.
        }
      }

      throw error;
    }
  }

  async function appendTransaction(entry, options = {}) {
    await initialize();

    const executor = options.executor || defaultExecutor;
    const inTransaction = Boolean(options.inTransaction);

    if (!inTransaction && executor === defaultExecutor) {
      const queueWrite = typeof enqueueWrite === 'function' ? enqueueWrite : enqueueTopLevelWrite;
      return queueWrite(() => appendTransactionInternal(entry, {
        ...options,
        executor,
        inTransaction,
      }));
    }

    return appendTransactionInternal(entry, options);
  }

  async function appendTransactionsBatchInternal(entries, options = {}) {
    await initialize();

    const executor = options.executor || defaultExecutor;
    const inTransaction = Boolean(options.inTransaction);
    const insertedRows = [];

    if (!Array.isArray(entries) || entries.length === 0) {
      return insertedRows;
    }

    const distinctUsers = new Set();
    for (const entry of entries) {
      const fromUserId = normalizeUserId(entry.fromUserId);
      const toUserId = normalizeUserId(entry.toUserId);
      if (fromUserId) distinctUsers.add(fromUserId);
      if (toUserId) distinctUsers.add(toUserId);
    }

    await Promise.all([...distinctUsers].map((userId) => ensureUserEconomyRow(userId)));

    if (!inTransaction) {
      await executor.run('BEGIN IMMEDIATE');
    }

    try {
      const latestRow = await executor.get(`SELECT id, hash FROM transactions ORDER BY id DESC LIMIT 1`);
      let nextId = Number(latestRow?.id || 0) + 1;
      let previousHash = latestRow?.hash || GENESIS_HASH;

      for (const entry of entries) {
        const fromUserId = normalizeUserId(entry.fromUserId);
        const toUserId = normalizeUserId(entry.toUserId);
        const amount = Number(entry.amount);

        if (!entry.type || typeof entry.type !== 'string') {
          throw new Error('Transaction type is required.');
        }

        if (!Number.isInteger(amount) || amount <= 0) {
          throw new Error('Transaction amount must be a positive integer.');
        }

        if (!fromUserId && !toUserId) {
          throw new Error('Transactions must have either a source user or destination user.');
        }

        const metadata = normalizeMetadataForStorage(entry.metadata, fromUserId, toUserId);
        const timestamp = Number(entry.timestamp || Math.floor(Date.now() / 1000));
        const rowToInsert = {
          id: nextId,
          timestamp,
          type: entry.type,
          from_user_id: fromUserId,
          to_user_id: toUserId,
          amount,
          metadata,
          previous_hash: previousHash,
        };
        const hash = computeTransactionHash(rowToInsert);

        await executor.run(
          `INSERT INTO transactions (
             id,
             timestamp,
             type,
             from_user_id,
             to_user_id,
             amount,
             metadata,
             previous_hash,
             hash
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rowToInsert.id,
            rowToInsert.timestamp,
            rowToInsert.type,
            rowToInsert.from_user_id,
            rowToInsert.to_user_id,
            rowToInsert.amount,
            rowToInsert.metadata,
            rowToInsert.previous_hash,
            hash,
          ]
        );

        previousHash = hash;
        nextId += 1;
        insertedRows.push({ ...rowToInsert, hash });
      }

      for (const userId of distinctUsers) {
        // eslint-disable-next-line no-await-in-loop
        const balance = await getUserAccountBalance(userId, PRIMARY_BALANCE_ACCOUNT, { executor });
        // eslint-disable-next-line no-await-in-loop
        await syncUserProjection({
          userId,
          balance,
          wallet: balance,
          bank: 0,
          total: balance,
          executor,
        });
      }

      if (!inTransaction) {
        await executor.run('COMMIT');
      }

      cache.loaded = false;
      cache.latestId = 0;
      cache.latestHash = GENESIS_HASH;
      cache.users = new Map();

      return insertedRows.map((row) => formatTransactionRow(row));
    } catch (error) {
      if (!inTransaction) {
        try {
          await executor.run('ROLLBACK');
        } catch (rollbackError) {
          // Ignore rollback errors so the original failure is preserved.
        }
      }
      throw error;
    }
  }

  async function appendTransactionsBatch(entries, options = {}) {
    await initialize();

    const executor = options.executor || defaultExecutor;
    const inTransaction = Boolean(options.inTransaction);

    if (!inTransaction && executor === defaultExecutor) {
      const queueWrite = typeof enqueueWrite === 'function' ? enqueueWrite : enqueueTopLevelWrite;
      return queueWrite(() => appendTransactionsBatchInternal(entries, {
        ...options,
        executor,
        inTransaction,
      }));
    }

    return appendTransactionsBatchInternal(entries, options);
  }

  async function getBalance(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
      throw new Error('User ID is required.');
    }

    const state = await refreshCache();
    const userState = state.users.get(normalizedUserId);

    if (!userState) {
      return {
        balance: 0,
        wallet: 0,
        bank: 0,
        total: 0,
        accounts: {},
      };
    }

    return {
      balance: userState.balance,
      wallet: userState.wallet,
      bank: userState.bank,
      total: userState.total,
      accounts: { ...userState.accounts },
    };
  }

  async function getLeaderboard(limit = 10) {
    const state = await refreshCache();
    return [...state.users.entries()]
      .map(([userID, balance]) => ({
        userID,
        balance: balance.balance,
        wallet: balance.wallet,
        bank: balance.bank,
        totalBalance: balance.total,
      }))
      .sort((left, right) => right.totalBalance - left.totalBalance)
      .slice(0, limit);
  }

  async function getFullLedger(options = {}) {
    await initialize();
    const sinceId = Number(options.sinceId || 0);
    const rows = await defaultExecutor.all(
      `SELECT * FROM transactions WHERE id > ? ORDER BY id ASC`,
      [sinceId]
    );

    return rows.map((row) => formatTransactionRow(row, { parse: options.parse !== false }));
  }

  async function verifyLedgerIntegrity(providedRows = null) {
    await initialize();

    const rows = providedRows
      ? providedRows.map((row) => ({
        ...row,
        metadata: typeof row.metadata_raw !== 'undefined'
          ? row.metadata_raw
          : (typeof row.metadata === 'string' ? row.metadata : stableStringify(row.metadata || {})),
      }))
      : await defaultExecutor.all(`SELECT * FROM transactions ORDER BY id ASC`);

    let previousHash = GENESIS_HASH;
    let previousId = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const normalizedRow = {
        id: Number(row.id),
        timestamp: Number(row.timestamp),
        type: row.type,
        from_user_id: normalizeUserId(row.from_user_id),
        to_user_id: normalizeUserId(row.to_user_id),
        amount: Number(row.amount),
        metadata: typeof row.metadata === 'string'
          ? row.metadata
          : (typeof row.metadata_raw === 'string' ? row.metadata_raw : stableStringify(row.metadata || {})),
        previous_hash: row.previous_hash,
        hash: row.hash,
      };

      if (!Number.isInteger(normalizedRow.id) || normalizedRow.id <= previousId) {
        return {
          valid: false,
          firstBrokenIndex: index,
          transactionId: normalizedRow.id,
          reason: 'Transaction IDs are not strictly increasing.',
        };
      }

      if (normalizedRow.previous_hash !== previousHash) {
        return {
          valid: false,
          firstBrokenIndex: index,
          transactionId: normalizedRow.id,
          reason: 'Previous hash mismatch.',
        };
      }

      const expectedHash = computeTransactionHash(normalizedRow);
      if (normalizedRow.hash !== expectedHash) {
        return {
          valid: false,
          firstBrokenIndex: index,
          transactionId: normalizedRow.id,
          reason: 'Hash mismatch.',
        };
      }

      previousHash = normalizedRow.hash;
      previousId = normalizedRow.id;
    }

    return {
      valid: true,
      firstBrokenIndex: null,
      transactionId: null,
      reason: null,
      transactionCount: rows.length,
      latestHash: previousHash,
      genesisHash: GENESIS_HASH,
    };
  }

  async function replayLedger() {
    const state = await rebuildCache();
    const users = {};

    for (const [userID, balance] of [...state.users.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      users[userID] = {
        balance: balance.balance,
        wallet: balance.wallet,
        bank: balance.bank,
        total: balance.total,
        accounts: { ...balance.accounts },
      };
    }

    return {
      users,
      latestTransactionId: state.latestId,
      latestHash: state.latestHash,
      transactionCount: await getTransactionCount(),
    };
  }

  async function getTransactionCount({ executor = defaultExecutor } = {}) {
    await initialize();
    const row = await executor.get(`SELECT COUNT(*) AS count FROM transactions`);
    return Number(row?.count || 0);
  }

  async function exportLedger(options = {}) {
    await initialize();
    const sinceId = Number(options.sinceId || 0);
    const rows = await defaultExecutor.all(
      `SELECT * FROM transactions WHERE id > ? ORDER BY id ASC`,
      [sinceId]
    );
    const integrity = await verifyLedgerIntegrity(rows);
    const payload = {
      exportVersion: LEDGER_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      genesisHash: GENESIS_HASH,
      sinceId,
      integrity,
      transactions: rows.map((row) => ({
          id: Number(row.id),
          timestamp: Number(row.timestamp),
          type: row.type,
          from_user_id: normalizeUserId(row.from_user_id),
          to_user_id: normalizeUserId(row.to_user_id),
          amount: Number(row.amount),
          metadata: row.metadata,
          previous_hash: row.previous_hash,
          hash: row.hash,
        })),
    };

    if (options.outputPath) {
      const resolvedPath = path.resolve(options.outputPath);
      await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.promises.writeFile(resolvedPath, JSON.stringify(payload, null, 2), 'utf8');
    }

    return payload;
  }

  async function importLedger(source) {
    await initialize();
    const queueWrite = typeof enqueueWrite === 'function' ? enqueueWrite : enqueueTopLevelWrite;
    return queueWrite(async () => {
      let payload = source;
      if (typeof source === 'string') {
        const resolvedPath = path.resolve(source);
        payload = JSON.parse(await fs.promises.readFile(resolvedPath, 'utf8'));
      }

      const transactions = Array.isArray(payload) ? payload : payload?.transactions;
      if (!Array.isArray(transactions)) {
        throw new Error('Imported ledger must be an array or an object with a transactions array.');
      }

      const existingCount = await getTransactionCount();
      if (existingCount > 0) {
        throw new Error('Import requires an empty transactions table.');
      }

      const integrity = await verifyLedgerIntegrity(transactions);
      if (!integrity.valid) {
        throw new Error(`Imported ledger failed verification at index ${integrity.firstBrokenIndex}: ${integrity.reason}`);
      }

      const preparedRows = transactions.map((row) => ({
        id: Number(row.id),
        timestamp: Number(row.timestamp),
        type: row.type,
        from_user_id: normalizeUserId(row.from_user_id),
        to_user_id: normalizeUserId(row.to_user_id),
        amount: Number(row.amount),
        metadata: typeof row.metadata === 'string' ? row.metadata : stableStringify(row.metadata || {}),
        previous_hash: row.previous_hash,
        hash: row.hash,
      }));

      const distinctUsers = new Set();
      for (const row of preparedRows) {
        if (row.from_user_id) distinctUsers.add(row.from_user_id);
        if (row.to_user_id) distinctUsers.add(row.to_user_id);
      }
      await Promise.all([...distinctUsers].map((userId) => ensureUserEconomyRow(userId)));

      await defaultExecutor.run('BEGIN IMMEDIATE');
      try {
        for (const row of preparedRows) {
          await defaultExecutor.run(
            `INSERT INTO transactions (
               id,
               timestamp,
               type,
               from_user_id,
               to_user_id,
               amount,
               metadata,
               previous_hash,
               hash
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.id,
              row.timestamp,
              row.type,
              row.from_user_id,
              row.to_user_id,
              row.amount,
              row.metadata,
              row.previous_hash,
              row.hash,
            ]
          );
        }

        await defaultExecutor.run('COMMIT');
      } catch (error) {
        try {
          await defaultExecutor.run('ROLLBACK');
        } catch (rollbackError) {
          // Ignore rollback errors so the original failure is preserved.
        }
        throw error;
      }

      cache.loaded = false;
      cache.latestId = 0;
      cache.latestHash = GENESIS_HASH;
      cache.users = new Map();

      return {
        imported: preparedRows.length,
        latestHash: preparedRows[preparedRows.length - 1]?.hash || GENESIS_HASH,
      };
    });
  }

  async function migrateEconomyToLedger() {
    await initialize();

    const existingCount = await getTransactionCount();
    if (existingCount > 0) {
      return {
        migrated: false,
        createdTransactions: 0,
        reason: 'Ledger already contains transactions.',
      };
    }

    const balances = await defaultExecutor.all(
      `SELECT userID, IFNULL(wallet, 0) AS wallet, IFNULL(bank, 0) AS bank
       FROM economy
       WHERE IFNULL(wallet, 0) != 0 OR IFNULL(bank, 0) != 0
       ORDER BY userID ASC`
    );

    const migrationBatchId = `genesis-${Math.floor(Date.now() / 1000)}`;
    const entries = [];

    for (const balance of balances) {
      for (const account of ['wallet', 'bank']) {
        const amount = Number(balance[account] || 0);
        if (!amount) continue;

        if (amount > 0) {
          entries.push({
            type: 'migration_genesis',
            fromUserId: null,
            toUserId: balance.userID,
            amount,
            metadata: {
              fromAccount: 'system',
              toAccount: account,
              migrationBatchId,
              sourceTable: 'economy',
              sourceColumn: account,
            },
          });
        } else {
          entries.push({
            type: 'migration_genesis',
            fromUserId: balance.userID,
            toUserId: null,
            amount: Math.abs(amount),
            metadata: {
              fromAccount: account,
              toAccount: 'system',
              migrationBatchId,
              sourceTable: 'economy',
              sourceColumn: account,
            },
          });
        }
      }
    }

    const inserted = await appendTransactionsBatch(entries);
    return {
      migrated: true,
      createdTransactions: inserted.length,
      migrationBatchId,
    };
  }

  return {
    GENESIS_HASH,
    createExecutor,
    initialize,
    appendTransaction,
    appendTransactionsBatch,
    getBalance,
    getUserAccountBalance,
    getLeaderboard,
    getFullLedger,
    verifyLedgerIntegrity,
    replayLedger,
    exportLedger,
    importLedger,
    migrateEconomyToLedger,
  };
}

module.exports = {
  GENESIS_HASH,
  PRIMARY_BALANCE_ACCOUNT,
  createLedgerService,
  normalizeLedgerAccount,
  stableStringify,
};
