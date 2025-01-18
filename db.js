const SQLite = require('sqlite3').verbose();

const db = new SQLite.Database('./economy.db', (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Blackjack table
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

db.serialize(() => {
  // economy table with wallet and bank columns
  db.run(`
    CREATE TABLE IF NOT EXISTS economy (
      userID TEXT PRIMARY KEY,
      wallet INTEGER DEFAULT 0,
      bank INTEGER DEFAULT 0
    )
  `);

  // items available in shop
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      itemID INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,
      price INTEGER,
      isAvailable BOOLEAN DEFAULT 1
    )
  `);

  // user inventory: items owned and their quantity
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      userID TEXT,
      itemID INTEGER,
      quantity INTEGER DEFAULT 1,
      PRIMARY KEY(userID, itemID),
      FOREIGN KEY(itemID) REFERENCES items(itemID)
    )
  `);

  // administrators for bot-specific commands
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      userID TEXT PRIMARY KEY
    )
  `);

  // Jobs
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

  // Blackjack games table
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

  // Virtual Pets table
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
});

// =========================================================================
// Helper Functions
// =========================================================================

/**
 * Ensures that a row for the user exists in the economy table.
 */
function initUserEconomy(userID) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO economy (userID, wallet, bank) VALUES (?, 0, 0)`,
      [userID],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

/**
 * Creates a new deck of cards and shuffles it.
 */
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  // Shuffle the deck using the Fisher–Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Draws a card from the deck.
 */
function drawCard(deck) {
  return deck.pop();
}

/**
 * Calculates the total of a blackjack hand.
 */
function calculateHand(hand) {
  let sum = 0;
  let aces = 0;
  hand.forEach(card => {
    if (card.value === 'A') {
      aces++;
      sum += 11;
    } else if (['K', 'Q', 'J'].includes(card.value)) {
      sum += 10;
    } else {
      sum += parseInt(card.value);
    }
  });
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces--;
  }
  return sum;
}

/**
 * Retrieves a pet by petID.
 */
function getPetByID(petID) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM pets WHERE petID = ?`, [petID], (err, pet) => {
      if (err) return reject(err);
      resolve(pet);
    });
  });
}

// =========================================================================
// Bank & Wallet Functions
// =========================================================================

async function getBalances(userID) {
  await initUserEconomy(userID);
  return new Promise((resolve, reject) => {
    db.get(`SELECT wallet, bank FROM economy WHERE userID = ?`, [userID], (err, row) => {
      if (err) return reject('Failed to get balances.');
      if (!row) return resolve({ wallet: 0, bank: 0 });
      resolve({ wallet: row.wallet, bank: row.bank });
    });
  });
}

function updateWallet(userID, amount) {
  return new Promise(async (resolve, reject) => {
    try {
      await initUserEconomy(userID);
    } catch (err) {
      return reject(err);
    }
    db.run(`UPDATE economy SET wallet = wallet + ? WHERE userID = ?`, [amount, userID], (err2) => {
      if (err2) return reject('Error updating wallet.');
      resolve();
    });
  });
}

function updateBank(userID, amount) {
  return new Promise(async (resolve, reject) => {
    try {
      await initUserEconomy(userID);
    } catch (err) {
      return reject(err);
    }
    db.run(`UPDATE economy SET bank = bank + ? WHERE userID = ?`, [amount, userID], (err2) => {
      if (err2) return reject('Error updating bank.');
      resolve();
    });
  });
}

async function deposit(userID, amount) {
  const { wallet } = await getBalances(userID);
  if (wallet < amount) {
    throw `Not enough in wallet (you have ${wallet}).`;
  }
  await updateWallet(userID, -amount);
  await updateBank(userID, amount);
}

async function withdraw(userID, amount) {
  const { bank } = await getBalances(userID);
  if (bank < amount) {
    throw `Not enough in bank (you have ${bank}).`;
  }
  await updateBank(userID, -amount);
  await updateWallet(userID, amount);
}

// =========================================================================
// Blackjack Functions
// =========================================================================

async function startBlackjackGame(userID, bet) {
  try {
    const { wallet } = await getBalances(userID);
    if (wallet < bet) throw `Not enough money in wallet for the bet`;

    await updateWallet(userID, -bet);

    const deck = createDeck();
    const playerHand = [drawCard(deck), drawCard(deck)];
    const dealerHand = [drawCard(deck)]; // Dealer's second card remains hidden initially

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO blackjack_games (userID, bet, playerHand, dealerHand) 
         VALUES (?, ?, ?, ?)`,
        [userID, bet, JSON.stringify(playerHand), JSON.stringify(dealerHand)],
        function (err) {
          if (err) return reject(err);
          resolve({ gameID: this.lastID, playerHand, dealerHand, bet });
        }
      );
    });
  } catch (err) {
    throw err;
  }
}

function getBlackjackGame(gameID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM blackjack_games WHERE gameID = ?`,
      [gameID],
      (err, game) => {
        if (err) return reject(err);
        if (!game) return resolve(null);

        game.playerHand = JSON.parse(game.playerHand);
        game.dealerHand = JSON.parse(game.dealerHand);
        resolve(game);
      }
    );
  });
}

async function blackjackHit(gameID) {
  const game = await getBlackjackGame(gameID);
  if (!game || game.status !== 'active') throw `No active game found`;

  const deck = createDeck();
  const newCard = drawCard(deck);
  game.playerHand.push(newCard);

  const playerTotal = calculateHand(game.playerHand);
  const status = playerTotal > 21 ? 'dealer_win' : 'active';

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE blackjack_games 
       SET playerHand = ?, status = ?
       WHERE gameID = ?`,
      [JSON.stringify(game.playerHand), status, gameID],
      (err) => {
        if (err) return reject(err);
        resolve({ newCard, playerHand: game.playerHand, status });
      }
    );
  });
}

async function blackjackStand(gameID) {
  const game = await getBlackjackGame(gameID);
  if (!game || game.status !== 'active') throw `No active game found`;

  const deck = createDeck();
  while (calculateHand(game.dealerHand) < 17) {
    game.dealerHand.push(drawCard(deck));
  }

  const playerTotal = calculateHand(game.playerHand);
  const dealerTotal = calculateHand(game.dealerHand);

  let status;
  if (dealerTotal > 21 || playerTotal > dealerTotal) {
    status = 'player_win';
    await updateWallet(game.userID, game.bet * 2);
  } else if (dealerTotal > playerTotal) {
    status = 'dealer_win';
  } else {
    status = 'push';
    await updateWallet(game.userID, game.bet);
  }

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE blackjack_games 
       SET dealerHand = ?, status = ?
       WHERE gameID = ?`,
      [JSON.stringify(game.dealerHand), status, gameID],
      (err) => {
        if (err) return reject(err);
        resolve({ dealerHand: game.dealerHand, status });
      }
    );
  });
}



// =========================================================================
// Virtual Pets Functions
// =========================================================================

function createPet(userID, name, type) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO pets (userID, name, type)
       VALUES (?, ?, ?)`,
      [userID, name, type],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function getPet(userID, name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM pets WHERE userID = ? AND name = ?`,
      [userID, name],
      (err, pet) => {
        if (err) return reject(err);
        resolve(pet);
      }
    );
  });
}

async function battlePets(pet1ID, pet2ID, betAmount) {
  const [pet1, pet2] = await Promise.all([
    getPetByID(pet1ID),
    getPetByID(pet2ID)
  ]);
  
  if (!pet1 || !pet2) {
    throw 'Invalid pets for battle';
  }
  
  // Calculate battle power based on level, type advantages, and some randomness
  const BASE_POWER = 100;
  const typeMultipliers = {
    dragon: { phoenix: 1.2, griffin: 0.8, unicorn: 1 },
    phoenix: { griffin: 1.2, unicorn: 0.8, dragon: 1 },
    griffin: { unicorn: 1.2, dragon: 0.8, phoenix: 1 },
    unicorn: { dragon: 1.2, phoenix: 0.8, griffin: 1 }
  };
  
  const pet1Power = BASE_POWER * pet1.level * 
    (typeMultipliers[pet1.type]?.[pet2.type] || 1) * 
    (0.8 + Math.random() * 0.4);
    
  const pet2Power = BASE_POWER * pet2.level * 
    (typeMultipliers[pet2.type]?.[pet1.type] || 1) * 
    (0.8 + Math.random() * 0.4);
  
  const pet1Wins = pet1Power > pet2Power;
  
  // Update stats for both pets
  await Promise.all([
    updatePetStats(pet1ID, pet1Wins, betAmount),
    updatePetStats(pet2ID, !pet1Wins, betAmount)
  ]);
  
  return {
    winner: pet1Wins ? pet1 : pet2,
    loser: pet1Wins ? pet2 : pet1,
    winnerPower: pet1Wins ? pet1Power : pet2Power,
    loserPower: pet1Wins ? pet2Power : pet1Power
  };
}

function getUserPets(userID) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM pets 
       WHERE userID = ? 
       ORDER BY name ASC`,
      [userID],
      (err, pets) => {
        if (err) return reject('Error retrieving pets');
        resolve(pets || []);
      }
    );
  });
}

function updatePetStats(petID, won, reward) {
  return new Promise((resolve, reject) => {
    const expGain = won ? 10 : 5;
    db.run(
      `UPDATE pets 
       SET wins = wins + ?, 
           losses = losses + ?,
           exp = exp + ?,
           level = CASE 
             WHEN exp + ? >= level * 100 THEN level + 1 
             ELSE level 
           END,
           lastBattle = CURRENT_TIMESTAMP
       WHERE petID = ?`,
      [won ? 1 : 0, won ? 0 : 1, expGain, expGain, petID],
      async function (err) {
        if (err) return reject(err);
        if (won && reward > 0) {
          try {
            const pet = await getPetByID(petID);
            await updateWallet(pet.userID, reward * 2);
          } catch (e) {
            return reject(e);
          }
        }
        resolve();
      }
    );
  });
}

// =========================================================================
// Rob & Transfer Functions
// =========================================================================

/**
 * Attempt to rob a target.
 * - 50% chance of success.
 * - If successful: steals 10-40% of target's wallet.
 * - If failed: 25% penalty of the calculated amount is transferred from robber to target.
 */
async function robUser(robberID, targetID) {
  await initUserEconomy(robberID);
  await initUserEconomy(targetID);
  const { wallet: targetWallet } = await getBalances(targetID);
  if (targetWallet <= 0) {
    return { success: false, message: 'Target has 0 in wallet.' };
  }

  const successChance = 0.5;
  const success = Math.random() < successChance;

  // 10-40% of target's wallet
  const percent = 0.1 + Math.random() * 0.3;
  const amount = Math.floor(targetWallet * percent);

  if (success) {
    // Robber wins: transfer funds from target
    await updateWallet(targetID, -amount);
    await updateWallet(robberID, amount);
    return { success: true, outcome: 'success', amountStolen: amount };
  } else {
    // Robber fails: pay a penalty of 25% of the stolen amount to target
    const penalty = Math.floor(amount * 0.25);
    const { wallet: robberWallet } = await getBalances(robberID);
    if (penalty > 0 && robberWallet >= penalty) {
      await updateWallet(robberID, -penalty);
      await updateWallet(targetID, penalty);
    }
    return { success: true, outcome: 'fail', penalty };
  }
}

async function transferFromWallet(fromID, toID, amount) {
  if (amount <= 0) throw 'Amount must be positive.';
  const { wallet } = await getBalances(fromID);
  if (wallet < amount) {
    throw `You only have ${wallet} in your wallet.`;
  }
  await updateWallet(fromID, -amount);
  await updateWallet(toID, amount);
}

// =========================================================================
// Leaderboard Functions
// =========================================================================

function getLeaderboard() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT userID, wallet, bank FROM economy ORDER BY (wallet + bank) DESC LIMIT 10`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

// =========================================================================
// Shop & Inventory Functions
// =========================================================================

function getShopItems() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM items WHERE isAvailable = 1`, [], (err, rows) => {
      if (err) return reject('Error retrieving shop items.');
      resolve(rows || []);
    });
  });
}

function getShopItemByName(name) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM items WHERE name = ? AND isAvailable = 1`, [name], (err, row) => {
      if (err) return reject('Error retrieving item by name.');
      resolve(row || null);
    });
  });
}

function addShopItem(price, name, description) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO items (price, name, description) VALUES (?, ?, ?)`,
      [price, name, description],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function removeShopItem(name) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM items WHERE name = ?`, [name], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function addItemToInventory(userID, itemID, quantity = 1) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO inventory (userID, itemID, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(userID, itemID)
      DO UPDATE SET quantity = quantity + ?
      `,
      [userID, itemID, quantity, quantity],
      (err) => {
        if (err) return reject('Error adding item.');
        resolve();
      }
    );
  });
}

function getInventory(userID) {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT items.name, inventory.quantity
      FROM inventory
      INNER JOIN items ON inventory.itemID = items.itemID
      WHERE inventory.userID = ?
      `,
      [userID],
      (err, rows) => {
        if (err) return reject('Error retrieving inventory.');
        resolve(rows || []);
      }
    );
  });
}

function transferItem(fromUserID, toUserID, itemName, qty) {
  return new Promise((resolve, reject) => {
    if (qty <= 0) {
      return reject('Quantity must be positive.');
    }
    db.get(`SELECT itemID FROM items WHERE name = ? AND isAvailable = 1`, [itemName], (err, itemRow) => {
      if (err) return reject('Error looking up item.');
      if (!itemRow) return reject(`Item "${itemName}" not available.`);

      const itemID = itemRow.itemID;
      db.get(
        `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`,
        [fromUserID, itemID],
        (err2, row2) => {
          if (err2) return reject('Error checking sender inventory.');
          if (!row2 || row2.quantity < qty) {
            return reject(`You don't have enough of "${itemName}".`);
          }

          // Subtract from sender
          const newQty = row2.quantity - qty;
          if (newQty > 0) {
            db.run(
              `UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`,
              [newQty, fromUserID, itemID],
              (err3) => {
                if (err3) return reject('Error updating inventory.');
                addToRecipient();
              }
            );
          } else {
            db.run(
              `DELETE FROM inventory WHERE userID = ? AND itemID = ?`,
              [fromUserID, itemID],
              (err3) => {
                if (err3) return reject('Error removing item.');
                addToRecipient();
              }
            );
          }

          function addToRecipient() {
            db.run(
              `
              INSERT INTO inventory (userID, itemID, quantity)
              VALUES (?, ?, ?)
              ON CONFLICT(userID, itemID)
              DO UPDATE SET quantity = quantity + ?
              `,
              [toUserID, itemID, qty, qty],
              (err4) => {
                if (err4) return reject('Error adding to recipient inventory.');
                resolve();
              }
            );
          }
        }
      );
    });
  });
}

function redeemItem(userID, itemName) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT itemID FROM items WHERE name = ?`, [itemName], (err, itemRow) => {
      if (err) return reject('Error looking up item.');
      if (!itemRow) return reject(`Item "${itemName}" does not exist.`);

      const itemID = itemRow.itemID;
      db.get(`SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`, [userID, itemID], (err2, row2) => {
        if (err2) return reject('Error retrieving inventory.');
        if (!row2 || row2.quantity < 1) {
          return reject(`No "${itemName}" to redeem.`);
        }

        const newQty = row2.quantity - 1;
        if (newQty > 0) {
          db.run(
            `UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`,
            [newQty, userID, itemID],
            (err3) => {
              if (err3) return reject('Redeem failed.');
              resolve(true);
            }
          );
        } else {
          db.run(
            `DELETE FROM inventory WHERE userID = ? AND itemID = ?`,
            [userID, itemID],
            (err3) => {
              if (err3) return reject('Redeem failed.');
              resolve(true);
            }
          );
        }
      });
    });
  });
}

// =========================================================================
// Multi-Assignee Jobs Functions
// =========================================================================

function addJob(description) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO joblist (description) VALUES (?)`, [description], (err) => {
      if (err) return reject('Failed to add job.');
      resolve();
    });
  });
}

function getJobList() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT jobID, description FROM joblist`, [], (err, jobs) => {
      if (err) return reject('Error retrieving jobs.');
      if (!jobs || !jobs.length) return resolve([]);

      const jobIDs = jobs.map(j => j.jobID);
      db.all(
        `SELECT jobID, userID FROM job_assignees WHERE jobID IN (${jobIDs.map(() => '?').join(',')})`,
        jobIDs,
        (err2, assignedRows) => {
          if (err2) return reject('Error retrieving assignees.');
          const map = {};
          (assignedRows || []).forEach(row => {
            if (!map[row.jobID]) map[row.jobID] = [];
            map[row.jobID].push(row.userID);
          });
          const result = jobs.map(j => ({
            jobID: j.jobID,
            description: j.description,
            assignees: map[j.jobID] || []
          }));
          resolve(result);
        }
      );
    });
  });
}

function assignRandomJob(userID) {
  return new Promise((resolve, reject) => {
    // Pick a random job to which the user is not yet assigned.
    db.get(
      `
      SELECT jobID, description
      FROM joblist
      WHERE jobID NOT IN (
        SELECT jobID FROM job_assignees WHERE userID = ?
      )
      ORDER BY RANDOM()
      LIMIT 1
      `,
      [userID],
      (err, row) => {
        if (err) return reject('Error finding a job.');
        if (!row) return resolve(null);
        // Add assignment
        db.run(
          `INSERT INTO job_assignees (jobID, userID) VALUES (?, ?)`,
          [row.jobID, userID],
          (err2) => {
            if (err2) return reject('Error assigning job.');
            resolve(row);
          }
        );
      }
    );
  });
}

function completeJob(jobID, userID, reward) {
  return new Promise((resolve, reject) => {
    // Check if job exists.
    db.get(`SELECT jobID FROM joblist WHERE jobID = ?`, [jobID], (err, job) => {
      if (err) return reject('Error looking up job.');
      if (!job) return resolve(null); // No such job exists.

      // Check if user is assigned to the job.
      db.get(
        `SELECT * FROM job_assignees WHERE jobID = ? AND userID = ?`,
        [jobID, userID],
        async (err2, row2) => {
          if (err2) return reject('Error checking assignment.');
          if (!row2) {
            // User not assigned.
            return resolve({ notAssigned: true });
          }

          // Pay user the specified reward.
          try {
            await updateWallet(userID, reward);
          } catch (err3) {
            return reject('Error paying user.');
          }

          // Remove assignment.
          db.run(
            `DELETE FROM job_assignees WHERE jobID = ? AND userID = ?`,
            [jobID, userID],
            (err4) => {
              if (err4) return reject('Error removing assignment.');
              resolve({ success: true, payAmount: reward });
            }
          );
        }
      );
    });
  });
}

// =========================================================================
// Admin Functions
// =========================================================================

function addAdmin(userID) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO admins (userID) VALUES (?)`, [userID], (err) => {
      if (err) return reject('Failed to add admin.');
      resolve();
    });
  });
}

function removeAdmin(userID) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM admins WHERE userID = ?`, [userID], (err) => {
      if (err) return reject('Failed to remove admin.');
      resolve();
    });
  });
}

function getAdmins() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT userID FROM admins`, [], (err, rows) => {
      if (err) return reject('Failed to retrieve admins.');
      resolve(rows.map(r => r.userID));
    });
  });
}

// =========================================================================
// Export All Functions
// =========================================================================

module.exports = {
  // Bank & Wallet
  getBalances,
  updateWallet,
  updateBank,
  deposit,
  withdraw,

  // Blackjack
  startBlackjackGame,
  getBlackjackGame,
  blackjackHit,
  blackjackStand,

  getActiveGames(userID) {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM blackjack_games WHERE userID = ? AND status = "active"',
        [userID],
        (err, games) => {
          if (err) return reject(err);
          games = games || [];
          games.forEach(game => {
            try {
              game.playerHand = JSON.parse(game.playerHand);
              game.dealerHand = JSON.parse(game.dealerHand);
            } catch (e) {
              game.playerHand = [];
              game.dealerHand = [];
            }
          });
          resolve(games);
        }
      );
    });
  },

  // Virtual Pets
  createPet,
  getPet,
  getUserPets,
  updatePetStats,
  getPetByID,
  battlePets,

  // Rob & Transfer
  robUser,
  transferFromWallet,

  // Leaderboard
  getLeaderboard,

  // Shop & Inventory
  getShopItems,
  getShopItemByName,
  addShopItem,
  removeShopItem,
  addItemToInventory,
  getInventory,
  transferItem,
  redeemItem,

  // Multi-Assignee Jobs
  addJob,
  getJobList,
  assignRandomJob,
  completeJob,

  // Admin
  addAdmin,
  removeAdmin,
  getAdmins
};
// Helper functions (outside module.exports)
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  
  return shuffleDeck(deck);
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawCard() {
  const deck = createDeck(); // Create a fresh deck for each draw
  return deck[Math.floor(Math.random() * deck.length)];
}

function calculateHandTotal(hand) {
  let total = 0;
  let aces = 0;
  
  for (const card of hand) {
    if (card.value === 'A') {
      aces++;
    } else if (['K', 'Q', 'J'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value);
    }
  }
  
  for (let i = 0; i < aces; i++) {
    if (total + 11 <= 21) {
      total += 11;
    } else {
      total += 1;
    }
  }
  
  return total;
}

function formatCard(card) {
  if (!card || !card.value || !card.suit) {
    return '??';
  }
  return `${card.value}${card.suit}`;
}

function formatHand(hand) {
  if (!Array.isArray(hand)) {
    return 'No cards';
  }
  return hand.map(card => formatCard(card)).join(' ');
}

function calculateHandTotal(hand) {
  if (!Array.isArray(hand)) {
    return 0;
  }
  
  let total = 0;
  let aces = 0;
  
  for (const card of hand) {
    if (!card || !card.value) continue;
    
    if (card.value === 'A') {
      aces++;
    } else if (['K', 'Q', 'J'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value) || 0;
    }
  }
  
  for (let i = 0; i < aces; i++) {
    if (total + 11 <= 21) {
      total += 11;
    } else {
      total += 1;
    }
  }
  
  return total;
}