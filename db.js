const SQLite = require('sqlite3').verbose();

const db = new SQLite.Database('./economy.db', (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to SQLite database.');
  }
});

db.serialize(() => {
  // economy table with wallet+bank
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
});

// Ensure user row
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

module.exports = {
  /**
   * -------------------------
   * Bank & Wallet
   * -------------------------
   */
  async getBalances(userID) {
    await initUserEconomy(userID);
    return new Promise((resolve, reject) => {
      db.get(`SELECT wallet, bank FROM economy WHERE userID = ?`, [userID], (err, row) => {
        if (err) return reject('Failed to get balances.');
        if (!row) return resolve({ wallet: 0, bank: 0 });
        resolve({ wallet: row.wallet, bank: row.bank });
      });
    });
  },

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

  async deposit(userID, amount) {
    const { wallet } = await this.getBalances(userID);
    if (wallet < amount) {
      throw `Not enough in wallet (you have ${wallet}).`;
    }
    await this.updateWallet(userID, -amount);
    await this.updateBank(userID, amount);
  },

  async withdraw(userID, amount) {
    const { bank } = await this.getBalances(userID);
    if (bank < amount) {
      throw `Not enough in bank (you have ${bank}).`;
    }
    await this.updateBank(userID, -amount);
    await this.updateWallet(userID, amount);
  },

  /**
   * ROB
   *  - 50% success
   *  - If success: steals 10-40% of target's wallet
   *  - If fail: 25% of that portion is paid to target from robber
   */
  async robUser(robberID, targetID) {
    await initUserEconomy(robberID);
    await initUserEconomy(targetID);
    const { wallet: targetWallet } = await this.getBalances(targetID);
    if (targetWallet <= 0) {
      return { success: false, message: 'Target has 0 in wallet.' };
    }

    const successChance = 0.5;
    const success = Math.random() < successChance;

    // 10-40%
    const percent = 0.1 + Math.random() * 0.3;
    const amount = Math.floor(targetWallet * percent);

    if (success) {
      // robber wins
      await this.updateWallet(targetID, -amount);
      await this.updateWallet(robberID, amount);
      return { success: true, outcome: 'success', amountStolen: amount };
    } else {
      // robber fails -> penalty
      const penalty = Math.floor(amount * 0.25);
      const { wallet: robberWallet } = await this.getBalances(robberID);
      if (penalty > 0 && robberWallet >= penalty) {
        await this.updateWallet(robberID, -penalty);
        await this.updateWallet(targetID, penalty);
      }
      return { success: true, outcome: 'fail', penalty };
    }
  },

  async transferFromWallet(fromID, toID, amount) {
    if (amount <= 0) throw 'Amount must be positive.';
    const { wallet } = await this.getBalances(fromID);
    if (wallet < amount) {
      throw `You only have ${wallet} in your wallet.`;
    }
    // subtract
    await this.updateWallet(fromID, -amount);
    // add
    await this.updateWallet(toID, amount);
  },

  /**
   * -------------------------
   * LEADERBOARD
   * -------------------------
   */
  getLeaderboard() {
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
  },

  /**
   * -------------------------
   * SHOP & INVENTORY
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

  getShopItemByName(name) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM items WHERE name = ? AND isAvailable = 1`, [name], (err, row) => {
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
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  removeShopItem(name) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM items WHERE name = ?`, [name], (err) => {
        if (err) return reject(err);
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
          if (err) return reject('Error adding item.');
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

            // subtract
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
  },

  /**
   * -------------------------
   * Multi-Assignee Jobs
   * (Per-User completion)
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
  },

  assignRandomJob(userID) {
    return new Promise((resolve, reject) => {
      // pick a random job user not assigned to
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
          // add to job_assignees
          db.run(`INSERT INTO job_assignees (jobID, userID) VALUES (?, ?)`,
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

  completeJob(jobID, userID, reward) {
    return new Promise((resolve, reject) => {
      // check if job exists
      db.get(`SELECT jobID FROM joblist WHERE jobID = ?`, [jobID], (err, job) => {
        if (err) return reject('Error looking up job.');
        if (!job) return resolve(null); // no job

        // check if user is assigned
        db.get(
          `SELECT * FROM job_assignees WHERE jobID = ? AND userID = ?`,
          [jobID, userID],
          async (err2, row2) => {
            if (err2) return reject('Error checking assignment.');
            if (!row2) {
              // user not assigned
              return resolve({ notAssigned: true });
            }

            // pay user the specified reward
            try {
              await this.updateWallet(userID, reward);
            } catch (err3) {
              return reject('Error paying user.');
            }

            // remove from job_assignees
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

