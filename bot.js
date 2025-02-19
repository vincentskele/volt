// bot.js
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * NEW: Log capturing functionality.
 * This code captures the last 160 console log/error messages and writes them to console.json.
 */
const LOG_LIMIT = 160;
const logBuffer = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

function updateLogBuffer(logEntry) {
  logBuffer.push(logEntry);
  if (logBuffer.length > LOG_LIMIT) {
    logBuffer.shift();
  }
  // Write the updated logBuffer to console.json (formatted for readability)
  fs.writeFileSync(path.join(__dirname, 'console.json'), JSON.stringify(logBuffer, null, 2), 'utf8');
}

console.log = function (...args) {
  const message = args.join(' ');
  const logEntry = { timestamp: new Date().toISOString(), message };
  updateLogBuffer(logEntry);
  originalConsoleLog.apply(console, args);
};

console.error = function (...args) {
  const message = args.join(' ');
  const logEntry = { timestamp: new Date().toISOString(), message };
  updateLogBuffer(logEntry);
  originalConsoleError.apply(console, args);
};

// Import the required database functions (adjust to your actual db.js exports).
const {
  getActiveGiveaways,
  getGiveawayEntries,
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

// Load events from the "events" folder
const eventsPath = path.join(__dirname, 'events'); // Adjust if your folder is elsewhere
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  console.log(`[DEBUG] Registering event: ${event.name} from ${file}`);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}


// ==========================
// 🚦 ALLOWED ROLES FILTER
// ==========================
// The ALLOWED_ROLES env variable should be a comma-separated list of role IDs.
// If left blank, no filtering is applied.
const ALLOWED_ROLES = process.env.ALLOWED_ROLES
  ? process.env.ALLOWED_ROLES.split(',').map(role => role.trim())
  : [];

if (ALLOWED_ROLES.length > 0) {
  console.log(`🚦 Bot is filtering by allowed roles: ${ALLOWED_ROLES.join(', ')}`);
} else {
  console.log(`🚦 Bot is not filtering by roles.`);
}

/**
 * Checks if the user (from a guild) has at least one of the allowed roles.
 * If no allowed roles are defined, returns true.
 * @param {User} user - The Discord user.
 * @param {Guild} guild - The guild in which to check the user's roles.
 * @returns {Promise<boolean>}
 */
async function userHasAllowedRole(user, guild) {
  if (ALLOWED_ROLES.length === 0) return true; // No filter applied.
  let member = guild.members.cache.get(user.id);
  if (!member) {
    try {
      member = await guild.members.fetch(user.id);
    } catch (err) {
      console.error(`Error fetching member ${user.id} in guild ${guild.id}:`, err);
      return false;
    }
  }
  return member.roles.cache.some(role => ALLOWED_ROLES.includes(role.id));
}

// ==========================
// COMMANDS LOADING
// ==========================
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

    // Check existing DB entries and only add new ones
    const existingEntries = await getGiveawayEntries(giveaway.id);
    const existingUserIds = new Set(existingEntries.map(entry => entry.user_id));

    for (const userId of participantIDs) {
      if (!existingUserIds.has(userId)) {
        await addGiveawayEntry(giveaway.id, userId);
        console.log(`✅ Added new giveaway entry for user ${userId} in giveaway ${giveaway.id}`);
      }
    }
  } catch (error) {
    console.error('Error syncing giveaway entries:', error);
  }
}  // ✅ Make sure this closing bracket is here!


/**
 * Reaction listener for adding a giveaway entry.
 */
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;
  // Allowed roles filter check
  if (reaction.message.guild && !(await userHasAllowedRole(user, reaction.message.guild))) return;
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
  // Allowed roles filter check
  if (reaction.message.guild && !(await userHasAllowedRole(user, reaction.message.guild))) return;
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

    // Check if the prize is numeric points or a named shop item
    const prizeCurrency = parseInt(giveaway.prize, 10);
    for (const winner of selectedWinners) {
      if (!isNaN(prizeCurrency)) {
        // Award points
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

// ==========================
// HANDLE PREFIX-BASED COMMANDS
// ==========================
client.on('messageCreate', async (message) => {
  // Only process messages that start with the prefix.
  if (!message.content.startsWith(PREFIX)) return;
  if (!message.guild) return; // Only process guild messages.
  // Allowed roles filter check:
  if (!(await userHasAllowedRole(message.author, message.guild))) return;

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

// ==========================
// HANDLE SLASH COMMANDS & AUTOCOMPLETE
// ==========================
client.on('interactionCreate', async (interaction) => {
  // First, handle autocomplete interactions
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command && typeof command.autocomplete === 'function') {
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(`Error handling autocomplete for ${interaction.commandName}:`, error);
      }
    }
    return; // Exit after processing autocomplete
  }

  // Then, handle slash commands
  if (!interaction.isCommand()) return;

  // Check for allowed roles in guild channels
  if (interaction.guild && !(await userHasAllowedRole(interaction.user, interaction.guild))) {
    return interaction.reply({ content: '🚫 You do not have permission to use this command.', ephemeral: true });
  }

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
// 🎁 DAILY REWARDS SYSTEM SETUP
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
const FIRST_MESSAGE_BONUS = parseInt(process.env.FIRST_MESSAGE_BONUS, 10) || 50;
const FIRST_MESSAGE_BONUS_CHANNEL = process.env.FIRST_MESSAGE_BONUS_CHANNEL || ""; // Default: all channels

// Function to save message counts to file
function saveMessageCounts() {
  fs.writeFileSync(userMessageCountsPath, JSON.stringify([...userMessageCounts]), 'utf8');
}

// ==========================
// 🗓️ Helper: Get today's date in EST (without DST handling)
// ==========================
function getESTDateString() {
  // 5 hours behind UTC for standard EST (not accounting for DST)
  const now = new Date();
  const estTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
  // Convert to YYYY-MM-DD string
  return estTime.toISOString().split('T')[0];
}

// ==========================
// ⏳ SCHEDULE MIDNIGHT EST RESET
// ==========================
function scheduleMidnightReset() {
  const now = new Date();
  // We'll keep the approach of resetting at 05:00 UTC for "EST midnight" (no DST)
  // If you need DST logic, use a timezone library.
  
  // This line calculates "today's midnight in EST" as 05:00 UTC
  // (Manually ignoring DST changes.)
  const estMidnight = new Date(now.toISOString().split('T')[0] + 'T05:00:00.000Z');

  let timeUntilMidnight = estMidnight.getTime() - now.getTime();
  if (timeUntilMidnight < 0) {
    // If it's already past 05:00 UTC, schedule for the next day
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
// 📩 MESSAGE-BASED REWARDS + FIRST MESSAGE BONUS
// ==========================
client.on('messageCreate', async (message) => {
  if (!message.guild) return;
  // Allowed roles filter check:
  if (!(await userHasAllowedRole(message.author, message.guild))) return;

  const userId = message.author.id;
  // Use EST-based date here
  const today = getESTDateString();

  // Get or initialize user message data
  if (!userMessageCounts.has(userId)) {
    userMessageCounts.set(userId, { date: today, count: 0, reacted: false, firstMessage: false });
  }

  const userData = userMessageCounts.get(userId);

  // Reset data if it's a new day (based on EST date)
  if (userData.date !== today) {
    userData.date = today;
    userData.count = 0;
    userData.reacted = false;
    userData.firstMessage = false; // Reset first message bonus eligibility
  }

  // Check if the message is in the allowed first message bonus channel (or all channels if blank)
  const isBonusChannel = !FIRST_MESSAGE_BONUS_CHANNEL || message.channel.id === FIRST_MESSAGE_BONUS_CHANNEL;

  // 🎁 First Message Bonus - Award if it's the user's first message of the day
  if (!userData.firstMessage && isBonusChannel) {
    userData.firstMessage = true;
    userMessageCounts.set(userId, userData);
    saveMessageCounts(); // Save progress

    await updateWallet(userId, FIRST_MESSAGE_BONUS);
    console.log(`🎁 First message bonus! Given ${FIRST_MESSAGE_BONUS} to ${message.author.username}`);

    /* Optional: Notify the user
    message.reply(`🎉 You've received your first message bonus of the day! (+${FIRST_MESSAGE_BONUS})`);*/
  }

  // 💬 Regular message-based rewards (only in allowed channels)
  if (allowedChannels.includes(message.channel.id) && userData.count < MESSAGE_REWARD_LIMIT) {
    userData.count += 1;
    userMessageCounts.set(userId, userData);
    saveMessageCounts(); // Save progress

    await updateWallet(userId, MESSAGE_REWARD_AMOUNT);
    console.log(`⚡ Given ${MESSAGE_REWARD_AMOUNT} to ${message.author.username} for message #${userData.count} today`);
  }
});

// ==========================
// ⭐ REACTION-BASED REWARDS (Once Per 24 Hours Once Per Message)
// ==========================
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.message.guild && !(await userHasAllowedRole(user, reaction.message.guild))) return;

  // Ensure reaction happened in the defined reward channel
  if (reaction.message.channel.id !== REACTION_REWARD_CHANNEL) return;

  const userId = user.id;
  // Use EST-based date here
  const today = getESTDateString();

  // Get or initialize user data
  if (!userMessageCounts.has(userId)) {
    userMessageCounts.set(userId, { date: today, count: 0, reacted: false, firstMessage: false });
  }

  const userData = userMessageCounts.get(userId);

  // Reset reaction reward eligibility if it's a new day (EST)
  if (userData.date !== today) {
    userData.date = today;
    userData.count = 0;
    userData.reacted = false; // Reset daily reaction eligibility
    userData.firstMessage = false; // If needed, though not strictly required for reaction logic
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

  // Grant money (assuming updateWallet is your function for adding points)
  await updateWallet(userId, REACTION_REWARD_AMOUNT);
  console.log(`🌟 Given ${REACTION_REWARD_AMOUNT} to ${user.username} for reacting in the reward channel.`);
});

// ==========================
// 🎟️ RAFFLES
// ==========================

const {
  addShopItem,
  getRaffleParticipants,
  addRaffleEntry,
  removeRaffleEntry,
  clearRaffleEntries
} = require('./db');

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎟️') return;
  if (reaction.message.guild && !(await userHasAllowedRole(user, reaction.message.guild))) return;

  try {
    if (reaction.partial) await reaction.fetch();
    const raffle = await getRaffleParticipants(reaction.message.id);
    if (!raffle) return;

    await addRaffleEntry(raffle.id, user.id);
    console.log(`📌 User ${user.id} entered raffle ${raffle.id}`);
  } catch (err) {
    console.error('⚠️ Error recording raffle entry:', err);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎟️') return;
  if (reaction.message.guild && !(await userHasAllowedRole(user, reaction.message.guild))) return;

  try {
    if (reaction.partial) await reaction.fetch();
    const raffle = await getRaffleParticipants(reaction.message.id);
    if (!raffle) return;

    await removeRaffleEntry(raffle.id, user.id);
    console.log(`📌 User ${user.id} left raffle ${raffle.id}`);
  } catch (err) {
    console.error('⚠️ Error removing raffle entry:', err);
  }
});

async function concludeRaffle(raffle) {
  try {
    console.log(`🎟️ Concluding raffle: ${raffle.name}`);
    const channel = await client.channels.fetch(raffle.channel_id);
    if (!channel) {
      console.error(`❌ Channel ${raffle.channel_id} not found.`);
      return;
    }

    const message = await channel.messages.fetch(raffle.message_id);
    if (!message) {
      console.error(`❌ Raffle message ${raffle.message_id} not found.`);
      return;
    }

    const reaction = message.reactions.cache.get('🎟️');
    if (!reaction) {
      await channel.send(`🚫 No participants for the raffle **${raffle.name}**.`);
      return;
    }

    const usersReacted = await reaction.users.fetch();
    const participants = usersReacted.filter(user => !user.bot);

    if (participants.size === 0) {
      await channel.send(`🚫 No valid participants for raffle **${raffle.name}**.`);
      return;
    }

    const winners = [];
    const shuffled = participants.sort(() => 0.5 - Math.random());

    for (let i = 0; i < Math.min(raffle.winners, shuffled.length); i++) {
      winners.push(shuffled[i]);
    }

    if (!isNaN(raffle.prize)) {
      const prizeAmount = parseInt(raffle.prize, 10);
      for (const winner of winners) {
        await updateWallet(winner.id, prizeAmount);
        await channel.send(`🎉 <@${winner.id}> won **${raffle.name}** and received **${prizeAmount}${VOLT_SYMBOL}**!`);
      }
    } else {
      const shopItem = await getShopItemByName(raffle.prize);
      if (!shopItem) {
        console.error(`⚠️ Shop item "${raffle.prize}" not found.`);
        await channel.send(`🚫 Error: Shop item "**${raffle.prize}**" not found.`);
        return;
      }

      for (const winner of winners) {
        await addItemToInventory(winner.id, shopItem.itemID);
        await channel.send(`🎉 <@${winner.id}> won **${raffle.name}** and received **${shopItem.name}**!`);
      }
    }

    await clearRaffleEntries(raffle.id);
    console.log(`✅ Raffle ${raffle.id} resolved and entries cleared.`);
  } catch (err) {
    console.error('⚠️ Error concluding raffle:', err);
  }
}

// Restore active raffles on bot startup
client.once('ready', async () => {
  console.log('🔄 Restoring active raffles...');
  const activeRaffles = await getActiveGiveaways(); // Reuse function for raffles
  for (const raffle of activeRaffles) {
    const remainingTime = raffle.end_time - Date.now();
    if (remainingTime > 0) {
      setTimeout(() => concludeRaffle(raffle), remainingTime);
      console.log(`📅 Scheduled raffle ${raffle.id} to conclude in ${remainingTime}ms.`);
    } else {
      await concludeRaffle(raffle);
    }
  }
});


// ==========================
// EXPORT THE CLIENT
// ==========================
module.exports = { client };

// Finally, log in the bot with your token from .env
client.login(process.env.TOKEN);