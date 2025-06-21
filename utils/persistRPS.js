const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');
const filepath = path.join(dataDir, 'rpsGames.json');

// Ensure the /data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

/**
 * Load saved RPS games from disk into a Map.
 * Only returns serializable game data (no timeouts).
 */
function loadGames() {
  try {
    if (!fs.existsSync(filepath)) return new Map();

    const raw = fs.readFileSync(filepath, 'utf8');
    const parsed = JSON.parse(raw);
    return new Map(parsed.map(([k, v]) => [k, v]));
  } catch (e) {
    console.error('❌ Failed to load RPS games:', e);
    return new Map();
  }
}

/**
 * Save current RPS games to disk.
 * Removes the `timeout` field before serialization.
 */
function saveGames(gameMap) {
  try {
    const serializable = [...gameMap.entries()].map(([key, game]) => {
      const cleanGame = { ...game };
      delete cleanGame.timeout;
      return [key, cleanGame];
    });

    fs.writeFileSync(filepath, JSON.stringify(serializable, null, 2));
  } catch (e) {
    console.error('❌ Failed to save RPS games:', e);
  }
}

module.exports = {
  loadGames,
  saveGames
};
