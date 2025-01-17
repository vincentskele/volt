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

  transferBalance: (fromUserID, toUserID, amount) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT balance FROM economy WHERE userID = ?`, [fromUserID], (err, row) => {
        if (err || !row || row.balance < amount) {
          return reject('Insufficient balance');
        }
        db.run(`UPDATE economy SET balance = balance - ? WHERE userID = ?`, [amount, fromUserID]);
        db.run(`INSERT OR IGNORE INTO economy (userID, balance) VALUES (?, 0)`, [toUserID]);
        db.run(`UPDATE economy SET balance = balance + ? WHERE userID = ?`, [amount, toUserID], (err) => {
          if (err) return reject('Error transferring balance');
          resolve();
        });
      });
    });
  },

  getLeaderboard: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT userID, balance FROM economy ORDER BY balance DESC LIMIT 10`, [], (err, rows) => {
        if (err) return reject('Error retrieving leaderboard');
        let leaderboard = '🏆 **Pizza Leaderboard**\n\n';
        rows.forEach((row, i) => {
          leaderboard += `${i + 1}. <@${row.userID}>: ${row.balance} 🍕\n`;
        });
        resolve(leaderboard);
      });
    });
  },

  addAdmin: (userID) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT OR IGNORE INTO admins (userID) VALUES (?)`, [userID], (err) => {
        if (err) return reject('Error adding admin');
        resolve();
      });
    });
  },

  removeAdmin: (userID) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM admins WHERE userID = ?`, [userID], (err) => {
        if (err) return reject('Error removing admin');
        resolve();
      });
    });
  },

  getAdmins: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT userID FROM admins`, [], (err, rows) => {
        if (err) return reject('Error retrieving admins');
        if (rows.length === 0) return resolve('👥 No bot admins configured.');
        resolve(rows.map(row => `<@${row.userID}>`).join('\n'));
      });
    });
  },

  getShopItems: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT name, description, price FROM items WHERE isAvailable = 1`, [], (err, rows) => {
        if (err) return reject('Error retrieving shop items');
        if (rows.length === 0) return resolve('🏪 The shop is currently empty!');
        const shopList = rows.map(item => `**${item.name}** - ${item.price} 🍕\n└ ${item.description}`).join('\n\n');
        resolve(`🏪 **Pizza Shop:**\n\n${shopList}`);
      });
    });
  },

  addItem: (price, name, description) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO items (name, description, price, isAvailable) VALUES (?, ?, ?, 1)`,
        [name, description, price],
        (err) => {
          if (err) return reject('Error adding item to shop');
          resolve();
        }
      );
    });
  },

  removeItem: (name) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM items WHERE name = ?`, [name], (err) => {
        if (err) return reject('Error removing item from shop');
        resolve();
      });
    });
  },

  buyItem: (userID, itemName) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM items WHERE name = ? AND isAvailable = 1`,
        [itemName],
        (err, item) => {
          if (err || !item) return reject('This item does not exist or is not available.');

          db.get(`SELECT balance FROM economy WHERE userID = ?`, [userID], (err, user) => {
            if (err || !user || user.balance < item.price) {
              return reject(`You need ${item.price} 🍕 to buy this item. You only have ${user ? user.balance : 0} 🍕.`);
            }

            db.run(`UPDATE economy SET balance = balance - ? WHERE userID = ?`, [item.price, userID], (err) => {
              if (err) {
                return reject('Error processing the purchase.');
              }

              db.run(
                `INSERT INTO inventory (userID, itemID, quantity) 
                 VALUES (?, ?, 1) 
                 ON CONFLICT(userID, itemID) 
                 DO UPDATE SET quantity = quantity + 1`,
                [userID, item.itemID],
                (err) => {
                  if (err) return reject('Error updating inventory.');
                  resolve(`✅ You bought **${item.name}** for ${item.price} 🍕.`);
                }
              );
            });
          });
        }
      );
    });
  },

  getInventory: (userID) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT i.name, i.description, inv.quantity 
         FROM inventory inv 
         JOIN items i ON inv.itemID = i.itemID 
         WHERE inv.userID = ?`,
        [userID],
        (err, rows) => {
          if (err) return reject('Error retrieving inventory');
          if (rows.length === 0) {
            return resolve('🎒 Your inventory is empty!');
          }

          const inventoryList = rows
            .map((item) => `**${item.name}** (${item.quantity}x)\n└ ${item.description}`)
            .join('\n\n');
          resolve(`🎒 **Inventory:**\n\n${inventoryList}`);
        }
      );
    });
  },

  transferItem: (fromUserID, toUserID, itemName) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT inv.quantity, i.itemID FROM inventory inv
         JOIN items i ON inv.itemID = i.itemID
         WHERE inv.userID = ? AND i.name = ?`,
        [fromUserID, itemName],
        (err, item) => {
          if (err || !item || item.quantity < 1) {
            return reject(`You don't have **${itemName}** in your inventory.`);
          }

          db.run(`BEGIN TRANSACTION`);
          db.run(
            `UPDATE inventory SET quantity = quantity - 1 
             WHERE userID = ? AND itemID = ?`,
            [fromUserID, item.itemID]
          );
          db.run(
            `INSERT INTO inventory (userID, itemID, quantity) 
             VALUES (?, ?, 1) 
             ON CONFLICT(userID, itemID) 
             DO UPDATE SET quantity = quantity + 1`,
            [toUserID, item.itemID],
            (err) => {
              if (err) {
                db.run(`ROLLBACK`);
                return reject('Error transferring item.');
              }
              db.run(`COMMIT`);
              resolve(`✅ Transferred **${itemName}** to <@${toUserID}>.`);
            }
          );
        }
      );
    });
  },
};

