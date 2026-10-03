const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

function parseTriviaTimeoutHours(value) {
  if (value === null || typeof value === 'undefined' || String(value).trim() === '') {
    return 0;
  }

  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

function createTriviaTimeout({ hours, getSystemEvents, now = () => Date.now() }) {
  const timeoutMilliseconds = parseTriviaTimeoutHours(hours) * MILLISECONDS_PER_HOUR;
  const lastWinByUser = new Map();

  async function getLastWinMilliseconds(userId) {
    const normalizedUserId = String(userId);
    if (lastWinByUser.has(normalizedUserId)) {
      return lastWinByUser.get(normalizedUserId);
    }

    const events = await getSystemEvents({
      domain: 'trivia',
      actorUserId: normalizedUserId,
      parse: true,
    });
    const lastWinMilliseconds = events.reduce((latest, event) => {
      if (event.action !== 'answer_correct') return latest;
      return Math.max(latest, Number(event.timestamp || 0) * 1000);
    }, 0);

    lastWinByUser.set(normalizedUserId, lastWinMilliseconds);
    return lastWinMilliseconds;
  }

  return {
    enabled: timeoutMilliseconds > 0,

    async isTimedOut(userId) {
      if (timeoutMilliseconds === 0) return false;
      const lastWinMilliseconds = await getLastWinMilliseconds(userId);
      return lastWinMilliseconds > 0 && now() - lastWinMilliseconds < timeoutMilliseconds;
    },

    recordWin(userId, wonAtMilliseconds = now()) {
      lastWinByUser.set(String(userId), wonAtMilliseconds);
    },
  };
}

module.exports = {
  createTriviaTimeout,
  parseTriviaTimeoutHours,
};
