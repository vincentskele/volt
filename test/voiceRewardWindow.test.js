const test = require('node:test');
const assert = require('node:assert/strict');
const { getVoiceRewardWindow } = require('../utils/voiceRewardWindow');

const config = {
  day: 6,
  hour: 23,
  durationMinutes: 60,
  timeZone: 'America/New_York',
};

test('opens at the configured local time, not the server timezone', () => {
  const result = getVoiceRewardWindow(new Date('2026-11-08T04:30:00.000Z'), config);
  assert.equal(new Date(result.windowStart).toISOString(), '2026-11-08T04:00:00.000Z');
  assert.equal(result.inWindow, true);
});

test('uses the previous window before this week starts', () => {
  const result = getVoiceRewardWindow(new Date('2026-11-07T20:00:00.000Z'), config);
  assert.equal(new Date(result.windowStart).toISOString(), '2026-11-01T03:00:00.000Z');
  assert.equal(result.inWindow, false);
});

test('handles the daylight-saving offset change between weeks', () => {
  const result = getVoiceRewardWindow(new Date('2026-10-25T03:30:00.000Z'), config);
  assert.equal(new Date(result.windowStart).toISOString(), '2026-10-25T03:00:00.000Z');
  assert.equal(result.inWindow, true);
});
