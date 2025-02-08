// bot.js
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Import the required database functions (adjust to your actual db.js exports).
const {
  getActiveGiveaways,
  deleteGiveaway,
  updateWallet,
  getShopItemByName,
  addItemToInventory,
  getGiveawayByMessageId,
  addGiveawayEntry,
  removeGiveawayEntry,
  clearGiveawayEntries,
} = require('./db');

// Initialize the bot client with necessary intents and partials.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const PREFIX = process.env.PREFIX || '$';
client.commands = new Collection();
const commandModules = {};

// Dynamically load commands from the "commands" folder (and subfolders).
const commandsPath = path.join(__dirname, 'commands');
function loadCommands(dir) {
  console.log(`Scanning directory: ${dir}`);
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      console.log(`Entering subdirectory: ${entry}`);
      loadCommands(fullPath);
    } else if (entry.endsWith('.js')) {
      console.log(`Found command file: ${entry}`);
      try {
        const command = require(fullPath);
        // We check for slash command structure (command.data) or a normal 'execute'
        if ('data' in command && 'execute' in command) {
          // For slash commands:
          client.commands.set(command.data.name, command);
          // For prefix commands:
          commandModules[command.data.name] = command;
          console.log(`Loaded command: ${command.data.name}`);
        } else {
          console.warn(`⚠️ Skipped loading "${entry}" due to missing "data" or "execute".`);
        }
      } catch (err) {
        console.error(`❌ Error loading command "${entry}":`, err);
      }
    }
  }
}
loadCommands(commandsPath);

/**
 * Synchronize persistent giveaway entries for a given giveaway.
 * 1) Fetch the message from Discord
 * 2) Look at all 🎉 reactions (ignoring bots)
 * 3) Clear old entries in DB, re-add them
 */
async function syncGiveawayEntries(giveaway) {
  try {
    const channel = await client.channels.fetch(giveaway.channel_id);
    if (!channel) return;
    const message = await channel.messages.fetch(giveaway.message_id);
    if (!message) return;

    const reaction = message.reactions.cache.get('🎉');
    let participantIDs = [];
    if (reaction) {
      const usersReacted = await reaction.users.fetch();
      participantIDs = usersReacted.filter(u => !u.bot).map(u => u.id);
    }
    // Clear existing DB entries and re-add
    await clearGiveawayEntries(giveaway.id);
    for (const userId of participantIDs) {
      await addGiveawayEntry(giveaway.id, userId);
    }
    console.log(`Synced persistent entries for giveaway ${giveaway.id}`);
  } catch (error) {
    console.error('Error syncing giveaway entries:', error);
  }
}

/**
 * Reaction listener for adding a giveaway entry.
 */
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;
  try {
    if (reaction.partial) await reaction.fetch();
    const giveaway = await getGiveawayByMessageId(reaction.message.id);
    if (!giveaway) return; // Not a recognized giveaway message
    await addGiveawayEntry(giveaway.id, user.id);
    console.log(`Recorded giveaway entry for user ${user.id} in giveaway ${giveaway.id}`);
  } catch (err) {
    console.error('Error recording giveaway entry (add):', err);
  }
});

/**
 * Reaction listener for removing a giveaway entry.
 */
client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;
  try {
    if (reaction.partial) await reaction.fetch();
    const giveaway = await getGiveawayByMessageId(reaction.message.id);
    if (!giveaway) return;
    await removeGiveawayEntry(giveaway.id, user.id);
    console.log(`Removed giveaway entry for user ${user.id} from giveaway ${giveaway.id}`);
  } catch (err) {
    console.error('Error handling reaction remove:', err);
  }
});

/**
 * Conclude a giveaway by fetching winners, awarding prizes, and announcing them.
 */
async function concludeGiveaway(giveaway) {
  try {
    console.log(`⏳ Resolving giveaway: ${giveaway.message_id}`);
    const channel = await client.channels.fetch(giveaway.channel_id);
    if (!channel) {
      console.error(`❌ Channel ${giveaway.channel_id} not found.`);
      return;
    }
    const message = await channel.messages.fetch(giveaway.message_id);
    if (!message) {
      console.error(`❌ Message ${giveaway.message_id} not found.`);
      return;
    }

    // Check for reactions
    const reaction = message.reactions.cache.get('🎉');
    if (!reaction) {
      await channel.send('🚫 No one participated in the giveaway.');
      await deleteGiveaway(giveaway.message_id);
      return;
    }

    const usersReacted = await reaction.users.fetch();
    const participants = usersReacted.filter(user => !user.bot);

    if (participants.size === 0) {
      await channel.send('🚫 No one participated in the giveaway.');
      await deleteGiveaway(giveaway.message_id);
      return;
    }

    // Select winners randomly
    const participantArray = Array.from(participants.values());
    const selectedWinners = [];
    while (
      selectedWinners.length < giveaway.winners &&
      selectedWinners.length < participantArray.length
    ) {
      const randomIndex = Math.floor(Math.random() * participantArray.length);
      const selectedUser = participantArray[randomIndex];
      if (!selectedWinners.includes(selectedUser)) {
        selectedWinners.push(selectedUser);
      }
    }

    // Check if the prize is numeric currency or a named shop item
    const prizeCurrency = parseInt(giveaway.prize, 10);
    for (const winner of selectedWinners) {
      if (!isNaN(prizeCurrency)) {
        // Award currency
        await updateWallet(winner.id, prizeCurrency);
        console.log(`💰 Updated wallet for ${winner.id}: +${prizeCurrency}`);
      } else {
        // Award shop item
        try {
          const shopItem = await getShopItemByName(giveaway.prize);
          await addItemToInventory(winner.id, shopItem.itemID, 1);
          console.log(`🎁 Awarded shop item "${giveaway.prize}" to ${winner.id}`);
        } catch (err) {
          console.error(`❌ Failed to award shop item to ${winner.id}:`, err);
        }
      }
    }

    // Announce winners
    const winnersMention = selectedWinners.map(u => `<@${u.id}>`).join(', ');
    await channel.send(`🎉 Congratulations ${winnersMention}! You won **${giveaway.prize}**!`);
    await deleteGiveaway(giveaway.message_id);
    console.log(`✅ Giveaway ${giveaway.message_id} resolved and deleted from DB.`);
  } catch (err) {
    console.error('❌ Error concluding giveaway:', err);
  }
}

/**
 * On bot ready: restore any active giveaways from the DB,
 * set timeouts to conclude them if needed, or conclude instantly if overdue.
 */
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is ready to use commands with prefix "${PREFIX}".`);

  const activeGiveaways = await getActiveGiveaways();
  console.log(`🔄 Restoring ${activeGiveaways.length} active giveaways...`);

  for (const giveaway of activeGiveaways) {
    // Sync the DB with current reactions (in case of offline period)
    await syncGiveawayEntries(giveaway);

    const remainingTime = giveaway.end_time - Date.now();
    if (remainingTime > 0) {
      // Schedule for the future
      setTimeout(async () => {
        await concludeGiveaway(giveaway);
      }, remainingTime);
      console.log(`Scheduled giveaway ${giveaway.message_id} to conclude in ${remainingTime}ms.`);
    } else {
      // Conclude immediately if it's already expired
      await concludeGiveaway(giveaway);
    }
  }
});

// Handle prefix-based commands (e.g. "$balance")
client.on('messageCreate', async (message) => {
  // Ignore bots and anything not starting with prefix
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const [command, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = command.toLowerCase();

  try {
    const commandModule = commandModules[commandName];
    if (!commandModule) {
      return message.reply(`🚫 Unknown command: "${commandName}". Use \`${PREFIX}help\` for help.`);
    }
    // Execute the prefix command
    await commandModule.execute('prefix', message, args);
  } catch (error) {
    console.error('Error handling prefix command:', error);
    await message.reply('🚫 An error occurred while processing your command.');
  }
});

// Handle slash commands ("/balance", etc.)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return interaction.reply({ content: '🚫 Command not found. Try /help.', ephemeral: true });
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing slash command ${interaction.commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '🚫 There was an error executing that command!',
        ephemeral: true,
      });
    } else {
      await interaction.reply({ content: '🚫 There was an error executing that command!', ephemeral: true });
    }
  }
});

// ==========================
// 🎁 DAILY REWARDS SYSTEM 🎁
// ==========================

const userMessageCountsPath = path.join(__dirname, 'userMessageCounts.json');

// Load previous message counts from file
let userMessageCounts = new Map();
try {
  if (fs.existsSync(userMessageCountsPath)) {
    const rawData = fs.readFileSync(userMessageCountsPath);
    userMessageCounts = new Map(JSON.parse(rawData));
    console.log("✅ Loaded message counts from file.");
  }
} catch (error) {
  console.error("⚠️ Error loading message counts:", error);
}

// Load values from .env
const allowedChannels = process.env.MESSAGE_REWARD_CHANNELS
  ? process.env.MESSAGE_REWARD_CHANNELS.split(',').map(id => id.trim())
  : [];

const REACTION_REWARD_CHANNEL = process.env.REACTION_REWARD_CHANNEL || "";
const MESSAGE_REWARD_AMOUNT = parseInt(process.env.MESSAGE_REWARD_AMOUNT, 10) || 10;
const MESSAGE_REWARD_LIMIT = parseInt(process.env.MESSAGE_REWARD_LIMIT, 10) || 8;
const REACTION_REWARD_AMOUNT = parseInt(process.env.REACTION_REWARD_AMOUNT, 10) || 20;

// Function to save message counts to file
function saveMessageCounts() {
  fs.writeFileSync(userMessageCountsPath, JSON.stringify([...userMessageCounts]), 'utf8');
}

// ==========================
// ⏳ SCHEDULE MIDNIGHT EST RESET
// ==========================
function scheduleMidnightReset() {
  const now = new Date();
  const estOffset = -5 * 60 * 60 * 1000; // EST offset in milliseconds
  const estMidnight = new Date(now.toISOString().split('T')[0] + 'T05:00:00.000Z'); // Midnight EST

  let timeUntilMidnight = estMidnight.getTime() - now.getTime();
  if (timeUntilMidnight < 0) {
    // If past midnight EST, schedule for the next day
    timeUntilMidnight += 24 * 60 * 60 * 1000;
  }

  console.log(`⏳ Scheduling daily rewards reset in ${timeUntilMidnight / 1000 / 60} minutes.`);

  setTimeout(() => {
    userMessageCounts.clear();
    saveMessageCounts();
    console.log("🔄 Daily rewards counter reset at midnight EST!");
    scheduleMidnightReset(); // Schedule next reset
  }, timeUntilMidnight);
}

// Start the reset scheduler
scheduleMidnightReset();

// ==========================
// 📩 MESSAGE-BASED REWARDS
// ==========================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Check if message is in an allowed channel
  if (!allowedChannels.includes(message.channel.id)) return;

  const userId = message.author.id;
  const today = new Date().toISOString().split('T')[0];

  // Get or initialize user message data
  if (!userMessageCounts.has(userId)) {
    userMessageCounts.set(userId, { date: today, count: 0, reacted: false });
  }

  const userData = userMessageCounts.get(userId);

  // Reward if user hasn't reached limit
  if (userData.count < MESSAGE_REWARD_LIMIT) {
    userData.count += 1;
    userMessageCounts.set(userId, userData);
    saveMessageCounts(); // Save progress

    // Grant money (assuming updateWallet is your function for adding currency)
    await updateWallet(userId, MESSAGE_REWARD_AMOUNT);
    console.log(`💰 Given ${MESSAGE_REWARD_AMOUNT} to ${message.author.username} for message #${userData.count} today`);
  }
});

// ==========================
// ⭐ REACTION-BASED REWARDS (Once Per 24 Hours Once Per Message)
// ==========================
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return; // Ignore bot reactions

  // Ensure reaction happened in the defined reward channel
  if (reaction.message.channel.id !== REACTION_REWARD_CHANNEL) return;

  const userId = user.id;
  const today = new Date().toISOString().split('T')[0];

  // Get or initialize user data
  if (!userMessageCounts.has(userId)) {
    userMessageCounts.set(userId, { date: today, count: 0, reacted: false });
  }

  const userData = userMessageCounts.get(userId);

  // Reset reaction reward eligibility if it's a new day
  if (userData.date !== today) {
    userData.date = today;
    userData.count = 0;
    userData.reacted = false; // Reset daily reaction eligibility
  }

  // If the user has already received a reaction reward today, deny it
  if (userData.reacted) {
    console.log(`⚠️ User ${user.username} already received a reaction reward today.`);
    return;
  }

  // Grant reward for first reaction of the day
  userData.reacted = true; // Mark that they have received today's reaction reward
  userMessageCounts.set(userId, userData);
  saveMessageCounts(); // Save progress

  // Grant money (assuming updateWallet is your function for adding currency)
  await updateWallet(userId, REACTION_REWARD_AMOUNT);
  console.log(`🌟 Given ${REACTION_REWARD_AMOUNT} to ${user.username} for reacting in the reward channel.`);
});





// Export the client so server.js can do `client.users.fetch(...)`
module.exports = { client };

// Finally, log in the bot with your token from .env
client.login(process.env.TOKEN);
