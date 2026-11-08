'use strict';

// Analytics is deliberately isolated from economy state. Every write is append-only,
// best-effort, and ignored by callers if SQLite is temporarily unavailable.
function initializeAnalytics(db) {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS analytics_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    db.run(
      `INSERT OR IGNORE INTO analytics_meta (key, value)
       VALUES ('collection_started_at', strftime('%s', 'now'))`
    );
    db.run(`CREATE TABLE IF NOT EXISTS analytics_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_key TEXT UNIQUE,
      event_type TEXT NOT NULL,
      user_id TEXT,
      counterparty_id TEXT,
      amount INTEGER NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL,
      item_name TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_analytics_events_created
      ON analytics_events(created_at, event_type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_analytics_events_user
      ON analytics_events(user_id, created_at)`);
  });
}

function recordAnalyticsEvent(db, event = {}) {
  return new Promise((resolve) => {
    const amount = Number.isFinite(Number(event.amount)) ? Math.trunc(Number(event.amount)) : 0;
    const quantity = Number.isFinite(Number(event.quantity)) ? Math.max(0, Math.trunc(Number(event.quantity))) : 1;
    let metadata = null;
    try {
      metadata = event.metadata ? JSON.stringify(event.metadata) : null;
    } catch (_) {
      metadata = null;
    }

    db.run(
      `INSERT OR IGNORE INTO analytics_events
       (unique_key, event_type, user_id, counterparty_id, amount, quantity, source, item_name, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%s', 'now')))`,
      [
        event.uniqueKey || null,
        String(event.eventType || 'activity'),
        event.userId ? String(event.userId) : null,
        event.counterpartyId ? String(event.counterpartyId) : null,
        amount,
        quantity,
        String(event.source || 'unknown'),
        event.itemName ? String(event.itemName) : null,
        metadata,
        event.createdAt ? Math.trunc(Number(event.createdAt)) : null,
      ],
      (error) => {
        if (error) console.error('[analytics] Failed to record event:', error.message);
        resolve(!error);
      }
    );
  });
}

module.exports = { initializeAnalytics, recordAnalyticsEvent };
