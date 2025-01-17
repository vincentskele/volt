// Load environment variables from .env
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const SQLite = require('sqlite3').verbose();

// Initialize the database
const db = new SQLite.Database('./economy.db', (err) => {
  if (err) console.error(err);
  console.log('Connected to SQLite database.');
});

// Create the economy table and admin table if they don't exist
db.run(`CREATE TABLE IF NOT EXISTS economy (userID TEXT PRIMARY KEY, balance INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE IF NOT EXISTS admins (userID TEXT PRIMARY KEY)`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '$';

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;
  if (!message.content.startsWith(PREFIX)) return;

  // Get the full command including hyphens
  const fullCommand = message.content.slice(PREFIX.length).trim();
  const args = fullCommand.split(/ +/);
  const command = args.shift().toLowerCase();

  const userID = message.author.id;

  // Promise-based admin check
  const isBotAdmin = async (userID) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM admins WHERE userID = ?`, [userID], (err, row) => {
        if (err) reject(err);
        resolve(!!row);
      });
    });
  };

  // Initialize user in economy table if they don't exist
  await new Promise((resolve, reject) => {
    db.run(`INSERT OR IGNORE INTO economy (userID) VALUES (?)`, [userID], (err) => {
      if (err) reject(err);
      resolve();
    });
  });

  try {
    switch (command) {
      case 'pizzahelp':
        const helpMessage = `
**Pizza Bot Commands:**
🍕 **$pizzahelp**: Show this list of commands.
🍕 **$balance [@user]**: Check your balance or mention another user to see theirs.
🍕 **$bake**: Admin-only. Bake 6969 🍕 for yourself.
🍕 **$give-money @user <amount>**: Send 🍕 to another user.
🍕 **$leaderboard**: View the top 10 pizza holders.
🍕 **$add-admin @user**: Admin-only. Add a bot-specific admin.
🍕 **$remove-admin @user**: Admin-only. Remove a bot-specific admin.
🍕 **$list-admins**: List all bot-specific admins.
        `;
        return message.channel.send(helpMessage);
        break;

      case 'list-admins':
        db.all(`SELECT userID FROM admins`, [], async (err, rows) => {
          if (err) {
            console.error(err);
            return message.reply('🚫 An error occurred while retrieving admins.');
          }
          if (rows.length === 0) {
            return message.reply('👥 No bot admins configured.');
          }
          const adminList = rows.map(row => `<@${row.userID}>`).join('\n');
          message.reply(`👥 **Bot Admins:**\n${adminList}`);
        });
        break;

      case 'add-admin':
        const isAdmin = await isBotAdmin(userID);
        const isServerAdmin = message.member.permissions.has('ADMINISTRATOR');
        
        if (!isAdmin && !isServerAdmin) {
          return message.reply('🚫 Only server administrators or bot admins can use this command.');
        }

        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply('🚫 Please mention a user to add as admin.');
        }

        db.run(`INSERT OR IGNORE INTO admins (userID) VALUES (?)`, [targetUser.id], (err) => {
          if (err) {
            console.error(err);
            return message.reply('🚫 An error occurred while adding admin.');
          }
          message.reply(`✅ Added <@${targetUser.id}> as a bot admin.`);
        });
        break;

      case 'remove-admin':
        const isRemovingAdmin = await isBotAdmin(userID);
        const hasServerAdminPerms = message.member.permissions.has('ADMINISTRATOR');
        
        if (!isRemovingAdmin && !hasServerAdminPerms) {
          return message.reply('🚫 Only server administrators or bot admins can use this command.');
        }

        const targetRemove = message.mentions.users.first();
        if (!targetRemove) {
          return message.reply('🚫 Please mention a user to remove as admin.');
        }

        db.run(`DELETE FROM admins WHERE userID = ?`, [targetRemove.id], (err) => {
          if (err) {
            console.error(err);
            return message.reply('🚫 An error occurred while removing admin.');
          }
          message.reply(`✅ Removed <@${targetRemove.id}> from bot admins.`);
        });
        break;

      // ... [Previous command handlers for balance, bake, give-money, etc. remain the same]
    }
  } catch (error) {
    console.error(error);
    message.reply('🚫 An error occurred while processing the command.');
  }
});

client.login(process.env.DISCORD_TOKEN);
