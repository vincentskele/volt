const SQLite = require('sqlite3').verbose();

const db = new SQLite.Database('./economy.db', (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create tables if they don't exist
db.serialize(() => {
  // economy: now has wallet + bank
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

  // joblist: multi-assignee approach
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
      PRIMARY KEY(jobID, userID),
      FOREIGN KEY(jobID) REFERENCES joblist(jobID)
    )
  `);
});

/** Helper to ensure row in economy table. */
function initUserEconomy(userID) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT OR IGNORE INTO economy (userID, wallet, bank) VALUES (?, 0, 0)`, [userID], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = {
  /**
   * -------------------------
   * BANK & WALLET Functions
   * -------------------------
   */
  // Return { wallet, bank }
  getBalances(userID) {
    return new Promise(async (resolve, reject) => {
      try {
        await initUserEconomy(userID);
      } catch (e) {
        return reject('Failed to init user economy.');
      }
      db.get(`SELECT wallet, bank FROM economy WHERE userID = ?`, [userID], (err, row) => {
        if (err) return reject('Error retrieving balances.');
        if (!row) return resolve({ wallet: 0, bank: 0 });
        resolve({ wallet: row.wallet, bank: row.bank });
      });
    });
  },

  // Directly update the wallet by some amount (can be negative)
  updateWallet(userID, amount) {
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
  },

  // deposit: move from wallet -> bank
  async deposit(userID, amount) {
    const { wallet } = await this.getBalances(userID);
    if (wallet < amount) {
      throw `You only have ${wallet} in your wallet.`;
    }
    await this.updateWallet(userID, -amount);
    await this.updateBank(userID, amount);
  },

  // withdraw: move from bank -> wallet
  async withdraw(userID, amount) {
    const { bank } = await this.getBalances(userID);
    if (bank < amount) {
      throw `You only have ${bank} in your bank.`;
    }
    await this.updateBank(userID, -amount);
    await this.updateWallet(userID, amount);
  },

  // Directly update bank by some amount (can be negative)
  updateBank(userID, amount) {
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
  },

  /**
   * ROB Function
   *  - 50% chance success
   *  - If success, robber steals random portion (10-40%) of target's wallet
   *  - If fail, robber pays a 25% penalty of that portion to the target
   */
  async robUser(robberID, targetID) {
    // 1) Make sure both exist
    await initUserEconomy(robberID);
    await initUserEconomy(targetID);

    // 2) Check target's wallet
    const { wallet: targetWallet } = await this.getBalances(targetID);
    if (targetWallet <= 0) {
      return { success: false, message: 'They have no money in their wallet.' };
    }

    // 3) Roll success/fail
    const successChance = 0.5; // 50%
    const isSuccess = Math.random() < successChance;

    // 4) Determine how much they'd attempt to steal—say 10% to 40% of target wallet
    const minPercent = 0.1;
    const maxPercent = 0.4;
    const stealPercent = Math.random() * (maxPercent - minPercent) + minPercent;
    const amount = Math.floor(targetWallet * stealPercent);

    if (isSuccess) {
      // Succeed: robber gains 'amount' from target's wallet
      await this.updateWallet(targetID, -amount);
      await this.updateWallet(robberID, amount);
      return {
        success: true,
        outcome: 'success',
        amountStolen: amount,
      };
    } else {
      // Fail: robber pays 25% of that 'amount' as penalty to target
      const penalty = Math.floor(amount * 0.25);
      // Check robber's wallet
      const { wallet: robberWallet } = await this.getBalances(robberID);
      if (penalty > 0 && robberWallet >= penalty) {
        await this.updateWallet(robberID, -penalty);
        await this.updateWallet(targetID, penalty);
      }
      return {
        success: true,
        outcome: 'fail',
        penalty,
      };
    }
  },

  /**
   * Transfer from one user's wallet to another user's wallet
   */
  async transferFromWallet(fromID, toID, amount) {
    if (amount <= 0) throw 'Amount must be positive.';
    // fromID must have enough in wallet
    const { wallet } = await this.getBalances(fromID);
    if (wallet < amount) {
      throw `You only have ${wallet} in your wallet.`;
    }
    // subtract from fromID
    await this.updateWallet(fromID, -amount);
    // add to toID
    await this.updateWallet(toID, amount);
  },

  /**
   * -------------------------
   * Leaderboard
   * -------------------------
   */
  // Now we rank by (wallet + bank) DESC
  getLeaderboard() {
    return new Promise((resolve, reject) => {
      db.all(
        `
        SELECT userID, wallet, bank
        FROM economy
        ORDER BY (wallet + bank) DESC
        LIMIT 10
        `,
        [],
        (err, rows) => {
          if (err) return reject('Failed to retrieve leaderboard.');
          resolve(rows || []);
        }
      );
    });
  },

  /**
   * -------------------------
   * Shop & Inventory
   * -------------------------
   */
  getShopItems() {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM items WHERE isAvailable = 1`, [], (err, rows) => {
        if (err) return reject('Error retrieving shop items.');
        resolve(rows || []);
      });
    });
  },

  getShopItemByName(itemName) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM items WHERE name = ? AND isAvailable = 1`, [itemName], (err, row) => {
        if (err) return reject('Error retrieving item by name.');
        resolve(row || null);
      });
    });
  },

  addShopItem(price, name, description) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO items (price, name, description) VALUES (?, ?, ?)`,
        [price, name, description],
        (err) => {
          if (err) return reject('Failed to add item to the shop.');
          resolve();
        }
      );
    });
  },

  removeShopItem(name) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM items WHERE name = ?`, [name], (err) => {
        if (err) return reject('Failed to remove item.');
        resolve();
      });
    });
  },

  addItemToInventory(userID, itemID, quantity = 1) {
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
          if (err) return reject('Error adding item to inventory.');
          resolve();
        }
      );
    });
  },

  getInventory(userID) {
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
  },

  transferItem(fromUserID, toUserID, itemName, qty) {
    return new Promise((resolve, reject) => {
      if (qty <= 0) {
        return reject('Quantity must be a positive number.');
      }
      db.get(`SELECT itemID FROM items WHERE name = ? AND isAvailable = 1`, [itemName], (err, itemRow) => {
        if (err) return reject('Error looking up item.');
        if (!itemRow) return reject(`Item "${itemName}" does not exist or is not available.`);

        const itemID = itemRow.itemID;
        db.get(`SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`, [fromUserID, itemID], (err2, row2) => {
          if (err2) return reject('Error checking sender inventory.');
          if (!row2 || row2.quantity < qty) {
            return reject(`You don't have enough of "${itemName}".`);
          }
          // subtract from sender
          const newSenderQty = row2.quantity - qty;
          if (newSenderQty > 0) {
            db.run(
              `UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`,
              [newSenderQty, fromUserID, itemID],
              (err3) => {
                if (err3) return reject('Error updating sender inventory.');
                addToRecipient();
              }
            );
          } else {
            db.run(
              `DELETE FROM inventory WHERE userID = ? AND itemID = ?`,
              [fromUserID, itemID],
              (err3) => {
                if (err3) return reject('Error removing item from sender inventory.');
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
                if (err4) return reject('Error adding item to recipient.');
                resolve();
              }
            );
          }
        });
      });
    });
  },

  redeemItem(userID, itemName) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT itemID FROM items WHERE name = ?`, [itemName], (err, itemRow) => {
        if (err) return reject('Error looking up item.');
        if (!itemRow) return reject(`Item "${itemName}" does not exist.`);

        const itemID = itemRow.itemID;
        db.get(`SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`, [userID, itemID], (err2, row2) => {
          if (err2) return reject('Error retrieving inventory.');
          if (!row2 || row2.quantity < 1) {
            return reject(`You don't have any of "${itemName}" to redeem.`);
          }

          const newQty = row2.quantity - 1;
          if (newQty > 0) {
            db.run(
              `UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`,
              [newQty, userID, itemID],
              (err3) => {
                if (err3) return reject('Failed to redeem item.');
                resolve(true);
              }
            );
          } else {
            db.run(
              `DELETE FROM inventory WHERE userID = ? AND itemID = ?`,
              [userID, itemID],
              (err3) => {
                if (err3) return reject('Failed to redeem item.');
                resolve(true);
              }
            );
          }
        });
      });
    });
  },

  /**
   * -------------------------
   * Multi-Assignee Jobs
   * -------------------------
   */
  addJob(description) {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO joblist (description) VALUES (?)`, [description], (err) => {
        if (err) return reject('Failed to add job.');
        resolve();
      });
    });
  },

  getJobList() {
    return new Promise((resolve, reject) => {
      // First get all jobs
      db.all(`SELECT jobID, description FROM joblist`, [], (err, jobRows) => {
        if (err) return reject('Failed to retrieve job list.');
        if (!jobRows || !jobRows.length) return resolve([]);

        const jobIDs = jobRows.map(j => j.jobID);
        db.all(
          `SELECT jobID, userID FROM job_assignees WHERE jobID IN (${jobIDs.map(() => '?').join(',')})`,
          jobIDs,
          (err2, assignees) => {
            if (err2) return reject('Failed to retrieve job assignees.');
            // Build a map jobID -> [userIDs...]
            const map = {};
            (assignees || []).forEach(a => {
              if (!map[a.jobID]) map[a.jobID] = [];
              map[a.jobID].push(a.userID);
            });
            // Attach to jobs
            const result = jobRows.map(j => ({
              jobID: j.jobID,
              description: j.description,
              assignees: map[j.jobID] || []
            }));
            resolve(result);
          }
        );
      });
    });
  },

  assignRandomJob(userID) {
    return new Promise((resolve, reject) => {
      // Get a random job that user is NOT already assigned to
      db.get(
        `
        SELECT j.jobID, j.description
        FROM joblist j
        WHERE j.jobID NOT IN (
          SELECT jobID FROM job_assignees WHERE userID = ?
        )
        ORDER BY RANDOM() LIMIT 1
        `,
        [userID],
        (err, row) => {
          if (err) return reject('Error retrieving random job.');
          if (!row) return resolve(null);
          // Assign user to that job
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
  },

  completeJob(jobID) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT jobID, description FROM joblist WHERE jobID = ?`, [jobID], (err, jobRow) => {
        if (err) return reject('Error finding job.');
        if (!jobRow) return resolve(null);

        // get all assignees
        db.all(`SELECT userID FROM job_assignees WHERE jobID = ?`, [jobID], (err2, rows) => {
          if (err2) return reject('Error retrieving assignees.');
          const userIDs = rows.map(r => r.userID);
          const payAmount = Math.floor(Math.random() * 201) + 100; // 100..300
          if (!userIDs.length) {
            // No one assigned
            return db.run(`DELETE FROM job_assignees WHERE jobID = ?`, [jobID], () =>
              resolve({ success: true, payAmount, assignees: [] })
            );
          }
          // Pay each user
          const payPromises = userIDs.map(uid => {
            return new Promise(res => {
              initUserEconomy(uid)
                .then(() => {
                  db.run(
                    `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
                    [payAmount, uid],
                    () => res()
                  );
                })
                .catch(() => res());
            });
          });
          Promise.all(payPromises).then(() => {
            // Unassign them all
            db.run(`DELETE FROM job_assignees WHERE jobID = ?`, [jobID], (err3) => {
              if (err3) return reject('Error unassigning users.');
              resolve({ success: true, payAmount, assignees: userIDs });
            });
          });
        });
      });
    });
  },

  /**
   * -------------------------
   * Bot-Specific Admin
   * -------------------------
   */
  addAdmin(userID) {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO admins (userID) VALUES (?)`, [userID], (err) => {
        if (err) return reject('Failed to add admin.');
        resolve();
      });
    });
  },

  removeAdmin(userID) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM admins WHERE userID = ?`, [userID], (err) => {
        if (err) return reject('Failed to remove admin.');
        resolve();
      });
    });
  },

  getAdmins() {
    return new Promise((resolve, reject) => {
      db.all(`SELECT userID FROM admins`, [], (err, rows) => {
        if (err) return reject('Failed to retrieve admins.');
        resolve(rows.map(r => r.userID));
      });
    });
  },
};

