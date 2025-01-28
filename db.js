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

// Add a bot admin
async function addAdmin(userID) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO admins (userID) VALUES (?)`,
      [userID],
      (err) => (err ? reject('Failed to add admin.') : resolve())
    );
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
        const adminIDs = rows.map((row) => row.userID);
        resolve(adminIDs);
      }
    );
  });
}

// Remove a bot admin
async function removeAdmin(userID) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM admins WHERE userID = ?`,
      [userID],
      function (err) {
        if (err) {
          return reject('Failed to remove admin.');
        }
        resolve({ changes: this.changes });
      }
    );
  });
}


// Update wallet balance for a user
async function updateWallet(userID, amount) {
  await initUserEconomy(userID);
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
      [amount, userID],
      function (err) {
        if (err) {
          return reject('Failed to update wallet balance.');
        }
        resolve({ changes: this.changes });
      }
    );
  });
}


// Transfer money from one user's wallet to another user's wallet
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

// Withdraw money from the user's bank to their wallet
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
              if (err) {
                return reject('Failed to process withdrawal.');
              }
              resolve();
            }
          );
        }
      );
    });
  });
}

// Deposit money from wallet to bank
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

// Rob another user's wallet
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

          const isSuccessful = Math.random() < 0.5; // 50% chance of success
          const amountStolen = Math.min(targetWallet, 100); // Limit the max stolen
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
// ==============================
// Pets System
// ==============================


/**
 * Create a new pet for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} name - The name of the pet.
 * @param {string} type - The type of the pet.
 */
async function createPet(userId, name, type) {
  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO pets (userId, name, type, level, exp, wins, losses)
      VALUES (?, ?, ?, 1, 0, 0, 0)
    `;
    db.run(query, [userId, name, type], function (err) {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Retrieve all pets for a user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<Array>} - Array of pets owned by the user.
 */
async function getUserPets(userId) {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM pets WHERE userId = ?`;
    db.all(query, [userId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/**
 * Retrieve a specific pet by userId and name.
 * @param {string} userId - The ID of the user.
 * @param {string} name - The name of the pet.
 * @returns {Promise<Object>} - The pet object.
 */
async function getPet(userId, name) {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM pets WHERE userId = ? AND name = ?`;
    db.get(query, [userId, name], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

/**
 * Battle two pets and update their stats.
 * @param {number} pet1Id - The ID of the first pet.
 * @param {number} pet2Id - The ID of the second pet.
 * @param {number} bet - The bet amount.
 * @returns {Promise<Object>} - Battle result with winner and loser.
 */
async function battlePets(pet1Id, pet2Id, bet) {
  return new Promise(async (resolve, reject) => {
    try {
      const pet1 = await getPetById(pet1Id);
      const pet2 = await getPetById(pet2Id);

      const pet1Power = pet1.level * Math.random();
      const pet2Power = pet2.level * Math.random();

      const winner = pet1Power > pet2Power ? pet1 : pet2;
      const loser = pet1Power > pet2Power ? pet2 : pet1;

      // Update winner and loser stats
      db.serialize(() => {
        db.run(`UPDATE pets SET wins = wins + 1, exp = exp + 10 WHERE petID = ?`, [winner.petID]);
        db.run(`UPDATE pets SET losses = losses + 1 WHERE petID = ?`, [loser.petID]);
      });

      resolve({
        winner,
        loser,
        winnerPower: pet1Power > pet2Power ? pet1Power : pet2Power,
        loserPower: pet1Power > pet2Power ? pet2Power : pet1Power,
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Helper function to get a pet by its ID.
 * @param {number} petId - The pet's ID.
 * @returns {Promise<Object>} - The pet object.
 */
async function getPetById(petId) {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM pets WHERE petID = ?`;
    db.get(query, [petId], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}


// =========================================================================
// Job System
// =========================================================================

// Add a new job to the job list
function addJob(description) {
  return new Promise((resolve, reject) => {
    if (!description || typeof description !== 'string') {
      return reject('Invalid job description');
    }

    db.run(
      `INSERT INTO joblist (description) VALUES (?)`,
      [description],
      function (err) {
        if (err) {
          return reject('Failed to add job');
        }
        resolve({ 
          jobID: this.lastID, 
          description 
        });
      }
    );
  });
}

// Get the list of all jobs with their assignees
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
        if (err) {
          return reject('Failed to retrieve job list');
        }
        
        const jobs = rows.map(row => ({
          jobID: row.jobID,
          description: row.description,
          assignees: row.assignees ? row.assignees.split(',') : []
        }));
        
        resolve(jobs);
      }
    );
  });
}

// Assign a random job to a user
function assignRandomJob(userID) {
  return new Promise((resolve, reject) => {
    if (!userID) {
      return reject('Invalid user ID');
    }

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // First check current assignments
      db.get(
        `SELECT COUNT(*) as count FROM job_assignees WHERE userID = ?`,
        [userID],
        (err, result) => {
          if (err) {
            db.run('ROLLBACK');
            return reject('Failed to check existing assignments');
          }

          // Get an unassigned job
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

              // Assign the job
              db.run(
                `INSERT INTO job_assignees (jobID, userID) VALUES (?, ?)`,
                [job.jobID, userID],
                (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    return reject('Failed to assign job');
                  }

                  db.run('COMMIT');
                  resolve({
                    jobID: job.jobID,
                    description: job.description
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

// Complete a job and reward the user
function completeJob(jobID, userID, reward) {
  return new Promise((resolve, reject) => {
    if (!jobID || !userID || !reward) {
      return reject('Missing required parameters');
    }

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

          // Remove the job assignment
          db.run(
            `DELETE FROM job_assignees WHERE jobID = ? AND userID = ?`,
            [jobID, userID],
            (err) => {
              if (err) {
                db.run('ROLLBACK');
                return reject('Failed to remove job assignment');
              }

              // Add the reward
              db.run(
                `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
                [reward, userID],
                (err) => {
                  if (err) {
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

/**
 * Get all available shop items.
 * @returns {Promise<Array>} - Resolves with an array of available items.
 */
function getShopItems() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM items WHERE isAvailable = 1`,
      [],
      (err, rows) => {
        if (err) {
          console.error('Error retrieving shop items:', err);
          reject('🚫 Shop is currently unavailable. Please try again later.');
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

/**
 * Get a specific shop item by name.
 * @param {string} name - The name of the item to retrieve.
 * @returns {Promise<Object>} - Resolves with the item details.
 */
function getShopItemByName(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM items WHERE name = ? AND isAvailable = 1`,
      [name],
      (err, row) => {
        if (err) {
          console.error(`Error looking up item "${name}":`, err);
          reject('🚫 Unable to retrieve item information. Please try again.');
        } else if (!row) {
          reject(`🚫 The item "${name}" is not available in the shop.`);
        } else {
          resolve(row);
        }
      }
    );
  });
}

/**
 * Add a new item to the shop.
 * @param {number} price - The price of the item.
 * @param {string} name - The name of the item.
 * @param {string} description - A description of the item.
 * @returns {Promise<void>} - Resolves when the item is added.
 */
function addShopItem(price, name, description) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO items (price, name, description, isAvailable) VALUES (?, ?, ?, 1)`,
      [price, name, description],
      (err) => {
        if (err) {
          console.error('Error adding new shop item:', err);
          reject('🚫 Failed to add the item to the shop. Please try again.');
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Remove an item from the shop by name.
 * @param {string} name - The name of the item to remove.
 * @returns {Promise<void>} - Resolves when the item is removed.
 */
function removeShopItem(name) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE items SET isAvailable = 0 WHERE name = ?`,
      [name],
      (err) => {
        if (err) {
          console.error(`Error removing item "${name}" from the shop:`, err);
          reject('🚫 Failed to remove the item from the shop. Please try again.');
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Get the inventory for a user.
 * @param {string} userId - The user's ID.
 * @returns {Promise<Array>} - Resolves with an array of inventory items.
 */
function getInventory(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT i.name, i.description, inv.quantity
       FROM inventory inv
       JOIN items i ON inv.itemID = i.itemID
       WHERE inv.userId = ?`,
      [userId],
      (err, rows) => {
        if (err) {
          console.error(`Error retrieving inventory for user ${userId}:`, err);
          reject('🚫 Failed to retrieve inventory. Please try again later.');
        } else {
          resolve(rows || []);
        }
      }
    );
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

// Perform a "hit" action
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

            resolve({
              playerHand,
              newCard,
              status,
            });
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
    total += total + 11 > 21 ? 1 : 11;
  }

  return total;
}

// Perform a "stand" action
async function blackjackStand(gameID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT playerHand, dealerHand, bet FROM blackjack_games WHERE gameID = ? AND status = 'active'`,
      [gameID],
      (err, row) => {
        if (err || !row) {
          return reject('Failed to retrieve the game.');
        }

        const playerHand = JSON.parse(row.playerHand || '[]');
        let dealerHand = JSON.parse(row.dealerHand || '[]');
        const bet = row.bet;

        const playerTotal = calculateHandTotal(playerHand);
        let dealerTotal = calculateHandTotal(dealerHand);

        // Dealer logic: draw cards until total is at least 17
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
          winnings = bet; // Return bet in case of a draw
        }

        // Update the game and player balance
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
                  `UPDATE economy SET wallet = wallet + ? WHERE userID = (SELECT userID FROM blackjack_games WHERE gameID = ?)`,
                  [winnings, gameID],
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
  db,
  addAdmin,
  removeAdmin,
  updateWallet,
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
  drawCard,
  calculateHandTotal,
  getShopItems,
  createPet,
  getUserPets,
  getPet,
  battlePets,
  getShopItemByName,
  addShopItem,
  removeShopItem,
  getInventory,
  addJob,
  getJobList,
  assignRandomJob,
  completeJob,
};