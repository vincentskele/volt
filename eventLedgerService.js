const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stableStringify } = require('./ledgerService');

const EVENT_LEDGER_GENESIS_HASH = 'VOLT_EVENT_LEDGER_GENESIS_V1';
const EVENT_LEDGER_EXPORT_VERSION = 1;

function normalizeValue(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  return String(value);
}

function normalizeMetadata(metadata) {
  const baseMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};

  if (!baseMetadata.eventLedgerVersion) {
    baseMetadata.eventLedgerVersion = EVENT_LEDGER_EXPORT_VERSION;
  }

  return stableStringify(baseMetadata);
}

function computeEventHash(event) {
  const payload = [
    event.id,
    event.timestamp,
    event.domain,
    event.action,
    event.entity_type ?? '',
    event.entity_id ?? '',
    event.actor_user_id ?? '',
    event.metadata,
    event.previous_hash,
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

function formatEventRow(row, { parse = true } = {}) {
  const formatted = {
    id: Number(row.id),
    timestamp: Number(row.timestamp),
    domain: row.domain,
    action: row.action,
    entity_type: normalizeValue(row.entity_type),
    entity_id: normalizeValue(row.entity_id),
    actor_user_id: normalizeValue(row.actor_user_id),
    metadata_raw: row.metadata || '{}',
    previous_hash: row.previous_hash,
    hash: row.hash,
  };

  formatted.metadata = parse
    ? (() => {
      try {
        return JSON.parse(formatted.metadata_raw);
      } catch (error) {
        return {};
      }
    })()
    : formatted.metadata_raw;

  return formatted;
}

function createEventLedgerService({ db, enqueueWrite = null }) {
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
          CREATE TABLE IF NOT EXISTS system_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            domain TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_type TEXT,
            entity_id TEXT,
            actor_user_id TEXT,
            metadata TEXT NOT NULL DEFAULT '{}',
            previous_hash TEXT NOT NULL,
            hash TEXT NOT NULL UNIQUE
          )
        `);

        await defaultExecutor.run(
          `CREATE INDEX IF NOT EXISTS idx_system_events_domain ON system_events(domain)`
        );
        await defaultExecutor.run(
          `CREATE INDEX IF NOT EXISTS idx_system_events_entity ON system_events(entity_type, entity_id)`
        );
        await defaultExecutor.run(
          `CREATE INDEX IF NOT EXISTS idx_system_events_actor ON system_events(actor_user_id)`
        );
        await defaultExecutor.run(
          `CREATE INDEX IF NOT EXISTS idx_system_events_timestamp ON system_events(timestamp)`
        );

        await defaultExecutor.run(`
          CREATE TRIGGER IF NOT EXISTS system_events_prevent_update
          BEFORE UPDATE ON system_events
          BEGIN
            SELECT RAISE(ABORT, 'system_events are append-only');
          END
        `);

        await defaultExecutor.run(`
          CREATE TRIGGER IF NOT EXISTS system_events_prevent_delete
          BEFORE DELETE ON system_events
          BEGIN
            SELECT RAISE(ABORT, 'system_events are append-only');
          END
        `);
      })().catch((error) => {
        initializationPromise = null;
        throw error;
      });
    }

    return initializationPromise;
  }

  async function appendEventInternal(entry, options = {}) {
    await initialize();

    const executor = options.executor || defaultExecutor;
    const inTransaction = Boolean(options.inTransaction);

    if (!entry.domain || typeof entry.domain !== 'string') {
      throw new Error('Event domain is required.');
    }

    if (!entry.action || typeof entry.action !== 'string') {
      throw new Error('Event action is required.');
    }

    const timestamp = Number(entry.timestamp || Math.floor(Date.now() / 1000));
    const metadata = normalizeMetadata(entry.metadata);
    const entityType = normalizeValue(entry.entityType);
    const entityId = normalizeValue(entry.entityId);
    const actorUserId = normalizeValue(entry.actorUserId);

    if (!inTransaction) {
      await executor.run('BEGIN IMMEDIATE');
    }

    try {
      const latestRow = await executor.get(`SELECT id, hash FROM system_events ORDER BY id DESC LIMIT 1`);
      const nextId = Number(latestRow?.id || 0) + 1;
      const previousHash = latestRow?.hash || EVENT_LEDGER_GENESIS_HASH;
      const rowToInsert = {
        id: nextId,
        timestamp,
        domain: entry.domain,
        action: entry.action,
        entity_type: entityType,
        entity_id: entityId,
        actor_user_id: actorUserId,
        metadata,
        previous_hash: previousHash,
      };

      const hash = computeEventHash(rowToInsert);

      await executor.run(
        `INSERT INTO system_events (
           id,
           timestamp,
           domain,
           action,
           entity_type,
           entity_id,
           actor_user_id,
           metadata,
           previous_hash,
           hash
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rowToInsert.id,
          rowToInsert.timestamp,
          rowToInsert.domain,
          rowToInsert.action,
          rowToInsert.entity_type,
          rowToInsert.entity_id,
          rowToInsert.actor_user_id,
          rowToInsert.metadata,
          rowToInsert.previous_hash,
          hash,
        ]
      );

      if (!inTransaction) {
        await executor.run('COMMIT');
      }

      return formatEventRow({ ...rowToInsert, hash });
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

  async function appendEvent(entry, options = {}) {
    await initialize();

    const executor = options.executor || defaultExecutor;
    const inTransaction = Boolean(options.inTransaction);

    if (!inTransaction && executor === defaultExecutor) {
      const queueWrite = typeof enqueueWrite === 'function' ? enqueueWrite : enqueueTopLevelWrite;
      return queueWrite(() => appendEventInternal(entry, {
        ...options,
        executor,
        inTransaction,
      }));
    }

    return appendEventInternal(entry, options);
  }

  async function getEvents(options = {}) {
    await initialize();

    const clauses = [];
    const params = [];

    if (options.domain) {
      clauses.push('domain = ?');
      params.push(options.domain);
    }

    if (options.entityType) {
      clauses.push('entity_type = ?');
      params.push(options.entityType);
    }

    if (options.entityId) {
      clauses.push('entity_id = ?');
      params.push(String(options.entityId));
    }

    if (options.actorUserId) {
      clauses.push('actor_user_id = ?');
      params.push(String(options.actorUserId));
    }

    if (options.sinceId) {
      clauses.push('id > ?');
      params.push(Number(options.sinceId));
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await defaultExecutor.all(
      `SELECT * FROM system_events ${whereClause} ORDER BY id ASC`,
      params
    );

    return rows.map((row) => formatEventRow(row, { parse: options.parse !== false }));
  }

  async function verifyIntegrity(providedRows = null) {
    await initialize();

    const rows = providedRows
      ? providedRows.map((row) => ({
        ...row,
        metadata: typeof row.metadata_raw !== 'undefined'
          ? row.metadata_raw
          : (typeof row.metadata === 'string' ? row.metadata : stableStringify(row.metadata || {})),
      }))
      : await defaultExecutor.all(`SELECT * FROM system_events ORDER BY id ASC`);

    let previousHash = EVENT_LEDGER_GENESIS_HASH;
    let previousId = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const normalizedRow = {
        id: Number(row.id),
        timestamp: Number(row.timestamp),
        domain: row.domain,
        action: row.action,
        entity_type: normalizeValue(row.entity_type),
        entity_id: normalizeValue(row.entity_id),
        actor_user_id: normalizeValue(row.actor_user_id),
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
          eventId: normalizedRow.id,
          reason: 'Event IDs are not strictly increasing.',
        };
      }

      if (normalizedRow.previous_hash !== previousHash) {
        return {
          valid: false,
          firstBrokenIndex: index,
          eventId: normalizedRow.id,
          reason: 'Previous hash mismatch.',
        };
      }

      const expectedHash = computeEventHash(normalizedRow);
      if (normalizedRow.hash !== expectedHash) {
        return {
          valid: false,
          firstBrokenIndex: index,
          eventId: normalizedRow.id,
          reason: 'Hash mismatch.',
        };
      }

      previousHash = normalizedRow.hash;
      previousId = normalizedRow.id;
    }

    return {
      valid: true,
      firstBrokenIndex: null,
      eventId: null,
      reason: null,
      eventCount: rows.length,
      latestHash: previousHash,
      genesisHash: EVENT_LEDGER_GENESIS_HASH,
    };
  }

  async function exportEvents(options = {}) {
    const rows = await getEvents({ ...options, parse: false });
    const integrity = await verifyIntegrity(rows);
    const payload = {
      exportVersion: EVENT_LEDGER_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      genesisHash: EVENT_LEDGER_GENESIS_HASH,
      integrity,
      events: rows.map((row) => ({
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
    };

    if (options.outputPath) {
      const resolvedPath = path.resolve(options.outputPath);
      await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.promises.writeFile(resolvedPath, JSON.stringify(payload, null, 2), 'utf8');
    }

    return payload;
  }

  async function getEventCount() {
    await initialize();
    const row = await defaultExecutor.get(`SELECT COUNT(*) AS count FROM system_events`);
    return Number(row?.count || 0);
  }

  async function importEvents(source) {
    await initialize();
    const queueWrite = typeof enqueueWrite === 'function' ? enqueueWrite : enqueueTopLevelWrite;
    return queueWrite(async () => {
      let payload = source;
      if (typeof source === 'string') {
        const resolvedPath = path.resolve(source);
        payload = JSON.parse(await fs.promises.readFile(resolvedPath, 'utf8'));
      }

      const events = Array.isArray(payload) ? payload : payload?.events;
      if (!Array.isArray(events)) {
        throw new Error('Imported event ledger must be an array or an object with an events array.');
      }

      const existingCount = await getEventCount();
      if (existingCount > 0) {
        throw new Error('Import requires an empty system_events table.');
      }

      const integrity = await verifyIntegrity(events);
      if (!integrity.valid) {
        throw new Error(`Imported event ledger failed verification at index ${integrity.firstBrokenIndex}: ${integrity.reason}`);
      }

      const preparedRows = events.map((row) => ({
        id: Number(row.id),
        timestamp: Number(row.timestamp),
        domain: row.domain,
        action: row.action,
        entity_type: normalizeValue(row.entity_type),
        entity_id: normalizeValue(row.entity_id),
        actor_user_id: normalizeValue(row.actor_user_id),
        metadata: typeof row.metadata === 'string' ? row.metadata : stableStringify(row.metadata || {}),
        previous_hash: row.previous_hash,
        hash: row.hash,
      }));

      await defaultExecutor.run('BEGIN IMMEDIATE');
      try {
        for (const row of preparedRows) {
          await defaultExecutor.run(
            `INSERT INTO system_events (
               id,
               timestamp,
               domain,
               action,
               entity_type,
               entity_id,
               actor_user_id,
               metadata,
               previous_hash,
               hash
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.id,
              row.timestamp,
              row.domain,
              row.action,
              row.entity_type,
              row.entity_id,
              row.actor_user_id,
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
          // Preserve original error.
        }
        throw error;
      }

      return {
        imported: preparedRows.length,
        latestHash: preparedRows[preparedRows.length - 1]?.hash || EVENT_LEDGER_GENESIS_HASH,
      };
    });
  }

  return {
    EVENT_LEDGER_GENESIS_HASH,
    createExecutor,
    initialize,
    appendEvent,
    getEvents,
    verifyIntegrity,
    exportEvents,
    importEvents,
  };
}

module.exports = {
  EVENT_LEDGER_GENESIS_HASH,
  createEventLedgerService,
};
