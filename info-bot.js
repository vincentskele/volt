require('dotenv').config(); // Load .env variables

const { Client, GatewayIntentBits } = require('discord.js');

// Ensure we get user and message events
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Read token from INFO_TOKEN instead of TOKEN
const TOKEN = process.env.INFO_TOKEN;

if (!TOKEN) {
  console.error("Missing INFO_TOKEN in .env file!");
  process.exit(1);
}

// Bot event when ready
client.once('ready', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
});

// Example command listener
client.on('messageCreate', async (message) => {
  if (message.author.bot) return; // Ignore bot messages

  if (message.content.toLowerCase() === '!ping') {
    message.reply('🏓 Pong!');
  }
});

// Log in the bot
client.login(TOKEN)
  .catch(err => console.error("Failed to login:", err));

module.exports = { client };
