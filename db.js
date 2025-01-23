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

// Withdraw money from the user's bank to their wallet
async function withdraw(userID, amount) {
  await initUserEconomy(userID); // Ensure the user exists in the database
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get(
        `SELECT bank FROM economy WHERE userID = ?`,
        [userID],
        (err, row) => {
          if (err || !row || row.bank < amount) {
            return reject('Insufficient funds in the bank or error occurred.');
          }

          db.run(
            `UPDATE economy SET bank = bank - ?, wallet = wallet + ? WHERE userID = ?`,
            [amount, amount, userID],
            (err) => {
              if (err) {
                return reject('Failed to process withdrawal.');
              }
              resolve(); // Resolve the promise if the transaction is successful
            }
          );
        }
      );
    });
  });
}

// Deposit money from wallet to bank
async function deposit(userID, amount) {
  await initUserEconomy(userID); // Ensure the user exists in the database
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get(
        `SELECT wallet FROM economy WHERE userID = ?`,
        [userID],
        (err, row) => {
          if (err) {
            return reject('Failed to retrieve wallet balance.');
          }

          if (!row || row.wallet < amount) {
            return reject('Insufficient funds in wallet.');
          }

          db.run(
            `UPDATE economy SET wallet = wallet - ?, bank = bank + ? WHERE userID = ?`,
            [amount, amount, userID],
            (err) => {
              if (err) {
                return reject('Failed to deposit funds.');
              }
              resolve();
            }
          );
        }
      );
    });
  });
}

// Get all bot admins
async function getAdmins() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT userID FROM admins`,
      [],
      (err, rows) => {
        if (err) {
          return reject('Failed to retrieve admins.');
        }
        // Map the rows to an array of user IDs
        const adminIDs = rows.map(row => row.userID);
        resolve(adminIDs);
      }
    );
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
// Blackjack Functions
// =========================================================================

// Retrieve all active Blackjack games for a user
async function getActiveGames(userID) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM blackjack_games WHERE userID = ? AND status = 'active'`,
      [userID],
      (err, rows) => {
        if (err) {
          return reject('Failed to retrieve active games.');
        }
        resolve(rows || []);
      }
    );
  });
}

// Start a new Blackjack game
async function startBlackjackGame(userID, bet) {
  await initUserEconomy(userID);
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT wallet FROM economy WHERE userID = ?`,
      [userID],
      (err, row) => {
        if (err || !row || row.wallet < bet) {
          return reject('Insufficient wallet balance to start the game.');
        }

        const playerHand = JSON.stringify([drawCard(), drawCard()]);
        const dealerHand = JSON.stringify([drawCard()]);

        db.run(
          `UPDATE economy SET wallet = wallet - ? WHERE userID = ?`,
          [bet, userID],
          (updateErr) => {
            if (updateErr) {
              return reject('Failed to deduct bet from wallet.');
            }

            db.run(
              `INSERT INTO blackjack_games (userID, bet, playerHand, dealerHand) VALUES (?, ?, ?, ?)`,
              [userID, bet, playerHand, dealerHand],
              function (insertErr) {
                if (insertErr) {
                  return reject('Failed to create new Blackjack game.');
                }
                resolve({
                  gameID: this.lastID,
                  bet,
                  playerHand: JSON.parse(playerHand),
                  dealerHand: JSON.parse(dealerHand),
                });
              }
            );
          }
        );
      }
    );
  });
}

// Draw a card for Blackjack
async function blackjackHit(gameID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT playerHand, dealerHand FROM blackjack_games WHERE gameID = ? AND status = 'active'`,
      [gameID],
      (err, game) => {
        if (err || !game) {
          return reject('No active game found with the given ID.');
        }

        const playerHand = JSON.parse(game.playerHand);
        const dealerHand = JSON.parse(game.dealerHand);

        const newCard = drawCard();
        playerHand.push(newCard);

        const playerTotal = calculateHandTotal(playerHand);

        if (playerTotal > 21) {
          // Bust, update the game status
          db.run(
            `UPDATE blackjack_games SET playerHand = ?, status = 'dealer_win' WHERE gameID = ?`,
            [JSON.stringify(playerHand), gameID],
            (updateErr) => {
              if (updateErr) {
                return reject('Failed to update game status.');
              }
              resolve({
                status: 'dealer_win',
                newCard,
                playerHand,
                playerTotal,
              });
            }
          );
        } else {
          // Game continues
          db.run(
            `UPDATE blackjack_games SET playerHand = ? WHERE gameID = ?`,
            [JSON.stringify(playerHand), gameID],
            (updateErr) => {
              if (updateErr) {
                return reject('Failed to update player hand.');
              }
              resolve({
                status: 'continue',
                newCard,
                playerHand,
                playerTotal,
              });
            }
          );
        }
      }
    );
  });
}

// Stand and let the dealer play
async function blackjackStand(gameID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT userID, bet, playerHand, dealerHand FROM blackjack_games WHERE gameID = ? AND status = 'active'`,
      [gameID],
      (err, game) => {
        if (err || !game) {
          return reject('No active game found with the given ID.');
        }

        const playerHand = JSON.parse(game.playerHand);
        const dealerHand = JSON.parse(game.dealerHand);

        let dealerTotal = calculateHandTotal(dealerHand);
        while (dealerTotal < 17) {
          dealerHand.push(drawCard());
          dealerTotal = calculateHandTotal(dealerHand);
        }

        const playerTotal = calculateHandTotal(playerHand);
        let status = '';
        let winnings = 0;

        if (playerTotal > 21 || (dealerTotal <= 21 && dealerTotal >= playerTotal)) {
          status = 'dealer_win';
        } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
          status = 'player_win';
          winnings = playerHand.length === 2 && playerTotal === 21 ? Math.floor(game.bet * 2.5) : game.bet * 2;
        } else {
          status = 'push';
          winnings = game.bet;
        }

        // Update the game in the database
        db.run(
          `UPDATE blackjack_games SET dealerHand = ?, status = ? WHERE gameID = ?`,
          [JSON.stringify(dealerHand), status, gameID],
          (updateErr) => {
            if (updateErr) {
              return reject('Failed to update game results.');
            }

            // Pay out winnings or return bet if it's a push
            if (status === 'player_win' || status === 'push') {
              db.run(
                `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
                [winnings, game.userID],
                (payoutErr) => {
                  if (payoutErr) {
                    return reject('Failed to pay out winnings.');
                  }
                  resolve({
                    status,
                    winnings,
                    playerTotal,
                    dealerTotal,
                    dealerHand,
                  });
                }
              );
            } else {
              resolve({
                status,
                playerTotal,
                dealerTotal,
                dealerHand,
              });
            }
          }
        );
      }
    );
  });
}

// Utility: Draw a random card
function drawCard() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const value = values[Math.floor(Math.random() * values.length)];
  const suit = suits[Math.floor(Math.random() * suits.length)];
  return { value, suit };
}

// Utility: Calculate the total value of a Blackjack hand
function calculateHandTotal(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.value === 'A') {
      aces++;
    } else if (['K', 'Q', 'J'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value, 10);
    }
  }

  for (let i = 0; i < aces; i++) {
    total += total + 11 > 21 ? 1 : 11;
  }

  return total;
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
  deposit,
  getAdmins,
  withdraw,
  getActiveGames,
  startBlackjackGame,
  blackjackHit,
  blackjackStand,
  getShopItems,
  getShopItemByName,
};
