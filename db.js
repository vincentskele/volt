const SQLite = require('sqlite3').verbose();

const db = new SQLite.Database('./economy.db', (err) => {
  if (err) console.error('Error connecting to database:', err);
  console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS economy (userID TEXT PRIMARY KEY, balance INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS admins (userID TEXT PRIMARY KEY)`);
  db.run(`CREATE TABLE IF NOT EXISTS items (
    itemID INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    description TEXT,
    price INTEGER,
    isAvailable BOOLEAN DEFAULT 1
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    userID TEXT,
    itemID INTEGER,
    quantity INTEGER DEFAULT 1,
    PRIMARY KEY(userID, itemID),
    FOREIGN KEY(itemID) REFERENCES items(itemID)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS joblist (
    jobID INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    isCompleted BOOLEAN DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS user_jobs (
    userID TEXT NOT NULL,
    jobID INTEGER NOT NULL,
    assignedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(userID, jobID),
    FOREIGN KEY(jobID) REFERENCES joblist(jobID)
  )`);
});

module.exports = {
  getBalance: (userID) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT balance FROM economy WHERE userID = ?`, [userID], (err, row) => {
        if (err) return reject('Error retrieving balance');
        resolve(row ? row.balance : 0);
      });
    });
  },

  addBalance: (userID, amount) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT OR IGNORE INTO economy (userID, balance) VALUES (?, 0)`, [userID], (err) => {
        if (err) return reject('Error initializing user');
        db.run(`UPDATE economy SET balance = balance + ? WHERE userID = ?`, [amount, userID], (err) => {
          if (err) return reject('Error updating balance');
          resolve();
        });
      });
    });
  },

  addJob: (description) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO joblist (description) VALUES (?)`, [description], (err) => {
        if (err) {
          console.error('Error adding job:', err);
          return reject('Error adding job to the list.');
        }
        resolve('✅ Job added successfully!');
      });
    });
  },

  getJobs: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM joblist WHERE isCompleted = 0 ORDER BY createdAt ASC`, [], (err, rows) => {
        if (err) {
          console.error('Error retrieving jobs:', err);
          return reject('Error retrieving job list.');
        }
        if (rows.length === 0) {
          return resolve('📋 The joblist is currently empty!');
        }
        const jobList = rows
          .map((job) => `🔹 **#${job.jobID}** - ${job.description} (Created: ${job.createdAt})`)
          .join('\n');
        resolve(`📋 **Job List:**\n\n${jobList}`);
      });
    });
  },

  completeJob: (jobID) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE joblist SET isCompleted = 1 WHERE jobID = ?`, [jobID], (err) => {
        if (err) {
          console.error('Error completing job:', err);
          return reject('Error marking the job as completed.');
        }
        resolve(`✅ Job #${jobID} marked as completed!`);
      });
    });
  },

  assignJobToUser: (userID) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM joblist WHERE isCompleted = 0 ORDER BY RANDOM() LIMIT 1`,
        [],
        (err, job) => {
          if (err || !job) {
            return reject('No available jobs to assign.');
          }

          db.run(
            `INSERT INTO user_jobs (userID, jobID, assignedAt) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [userID, job.jobID],
            (err) => {
              if (err) {
                console.error('Error assigning job:', err);
                return reject('Failed to assign the job.');
              }
              resolve(`✅ Job assigned: **${job.description}**. Get to work!`);
            }
          );
        }
      );
    });
  },
};

