const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAY_INDEX[values.weekday],
  };
}

// Convert a wall-clock time in an IANA timezone to an epoch. Repeating the
// correction handles daylight-saving offsets without adding another package.
function zonedDateTimeToEpoch(localParts, timeZone) {
  const desiredAsUtc = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute || 0,
    localParts.second || 0
  );
  let candidate = desiredAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedParts(new Date(candidate), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const correction = desiredAsUtc - actualAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }

  return candidate;
}

function getVoiceRewardWindow(now, config) {
  const { day, hour, durationMinutes, timeZone } = config;
  const localNow = getZonedParts(now, timeZone);
  const daysSinceRewardDay = (localNow.weekday - day + 7) % 7;
  const targetDate = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day));
  targetDate.setUTCDate(targetDate.getUTCDate() - daysSinceRewardDay);

  let windowStart = zonedDateTimeToEpoch({
    year: targetDate.getUTCFullYear(),
    month: targetDate.getUTCMonth() + 1,
    day: targetDate.getUTCDate(),
    hour,
  }, timeZone);

  // Before this week's configured start, the most recent window was last week.
  if (windowStart > now.getTime()) {
    const previousDate = new Date(Date.UTC(
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth(),
      targetDate.getUTCDate() - 7
    ));
    windowStart = zonedDateTimeToEpoch({
      year: previousDate.getUTCFullYear(),
      month: previousDate.getUTCMonth() + 1,
      day: previousDate.getUTCDate(),
      hour,
    }, timeZone);
  }

  const windowEnd = windowStart + durationMinutes * 60_000;
  const nowMs = now.getTime();
  return {
    windowStart,
    windowEnd,
    inWindow: nowMs >= windowStart && nowMs < windowEnd,
  };
}

module.exports = { getVoiceRewardWindow, getZonedParts, zonedDateTimeToEpoch };
