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

const PREFIX = '$'; // Command prefix

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', (message) => {
  // Ignore the bot's own messages but allow other bots' messages
  if (message.author.id === client.user.id) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const userID = message.author.id;

  // Check if a user is a bot-specific admin
  const isBotAdmin = (userID, callback) => {
    db.get(`SELECT * FROM admins WHERE userID = ?`, [userID], (err, row) => {
      if (err) {
        console.error(err);
        callback(false);
      } else {
        callback(!!row);
      }
    });
  };

  // Pizza Help command
  if (command === 'pizzahelp') {
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
  }

  // Balance command (self or another user)
  else if (command === 'balance') {
    const target = message.mentions.users.first() || message.author; // Mentioned user or self
    db.get(`SELECT balance FROM economy WHERE userID = ?`, [target.id], (err, row) => {
      if (err) {
        console.error(err);
        return message.reply('🚫 An error occurred while retrieving the balance.');
      }
      if (!row) {
        return message.reply(`🍕 ${target === message.author ? 'You have' : `<@${target.id}> has`} no account yet.`);
      }
      message.reply(`🍕 ${target === message.author ? 'You have' : `<@${target.id}> has`} **${row.balance}** 🍕.`);
    });
  }

  // Leaderboard command
  else if (command === 'leaderboard') {
    db.all(`SELECT userID, balance FROM economy ORDER BY balance DESC LIMIT 10`, [], (err, rows) => {
      if (err) {
        console.error(err);
        return message.reply('🚫 An error occurred while retrieving the leaderboard.');
      }
      if (rows.length === 0) {
        return message.reply('🚫 No accounts found.');
      }

      const leaderboard = rows
        .map((row, index) => `${index + 1}. <@${row.userID}>: **${row.balance}** 🍕`)
        .join('\n');

      message.reply(`🏆 **Pizza Leaderboard** 🏆\n${leaderboard}`);
    });
  }

  // Bake command (Restricted to bot-specific admins or server admins)
  else if (command === 'bake') {
    isBotAdmin(userID, (isAdmin) => {
      const isServerAdmin = message.member.permissions.has('ADMINISTRATOR');

      if (!isServerAdmin && !isAdmin) {
        return message.reply(
          '🚫 Only server administrators or bot admins can use this command.'
        );
      }

      // Add 6969 pizza
      const amount = 6969; // Fixed amount of pizza
      db.run(`UPDATE economy SET balance = balance + ? WHERE userID = ?`, [amount, userID], (err) => {
        if (err) {
          console.error(err);
          return message.reply('🚫 An error occurred while baking pizza.');
        }
        message.reply(`🍕 You baked **6969** 🍕! Enjoy your pizza!`);
      });
    });
  }

  // Give money command
  else if (command === 'give-money') {
    const target = message.mentions.users.first();
    const amount = parseInt(args[1], 10);

    if (!target || isNaN(amount) || amount <= 0) {
      return message.reply('🚫 **Invalid command usage.** Please use: `$give-money @user <amount>`.');
    }

    if (target.id === userID) {
      return message.reply('🚫 You cannot send 🍕 to yourself!');
    }

    db.get(`SELECT balance FROM economy WHERE userID = ?`, [userID], (err, sender) => {
      if (err) {
        console.error(err);
        return message.reply('🚫 An error occurred while processing your request.');
      }

      if (!sender || sender.balance < amount) {
        return message.reply('🚫 You do not have enough 🍕 to send.');
      }

      db.run(`INSERT OR IGNORE INTO economy (userID) VALUES (?)`, [target.id]);
      db.run(`UPDATE economy SET balance = balance - ? WHERE userID = ?`, [amount, userID]);
      db.run(`UPDATE economy SET balance = balance + ? WHERE userID = ?`, [amount, target.id], (err) => {
        if (err) {
          console.error(err);
          return message.reply('🚫 An error occurred while completing the transaction.');
        }
        message.reply(`✅ You sent **${amount}** 🍕 to <@${target.id}>!`);
      });
    });
  }
});

// Use the token from the .env file
client.login(process.env.DISCORD_TOKEN);

