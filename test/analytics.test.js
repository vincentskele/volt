'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { initializeAnalytics, recordAnalyticsEvent } = require('../analytics');

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

function close(db) {
  return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

test('analytics schema is isolated and unique events are idempotent', async () => {
  const db = new sqlite3.Database(':memory:');
  initializeAnalytics(db);
  await recordAnalyticsEvent(db, {
    uniqueKey: 'purchase:1', eventType: 'spent', userId: 'member-1',
    amount: 25, quantity: 2, source: 'shop_purchase', itemName: 'Ticket',
  });
  await recordAnalyticsEvent(db, {
    uniqueKey: 'purchase:1', eventType: 'spent', userId: 'member-1',
    amount: 25, quantity: 2, source: 'shop_purchase', itemName: 'Ticket',
  });

  const events = await all(db, 'SELECT * FROM analytics_events');
  const meta = await all(db, "SELECT value FROM analytics_meta WHERE key = 'collection_started_at'");
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, 25);
  assert.equal(events[0].quantity, 2);
  assert.equal(meta.length, 1);
  await close(db);
});

test('analytics write failures resolve without interrupting callers', async () => {
  const db = new sqlite3.Database(':memory:');
  const recorded = await recordAnalyticsEvent(db, { eventType: 'earned', amount: 5, source: 'test' });
  assert.equal(recorded, false);
  await close(db);
});
