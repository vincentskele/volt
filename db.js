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

  
    console.log('Database initialization complete.');
  });
}

// =========================================================================
// Core Economy Functions
// =========================================================================

async function initUserEconomy(userID) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO economy (userID, wallet, bank) VALUES (?, 0, 0)`,
      [userID],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function getBalances(userID) {
  await initUserEconomy(userID);
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT wallet, bank FROM economy WHERE userID = ?`,
      [userID],
      (err, row) => {
        if (err) return reject('Balance check failed');
        resolve(row || { wallet: 0, bank: 0 });
      }
    );
  });
}

async function addAdmin(userID) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO admins (userID) VALUES (?)`,
      [userID],
      (err) => (err ? reject('Failed to add admin.') : resolve())
    );
  });
}

async function getAdmins() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT userID FROM admins`,
      [],
      (err, rows) => {
        if (err) return reject('Failed to retrieve admins.');
        const adminIDs = rows.map((row) => row.userID);
        resolve(adminIDs);
      }
    );
  });
}

async function removeAdmin(userID) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM admins WHERE userID = ?`,
      [userID],
      function (err) {
        if (err) return reject('Failed to remove admin.');
        resolve({ changes: this.changes });
      }
    );
  });
}

async function updateWallet(userID, amount) {
  await initUserEconomy(userID);
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
      [amount, userID],
      function (err) {
        if (err) return reject('Failed to update wallet balance.');
        resolve({ changes: this.changes });
      }
    );
  });
}

async function transferFromWallet(fromUserID, toUserID, amount) {
  if (amount <= 0) throw new Error('Invalid transfer amount.');
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

async function withdraw(userID, amount) {
  if (amount <= 0) throw new Error('Invalid withdrawal amount.');
  await initUserEconomy(userID);
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
              if (err) return reject('Failed to process withdrawal.');
              resolve();
            }
          );
        }
      );
    });
  });
}

async function deposit(userID, amount) {
  if (amount <= 0) throw new Error('Invalid deposit amount.');
  await initUserEconomy(userID);
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get(
        `SELECT wallet FROM economy WHERE userID = ?`,
        [userID],
        (err, row) => {
          if (err || !row || row.wallet < amount) {
            return reject('Insufficient funds in wallet.');
          }
          db.run(
            `UPDATE economy SET wallet = wallet - ?, bank = bank + ? WHERE userID = ?`,
            [amount, amount, userID],
            (err) => {
              if (err) return reject('Failed to deposit funds.');
              resolve();
            }
          );
        }
      );
    });
  });
}

async function robUser(robberId, targetId) {
  await Promise.all([initUserEconomy(robberId), initUserEconomy(targetId)]);
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.get(
        `SELECT wallet FROM economy WHERE userID = ?`,
        [targetId],
        (err, targetRow) => {
          if (err || !targetRow) {
            db.run('ROLLBACK');
            return reject('Error retrieving target user wallet.');
          }
          const targetWallet = targetRow.wallet;
          if (targetWallet <= 0) {
            db.run('ROLLBACK');
            return resolve({
              success: false,
              message: 'Target has no money to rob!',
            });
          }
          const isSuccessful = Math.random() < 0.5;
          const amountStolen = Math.min(targetWallet, 100);
          const penalty = 50;
          if (isSuccessful) {
            db.run(
              `UPDATE economy SET wallet = wallet - ? WHERE userID = ?`,
              [amountStolen, targetId],
              (err) => {
                if (err) {
                  db.run('ROLLBACK');
                  return reject('Failed to deduct money from the target.');
                }
                db.run(
                  `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
                  [amountStolen, robberId],
                  (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      return reject('Failed to add money to the robber.');
                    }
                    db.run('COMMIT');
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
            db.run(
              `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
              [penalty, targetId],
              (err) => {
                if (err) {
                  db.run('ROLLBACK');
                  return reject('Failed to add penalty money to the target.');
                }
                db.run(
                  `UPDATE economy SET wallet = wallet - ? WHERE userID = ?`,
                  [penalty, robberId],
                  (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      return reject('Failed to deduct penalty money from the robber.');
                    }
                    db.run('COMMIT');
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
// Job System
// =========================================================================

function addJob(description) {
  return new Promise((resolve, reject) => {
    if (!description || typeof description !== 'string') {
      return reject('Invalid job description');
    }
    db.run(
      `INSERT INTO joblist (description) VALUES (?)`,
      [description],
      function (err) {
        if (err) return reject('Failed to add job');
        resolve({
          jobID: this.lastID,
          description,
        });
      }
    );
  });
}

function getJobList() {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT 
        j.jobID,
        j.description,
        GROUP_CONCAT(ja.userID) as assignees
      FROM joblist j
      LEFT JOIN job_assignees ja ON j.jobID = ja.jobID
      GROUP BY j.jobID
      `,
      [],
      (err, rows) => {
        if (err) return reject('Failed to retrieve job list');
        const jobs = rows.map((row) => ({
          jobID: row.jobID,
          description: row.description,
          assignees: row.assignees ? row.assignees.split(',') : [],
        }));
        resolve(jobs);
      }
    );
  });
}

function assignRandomJob(userID) {
  return new Promise((resolve, reject) => {
    if (!userID) return reject('Invalid user ID');
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.get(
        `SELECT COUNT(*) as count FROM job_assignees WHERE userID = ?`,
        [userID],
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject('Failed to check existing assignments');
          }
          db.get(
            `
            SELECT j.jobID, j.description
            FROM joblist j
            WHERE j.jobID NOT IN (
              SELECT jobID FROM job_assignees WHERE userID = ?
            )
            ORDER BY RANDOM() 
            LIMIT 1
            `,
            [userID],
            (err, job) => {
              if (err) {
                db.run('ROLLBACK');
                return reject('Database error while finding job');
              }
              if (!job) {
                db.run('ROLLBACK');
                return reject('No available jobs found');
              }
              db.run(
                `INSERT INTO job_assignees (jobID, userID) VALUES (?, ?)`,
                [job.jobID, userID],
                (err2) => {
                  if (err2) {
                    db.run('ROLLBACK');
                    return reject('Failed to assign job');
                  }
                  db.run('COMMIT');
                  resolve({
                    jobID: job.jobID,
                    description: job.description,
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

function completeJob(jobID, userID, reward) {
  return new Promise((resolve, reject) => {
    if (!jobID || !userID || !reward) return reject('Missing required parameters');
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.get(
        `SELECT 1 FROM job_assignees WHERE jobID = ? AND userID = ?`,
        [jobID, userID],
        (err, row) => {
          if (err) {
            db.run('ROLLBACK');
            return reject('Database error while checking job assignment');
          }
          if (!row) {
            db.run('ROLLBACK');
            return resolve({ notAssigned: true });
          }
          db.run(
            `DELETE FROM job_assignees WHERE jobID = ? AND userID = ?`,
            [jobID, userID],
            (err2) => {
              if (err2) {
                db.run('ROLLBACK');
                return reject('Failed to remove job assignment');
              }
              db.run(
                `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
                [reward, userID],
                (err3) => {
                  if (err3) {
                    db.run('ROLLBACK');
                    return reject('Failed to add reward');
                  }
                  db.run('COMMIT');
                  resolve({ success: true });
                }
              );
            }
          );
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
      (err, rows) => {
        if (err) {
          console.error('Error retrieving shop items:', err);
          return reject('🚫 Shop is currently unavailable. Please try again later.');
        }
        resolve(rows || []);
      }
    );
  });
}

function getShopItemByName(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM items WHERE name = ? AND isAvailable = 1`,
      [name],
      (err, row) => {
        if (err) {
          console.error(`Error looking up item "${name}":`, err);
          return reject('🚫 Unable to retrieve item information. Please try again.');
        } else if (!row) {
          return reject(`🚫 The item "${name}" is not available in the shop.`);
        } else {
          resolve(row);
        }
      }
    );
  });
}

function addShopItem(price, name, description) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO items (price, name, description, isAvailable) VALUES (?, ?, ?, 1)`,
      [price, name, description],
      (err) => {
        if (err) {
          console.error('Error adding new shop item:', err);
          return reject('🚫 Failed to add the item to the shop. Please try again.');
        }
        resolve();
      }
    );
  });
}

function removeShopItem(name) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE items SET isAvailable = 0 WHERE name = ?`,
      [name],
      (err) => {
        if (err) {
          console.error(`Error removing item "${name}" from the shop:`, err);
          return reject('🚫 Failed to remove the item from the shop. Please try again.');
        }
        resolve();
      }
    );
  });
}

function getInventory(userID) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT i.name, i.description, inv.quantity
       FROM inventory inv
       JOIN items i ON inv.itemID = i.itemID
       WHERE inv.userID = ?`,
      [userID],
      (err, rows) => {
        if (err) {
          console.error(`Error retrieving inventory for user ${userID}:`, err);
          return reject('🚫 Failed to retrieve inventory. Please try again later.');
        }
        resolve(rows || []);
      }
    );
  });
}

/**
 * Add (or increment) an item in the user's inventory.
 * If no record exists, a new row is inserted.
 */
function addItemToInventory(userID, itemID, quantity = 1) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`,
      [userID, itemID],
      (err, row) => {
        if (err) {
          console.error('Error finding existing inventory row:', err);
          return reject(new Error('Failed to find existing inventory.'));
        }
        if (!row) {
          db.run(
            `INSERT INTO inventory (userID, itemID, quantity) VALUES (?, ?, ?)`,
            [userID, itemID, quantity],
            (insertErr) => {
              if (insertErr) {
                console.error('Error inserting new inventory row:', insertErr);
                return reject(new Error('Failed to add item to inventory.'));
              }
              resolve();
            }
          );
        } else {
          const newQuantity = row.quantity + quantity;
          db.run(
            `UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`,
            [newQuantity, userID, itemID],
            (updateErr) => {
              if (updateErr) {
                console.error('Error updating inventory quantity:', updateErr);
                return reject(new Error('Failed to update inventory quantity.'));
              }
              resolve();
            }
          );
        }
      }
    );
  });
}

function redeemItem(userID, itemName) {
  return new Promise((resolve, reject) => {
    const findItemQuery = `SELECT itemID, name FROM items WHERE name = ? AND isAvailable = 1`;
    db.get(findItemQuery, [itemName], (err, itemRow) => {
      if (err) {
        console.error('Database error in redeemItem (item lookup):', err);
        return reject('🚫 Database error. Please try again.');
      }
      if (!itemRow) {
        return reject(`🚫 The item "${itemName}" does not exist or is not available.`);
      }
      const { itemID } = itemRow;
      const findInventoryQuery = `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`;
      db.get(findInventoryQuery, [userID, itemID], (invErr, invRow) => {
        if (invErr) {
          console.error('Database error in redeemItem (inventory lookup):', invErr);
          return reject('🚫 Database error. Please try again.');
        }
        if (!invRow || invRow.quantity <= 0) {
          return reject(`🚫 You do not own any "${itemName}" to redeem!`);
        }
        if (invRow.quantity === 1) {
          const deleteQuery = `DELETE FROM inventory WHERE userID = ? AND itemID = ?`;
          db.run(deleteQuery, [userID, itemID], (deleteErr) => {
            if (deleteErr) {
              console.error('Database error in redeemItem (inventory delete):', deleteErr);
              return reject('🚫 Failed to update your inventory.');
            }
            resolve(`✅ You have successfully used (and removed) your last "${itemName}".`);
          });
        } else {
          const updateQuery = `UPDATE inventory SET quantity = quantity - 1 WHERE userID = ? AND itemID = ?`;
          db.run(updateQuery, [userID, itemID], (updateErr) => {
            if (updateErr) {
              console.error('Database error in redeemItem (inventory update):', updateErr);
              return reject('🚫 Failed to update your inventory.');
            }
            resolve(`✅ You have successfully used one "${itemName}". You now have ${invRow.quantity - 1} left.`);
          });
        }
      });
    });
  });
}

// =========================================================================
// Blackjack Functions
// =========================================================================

async function getActiveGames(userID) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM blackjack_games WHERE userID = ? AND status = 'active'`,
      [userID],
      (err, rows) => {
        if (err) return reject('Failed to retrieve active games.');
        resolve(rows || []);
      }
    );
  });
}

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

async function blackjackHit(gameID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT playerHand FROM blackjack_games WHERE gameID = ? AND status = 'active'`,
      [gameID],
      (err, row) => {
        if (err || !row) {
          return reject('Failed to retrieve the game.');
        }
        const playerHand = JSON.parse(row.playerHand || '[]');
        const newCard = drawCard();
        playerHand.push(newCard);
        const playerTotal = calculateHandTotal(playerHand);
        const status = playerTotal > 21 ? 'dealer_win' : 'active';
        db.run(
          `UPDATE blackjack_games SET playerHand = ?, status = ? WHERE gameID = ?`,
          [JSON.stringify(playerHand), status, gameID],
          (updateErr) => {
            if (updateErr) {
              return reject('Failed to update the game after hit.');
            }
            resolve({ playerHand, newCard, status });
          }
        );
      }
    );
  });
}

function drawCard() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const value = values[Math.floor(Math.random() * values.length)];
  const suit = suits[Math.floor(Math.random() * suits.length)];
  return { value, suit };
}

function calculateHandTotal(hand) {
  if (!Array.isArray(hand)) return 0;
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (!card || !card.value) continue;
    if (card.value === 'A') {
      aces++;
    } else if (['K', 'Q', 'J'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value, 10);
    }
  }
  for (let i = 0; i < aces; i++) {
    total += (total + 11 > 21 ? 1 : 11);
  }
  return total;
}

async function blackjackStand(gameID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT userID, playerHand, dealerHand, bet FROM blackjack_games WHERE gameID = ? AND status = 'active'`,
      [gameID],
      (err, row) => {
        if (err || !row) {
          return reject('Failed to retrieve the game.');
        }
        const { userID, bet } = row;
        const playerHand = JSON.parse(row.playerHand || '[]');
        let dealerHand = JSON.parse(row.dealerHand || '[]');
        const playerTotal = calculateHandTotal(playerHand);
        let dealerTotal = calculateHandTotal(dealerHand);
        while (dealerTotal < 17) {
          const newCard = drawCard();
          dealerHand.push(newCard);
          dealerTotal = calculateHandTotal(dealerHand);
        }
        let status;
        let winnings = 0;
        if (playerTotal > 21) {
          status = 'dealer_win';
        } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
          status = 'player_win';
          winnings = bet * 2;
        } else if (playerTotal < dealerTotal) {
          status = 'dealer_win';
        } else {
          status = 'draw';
          winnings = bet;
        }
        db.serialize(() => {
          db.run(
            `UPDATE blackjack_games SET dealerHand = ?, status = ? WHERE gameID = ?`,
            [JSON.stringify(dealerHand), status, gameID],
            (updateErr) => {
              if (updateErr) {
                return reject('Failed to update game status.');
              }
              if (winnings > 0) {
                db.run(
                  `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
                  [winnings, userID],
                  (walletErr) => {
                    if (walletErr) {
                      return reject('Failed to update wallet balance.');
                    }
                    resolve({ status, playerHand, dealerHand, playerTotal, dealerTotal, winnings });
                  }
                );
              } else {
                resolve({ status, playerHand, dealerHand, playerTotal, dealerTotal, winnings });
              }
            }
          );
        });
      }
    );
  });
}

// =========================================================================
// Exports
// =========================================================================
module.exports = {
  // Raw SQLite instance (if needed)
  db,

  // Admin / Economy
  addAdmin,
  removeAdmin,
  getAdmins,
  initUserEconomy,
  getBalances,
  updateWallet,
  transferFromWallet,
  robUser,
  withdraw,
  deposit,

  // Blackjack
  getActiveGames,
  startBlackjackGame,
  blackjackHit,
  blackjackStand,
  drawCard,
  calculateHandTotal,

  // Shop
  getShopItems,
  getShopItemByName,
  addShopItem,
  removeShopItem,
  getInventory,
  addItemToInventory,
  redeemItem,

  // Jobs
  addJob,
  getJobList,
  assignRandomJob,
  completeJob,
};
