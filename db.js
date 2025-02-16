// db.js
// =========================================================================
// Require & Connect to SQLite
// =========================================================================
const SQLite = require('sqlite3').verbose();
const db = new SQLite.Database('./points.db', (err) => {
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

    // Economy table
    db.run(`
      CREATE TABLE IF NOT EXISTS economy (
        userID TEXT PRIMARY KEY,
        wallet INTEGER DEFAULT 0,
        bank INTEGER DEFAULT 0
      )
    `, (err) => {
      if (err) console.error('Error creating economy table:', err);
      else console.log('Economy table is ready.');
    });

    // Items table
    db.run(`
      CREATE TABLE IF NOT EXISTS items (
        itemID INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        description TEXT,
        price INTEGER,
        isAvailable BOOLEAN DEFAULT 1
      )
    `, (err) => {
      if (err) {
        console.error('Error creating items table:', err);
      } else {
        console.log('Items table is ready.');
        // Migration: Check if the "quantity" column exists, add it if missing
        db.all("PRAGMA table_info(items)", (err, columns) => {
          if (err) {
            console.error("Error retrieving items table info:", err);
          } else {
            const hasQuantity = columns.some(column => column.name === "quantity");
            if (!hasQuantity) {
              db.run("ALTER TABLE items ADD COLUMN quantity INTEGER DEFAULT 1", (alterErr) => {
                if (alterErr && alterErr.message.includes("duplicate column name")) {
                  console.log("Quantity column already exists, skipping migration.");
                } else if (alterErr) {
                  console.error("Error adding quantity column to items table:", alterErr);
                } else {
                  console.log("Quantity column added to items table.");
                }
              });
            }
          }
        });
      }
    });

    // Inventory table
    db.run(`
      CREATE TABLE IF NOT EXISTS inventory (
        userID TEXT,
        itemID INTEGER,
        quantity INTEGER DEFAULT 1,
        PRIMARY KEY(userID, itemID),
        FOREIGN KEY(itemID) REFERENCES items(itemID)
      )
    `, (err) => {
      if (err) console.error('Error creating inventory table:', err);
      else console.log('Inventory table is ready.');
    });

    // Admins table
    db.run(`
      CREATE TABLE IF NOT EXISTS admins (
        userID TEXT PRIMARY KEY
      )
    `, (err) => {
      if (err) console.error('Error creating admins table:', err);
      else console.log('Admins table is ready.');
    });


    // Joblist table
    db.run(`
      CREATE TABLE IF NOT EXISTS joblist (
        jobID INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('Error creating joblist table:', err);
      } else {
        console.log('Joblist table is ready.');
      }
    });

    // Job assignees table
    db.run(`
      CREATE TABLE IF NOT EXISTS job_assignees (
        jobID INTEGER,
        userID TEXT,
        PRIMARY KEY(jobID, userID)
      )
    `, (err) => {
      if (err) console.error('Error creating job_assignees table:', err);
      else console.log('Job assignees table is ready.');
    });

    // Job cycle table for round-robin (cycled) job assignments
    db.run(`
      CREATE TABLE IF NOT EXISTS job_cycle (
        current_index INTEGER NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('Error creating job_cycle table:', err);
      } else {
        console.log('Job cycle table is ready.');
        // Ensure the job_cycle table has an initial row with current_index = 0
        db.get("SELECT current_index FROM job_cycle LIMIT 1", (err, row) => {
          if (err) {
            console.error("Error checking job_cycle table:", err);
          } else if (!row) {
            db.run("INSERT INTO job_cycle (current_index) VALUES (0)", (err) => {
              if (err) {
                console.error("Error inserting initial job_cycle value:", err);
              } else {
                console.log("Job cycle table initialized with current_index = 0.");
              }
            });
          }
        });
      }
    });

    // Giveaways table
    db.run(`
      CREATE TABLE IF NOT EXISTS giveaways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        end_time INTEGER NOT NULL,
        prize TEXT NOT NULL,
        winners INTEGER NOT NULL,
        giveaway_name TEXT NOT NULL DEFAULT 'Untitled Giveaway',
        repeat INTEGER DEFAULT 0
      )
    `, (err) => {
      if (err) {
        console.error('Error creating giveaways table:', err);
      } else {
        console.log('Giveaways table is ready.');
        // Ensure the "giveaway_name" column exists
        db.all("PRAGMA table_info(giveaways)", (err, columns) => {
          if (err) {
            console.error("Error retrieving giveaways table info:", err);
          } else {
            const hasGiveawayName = columns.some(column => column.name === "giveaway_name");
            if (!hasGiveawayName) {
              console.log("Adding missing 'giveaway_name' column...");
              db.run("ALTER TABLE giveaways ADD COLUMN giveaway_name TEXT NOT NULL DEFAULT 'Untitled Giveaway'", (alterErr) => {
                if (alterErr) {
                  console.error("Error adding giveaway_name column to giveaways table:", alterErr);
                } else {
                  console.log("Successfully added 'giveaway_name' column to giveaways table.");
                }
              });
            }
          }
        });

        // Ensure the "repeat" column exists
        db.all("PRAGMA table_info(giveaways)", (err, columns) => {
          if (err) {
            console.error("Error retrieving giveaways table info:", err);
          } else {
            const hasRepeat = columns.some(column => column.name === "repeat");
            if (!hasRepeat) {
              console.log("Adding missing 'repeat' column...");
              db.run("ALTER TABLE giveaways ADD COLUMN repeat INTEGER DEFAULT 0", (alterErr) => {
                if (alterErr) {
                  console.error("Error adding repeat column to giveaways table:", alterErr);
                } else {
                  console.log("Successfully added 'repeat' column to giveaways table.");
                }
              });
            }
          }
        });
      }
    });

    // Giveaway entries table
    db.run(`
      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveaway_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (giveaway_id, user_id),
        FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Error creating giveaway_entries table:', err);
      else console.log('Giveaway entries table is ready.');
    });

    console.log('Database initialization complete.');
  });
}

    // Raffle table
    db.run(`
      CREATE TABLE IF NOT EXISTS raffles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        prize TEXT NOT NULL,
        cost INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        winners INTEGER NOT NULL,
        end_time INTEGER NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('Error creating raffles table:', err);
      } else {
        console.log('Raffles table is ready.');
      }
    });
    
    db.run(`
      CREATE TABLE IF NOT EXISTS raffle_entries (
        entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
        raffle_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) {
        console.error('Error creating raffle_entries table:', err);
      } else {
        console.log('Raffle entries table is ready.');
      }
    });
    

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

function getLeaderboard(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT userID, 
              IFNULL(wallet, 0) AS wallet, 
              IFNULL(bank, 0) AS bank, 
              (IFNULL(wallet, 0) + IFNULL(bank, 0)) AS totalBalance 
       FROM economy 
       ORDER BY totalBalance DESC 
       LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) {
          reject('Failed to retrieve leaderboard.');
        } else {
          resolve(rows || []);
        }
      }
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
        else resolve(row || { wallet: 0, bank: 0 });
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
    db.all(`SELECT userID FROM admins`, [], (err, rows) => {
      if (err) return reject('Failed to retrieve admins.');
      else resolve(rows.map((row) => row.userID));
    });
  });
}

async function removeAdmin(userID) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM admins WHERE userID = ?`, [userID], function (err) {
      if (err) return reject('Failed to remove admin.');
      else resolve({ changes: this.changes });
    });
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
        else resolve({ changes: this.changes });
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
      db.get(`SELECT wallet FROM economy WHERE userID = ?`, [fromUserID], (err, row) => {
        if (err || !row || row.wallet < amount) {
          db.run('ROLLBACK', () => reject('Insufficient funds or error occurred.'));
          return;
        }
        db.run(`UPDATE economy SET wallet = wallet - ? WHERE userID = ?`, [amount, fromUserID], (err) => {
          if (err) {
            db.run('ROLLBACK', () => reject('Failed to deduct funds.'));
            return;
          }
          db.run(`UPDATE economy SET wallet = wallet + ? WHERE userID = ?`, [amount, toUserID], (err) => {
            if (err) {
              db.run('ROLLBACK', () => reject('Failed to add funds.'));
              return;
            }
            db.run('COMMIT', (err) => {
              if (err) reject('Transaction commit failed.');
              else resolve();
            });
          });
        });
      });
    });
  });
}

async function withdraw(userID, amount) {
  if (amount <= 0) throw new Error('Invalid withdrawal amount.');
  await initUserEconomy(userID);
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get(`SELECT bank FROM economy WHERE userID = ?`, [userID], (err, row) => {
        if (err || !row || row.bank < amount) {
          return reject('Insufficient funds in the bank or error occurred.');
        }
        db.run(`UPDATE economy SET bank = bank - ?, wallet = wallet + ? WHERE userID = ?`, [amount, amount, userID], (err) => {
          if (err) return reject('Failed to process withdrawal.');
          resolve();
        });
      });
    });
  });
}

async function deposit(userID, amount) {
  if (amount <= 0) throw new Error('Invalid deposit amount.');
  await initUserEconomy(userID);
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get(`SELECT wallet FROM economy WHERE userID = ?`, [userID], (err, row) => {
        if (err || !row || row.wallet < amount) {
          return reject('Insufficient funds in wallet.');
        }
        db.run(`UPDATE economy SET wallet = wallet - ?, bank = bank + ? WHERE userID = ?`, [amount, amount, userID], (err) => {
          if (err) return reject('Failed to deposit funds.');
          resolve();
        });
      });
    });
  });
}

async function robUser(robberId, targetId) {
  await Promise.all([initUserEconomy(robberId), initUserEconomy(targetId)]);
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.get(`SELECT wallet FROM economy WHERE userID = ?`, [targetId], (err, targetRow) => {
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
          db.run(`UPDATE economy SET wallet = wallet - ? WHERE userID = ?`, [amountStolen, targetId], (err) => {
            if (err) {
              db.run('ROLLBACK');
              return reject('Failed to deduct money from the target.');
            }
            db.run(`UPDATE economy SET wallet = wallet + ? WHERE userID = ?`, [amountStolen, robberId], (err) => {
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
            });
          });
        } else {
          db.run(`UPDATE economy SET wallet = wallet + ? WHERE userID = ?`, [penalty, targetId], (err) => {
            if (err) {
              db.run('ROLLBACK');
              return reject('Failed to add penalty money to the target.');
            }
            db.run(`UPDATE economy SET wallet = wallet - ? WHERE userID = ?`, [penalty, robberId], (err) => {
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
            });
          });
        }
      });
    });
  });
}

// =========================================================================
// Job System (Updated for Cycled Assignment)
// =========================================================================

// Note: This snippet assumes that `db` is loaded elsewhere (e.g., via require('../../db')).

// --------------------- Original Functions ---------------------

function assignJobById(userID, jobID) {
  return new Promise((resolve, reject) => {
    if (!userID || !jobID) {
      return reject(new Error("Invalid user or job ID"));
    }
    db.serialize(() => {
      // Check if the user already has an assigned job
      db.get(
        `SELECT jobID FROM job_assignees WHERE userID = ?`,
        [userID],
        (err, row) => {
          if (err) return reject(new Error("Database error while checking active job"));
          if (row) return reject(new Error("User already has a job"));
          
          // Verify that the job exists
          db.get(
            `SELECT jobID, description FROM joblist WHERE jobID = ?`,
            [jobID],
            (err, job) => {
              if (err) return reject(new Error("Database error while verifying job"));
              if (!job) return reject(new Error("Job not found"));
              
              // Insert the assignment (this does not change your job cycle)
              db.run(
                `INSERT INTO job_assignees (jobID, userID) VALUES (?, ?)`,
                [jobID, userID],
                function (err2) {
                  if (err2) return reject(new Error("Failed to assign job"));
                  resolve(job);
                }
              );
            }
          );
        }
      );
    });
  });
}

function getAllJobs() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT jobID, description FROM joblist ORDER BY jobID ASC`, [], (err, rows) => {
      if (err) {
        console.error('Error fetching jobs from the database:', err);
        return reject('🚫 Failed to fetch jobs.');
      }
      resolve(rows);
    });
  });
}


/**
 * Retrieves the active job for a given user.
 */
function getActiveJob(userID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT j.jobID, j.description 
       FROM joblist j
       JOIN job_assignees ja ON j.jobID = ja.jobID
       WHERE ja.userID = ?`,
      [userID],
      (err, row) => {
        if (err) {
          reject('Failed to check active job.');
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Retrieves the description of the current job for a given user.
 */
function getUserJob(userID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT j.description 
       FROM joblist j
       JOIN job_assignees ja ON j.jobID = ja.jobID
       WHERE ja.userID = ?`,
      [userID],
      (err, row) => {
        if (err) {
          reject('Failed to check current job.');
        } else {
          resolve(row ? row.description : null);
        }
      }
    );
  });
}

/**
 * Adds a new job to the job list and renumbers jobs.
 */
function addJob(description) {
  return new Promise((resolve, reject) => {
    if (!description || typeof description !== 'string') {
      return reject('Invalid job description');
    }
    db.run(`INSERT INTO joblist (description) VALUES (?)`, [description], function (err) {
      if (err) return reject('Failed to add job');
      // Renumber job IDs after adding a new job.
      renumberJobs()
        .then(() =>
          resolve({
            jobID: this.lastID,
            description,
          })
        )
        .catch(reject);
    });
  });
}

/**
 * Retrieves the job list along with assigned users.
 */
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

/**
 * Completes a job for a user and adds a reward to their wallet.
 */
function completeJob(userID, reward) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get(
        `SELECT jobID FROM job_assignees WHERE userID = ?`,
        [userID],
        (err, row) => {
          if (err) {
            return reject('Database error while checking job assignment');
          }
          if (!row) {
            return resolve({ success: false, message: 'No active job found.' });
          }
          const jobID = row.jobID;
          db.run(`DELETE FROM job_assignees WHERE userID = ?`, [userID], (err2) => {
            if (err2) {
              return reject('Failed to remove job assignment');
            }
            db.run(
              `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
              [reward, userID],
              (err3) => {
                if (err3) {
                  return reject('Failed to add reward');
                }
                resolve({ success: true });
              }
            );
          });
        }
      );
    });
  });
}

/**
 * Renumbers jobs in the job list.
 */
function renumberJobs() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT jobID FROM joblist ORDER BY jobID`, [], (err, rows) => {
      if (err) return reject('Failed to retrieve jobs for renumbering');
      const jobs = rows.map((row, index) => ({ oldID: row.jobID, newID: index + 1 }));
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let errorOccurred = false;
        jobs.forEach(({ oldID, newID }) => {
          db.run(
            `UPDATE joblist SET jobID = ? WHERE jobID = ?`,
            [newID, oldID],
            (err2) => {
              if (err2) {
                errorOccurred = true;
                db.run('ROLLBACK');
                return reject('Failed to renumber job IDs');
              }
            }
          );
        });
        if (!errorOccurred) {
          db.run('COMMIT', (err3) => {
            if (err3) return reject('Failed to commit renumbering');
            resolve();
          });
        }
      });
    });
  });
}

// --------------------- New Functions for Cycled Assignment ---------------------

/**
 * Retrieves the current job index from the job_cycle table.
 * If the table is empty (or no row exists) it initializes it to 0.
 */
function getCurrentJobIndex() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT current_index FROM job_cycle LIMIT 1`, [], (err, row) => {
      if (err) {
        return reject('Failed to retrieve current job index');
      }
      if (!row) {
        // No row exists yet—initialize it with 0.
        db.run(`INSERT INTO job_cycle (current_index) VALUES (0)`, [], function (err2) {
          if (err2) return reject('Failed to initialize job cycle');
          resolve(0);
        });
      } else {
        resolve(row.current_index);
      }
    });
  });
}

/**
 * Updates the current job index in the job_cycle table.
 */
function setCurrentJobIndex(index) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE job_cycle SET current_index = ?`, [index], function (err) {
      if (err) return reject('Failed to update current job index');
      resolve();
    });
  });
}

/**
 * Assigns a job to a user using round-robin (cycled) logic.
 *
 * The steps are:
 * 1. Verify the user does not already have an active job.
 * 2. Retrieve the full list of jobs in a consistent order (ordered by jobID).
 * 3. Get the current index from the job_cycle table.
 * 4. Choose the job at that index.
 * 5. Increment the index (wrapping around to 0 if necessary) and update the table.
 * 6. Insert the assignment into job_assignees.
 */
function assignCycledJob(userID) {
  return new Promise((resolve, reject) => {
    if (!userID) return reject('Invalid user ID');
    db.serialize(() => {
      // Begin transaction for consistency.
      db.run('BEGIN TRANSACTION');
      // Verify the user does not already have an active job.
      db.get(`SELECT jobID FROM job_assignees WHERE userID = ?`, [userID], (err, row) => {
        if (err) {
          db.run('ROLLBACK');
          return reject('Failed to check existing assignments');
        }
        if (row) {
          db.run('ROLLBACK');
          return reject('User already has an assigned job');
        }
        // Retrieve all jobs (ordered by jobID for a consistent cycle).
        db.all(`SELECT jobID, description FROM joblist ORDER BY jobID ASC`, [], (err, jobs) => {
          if (err) {
            db.run('ROLLBACK');
            return reject('Failed to retrieve job list');
          }
          if (!jobs || jobs.length === 0) {
            db.run('ROLLBACK');
            return reject('No jobs available');
          }
          // Get the current job index.
          getCurrentJobIndex()
            .then((currentIndex) => {
              // Normalize index if out-of-bounds.
              if (currentIndex < 0 || currentIndex >= jobs.length) {
                currentIndex = 0;
              }
              const job = jobs[currentIndex];
              // Compute the next index (wrap-around to 0 if needed).
              const nextIndex = (currentIndex + 1) % jobs.length;
              // Update the job_cycle pointer.
              setCurrentJobIndex(nextIndex)
                .then(() => {
                  // Insert the assignment into job_assignees.
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
                })
                .catch((err) => {
                  db.run('ROLLBACK');
                  reject(err);
                });
            })
            .catch((err) => {
              db.run('ROLLBACK');
              reject(err);
            });
        });
      });
    });
  });
}

// =========================================================================
// Shop System
// =========================================================================

function getShopItems() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM items WHERE isAvailable = 1 AND quantity > 0`, [], (err, rows) => {
      if (err) {
        console.error('Error retrieving shop items:', err);
        return reject('🚫 Shop is currently unavailable. Please try again later.');
      }
      resolve(rows || []);
    });
  });
}

function getShopItemByName(name) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM items WHERE name = ? AND isAvailable = 1`, [name], (err, row) => {
      if (err) {
        console.error(`Error looking up item "${name}":`, err);
        return reject('🚫 Unable to retrieve item information. Please try again.');
      } else if (!row) {
        return reject(`🚫 The item "${name}" is not available in the shop.`);
      } else {
        resolve(row);
      }
    });
  });
}

function addShopItem(price, name, description, quantity = 1) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO items (price, name, description, quantity, isAvailable) VALUES (?, ?, ?, ?, 1)`,
      [price, name, description, quantity],
      (err) => {
        if (err) {
          console.error('Error adding new shop item:', err);
          return reject(new Error('🚫 Failed to add the item to the shop. Please try again.'));
        }
        resolve();
      }
    );
  });
}

function removeShopItem(name) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE items SET isAvailable = 0 WHERE name = ?`, [name], (err) => {
      if (err) {
        console.error(`Error removing item "${name}" from the shop:`, err);
        return reject('🚫 Failed to remove the item from the shop. Please try again.');
      }
      resolve();
    });
  });
}

async function updateShopItemQuantity(itemID, newQuantity) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE items SET quantity = ? WHERE itemID = ?', [newQuantity, itemID], (err) => {
      if (err) {
        console.error('Error updating item quantity:', err);
        return reject('🚫 Failed to update item stock.');
      }
      resolve();
    });
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

async function addItemToInventory(userID, itemID, quantity = 1) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT name FROM items WHERE itemID = ?`, [itemID], (err, row) => {
      if (err) {
        console.error('Error finding existing inventory row:', err);
        return reject(new Error('Failed to find existing inventory.'));
      }

      if (!row) return reject(new Error('Item does not exist.'));
      const itemName = row.name;

      // Add the item to inventory
      db.get(`SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`, [userID, itemID], (err, invRow) => {
        if (err) {
          console.error('Error finding existing inventory row:', err);
          return reject(new Error('Failed to find existing inventory.'));
        }

        if (!invRow) {
          db.run(`INSERT INTO inventory (userID, itemID, quantity) VALUES (?, ?, ?)`, [userID, itemID, quantity], (insertErr) => {
            if (insertErr) {
              console.error('Error inserting new inventory row:', insertErr);
              return reject(new Error('Failed to add item to inventory.'));
            }

            // ✅ Only trigger raffle entry if the item is a "Raffle Ticket"
            if (itemName.toLowerCase().includes('raffle ticket')) {
              autoEnterRaffle(userID, itemName, quantity);
            }

            resolve();
          });
        } else {
          const newQuantity = invRow.quantity + quantity;
          db.run(`UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`, [newQuantity, userID, itemID], (updateErr) => {
            if (updateErr) {
              console.error('Error updating inventory quantity:', updateErr);
              return reject(new Error('Failed to update inventory quantity.'));
            }

            // ✅ Only trigger raffle entry if the item is a "Raffle Ticket"
            if (itemName.toLowerCase().includes('raffle ticket')) {
              autoEnterRaffle(userID, itemName, quantity);
            }

            resolve();
          });
        }
      });
    });
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
// Giveaway Functions
// =========================================================================

// Save a new giveaway and return its auto-generated id.
async function saveGiveaway(messageId, channelId, endTime, prize, winners, giveawayName, repeat) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO giveaways (message_id, channel_id, end_time, prize, winners, giveaway_name, repeat) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [messageId, channelId, endTime, prize, winners, giveawayName, repeat],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}


// Get all active giveaways.
async function getActiveGiveaways() {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM giveaways WHERE end_time > ?',
      [Date.now()],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// Delete a giveaway by its message_id.
async function deleteGiveaway(messageId) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM giveaways WHERE message_id = ?', [messageId], function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Get a giveaway by its message_id.
async function getGiveawayByMessageId(messageId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM giveaways WHERE message_id = ?',
      [messageId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Record a giveaway entry (i.e. when a user reacts).
async function addGiveawayEntry(giveawayId, userId) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)',
      [giveawayId, userId],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

// Get all giveaway entries (user IDs) for a specific giveaway.
async function getGiveawayEntries(giveawayId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?',
      [giveawayId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => row.user_id));
      }
    );
  });
}

// Remove a giveaway entry when a reaction is removed.
async function removeGiveawayEntry(giveawayId, userId) {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?',
      [giveawayId, userId],
      function (err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Clear all giveaway entries for a given giveaway (used when syncing reactions).
async function clearGiveawayEntries(giveawayId) {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM giveaway_entries WHERE giveaway_id = ?',
      [giveawayId],
      function (err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

//================
// 🎟️ Raffles
//================


//--------------------------------------
// 1) Raffle Entry Methods
//--------------------------------------

/**
 * getRaffleParticipants(raffle_id)
 * Returns an array of row objects for each ticket:
 * [{ entry_id, raffle_id, user_id }, ...].
 *
 * This is more future-proof if you need to remove
 * a single winning ticket while keeping the user's other tickets.
 */
async function getRaffleParticipants(raffle_id) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT entry_id, raffle_id, user_id
       FROM raffle_entries
       WHERE raffle_id = ?`,
      [raffle_id],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

/**
 * addRaffleEntry(raffle_id, user_id)
 * Inserts a new row for each ticket purchased.
 * Allows multiple entries per user for the same raffle.
 */
async function addRaffleEntry(raffle_id, user_id) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO raffle_entries (raffle_id, user_id) VALUES (?, ?)`,
      [raffle_id, user_id],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

/**
 * clearRaffleEntries(raffle_id)
 * Removes all entries for a specific raffle.
 */
async function clearRaffleEntries(raffle_id) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM raffle_entries WHERE raffle_id = ?`,
      [raffle_id],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

//--------------------------------------
// 2) Creating & Fetching Raffles
//--------------------------------------

async function upsertShopItem(price, name, description, quantity) {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO items (price, name, description, quantity, isAvailable)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(name) DO UPDATE SET quantity = items.quantity + excluded.quantity
    `, [price, name, description, quantity], function (err) {
      if (err) return reject(new Error('🚫 Failed to upsert shop item.'));
      resolve();
    });
  });
}


/**
 * createRaffle(channelId, name, prize, cost, quantity, winners, endTime)
 * Creates a new raffle in the "raffles" table,
 * Also adds (or increments) a "RaffleName Ticket" to the shop.
 */
const { format } = require('date-fns'); // ✅ Import date-fns for formatting

async function createRaffle(channelId, name, prize, cost, quantity, winners, endTime) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO raffles (channel_id, name, prize, cost, quantity, winners, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [channelId, name, prize, cost, quantity, winners, endTime],
      function (err) {
        if (err) return reject(err);

        const raffleId = this.lastID; 
        const ticketName = `${name} Raffle Ticket`;

        // ✅ Format the end date nicely (e.g., "Feb 25 at 3:30 PM")
        const formattedEndTime = format(new Date(endTime), "MMM d 'at' h:mm a");

        // ✅ Description now includes number of winners AND raffle end time
        const ticketDesc = `Entry ticket for the ${name} raffle. 🏆 ${winners} winner(s) will be selected! ⏳ Ends on ${formattedEndTime}.`;

        // ✅ Single "upsert" query for the raffle ticket
        const insertUpsert = `
          INSERT INTO items (name, description, price, isAvailable, quantity)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(name) 
          DO UPDATE SET quantity = items.quantity + excluded.quantity
        `;
        
        db.run(insertUpsert, [ticketName, ticketDesc, cost, quantity], (err2) => {
          if (err2) {
            console.error(`⚠️ Upsert Error for '${ticketName}':`, err2);
            return reject(new Error('🚫 Failed to add or update raffle ticket in the shop.'));
          }
          console.log(`✅ Upserted raffle ticket '${ticketName}' successfully.`);
          resolve(raffleId);
        });
      }
    );
  });
}





/**
 * getRaffleByName(name)
 * Fetches an active raffle by its name (end_time > now).
 * Useful for auto-entering users when they buy a "RaffleName Ticket".
 */
async function getRaffleByName(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM raffles
       WHERE name = ?
       AND end_time > ?`,  // Only fetch active raffles
      [name, Date.now()],
      (err, row) => {
        if (err) {
          console.error(`❌ Error finding raffle by name '${name}':`, err);
          return reject(err);
        }
        if (!row) {
          console.warn(`⚠️ No active raffle found for '${name}'`);
          return resolve(null); // Return null if no raffle found
        }
        console.log(`✅ Found active raffle: ${row.name} (ID: ${row.id})`);
        resolve(row);
      }
    );
  });
}


/**
 * getRaffleById(raffle_id)
 * Fetches a raffle by its ID (used during conclusion).
 */
async function getRaffleById(raffle_id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM raffles
       WHERE id = ?`,
      [raffle_id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

/**
 * getActiveRaffles()
 * Returns all raffles that haven't ended yet (end_time > now).
 */
async function getActiveRaffles() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT *
       FROM raffles
       WHERE end_time > ?`,
      [Date.now()],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}



//--------------------------------------
// 3) Auto-Entering a Raffle
//--------------------------------------

/**
 * autoEnterRaffle(userID, ticketName)
 * Called when a user buys a "RaffleName Ticket" from the shop.
 * Finds the raffle by name and calls addRaffleEntry.
 */
async function autoEnterRaffle(userID, itemName, quantity = 1) {
  return new Promise((resolve, reject) => {
    const raffleName = itemName.replace(" Raffle Ticket", "").trim(); // Extract raffle name
    db.get(
      `SELECT id FROM raffles WHERE name = ? AND end_time > ?`,
      [raffleName, Date.now()],
      (err, row) => {
        if (err) {
          console.error('Error finding raffle:', err);
          return reject(new Error('🚫 Failed to enter raffle.'));
        }

        if (!row) {
          console.warn(`⚠️ No active raffle found for "${raffleName}". Skipping entry.`);
          return resolve();
        }

        const { id: raffle_id } = row; // Use correct ID

        // Insert the user into the raffle `quantity` times
        for (let i = 0; i < quantity; i++) {
          db.run(
            `INSERT INTO raffle_entries (raffle_id, user_id) VALUES (?, ?)`,
            [raffle_id, userID],
            (insertErr) => {
              if (insertErr) {
                console.error(`Error entering user ${userID} into raffle ${raffle_id}:`, insertErr);
              } else {
                console.log(`✅ User ${userID} entered into raffle ${raffle_id} with ticket "${itemName}".`);
              }
            }
          );
        }

        resolve();
      }
    );
  });
}


//--------------------------------------
// 4) Removing Raffle Shop Item
//--------------------------------------

/**
 * removeRaffleShopItem(raffleName)
 * Removes the "RaffleName Ticket" item from the shop,
 * and clears that item from all user inventories.
 */
async function removeRaffleShopItem(raffleName) {
  return new Promise((resolve, reject) => {
    const ticketName = `${raffleName} Raffle Ticket`;

    db.serialize(() => {
      // 4a) Remove the item from the "items" table
      db.run(`DELETE FROM items WHERE name = ?`, [ticketName], function (err) {
        if (err) {
          console.error(`⚠️ Error removing raffle shop item "${ticketName}":`, err);
          return reject(`🚫 Failed to remove raffle item.`);
        }
        console.log(`✅ Raffle shop item "${ticketName}" removed successfully.`);

        // 4b) Remove that ticket from user inventories
        db.run(
          `DELETE FROM inventory
           WHERE itemID IN (
             SELECT itemID FROM items WHERE name = ?
           )`,
          [ticketName],
          function (err) {
            if (err) {
              console.error(`⚠️ Error clearing raffle tickets from inventories:`, err);
              return reject(`🚫 Failed to remove raffle tickets from users.`);
            }
            console.log(`✅ All "${ticketName}" tickets removed from user inventories.`);
            resolve();
          }
        );
      });
    });
  });
}

//--------------------------------------
// 5) Conclude a Raffle
//--------------------------------------

/**
 * concludeRaffle(raffle_id, channel)
 * - Fetches the raffle by ID
 * - Gets all participant "ticket" rows
 * - Shuffles & picks winners
 * - Awards currency or item
 * - Removes ticket shop item & clears entries
 */
async function concludeRaffle(raffle_id, channel) {
  try {
    const raffle = await getRaffleById(raffle_id);
    if (!raffle) {
      console.error(`❌ Raffle ${raffle_id} not found in DB.`);
      return;
    }

    // 5a) Fetch participant rows
    const participants = await getRaffleParticipants(raffle_id);
    if (participants.length === 0) {
      await channel.send(`🚫 The **${raffle.name}** raffle ended, but no one entered.`);
      await removeRaffleShopItem(raffle.name);
      await clearRaffleEntries(raffle_id);
      return;
    }

    console.log(`🎟️ Raffle "${raffle.name}" has ${participants.length} total tickets.`);

    // 5b) Shuffle & pick winners (limit by raffle.winners)
    const shuffled = participants.sort(() => Math.random() - 0.5);
    const winningEntries = shuffled.slice(0, raffle.winners);

    if (winningEntries.length === 0) {
      console.error(`❌ No winners selected for raffle "${raffle.name}"`);
      return;
    }

    // 5c) Award the prizes
    if (!isNaN(raffle.prize)) {
      // Prize is numeric currency (e.g., coins/points)
      const prizeAmount = parseInt(raffle.prize, 10);
      for (const ticket of winningEntries) {
        await db.updateWallet(ticket.user_id, prizeAmount);
        console.log(`💰 ${ticket.user_id} won ${prizeAmount} coins!`);
      }
    } else {
      // Prize is a shop item
      const shopItem = await db.getShopItemByName(raffle.prize);
      if (shopItem) {
        for (const ticket of winningEntries) {
          await db.addItemToInventory(ticket.user_id, shopItem.itemID);
          console.log(`🎁 ${ticket.user_id} won "${shopItem.name}"!`);
        }
      } else {
        console.error(`❌ Could not find shop item "${raffle.prize}"`);
      }
    }

    // 5d) Announce winners in the channel
    const winnerMentions = winningEntries.map(entry => `<@${entry.user_id}>`).join(', ');
    await channel.send(
      `🎉 The **${raffle.name}** raffle has ended! Congratulations to: ${winnerMentions}`
    );

    // 5e) Clean up: remove the raffle shop item & clear entries
    await removeRaffleShopItem(raffle.name);
    await clearRaffleEntries(raffle_id);

    console.log(`✅ Raffle "${raffle.name}" concluded and cleaned up.`);
  } catch (err) {
    console.error(`❌ Error concluding raffle ${raffle_id}:`, err);
  }
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
  getLeaderboard,

  // Shop
  getShopItems,
  getShopItemByName,
  addShopItem,
  removeShopItem,
  getInventory,
  addItemToInventory,
  updateShopItemQuantity,
  redeemItem,
  getRaffleParticipants,
  addRaffleEntry,
  upsertShopItem,
  clearRaffleEntries,
  getActiveRaffles,
  createRaffle,
  getRaffleByName,
  getRaffleById,
  getActiveRaffles,
  autoEnterRaffle,
  removeRaffleShopItem,
  concludeRaffle,

  // Jobs
  getActiveJob,
  getUserJob,
  addJob,
  getJobList,
  completeJob,
  renumberJobs,
  getCurrentJobIndex,
  setCurrentJobIndex,
  assignCycledJob,
  assignJobById,
  getAllJobs,

  // Giveaway
  initializeDatabase,
  saveGiveaway,
  getActiveGiveaways,
  deleteGiveaway,
  getGiveawayByMessageId,
  addGiveawayEntry,
  getGiveawayEntries,
  removeGiveawayEntry,
  clearGiveawayEntries,
};
