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
  // 1) economy table
  db.run(`
    CREATE TABLE IF NOT EXISTS economy (
      userID TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0
    )
  `);

  // 2) items table
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      itemID INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,
      price INTEGER,
      isAvailable BOOLEAN DEFAULT 1
    )
  `);

  // 3) inventory table
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      userID TEXT,
      itemID INTEGER,
      quantity INTEGER DEFAULT 1,
      PRIMARY KEY(userID, itemID),
      FOREIGN KEY(itemID) REFERENCES items(itemID)
    )
  `);

  // 4) admins table
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      userID TEXT PRIMARY KEY
    )
  `);

  // 5) joblist table (remove assignedTo from here)
  db.run(`
    CREATE TABLE IF NOT EXISTS joblist (
      jobID INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT
    )
  `);

  // 6) job_assignees table to allow multiple users per job
  db.run(`
    CREATE TABLE IF NOT EXISTS job_assignees (
      jobID INTEGER,
      userID TEXT,
      PRIMARY KEY(jobID, userID),
      FOREIGN KEY(jobID) REFERENCES joblist(jobID)
    )
  `);
});

module.exports = {
  /**
   * -------------------------
   * Basic Economy Functions
   * -------------------------
   */
  getBalance(userID) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT balance FROM economy WHERE userID = ?`, [userID], (err, row) => {
        if (err) return reject('Error retrieving balance.');
        resolve(row ? row.balance : 0);
      });
    });
  },

  updateBalance(userID, amount) {
    return new Promise((resolve, reject) => {
      db.run(`INSERT OR IGNORE INTO economy (userID, balance) VALUES (?, 0)`, [userID], (err) => {
        if (err) return reject('Error initializing user balance.');
        db.run(`UPDATE economy SET balance = balance + ? WHERE userID = ?`, [amount, userID], (err2) => {
          if (err2) return reject('Error updating balance.');
          resolve();
        });
      });
    });
  },

  transferBalanceFromTo(fromUserID, toUserID, amount) {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.get(`SELECT balance FROM economy WHERE userID = ?`, [fromUserID], (err, row) => {
          if (err) return reject('Error retrieving sender balance.');
          if (!row || row.balance < amount) {
            return reject('Sender has insufficient balance.');
          }

          db.run(`UPDATE economy SET balance = balance - ? WHERE userID = ?`, [amount, fromUserID], (err2) => {
            if (err2) return reject('Error deducting balance from sender.');
            db.run(`INSERT OR IGNORE INTO economy (userID, balance) VALUES (?, 0)`, [toUserID], (err3) => {
              if (err3) return reject('Error initializing recipient account.');
              db.run(
                `UPDATE economy SET balance = balance + ? WHERE userID = ?`,
                [amount, toUserID],
                (err4) => {
                  if (err4) return reject('Error adding balance to recipient.');
                  resolve();
                }
              );
            });
          });
        });
      });
    });
  },

  getLeaderboard() {
    return new Promise((resolve, reject) => {
      db.all(`SELECT userID, balance FROM economy ORDER BY balance DESC LIMIT 10`, [], (err, rows) => {
        if (err) return reject('Failed to retrieve leaderboard.');
        resolve(rows || []);
      });
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
        `INSERT INTO inventory (userID, itemID, quantity)
         VALUES (?, ?, ?)
         ON CONFLICT(userID, itemID)
         DO UPDATE SET quantity = quantity + ?`,
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
        `SELECT items.name, inventory.quantity
         FROM inventory
         INNER JOIN items ON inventory.itemID = items.itemID
         WHERE inventory.userID = ?`,
        [userID],
        (err, rows) => {
          if (err) return reject('Error retrieving inventory.');
          resolve(rows || []);
        }
      );
    });
  },

  transferItem(fromUserID, toUserID, itemName, quantity) {
    return new Promise((resolve, reject) => {
      if (quantity <= 0) {
        return reject('Quantity must be positive.');
      }
      db.get(`SELECT itemID FROM items WHERE name = ? AND isAvailable = 1`, [itemName], (err, itemRow) => {
        if (err) return reject('Error looking up item.');
        if (!itemRow) return reject(`Item "${itemName}" not available.`);

        const itemID = itemRow.itemID;
        db.get(`SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`, [fromUserID, itemID], (err2, row2) => {
          if (err2) return reject('Error checking inventory.');
          if (!row2 || row2.quantity < quantity) {
            return reject(`You don't have enough of "${itemName}".`);
          }
          // subtract
          const newQty = row2.quantity - quantity;
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
                if (err3) return reject('Error removing item from inventory.');
                addToRecipient();
              }
            );
          }

          function addToRecipient() {
            db.run(
              `INSERT INTO inventory (userID, itemID, quantity)
               VALUES (?, ?, ?)
               ON CONFLICT(userID, itemID)
               DO UPDATE SET quantity = quantity + ?`,
              [toUserID, itemID, quantity, quantity],
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
            return reject(`You have no "${itemName}" to redeem.`);
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
   * Joblist & Admin
   * (Multiple Assignees)
   * -------------------------
   */

  // Insert a new job (unassigned)
  addJob(description) {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO joblist (description) VALUES (?)`, [description], (err) => {
        if (err) return reject('Failed to add job.');
        resolve();
      });
    });
  },

  /**
   * getJobList:
   *  - We want to return an array of jobs, each with an `assignees` array of userIDs
   */
  getJobList() {
    return new Promise((resolve, reject) => {
      // First, get all jobs
      db.all(`SELECT jobID, description FROM joblist`, [], (err, jobs) => {
        if (err) return reject('Failed to retrieve job list.');
        if (!jobs || !jobs.length) return resolve([]);

        // Then, for each job, get its assigned userIDs
        const jobIDs = jobs.map(j => j.jobID);
        db.all(
          `SELECT jobID, userID FROM job_assignees WHERE jobID IN (${jobIDs.map(() => '?').join(',')})`,
          jobIDs,
          (err2, assigneesRows) => {
            if (err2) return reject('Failed to retrieve assignees.');
            // Convert to dictionary: jobID -> array of userIDs
            const assigneesMap = {};
            if (assigneesRows) {
              assigneesRows.forEach(r => {
                if (!assigneesMap[r.jobID]) assigneesMap[r.jobID] = [];
                assigneesMap[r.jobID].push(r.userID);
              });
            }
            // Attach to each job
            const result = jobs.map(j => ({
              jobID: j.jobID,
              description: j.description,
              assignees: assigneesMap[j.jobID] || []
            }));
            resolve(result);
          }
        );
      });
    });
  },

  /**
   * assignRandomJob:
   *  - Assign the given user to a random job that they are NOT already on.
   *  - If you want to allow multiple jobs for a user, remove the check for
   *    "already assigned" altogether. This example just picks any random job
   *    that the user isn't already assigned to.
   */
  assignRandomJob(userID) {
    return new Promise((resolve, reject) => {
      // Find a random job that userID is not yet assigned to
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
          if (err) return reject('Error retrieving a random job.');
          if (!row) {
            // No job found that user isn't already assigned to
            return resolve(null);
          }
          // Insert (jobID, userID) into job_assignees
          db.run(
            `INSERT INTO job_assignees (jobID, userID) VALUES (?, ?)`,
            [row.jobID, userID],
            (err2) => {
              if (err2) return reject('Error assigning user to job.');
              // Return the job row
              return resolve(row);
            }
          );
        }
      );
    });
  },

  /**
   * completeJob:
   *  - We pay each assigned user a random amount (100–300).
   *  - Then we remove them from job_assignees for that job (unassign them).
   *  - The job remains in 'joblist' for reference/future re-use.
   */
  completeJob(jobID) {
    return new Promise((resolve, reject) => {
      // Does job exist?
      db.get(`SELECT jobID, description FROM joblist WHERE jobID = ?`, [jobID], (err, jobRow) => {
        if (err) return reject('Error finding job.');
        if (!jobRow) {
          // No such job
          return resolve(null);
        }

        // Next, get all assignees for this job
        db.all(`SELECT userID FROM job_assignees WHERE jobID = ?`, [jobID], (err2, rows) => {
          if (err2) return reject('Error retrieving assignees.');
          const assignees = rows.map(r => r.userID);
          // Let's pay each user. We'll just pick 1 random pay for everyone, for simplicity.
          const payAmount = Math.floor(Math.random() * 201) + 100; // 100..300
          // If no assignees, just mark success
          if (!assignees.length) {
            return resolve({ success: true, payAmount, assignees: [] });
          }

          // For each assigned user, pay them
          const payPromises = assignees.map(uid => {
            return new Promise((res) => {
              // Insert or ignore user
              db.run(`INSERT OR IGNORE INTO economy (userID, balance) VALUES (?, 0)`, [uid], () => {
                // Then add to their balance
                db.run(
                  `UPDATE economy SET balance = balance + ? WHERE userID = ?`,
                  [payAmount, uid],
                  () => {
                    res(); // ignore any errors for simplicity
                  }
                );
              });
            });
          });

          Promise.all(payPromises)
            .then(() => {
              // Finally, remove all assignees from job_assignees for this job
              db.run(`DELETE FROM job_assignees WHERE jobID = ?`, [jobID], (err3) => {
                if (err3) return reject('Error unassigning job assignees.');
                return resolve({ success: true, payAmount, assignees });
              });
            })
            .catch(() => {
              // Something went wrong paying
              return reject('Error paying assigned users.');
            });
        });
      });
    });
  },

  // -----------------------------
  // Bot-Specific Admin
  // -----------------------------
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

