'use strict';

const DAY_SECONDS = 86400;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseUtcDate(value) {
  if (!ISO_DATE.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day) / 1000;
  const date = new Date(timestamp * 1000);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return timestamp;
}

function utcStartOfDay(timestamp) {
  const date = new Date(timestamp * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000;
}

function resolveAnalyticsRange(query = {}, now = Math.floor(Date.now() / 1000)) {
  const requested = String(query.range || 'month');

  if (requested === 'custom') {
    const since = parseUtcDate(query.from);
    const inclusiveEnd = parseUtcDate(query.to);
    if (since === null || inclusiveEnd === null || since > inclusiveEnd) {
      throw new Error('Choose a valid start and end date.');
    }
    return { range: 'custom', since, until: inclusiveEnd + DAY_SECONDS, from: query.from, to: query.to };
  }

  const today = utcStartOfDay(now);
  const date = new Date(today * 1000);
  let since;
  let range = requested;

  if (requested === 'week') {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    since = today - (mondayOffset * DAY_SECONDS);
  } else if (requested === 'year') {
    since = Date.UTC(date.getUTCFullYear(), 0, 1) / 1000;
  } else if (requested === 'all') {
    since = 0;
  } else {
    range = 'month';
    since = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
  }

  return { range, since, until: now + 1 };
}

module.exports = { DAY_SECONDS, parseUtcDate, resolveAnalyticsRange };
