// db.js

// =========================================================================
// Require & Connect to SQLite
// =========================================================================
const SQLite = require('sqlite3').verbose();
const db = new SQLite.Database('./economy.db', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase(); // Automatically initialize DB on connection
  }
});

// =========================================================================
// Database Initialization
// =========================================================================
function initializeDatabase() {
  db.serialize(() => {
    console.log('Initializing database tables...');

    db.run(`
      CREATE TABLE IF NOT EXISTS economy (
        userID TEXT PRIMARY KEY,
        wallet INTEGER DEFAULT 0,
        bank INTEGER DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS items (
        itemID INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        description TEXT,
        price INTEGER,
        isAvailable BOOLEAN DEFAULT 1
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS inventory (
        userID TEXT,
        itemID INTEGER,
        quantity INTEGER DEFAULT 1,
        PRIMARY KEY(userID, itemID),
        FOREIGN KEY(itemID) REFERENCES items(itemID)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS admins (
        userID TEXT PRIMARY KEY
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS blackjack_games (
        gameID INTEGER PRIMARY KEY AUTOINCREMENT,
        userID TEXT,
        bet INTEGER,
        playerHand TEXT,
        dealerHand TEXT,
        status TEXT DEFAULT 'active',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS joblist (
        jobID INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS job_assignees (
        jobID INTEGER,
        userID TEXT,
        PRIMARY KEY(jobID, userID)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS pets (
        petID INTEGER PRIMARY KEY AUTOINCREMENT,
        userID TEXT,
        name TEXT,
        type TEXT,
        level INTEGER DEFAULT 1,
        exp INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        lastBattle DATETIME,
        UNIQUE(userID, name)
      )
    `);

    console.log('Database initialization complete.');
  });
}

// =========================================================================
// Core Economy Functions
// =========================================================================

// Ensure user has an economy entry
async function initUserEconomy(userID) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO economy (userID, wallet, bank) VALUES (?, 0, 0)`,
      [userID],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

// Get wallet and bank balances for a user
async function getBalances(userID) {
  await initUserEconomy(userID);
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT wallet, bank FROM economy WHERE userID = ?`,
      [userID],
      (err, row) => {
        if (err) return reject('Balance check failed');
        return resolve(row || { wallet: 0, bank: 0 });
      }
    );
  });
}

// Transfer money from one user's wallet to another user's wallet
async function transferFromWallet(fromUserID, toUserID, amount) {
  await Promise.all([initUserEconomy(fromUserID), initUserEconomy(toUserID)]);
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.get(
        `SELECT wallet FROM economy WHERE userID = ?`,
        [fromUserID],
        (err, row) => {
          if (err || !row || row.wallet < amount) {
            db.run('ROLLBACK', () => reject('Insufficient funds or error occurred.'));
            return;
          }
          db.run(
            `UPDATE economy SET wallet = wallet - ? WHERE userID = ?`,
            [amount, fromUserID],
            (err) => {
              if (err) {
                db.run('ROLLBACK', () => reject('Failed to deduct funds.'));
                return;
              }
              db.run(
                `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
                [amount, toUserID],
                (err) => {
                  if (err) {
                    db.run('ROLLBACK', () => reject('Failed to add funds.'));
                    return;
                  }
                  db.run('COMMIT', (err) => {
                    if (err) reject('Transaction commit failed.');
                    else resolve();
                  });
                }
              );
            }
          );
        }
      );
    });
  });
}

// Rob another user's wallet
async function robUser(robberId, targetId) {
  await Promise.all([initUserEconomy(robberId), initUserEconomy(targetId)]);

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get(
        `SELECT wallet FROM economy WHERE userID = ?`,
        [targetId],
        (err, targetRow) => {
          if (err || !targetRow) {
            return reject('Error retrieving target user wallet.');
          }

          const targetWallet = targetRow.wallet;
          if (targetWallet <= 0) {
            return resolve({
              success: false,
              message: 'Target has no money to rob!',
            });
          }

          const isSuccessful = Math.random() < 0.5; // 50% chance of success
          const amountStolen = Math.min(targetWallet, 100); // Limit the max stolen

          if (isSuccessful) {
            // Successful robbery
            db.run(
              `UPDATE economy SET wallet = wallet - ? WHERE userID = ?`,
              [amountStolen, targetId],
              (err) => {
                if (err) {
                  return reject('Failed to deduct money from the target.');
                }
                db.run(
                  `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
                  [amountStolen, robberId],
                  (err) => {
                    if (err) {
                      return reject('Failed to add money to the robber.');
                    }
                    return resolve({
                      success: true,
                      outcome: 'success',
                      amountStolen,
                    });
                  }
                );
              }
            );
          } else {
            // Failed robbery; penalize robber
            const penalty = 50; // Example penalty
            db.run(
              `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
              [penalty, targetId],
              (err) => {
                if (err) {
                  return reject('Failed to add penalty money to the target.');
                }
                db.run(
                  `UPDATE economy SET wallet = wallet - ? WHERE userID = ?`,
                  [penalty, robberId],
                  (err) => {
                    if (err) {
                      return reject('Failed to deduct penalty money from the robber.');
                    }
                    return resolve({
                      success: true,
                      outcome: 'fail',
                      penalty,
                    });
                  }
                );
              }
            );
          }
        }
      );
    });
  });
}

// =========================================================================
// Shop System
// =========================================================================
function getShopItems() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM items WHERE isAvailable = 1`,
      [],
      (err, rows) => (err ? reject('Shop unavailable') : resolve(rows || []))
    );
  });
}

function getShopItemByName(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM items WHERE name = ? AND isAvailable = 1`,
      [name],
      (err, row) => (err ? reject('Item lookup failed') : resolve(row))
    );
  });
}

// =========================================================================
// Exports
// =========================================================================
module.exports = {
  db,                 // Export the db instance if you need direct access
  initUserEconomy,
  getBalances,
  transferFromWallet,
  robUser,
  getShopItems,
  getShopItemByName,
};
