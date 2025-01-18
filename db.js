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
  // 1) economy table for user balances
  db.run(`
    CREATE TABLE IF NOT EXISTS economy (
      userID TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0
    )
  `);

  // 2) items table for shop items
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      itemID INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,
      price INTEGER,
      isAvailable BOOLEAN DEFAULT 1
    )
  `);

  // 3) inventory table for user-owned items
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

  // 5) joblist table (with 'assignedTo')
  db.run(`
    CREATE TABLE IF NOT EXISTS joblist (
      jobID INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT,
      assignedTo TEXT
    )
  `);
});

module.exports = {
  /**
   * Get a user's current balance. Returns 0 if user not found.
   */
  getBalance: (userID) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT balance FROM economy WHERE userID = ?`, [userID], (err, row) => {
        if (err) {
          console.error('Actual SQLite error in getBalance:', err);
          return reject('Error retrieving balance.');
        }
        resolve(row ? row.balance : 0);
      });
    });
  },

  /**
   * Add or subtract from a user's balance. (amount can be positive or negative.)
   */
  updateBalance: (userID, amount) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO economy (userID, balance) VALUES (?, 0)`,
        [userID],
        (err) => {
          if (err) {
            console.error('Actual SQLite error in updateBalance (INSERT/IGNORE):', err);
            return reject('Error initializing user balance.');
          }
          db.run(
            `UPDATE economy SET balance = balance + ? WHERE userID = ?`,
            [amount, userID],
            (err2) => {
              if (err2) {
                console.error('Actual SQLite error in updateBalance (UPDATE):', err2);
                return reject('Error updating balance.');
              }
              resolve();
            }
          );
        }
      );
    });
  },

  /**
   * Transfer balance from one user to another.
   */
  transferBalanceFromTo: (fromUserID, toUserID, amount) => {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Check if the sender has enough balance
        db.get(`SELECT balance FROM economy WHERE userID = ?`, [fromUserID], (err, row) => {
          if (err) {
            console.error('Actual SQLite error in transferBalance (SELECT sender):', err);
            return reject('Error retrieving sender balance.');
          }
          if (!row || row.balance < amount) {
            return reject('Sender has insufficient balance.');
          }

          // Deduct from sender
          db.run(`UPDATE economy SET balance = balance - ? WHERE userID = ?`, [amount, fromUserID], (err2) => {
            if (err2) {
              console.error('Actual SQLite error in transferBalance (UPDATE sender):', err2);
              return reject('Error deducting balance from sender.');
            }
            
            // Ensure recipient account exists
            db.run(`INSERT OR IGNORE INTO economy (userID, balance) VALUES (?, 0)`, [toUserID], (err3) => {
              if (err3) {
                console.error('Actual SQLite error in transferBalance (INSERT recipient):', err3);
                return reject('Error initializing recipient account.');
              }
              
              // Add to recipient
              db.run(`UPDATE economy SET balance = balance + ? WHERE userID = ?`, [amount, toUserID], (err4) => {
                if (err4) {
                  console.error('Actual SQLite error in transferBalance (UPDATE recipient):', err4);
                  return reject('Error adding balance to recipient.');
                }
                resolve();
              });
            });
          });
        });
      });
    });
  },

  /**
   * Return top 10 users sorted by balance (descending).
   */
  getLeaderboard: () => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT userID, balance FROM economy ORDER BY balance DESC LIMIT 10`,
        [],
        (err, rows) => {
          if (err) {
            console.error('Actual SQLite error in getLeaderboard:', err);
            return reject('Failed to retrieve leaderboard.');
          }
          resolve(rows || []);
        }
      );
    });
  },

  /**
   * Retrieve all available items from the shop.
   */
  getShopItems: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM items WHERE isAvailable = 1`, [], (err, rows) => {
        if (err) {
          console.error('Actual SQLite error in getShopItems:', err);
          return reject('Error retrieving shop items.');
        }
        resolve(rows || []);
      });
    });
  },

  /**
   * Look up a single shop item by name.
   */
  getShopItemByName: (itemName) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM items WHERE name = ? AND isAvailable = 1`,
        [itemName],
        (err, row) => {
          if (err) {
            console.error('Actual SQLite error in getShopItemByName:', err);
            return reject('Error retrieving shop item by name.');
          }
          resolve(row || null);
        }
      );
    });
  },

  /**
   * Add a new item to the shop.
   */
  addShopItem: (price, name, description) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO items (price, name, description) VALUES (?, ?, ?)`,
        [price, name, description],
        (err) => {
          if (err) {
            console.error('Actual SQLite error in addShopItem:', err.message);
            return reject('Failed to add item to the shop.');
          }
          resolve('✅ Item added to the shop successfully!');
        }
      );
    });
  },

  /**
   * Remove an existing item from the shop by name.
   */
  removeShopItem: (name) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM items WHERE name = ?`, [name], (err) => {
        if (err) {
          console.error('Actual SQLite error in removeShopItem:', err.message);
          return reject('Failed to remove item from the shop.');
        }
        resolve('✅ Item removed from the shop successfully!');
      });
    });
  },

  /**
   * Add an item to a user's inventory (or increment quantity).
   */
  addItemToInventory: (userID, itemID, quantity = 1) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO inventory (userID, itemID, quantity)
         VALUES (?, ?, ?)
         ON CONFLICT(userID, itemID)
         DO UPDATE SET quantity = quantity + ?`,
        [userID, itemID, quantity, quantity],
        (err) => {
          if (err) {
            console.error('Actual SQLite error in addItemToInventory:', err);
            return reject('Error adding item to inventory.');
          }
          resolve('Item added to inventory.');
        }
      );
    });
  },

  /**
   * Get a user's inventory. Returns an array of objects: { name, quantity, itemID }
   */
  getInventory: (userID) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT items.name, inventory.quantity, inventory.itemID
         FROM inventory
         INNER JOIN items ON inventory.itemID = items.itemID
         WHERE inventory.userID = ?`,
        [userID],
        (err, rows) => {
          if (err) {
            console.error('Actual SQLite error in getInventory:', err);
            return reject('Error retrieving inventory.');
          }
          resolve(rows || []);
        }
      );
    });
  },

  /**
   * Transfer an item from one user to another. 
   * The quantity is handled by the caller, but we can pass 1 for a single-item transfer.
   */
  transferItem: (fromUserID, toUserID, itemName, quantity) => {
    return new Promise((resolve, reject) => {
      if (quantity <= 0) {
        return reject('Quantity must be a positive number.');
      }

      // 1) Look up the item by name to get its itemID
      db.get(
        `SELECT itemID FROM items WHERE name = ? AND isAvailable = 1`,
        [itemName],
        (err, itemRow) => {
          if (err) {
            console.error('Error retrieving item by name in transferItem:', err);
            return reject('Error looking up item.');
          }
          if (!itemRow) {
            return reject(`Item "${itemName}" does not exist or is not available.`);
          }

          const itemID = itemRow.itemID;

          // 2) Check fromUser's inventory
          db.get(
            `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`,
            [fromUserID, itemID],
            (err2, invRow) => {
              if (err2) {
                console.error('Error checking fromUser inventory in transferItem:', err2);
                return reject('Error checking sender inventory.');
              }
              if (!invRow || invRow.quantity < quantity) {
                return reject(`You do not have enough of "${itemName}" to send.`);
              }

              // 3) Decrement fromUser's inventory
              const newQuantity = invRow.quantity - quantity;
              if (newQuantity > 0) {
                // Just update with new quantity
                db.run(
                  `UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`,
                  [newQuantity, fromUserID, itemID],
                  (err3) => {
                    if (err3) {
                      console.error('Error updating sender inventory in transferItem:', err3);
                      return reject('Error updating sender inventory.');
                    }
                    addToRecipient(); // proceed
                  }
                );
              } else {
                // newQuantity = 0 or less, remove row entirely
                db.run(
                  `DELETE FROM inventory WHERE userID = ? AND itemID = ?`,
                  [fromUserID, itemID],
                  (err3) => {
                    if (err3) {
                      console.error('Error removing sender inventory in transferItem:', err3);
                      return reject('Error removing item from sender inventory.');
                    }
                    addToRecipient();
                  }
                );
              }

              // 4) Add to recipient
              function addToRecipient() {
                db.run(
                  `INSERT INTO inventory (userID, itemID, quantity)
                   VALUES (?, ?, ?)
                   ON CONFLICT(userID, itemID)
                   DO UPDATE SET quantity = quantity + ?`,
                  [toUserID, itemID, quantity, quantity],
                  (err4) => {
                    if (err4) {
                      console.error('Error adding item to recipient in transferItem:', err4);
                      return reject('Error adding item to recipient inventory.');
                    }
                    return resolve();
                  }
                );
              }
            }
          );
        }
      );
    });
  },

  /**
   * Add a new job to the joblist.
   */
  addJob: (description) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO joblist (description) VALUES (?)`,
        [description],
        (err) => {
          if (err) {
            console.error('Actual SQLite error in addJob:', err);
            return reject('Failed to add the job.');
          }
          resolve();
        }
      );
    });
  },

  /**
   * Return all unassigned jobs (assignedTo IS NULL).
   */
  getJobList: () => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM joblist WHERE assignedTo IS NULL`,
        [],
        (err, rows) => {
          if (err) {
            console.error('Actual SQLite error in getJobList:', err);
            return reject('Failed to retrieve job list.');
          }
          resolve(rows || []);
        }
      );
    });
  },

  /**
   * Assign a random unassigned job to a user — but first check if they already have one.
   */
  assignRandomJob: (userID) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM joblist WHERE assignedTo = ? LIMIT 1`, [userID], (err, existingJob) => {
        if (err) {
          console.error('Actual SQLite error in assignRandomJob (check existing):', err);
          return reject('Error checking current job.');
        }
        if (existingJob) {
          return resolve(existingJob); // they already have a job
        }

        db.get(
          `SELECT * FROM joblist WHERE assignedTo IS NULL ORDER BY RANDOM() LIMIT 1`,
          [],
          (err2, newJob) => {
            if (err2) {
              console.error('Actual SQLite error in assignRandomJob (select random):', err2);
              return reject('Error retrieving unassigned job.');
            }
            if (!newJob) return resolve(null);

            db.run(
              `UPDATE joblist SET assignedTo = ? WHERE jobID = ?`,
              [userID, newJob.jobID],
              (err3) => {
                if (err3) {
                  console.error('Actual SQLite error in assignRandomJob (update assignedTo):', err3);
                  return reject('Error assigning job.');
                }
                return resolve(newJob);
              }
            );
          }
        );
      });
    });
  },

  /**
   * Complete a job by ID (admin command). Worker gets a random reward if assigned.
   */
  completeJob: (jobID) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM joblist WHERE jobID = ?`, [jobID], (err, jobRow) => {
        if (err) {
          console.error('Actual SQLite error in completeJob (select job):', err);
          return reject('Error finding job.');
        }
        if (!jobRow) {
          return resolve(null);
        }

        const assignedUser = jobRow.assignedTo;
        const payAmount = Math.floor(Math.random() * 201) + 100; // random 100–300

        db.run(`DELETE FROM joblist WHERE jobID = ?`, [jobID], function (err2) {
          if (err2) {
            console.error('Actual SQLite error in completeJob (delete job):', err2);
            return reject('Failed to complete job.');
          }
          if (this.changes === 0) {
            return resolve(null); // no row deleted
          }

          if (assignedUser) {
            // Reward them
            db.run(
              `INSERT OR IGNORE INTO economy (userID, balance) VALUES (?, 0)`,
              [assignedUser],
              (err3) => {
                if (err3) {
                  console.error('Actual SQLite error in completeJob (insert assignedUser):', err3);
                  return resolve({ success: true, payAmount: 0, assignedUser });
                }
                db.run(
                  `UPDATE economy SET balance = balance + ? WHERE userID = ?`,
                  [payAmount, assignedUser],
                  (err4) => {
                    if (err4) {
                      console.error('Failed to pay user for job completion.', err4);
                      return resolve({ success: true, payAmount: 0, assignedUser });
                    }
                    return resolve({ success: true, payAmount, assignedUser });
                  }
                );
              }
            );
          } else {
            // No assigned user
            return resolve({ success: true, payAmount: 0, assignedUser: null });
          }
        });
      });
    });
  },

  /**
   * Add an admin to the 'admins' table.
   */
  addAdmin: (userID) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO admins (userID) VALUES (?)`, [userID], (err) => {
        if (err) {
          console.error('Actual SQLite error in addAdmin:', err);
          return reject('Failed to add admin.');
        }
        resolve();
      });
    });
  },

  /**
   * Remove an admin from the 'admins' table.
   */
  removeAdmin: (userID) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM admins WHERE userID = ?`, [userID], (err) => {
        if (err) {
          console.error('Actual SQLite error in removeAdmin:', err);
          return reject('Failed to remove admin.');
        }
        resolve();
      });
    });
  },

  /**
   * Retrieve all bot admins from the DB.
   */
  getAdmins: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT userID FROM admins`, [], (err, rows) => {
        if (err) {
          console.error('Actual SQLite error in getAdmins:', err);
          return reject('Failed to retrieve admins.');
        }
        resolve(rows.map((row) => row.userID));
      });
    });
  },
};

