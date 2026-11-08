'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY_SECONDS, parseUtcDate, resolveAnalyticsRange } = require('../analytics-range');

test('calendar presets begin at the current week, month, and year', () => {
  const now = Date.UTC(2026, 10, 7, 15, 30) / 1000;

  assert.equal(resolveAnalyticsRange({ range: 'week' }, now).since, Date.UTC(2026, 10, 2) / 1000);
  assert.equal(resolveAnalyticsRange({ range: 'month' }, now).since, Date.UTC(2026, 10, 1) / 1000);
  assert.equal(resolveAnalyticsRange({ range: 'year' }, now).since, Date.UTC(2026, 0, 1) / 1000);
  assert.equal(resolveAnalyticsRange({ range: 'all' }, now).since, 0);
});

test('custom range includes the entire selected end date', () => {
  const range = resolveAnalyticsRange({ range: 'custom', from: '2024-02-28', to: '2024-02-29' });
  assert.equal(range.since, Date.UTC(2024, 1, 28) / 1000);
  assert.equal(range.until, (Date.UTC(2024, 1, 29) / 1000) + DAY_SECONDS);
});

test('custom range rejects invalid and reversed dates', () => {
  assert.equal(parseUtcDate('2026-02-29'), null);
  assert.throws(
    () => resolveAnalyticsRange({ range: 'custom', from: '2026-11-08', to: '2026-11-07' }),
    /valid start and end date/
  );
});
