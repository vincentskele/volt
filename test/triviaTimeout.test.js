const test = require('node:test');
const assert = require('node:assert/strict');
const { createTriviaTimeout, parseTriviaTimeoutHours } = require('../utils/triviaTimeout');

test('parseTriviaTimeoutHours accepts positive hour values and disables invalid values', () => {
  assert.equal(parseTriviaTimeoutHours('12'), 12);
  assert.equal(parseTriviaTimeoutHours('0.5'), 0.5);
  assert.equal(parseTriviaTimeoutHours(''), 0);
  assert.equal(parseTriviaTimeoutHours('invalid'), 0);
  assert.equal(parseTriviaTimeoutHours('-1'), 0);
});

test('a recorded winner remains timed out for the configured number of hours', async () => {
  let currentTime = Date.UTC(2026, 0, 1);
  const timeout = createTriviaTimeout({
    hours: 2,
    getSystemEvents: async () => [],
    now: () => currentTime,
  });

  timeout.recordWin('user-1');
  assert.equal(await timeout.isTimedOut('user-1'), true);

  currentTime += 2 * 60 * 60 * 1000;
  assert.equal(await timeout.isTimedOut('user-1'), false);
});

test('prior trivia wins are restored from the event ledger', async () => {
  const currentTime = Date.UTC(2026, 0, 1);
  const timeout = createTriviaTimeout({
    hours: 3,
    getSystemEvents: async (options) => {
      assert.deepEqual(options, {
        domain: 'trivia',
        actorUserId: 'user-2',
        parse: true,
      });
      return [
        { action: 'reward_failed', timestamp: currentTime / 1000 },
        { action: 'answer_correct', timestamp: currentTime / 1000 - 60 },
      ];
    },
    now: () => currentTime,
  });

  assert.equal(await timeout.isTimedOut('user-2'), true);
});

test('a disabled timeout does not query the event ledger', async () => {
  const timeout = createTriviaTimeout({
    hours: 0,
    getSystemEvents: async () => {
      throw new Error('should not be called');
    },
  });

  assert.equal(timeout.enabled, false);
  assert.equal(await timeout.isTimedOut('user-3'), false);
});
