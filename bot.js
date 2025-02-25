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
 * Synchronize giveaway entries from Discord reactions to the database.
 * This ensures that the database reflects the actual participants.
 */
async function syncGiveawayEntries(giveaway) {
  try {
    const channel = await client.channels.fetch(giveaway.channel_id);
    if (!channel) return;
    const message = await channel.messages.fetch(giveaway.message_id);
    if (!message) return;

    const reaction = message.reactions.cache.get('🎉');
    if (!reaction) return;

    const usersReacted = await reaction.users.fetch();
    const participantIDs = usersReacted.filter(user => !user.bot).map(user => user.id);

    // Get existing entries from the database
    const existingEntries = await getGiveawayEntries(giveaway.id);
    const existingUserIds = new Set(existingEntries.map(entry => entry.user_id));

    // Add new entries if they don't exist
    for (const userId of participantIDs) {
      if (!existingUserIds.has(userId)) {
        await addGiveawayEntry(giveaway.id, userId);
        console.log(`✅ Added new entry for user ${userId} in giveaway ${giveaway.id}`);
      }
    }

    // Remove users from the database if they no longer have the reaction
    for (const entry of existingEntries) {
      if (!participantIDs.includes(entry.user_id)) {
        await removeGiveawayEntry(giveaway.id, entry.user_id);
        console.log(`❌ Removed entry for user ${entry.user_id} from giveaway ${giveaway.id}`);
      }
    }
  } catch (error) {
    console.error('❌ Error syncing giveaway entries:', error);
  }
}

/**
 * Check if a user is already in a giveaway (real-time DB query).
 * @param {string} giveawayId - The giveaway ID.
 * @param {string} userId - The user ID.
 * @returns {Promise<boolean>} - True if the user is in the giveaway, false otherwise.
 */
async function checkUserInGiveaway(giveawayId, userId) {
  try {
    const existingEntries = await getGiveawayEntries(giveawayId);
    return existingEntries.some(entry => entry.user_id === userId);
  } catch (error) {
    console.error(`❌ Error checking giveaway entry for user ${userId}:`, error);
    return false; // Default to false if there's an error
  }
}


/**
 * Add a giveaway entry when a user reacts with 🎉.
 */
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;

  try {
    if (reaction.partial) await reaction.fetch();
    const giveaway = await getGiveawayByMessageId(reaction.message.id);
    if (!giveaway) return;

    // ✅ NEW: Directly query the database to check if the user is already in `giveaway_entries`
    const userAlreadyEntered = await checkUserInGiveaway(giveaway.id, user.id);

    if (userAlreadyEntered) {
      console.log(`⚠️ User ${user.id} already entered in giveaway ${giveaway.id}. Skipping duplicate.`);
      return; // Stop execution if user is already in the giveaway
    }

    await addGiveawayEntry(giveaway.id, user.id);
    console.log(`📌 User ${user.id} entered giveaway ${giveaway.id}`);
  } catch (err) {
    console.error('⚠️ Error recording giveaway entry:', err);
  }
});



/**
 * Remove a giveaway entry when a user removes their 🎉 reaction.
 */
client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;

  try {
    if (reaction.partial) await reaction.fetch();
    const giveaway = await getGiveawayByMessageId(reaction.message.id);
    if (!giveaway) return;

    // ✅ NEW: Force remove the user from the giveaway_entries table
    await removeGiveawayEntry(giveaway.id, user.id);
    console.log(`❌ User ${user.id} removed from giveaway ${giveaway.id}`);

    // ✅ NEW: Introduce a slight delay to allow the DB to update
    setTimeout(async () => {
      const stillInGiveaway = await checkUserInGiveaway(giveaway.id, user.id);
      if (stillInGiveaway) {
        console.log(`⚠️ User ${user.id} still exists in giveaway ${giveaway.id} after removal! Investigate!`);
      }
    }, 500); // Small delay to verify DB update

  } catch (err) {
    console.error('⚠️ Error handling reaction removal:', err);
  }
});


/**
 * Conclude a giveaway by selecting winners from the database and awarding prizes.
 */
async function concludeGiveaway(giveaway) {
  try {
    console.log(`⏳ DEBUG: Starting conclusion for giveaway ${giveaway.id}`);

    const channel = await client.channels.fetch(giveaway.channel_id);
    if (!channel) {
      console.error(`❌ DEBUG: Channel ${giveaway.channel_id} not found.`);
      return;
    }

    // ✅ Fetch participants from the database and log what happens
    console.log(`🔄 DEBUG: Fetching participants from giveaway_entries for giveaway ${giveaway.id}`);
    const participants = await getGiveawayEntries(giveaway.id);
    console.log(`📊 DEBUG: Participants retrieved from DB for giveaway ${giveaway.id}:`, participants);

    if (!participants.length) {
      console.log(`🚨 DEBUG: No valid participants found for giveaway ${giveaway.id}!`);
      await channel.send(`🚫 No valid participants for giveaway **${giveaway.name}**.`);
      await deleteGiveaway(giveaway.id);
      return;
    }

    // ✅ Select winners randomly
    const shuffled = participants.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, giveaway.winners);

    console.log(`🏆 DEBUG: Winners selected for giveaway ${giveaway.id}:`, winners);

    // ✅ Announce winners
    const winnersMention = winners.map(winnerId => `<@${winnerId}>`).join(', ');
    await channel.send(`🎉 Congratulations ${winnersMention}! You won **${giveaway.prize}**!`);

    // ✅ Award prizes
    for (const winnerId of winners) {
      if (!isNaN(giveaway.prize)) {
        await updateWallet(winnerId, parseInt(giveaway.prize, 10));
      } else {
        const shopItem = await getShopItemByName(giveaway.prize);
        if (shopItem) {
          await addItemToInventory(winnerId, shopItem.itemID);
        }
      }
    }

    // ✅ Cleanup
    await deleteGiveaway(giveaway.id);
    console.log(`✅ DEBUG: Giveaway ${giveaway.id} resolved and deleted.`);
  } catch (err) {
    console.error('⚠️ ERROR in concludeGiveaway():', err);
  }
}



/**
 * Restore and schedule active giveaways on bot startup.
 */
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  const activeGiveaways = await getActiveGiveaways();
  console.log(`🔄 Restoring ${activeGiveaways.length} active giveaways...`);

  for (const giveaway of activeGiveaways) {
    await syncGiveawayEntries(giveaway);

    const remainingTime = giveaway.end_time - Date.now();
    if (remainingTime > 0) {
      setTimeout(async () => {
        await concludeGiveaway(giveaway);
      }, remainingTime);
      console.log(`⏳ Scheduled giveaway ${giveaway.message_id} to conclude in ${remainingTime}ms.`);
    } else {
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
  const today = getESTDateString();

  // Initialize or reset user data for a new day.
  let userData = userMessageCounts.get(userId);
  if (!userData || userData.date !== today) {
    userData = {
      date: today,
      count: 0,
      reacted: false,
      firstMessageBonusGiven: false,
    };
    userMessageCounts.set(userId, userData);
  }

  // Determine if the current channel qualifies for a bonus.
  // If no bonus channel is set, allow bonus in any channel.
  const inBonusChannel = !FIRST_MESSAGE_BONUS_CHANNEL || message.channel.id === FIRST_MESSAGE_BONUS_CHANNEL;

  // 🎁 Award first message bonus if not already given and if in a bonus-eligible channel.
  if (!userData.firstMessageBonusGiven && inBonusChannel) {
    userData.firstMessageBonusGiven = true;
    await updateWallet(userId, FIRST_MESSAGE_BONUS);
    console.log(`🎁 First message bonus awarded to ${message.author.username} (+${FIRST_MESSAGE_BONUS}).`);
    saveMessageCounts();
  }

  // 💬 Regular message-based rewards (only in allowed channels).
  if (allowedChannels.includes(message.channel.id) && userData.count < MESSAGE_REWARD_LIMIT) {
    userData.count++;
    await updateWallet(userId, MESSAGE_REWARD_AMOUNT);
    console.log(`⚡ Awarded ${MESSAGE_REWARD_AMOUNT} to ${message.author.username} for message #${userData.count} today.`);
    saveMessageCounts();
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

const express = require("express");
const app = express();
app.use(express.json());

const SUBMISSION_CHANNEL_ID = process.env.SUBMISSION_CHANNEL_ID; // Load channel ID from .env

app.post("/api/submit-job", async (req, res) => {
  console.log("📥 Received job submission request:", req.body);

  const { title, description } = req.body;

  if (!title || !description) {
    console.error("❌ Missing title or description");
    return res.status(400).json({ error: "Title and description are required." });
  }

  try {
    const channel = await client.channels.fetch(SUBMISSION_CHANNEL_ID);
    if (!channel) {
      console.error("❌ Submission channel not found!");
      return res.status(500).json({ error: "Submission channel not found." });
    }

    await channel.send(`📢 **New Job Submission!**\n\n**Title:** ${title}\n**Description:** ${description}`);

    console.log("✅ Job submitted successfully to Discord");
    res.json({ message: "Job submitted successfully!" });
  } catch (error) {
    console.error("❌ Error sending message to Discord:", error);
    res.status(500).json({ error: "Failed to send job submission." });
  }
  
  document.addEventListener('DOMContentLoaded', () => {
  const sections = document.querySelectorAll('.content');
  const SERVER_ID = '1014872741846974514'; // Hardcoded Discord server ID

  // Show one section, hide all others
  function showSection(sectionId) {
    sections.forEach((section) => {
      section.style.display = 'none';
    });
    const sectionToShow = document.getElementById(sectionId);
    if (sectionToShow) {
      sectionToShow.style.display = 'block';
    }
  }

  // Format data depending on the endpoint type
  function getFormatter(type) {
    const formatters = {
      leaderboard: (item) =>
        `User: ${item.userTag} | Wallet: ${item.wallet} | Battery Bank: ${item.bank} | Total: ${item.totalBalance}`,
      admins: (item) => `Admin: ${item.userTag}`,
      shop: (item) =>
        `[${item.id}] ${item.name} - ${item.price} | Qty: ${item.quantity ?? 'N/A'} | Desc: ${item.description ?? ''}`,
      jobs: (job) => `[${job.jobID}] ${job.description}`,
      giveaways: (item) =>
        `Giveaway #${item.id} — Prize: "${item.prize}" — Ends: ${item.end_time ? new Date(item.end_time).toLocaleString() : 'N/A'}`,
    };
    return formatters[type] || ((obj) => JSON.stringify(obj));
  }

  // Generic fetch function
  async function fetchData(url, targetElement, type) {
    if (!targetElement) {
      console.error(`Target element is null for URL: ${url}`);
      return;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch from ${url}: ${response.statusText}`);
      }
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        targetElement.innerHTML = '<li>No data available.</li>';
        return;
      }
      const formatter = getFormatter(type);
      targetElement.innerHTML = data.map((item) => `<li>${formatter(item)}</li>`).join('');
    } catch (error) {
      console.error(`Error fetching data from ${url}:`, error);
      targetElement.innerHTML = '<li>Error loading data.</li>';
    }
  }

// ------------------------------
// Leaderboard Section (Clickable to view user's inventory)
// ------------------------------
const showLeaderboardButton = document.getElementById('showLeaderboardButton');
if (showLeaderboardButton) {
  showLeaderboardButton.addEventListener('click', () => {
    const leaderboardList = document.getElementById('leaderboardList');
    fetch('/api/leaderboard')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((leaderboard) => {
        leaderboardList.innerHTML = '';
        leaderboard.forEach((entry, index) => {
          const item = document.createElement('div');
          item.className = 'leaderboard-item';
          item.style.cursor = 'pointer'; // Indicates that the item is clickable

          // When clicked, fetch and display the inventory for that user
          item.addEventListener('click', () => {
            fetchUserInventory(entry.userID);
          });

          // Create the content for this leaderboard entry
          const totalBalance = entry.wallet + entry.bank;
          item.innerHTML = `
            <span class="rank">${index + 1}. </span>
            <span class="user-tag">${entry.userTag}</span> 
            <span class="details">
              Solarian: ${entry.wallet} | Battery Bank: ${entry.bank} | Total: ${totalBalance}
            </span>
          `;
          leaderboardList.appendChild(item);
        });
      })
      .catch((error) => {
        console.error('Error fetching leaderboard:', error);
        leaderboardList.textContent = 'Failed to load leaderboard.';
      });
    showSection('leaderboard');
  });
}

/**
 * Fetches and displays the inventory for the given user.
 * Assumes there is an API endpoint at `/api/public-inventory/<userID>` that returns an array of items.
 * @param {string} userID - The ID of the user whose inventory should be shown.
 */
async function fetchUserInventory(userID) {
  try {
    const response = await fetch(`/api/public-inventory/${userID}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch inventory for user ${userID}`);
    }
    const data = await response.json();
    const inventoryItems = document.getElementById('inventoryItems');
    inventoryItems.innerHTML = '';

    if (!data.length) {
      inventoryItems.innerHTML = `<p class="no-items text-body">No items in this user's inventory.</p>`;
    } else {
      data.forEach((item) => {
        const itemContainer = document.createElement('div');
        itemContainer.className = 'inventory-item raffle-item bg-content border border-accent rounded-lg p-3 my-2 shadow-md text-primary';

        itemContainer.innerHTML = `
          <h3 class="font-bold text-highlight uppercase tracking-wide text-center">${item.name} (Qty: ${item.quantity})</h3>
          <p class="text-body text-primary">${item.description}</p>
        `;

        // Event for clicking to use the item
        itemContainer.addEventListener('click', async () => {
          const command = `%use "${item.name}"`;
          try {
            await navigator.clipboard.writeText(command);
            alert(`Copied to clipboard: ${command}\n\nClick OK to go to Discord and use your item!`);
          } catch (err) {
            console.error('Clipboard copy failed:', err);
            alert('Failed to copy. Please copy manually.');
          }
          window.open('https://discord.com/channels/1014872741846974514/1336779333641179146', '_blank');
        });

        inventoryItems.appendChild(itemContainer);
      });
    }
    showSection('inventorySection');
  } catch (error) {
    console.error('Error fetching user inventory:', error);
    alert('Failed to load user inventory.');
  }
}


  // ------------------------------
  // Admin List Section
  // ------------------------------
  const showAdminListButton = document.getElementById('showAdminListButton');
  if (showAdminListButton) {
    showAdminListButton.addEventListener('click', () => {
      const adminListContent = document.getElementById('adminListContent');
      fetch('/api/admins')
        .then((response) => response.json())
        .then((admins) => {
          adminListContent.innerHTML = '';
          admins.forEach((admin) => {
            const adminLink = document.createElement('a');
            adminLink.href = `https://discord.com/users/${admin.userID}`;
            adminLink.target = '_blank';
            adminLink.textContent = admin.userTag;
            const listItem = document.createElement('div');
            listItem.className = 'admin-item';
            listItem.innerHTML = `<span>Admin:</span> `;
            listItem.appendChild(adminLink);
            adminListContent.appendChild(listItem);
          });
        })
        .catch((error) => {
          console.error('Error fetching admin list:', error);
          adminListContent.textContent = 'Failed to load admin list.';
        });
      showSection('adminList');
    });
  }

// ==================
  // SHOP SECTION - BUY ITEMS (With Modal)
const showShopButton = document.getElementById('showShopButton');
if (showShopButton) {
  showShopButton.addEventListener('click', async () => {
    let shopItems = document.getElementById('shopItems');
    if (!shopItems) {
      shopItems = document.createElement('div');
      shopItems.id = 'shopItems';
      shopItems.className = 'shop-list';
      document.body.appendChild(shopItems);
    }
    try {
      const response = await fetch('/api/shop');
      const data = await response.json();
      shopItems.innerHTML = ''; // Clear existing content

      data.forEach((item) => {
        const itemContainer = document.createElement('div');
        itemContainer.className = 'shop-item';
        itemContainer.style.cursor = 'pointer';

        const detailsSpan = document.createElement('span');
        detailsSpan.innerHTML = `<strong>${item.name}</strong> - ⚡${item.price} | Qty: ${item.quantity}`;
        itemContainer.appendChild(detailsSpan);

        const descriptionSpan = document.createElement('p');
        descriptionSpan.innerHTML = item.description.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" target="_blank" class="link">$1</a>'
        );
        itemContainer.appendChild(descriptionSpan);

        // Buy event listener - triggers modal
        itemContainer.addEventListener('click', () => {
          showPurchaseModal(item);
        });

        shopItems.appendChild(itemContainer);
      });

      showSection('shop');
    } catch (error) {
      console.error('Error fetching shop data:', error);
    }
  });
}

/**
 * Show purchase confirmation modal.
 * @param {Object} item - The item being purchased.
 */
function showPurchaseModal(item) {
  const existingModal = document.getElementById('purchaseModal');
  if (existingModal) existingModal.remove(); // Remove existing modal if any

  // Create modal overlay
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.id = 'purchaseModal';

  // Create modal box
  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';

  // Modal content
  modalBox.innerHTML = `
    <h3>Confirm Purchase</h3>
    <p>Are you sure you want to buy:</p>
    <p><strong>${item.name}</strong> for <strong>⚡${item.price}</strong>?</p>
    <div class="modal-buttons">
      <button class="confirm-button" id="confirmPurchase">Confirm</button>
      <button class="cancel-button" id="cancelPurchase">Cancel</button>
    </div>
  `;

  // Append modal to overlay
  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  // Add event listeners for buttons
  document.getElementById('confirmPurchase').addEventListener('click', () => {
    buyItem(item.name);
    closeModal();
  });

  document.getElementById('cancelPurchase').addEventListener('click', closeModal);
}

/**
 * Closes the purchase modal.
 */
function closeModal() {
  const modal = document.getElementById('purchaseModal');
  if (modal) modal.remove();
}

/**
 * Send buy request to the server.
 * @param {string} itemName - Name of the item to purchase.
 */
async function buyItem(itemName) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('You must be logged in to buy items.');
    return;
  }

  try {
    const response = await fetch('/api/buy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ itemName }),
    });

    const result = await response.json();
    if (response.ok) {
      showConfirmationPopup(`✅ Purchase successful! You bought "${itemName}".`);
      // Re-fetch the Volt balance here:
      fetchVoltBalance();
    } else {
      showConfirmationPopup(`❌ Purchase failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Error processing purchase:', error);
    showConfirmationPopup('❌ An error occurred while processing your purchase.');
  }
}


/**
 * Show a simple confirmation message popup.
 * @param {string} message - The message to display.
 */
function showConfirmationPopup(message) {
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  
  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';
  modalBox.innerHTML = `
    <p>${message}</p>
    <button class="confirm-button" id="closeModal">OK</button>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById('closeModal').addEventListener('click', () => {
    modalOverlay.remove();
  });
}



// ================================================
// INVENTORY SECTION
// ================================================
const showInventoryButton = document.getElementById('showInventoryButton');
const inventorySection = document.getElementById('inventorySection');
const inventoryItems = document.getElementById('inventoryItems');

// This function fetches the user’s inventory from /api/inventory
async function fetchInventory() {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please log in first!');
    return;
  }

  try {
    const response = await fetch('/api/inventory', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch inventory');
    }

    const data = await response.json();
    const inventoryItems = document.getElementById('inventoryItems');
    inventoryItems.innerHTML = ''; // Clear existing content

    if (!data.length) {
      inventoryItems.innerHTML = '<p class="no-items">There are no items in this inventory.</p>';
      return;
    }

    data.forEach((item) => {
      const itemContainer = document.createElement('div');
      itemContainer.className = 'inventory-item raffle-item bg-content border border-accent rounded-lg p-3 my-2 shadow-md text-primary';

      // Item title
      const itemTitle = document.createElement('h3');
      itemTitle.className = 'font-bold text-highlight uppercase tracking-wide text-center';
      itemTitle.textContent = `${item.name} (Qty: ${item.quantity})`;
      itemContainer.appendChild(itemTitle);

      // Item description
      const descriptionSpan = document.createElement('p');
      descriptionSpan.className = 'text-body text-primary';
      descriptionSpan.innerHTML = item.description.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" class="link">$1</a>'
      );
      itemContainer.appendChild(descriptionSpan);

      // Click event for using the item
      itemContainer.addEventListener('click', async () => {
        const command = `%use "${item.name}"`;
        try {
          await navigator.clipboard.writeText(command);
          alert(`Copied to clipboard: ${command}\n\nClick OK to go to Discord and use your item!`);
        } catch (err) {
          console.error('Clipboard copy failed:', err);
          alert('Failed to copy. Please copy manually.');
        }
        window.open('https://discord.com/channels/1014872741846974514/1336779333641179146', '_blank');
      });

      inventoryItems.appendChild(itemContainer);
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    inventoryItems.innerHTML = '<p class="error-text text-red-500">Error loading inventory.</p>';
  }
}


if (showInventoryButton) {
  showInventoryButton.addEventListener('click', () => {
    fetchInventory();
    // showSection('inventorySection') is your existing utility to display sections
    showSection('inventorySection');
  });
}


  // ------------------------------
// Jobs Section (with Clickable Assignment)
// ------------------------------
const showJobListButton = document.getElementById('showJobListButton');
const jobListContent = document.getElementById('jobListContent');

async function resolveUsername(userId) {
  try {
    const res = await fetch(`/api/resolveUser/${userId}`);
    if (!res.ok) throw new Error(`Failed to fetch username for ${userId}`);
    const data = await res.json();
    return data.username || `UnknownUser (${userId})`;
  } catch (error) {
    console.error('Error resolving username:', error);
    return `UnknownUser (${userId})`;
  }
}

async function resolveChannelName(channelId) {
  try {
    const res = await fetch(`/api/resolveChannel/${channelId}`);
    if (!res.ok) throw new Error(`Failed to fetch channel name for ${channelId}`);
    const data = await res.json();
    return data.channelName || `UnknownChannel (${channelId})`;
  } catch (error) {
    console.error('Error resolving channel name:', error);
    return `UnknownChannel (${channelId})`;
  }
}

async function fetchJobs() {
  try {
    jobListContent.innerHTML = '<p>Loading jobs...</p>';
    const res = await fetch('/api/jobs');
    const jobs = await res.json();

    if (!jobs.length) {
      jobListContent.innerHTML = '<p class="no-jobs-message">No jobs available at the moment. Please check back later.</p>';
      return;
    }

    jobListContent.innerHTML = '';
    const jobList = document.createElement('div');
    jobList.className = 'job-list';

    for (const job of jobs) {
      let description = job.description;
      const userIdMatches = description.match(/<@(\d+)>/g) || [];
      const uniqueUserIds = [...new Set(userIdMatches.map(match => match.slice(2, -1)))];
      const userMappings = {};

      await Promise.all(uniqueUserIds.map(async (userId) => {
        userMappings[userId] = await resolveUsername(userId);
      }));

      for (const userId in userMappings) {
        description = description.replace(
          new RegExp(`<@${userId}>`, 'g'),
          `<a href="https://discord.com/users/${userId}" target="_blank" class="link">@${userMappings[userId]}</a>`
        );
      }

      const channelIdMatches = description.match(/<#(\d+)>/g) || [];
      await Promise.all(channelIdMatches.map(async (match) => {
        const channelId = match.slice(2, -1);
        const channelName = await resolveChannelName(channelId);
        description = description.replace(
          new RegExp(`<#${channelId}>`, 'g'),
          `<a href="https://discord.com/channels/${channelId}" target="_blank" class="link">#${channelName}</a>`
        );
      }));

      description = description.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" class="link">$1</a>'
      );

      const jobItem = document.createElement('div');
      jobItem.className = 'job-item clickable-job';
      jobItem.dataset.jobId = job.jobID;
      jobItem.innerHTML = `<p><strong>Job:</strong> ${description}</p>`;

      if (job.assignees && Array.isArray(job.assignees) && job.assignees.length > 0) {
        const assigneeLinks = await Promise.all(job.assignees.map(async (userId) => {
          const username = await resolveUsername(userId);
          return `<a href="https://discord.com/users/${userId}" target="_blank" class="link">@${username}</a>`;
        }));
        jobItem.innerHTML += `<p>Assigned to: ${assigneeLinks.join(', ')}</p>`;
      } else {
        jobItem.innerHTML += `<p>Not assigned</p>`;
      }

      // Click event to assign the user to this job
      jobItem.addEventListener('click', () => {
        assignUserToJob(job.jobID);
      });

      jobList.appendChild(jobItem);
    }

    jobListContent.appendChild(jobList);
  } catch (error) {
    console.error('Error fetching jobs:', error.message, error.stack);
    jobListContent.innerHTML = '<p>Error loading jobs. Please try again later.</p>';
  }
}

// Assigns user to a job when clicked
async function assignUserToJob(jobID) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please log in first!');
    return;
  }

  try {
    console.log(`[DEBUG] Sending request to assign job:`, { jobID });

    const response = await fetch('/api/assign-job', { // ✅ Ensure correct endpoint
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobID }),
    });

    const result = await response.json();
    console.log(`[DEBUG] Job assignment response:`, result);

    if (response.ok) {
      showConfirmationPopup(`✅ Successfully assigned to job: "${result.job.description}"`);
      fetchJobs(); // Refresh the job list
    } else {
      showConfirmationPopup(`❌ Job assignment failed: ${result.error}`);
    }
  } catch (error) {
    console.error(`[ERROR] Error assigning job:`, error);
    showConfirmationPopup('❌ Error assigning job.');
  }
}



// Show the job list when the button is clicked
if (showJobListButton) {
  showJobListButton.addEventListener('click', () => {
    fetchJobs();
    showSection('jobList');
  });
}

document.addEventListener('click', (event) => {
  if (event.target && event.target.id === 'quitJobButton') {
    console.log("🛑 Quit Job button clicked!");
    quitJob();
  }
});

async function quitJob() {
  console.log("🚀 Sending request to quit job...");

  const token = localStorage.getItem('token');
  if (!token) {
    showConfirmationPopup('❌ You must be logged in to quit your job.');
    return;
  }

  try {
    const response = await fetch('/api/quit-job', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log("🔄 API Response:", response);

    const result = await response.json();
    console.log("📢 Server Response:", result);

    if (response.ok) {
      showConfirmationPopup(`✅ ${result.message}`);
      fetchJobs(); // Refresh job list after quitting
    } else {
      showConfirmationPopup(`❌ ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Error quitting job:', error);
    showConfirmationPopup('❌ Failed to quit job. Please try again later.');
  }
}

// ✅ Keep the original modal open/close functionality
document.addEventListener("click", (event) => {
  const modal = document.getElementById("jobSubmissionModal");

  if (event.target && event.target.id === "submitJobButton") {
    console.log("✅ Submit Job button clicked!");
    
    if (modal) {
      modal.style.display = "flex"; // Show the modal
      console.log("📌 Submission modal is now visible.");
    } else {
      console.error("❌ Submission modal not found!");
    }
  }

  // Handle closing the modal
  if (event.target && event.target.id === "cancelSubmissionButton") {
    if (modal) {
      modal.style.display = "none"; // Hide the modal
      console.log("❌ Submission modal closed.");
    }
  }
});

// ✅ Ensure the event listener for submission is correctly attached
document.addEventListener("click", async (event) => {
  if (event.target && event.target.id === "confirmJobSubmission") { 
    console.log("🚀 Confirm job submission clicked!");

    const jobTitleElement = document.getElementById("jobTitle");
    const jobDescriptionElement = document.getElementById("jobDescription");

    if (!jobTitleElement || !jobDescriptionElement) {
      console.error("❌ Job form elements not found!");
      return;
    }

    const jobTitle = jobTitleElement.value.trim();
    const jobDescription = jobDescriptionElement.value.trim();

    if (!jobTitle || !jobDescription) {
      alert("⚠️ Please fill out all fields.");
      return;
    }

    try {
      console.log(`📤 Sending job submission: ${jobTitle}, ${jobDescription}`);
      const response = await fetch("/api/submit-job", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: jobTitle, description: jobDescription }),
      });

      const result = await response.json();
      console.log("📥 Server response:", result);

      if (response.ok) {
        showConfirmationPopup(`✅ Job submitted successfully!`);
        modal.style.display = "none"; // Hide modal after submission
        fetchJobs(); // Refresh job list
      } else {
        showConfirmationPopup(`❌ Submission failed: ${result.error}`);
      }
    } catch (error) {
      console.error("❌ Error submitting job:", error);
      showConfirmationPopup("❌ Failed to submit job.");
    }
  }
});










// ------------------------------
// Giveaways Section (Clickable Entry)
// ------------------------------
const showGiveawayListButton = document.getElementById('showGiveawayListButton');
const giveawayItems = document.getElementById('giveawayItems');

/**
 * Fetches active giveaways from the API and renders them.
 * Users can click on a giveaway to enter.
 */
async function fetchGiveaways() {
  try {
    const res = await fetch('/api/giveaways/active');
    const giveaways = await res.json();

    if (!giveaways.length) {
      giveawayItems.innerHTML = '<p>No active giveaways at the moment.</p>';
      return;
    }

    giveawayItems.innerHTML = ''; // Clear previous content

    const options = { month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true };

    // Fetch entry counts for all giveaways
    for (const g of giveaways.reverse()) {
      const timestamp = g.end_time.toString().length === 10 ? g.end_time * 1000 : g.end_time;
      const endTime = new Date(timestamp).toLocaleString(undefined, options);

      // Fetch the entry count for this giveaway
      let entryCount = 0;
      try {
        const entryRes = await fetch(`/api/giveaways/${g.id}/entries`);
        const entryData = await entryRes.json();
        entryCount = entryData.entryCount || 0;
      } catch (error) {
        console.error(`Error fetching entry count for giveaway ${g.id}:`, error);
      }

      // Giveaway container
      const giveawayDiv = document.createElement('div');
      giveawayDiv.className = 'giveaway-item';
      giveawayDiv.setAttribute('data-giveaway-id', g.id);

      // Giveaway name
      const namePara = document.createElement('p');
      namePara.className = 'giveaway-name';
      namePara.textContent = g.giveaway_name;
      giveawayDiv.appendChild(namePara);

      // Giveaway details
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'giveaway-content';
      detailsDiv.innerHTML = `
        <p><strong>Prize:</strong> ${g.prize}</p>
        <p><strong>Winners:</strong> ${g.winners}</p>
        <p><strong>Entries:</strong> ${entryCount}</p>
        <p><strong>End Time:</strong> ${endTime}</p>
      `;
      giveawayDiv.appendChild(detailsDiv);

      // Click event: Enter the giveaway
      giveawayDiv.addEventListener('click', async () => {
        await enterGiveaway(g.id);
      });

      giveawayItems.appendChild(giveawayDiv);
    }
  } catch (error) {
    console.error('Error fetching giveaways:', error);
    giveawayItems.innerHTML = '<p>Error loading giveaways.</p>';
  }
}


/**
 * Sends a request to enter the giveaway.
 * @param {number} giveawayId - The ID of the giveaway.
 */
async function enterGiveaway(giveawayId) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('You must be logged in to enter giveaways.');
    return;
  }

  try {
    const res = await fetch('/api/giveaways/enter', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ giveawayId }),
    });

    const result = await res.json();
    if (res.ok) {
      if (result.joined) {
        showConfirmationPopup(`🎉 Successfully entered the giveaway!`);
      } else {
        showConfirmationPopup(`❌ You have left the giveaway.`);
      }
      fetchGiveaways(); // Refresh list after status change
    } else {
      showConfirmationPopup(`❌ Failed to enter giveaway: ${result.error}`);
    }
    
  } catch (error) {
    console.error('Error entering giveaway:', error);
    showConfirmationPopup('❌ An error occurred while entering.');
  }
}

/**
 * Displays a confirmation popup.
 * @param {string} message - Message to show in the popup.
 */
function showConfirmationPopup(message) {
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';

  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';
  modalBox.innerHTML = `
    <p>${message}</p>
    <button class="confirm-button" id="closeModal">OK</button>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById('closeModal').addEventListener('click', () => {
    modalOverlay.remove();
  });
}

// Button event listener to show giveaways
if (showGiveawayListButton) {
  showGiveawayListButton.addEventListener('click', () => {
    fetchGiveaways();
    showSection('giveawayList');
  });
}


// ------------------------------
// Login Section & Authentication
// ------------------------------
console.log('⚡ script.js is being executed!');

const loginButton = document.getElementById('submitLogin');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('loginUsername');
const passwordInput = document.getElementById('loginPassword');
const usernameLabel = document.querySelector("label[for='loginUsername']");
const passwordLabel = document.querySelector("label[for='loginPassword']");
const voltMenuContainer = document.getElementById('voltMenuContainer');

// Ensure Volt elements are hidden initially
if (voltMenuContainer) voltMenuContainer.style.display = 'none';

// Check if user is already logged in
const token = localStorage.getItem("token");

if (token) {
  console.log("✅ User is already logged in");
  showPostLoginButtons(); // Show inventory & logout buttons immediately
}

if (loginButton) {
  console.log("✅ Login button found:", loginButton);

  loginButton.addEventListener("click", async (event) => {
    event.preventDefault();
    console.log("🚀 Login button clicked!");

    let username = usernameInput.value.trim().toLowerCase(); // Convert to lowercase
    const password = passwordInput.value;

    if (!username || !password) {
      console.error("❌ Please enter both username and password.");
      alert("Please enter both username and password.");
      return;
    }

    try {
      console.log("🔄 Sending login request...");

      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log("✅ Login successful:", data);

        // Store JWT token in localStorage
        localStorage.setItem("token", data.token);

        // Show the post-login buttons (Inventory & Logout)
        showPostLoginButtons();
      } else {
        console.error("❌ Login failed:", data.message);
        alert(`Login failed: ${data.message}`);
      }
    } catch (error) {
      console.error("❌ Error during login:", error);
      alert("An error occurred. Please try again.");
    }
  });
} else {
  console.error("❌ Login button NOT found!");
}


/**
 * Replace the login form with 2 stacked buttons (INVENTORY + LOGOUT).
 */
function showPostLoginButtons() {
  console.log('🔄 Replacing login form with INVENTORY + LOGOUT buttons...');

  // Hide login inputs & labels
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const loginButton = document.getElementById('submitLogin');
  const usernameLabel = document.querySelector('label[for="loginUsername"]');
  const passwordLabel = document.querySelector('label[for="loginPassword"]');
  const voltMenuContainer = document.getElementById('voltMenuContainer');

  if (usernameInput) usernameInput.style.display = 'none';
  if (passwordInput) passwordInput.style.display = 'none';
  if (usernameLabel) usernameLabel.style.display = 'none';
  if (passwordLabel) passwordLabel.style.display = 'none';
  if (loginButton) loginButton.style.display = 'none';

  // Create a container for the two buttons, top-right corner
  const userActionContainer = document.createElement('div');
  userActionContainer.id = 'userButtons';
  userActionContainer.style.position = 'absolute';
  userActionContainer.style.top = '10px';
  userActionContainer.style.right = '10px';
  userActionContainer.style.display = 'flex';
  userActionContainer.style.flexDirection = 'column';
  userActionContainer.style.alignItems = 'flex-end';
  userActionContainer.style.gap = '4px'; // Keep spacing between buttons

  // ========== INVENTORY BUTTON ==========
  const inventoryButton = document.createElement('button');
  inventoryButton.textContent = 'INVENTORY';
  inventoryButton.className = 'btn text-sm font-bold';
  inventoryButton.style.height = '24px';
  inventoryButton.style.width = '110px'; // Ensure consistent width
  inventoryButton.style.lineHeight = '24px';
  inventoryButton.style.padding = '0 12px';
  inventoryButton.style.textAlign = 'center';

  // On click, fetch inventory & show the inventory page
  inventoryButton.addEventListener('click', () => {
    if (typeof fetchInventory === 'function') {
      fetchInventory();
    }
    if (typeof showSection === 'function') {
      showSection('inventorySection');
    }
  });

  // ========== LOGOUT BUTTON ==========
  const logoutButton = document.createElement('button');
  logoutButton.textContent = 'LOGOUT';
  logoutButton.className = 'btn text-sm font-bold';
  logoutButton.style.height = '24px';
  logoutButton.style.width = '110px'; // Matches Inventory button width
  logoutButton.style.lineHeight = '24px';
  logoutButton.style.padding = '0 12px';
  logoutButton.style.textAlign = 'center';

  logoutButton.addEventListener('click', () => {
    console.log('🚪 Logging out...');
    localStorage.removeItem('token'); // Remove token
    location.reload(); // Reload page to reset UI
  });

  // Add both buttons to the container
  userActionContainer.appendChild(inventoryButton);
  userActionContainer.appendChild(logoutButton);

  // Attach to the DOM
  document.body.appendChild(userActionContainer);

  // ✅ Show the Volt menu only after login
  if (voltMenuContainer) voltMenuContainer.style.display = 'block';

  // Fetch the user's Volt balance
  fetchVoltBalance();
}

document.addEventListener('DOMContentLoaded', () => {
  const voltMenuContainer = document.getElementById('voltMenuContainer');
  const voltMenu = document.getElementById('voltMenu');
  const toggleVoltMenu = document.getElementById('toggleVoltMenu');

  // Hide Volt menu initially
  if (voltMenuContainer) voltMenuContainer.style.display = 'none';

  const token = localStorage.getItem('token');

  if (token) {
    console.log('✅ User is logged in, showing Volt menu.');
    if (voltMenuContainer) voltMenuContainer.style.display = 'block';

    if (toggleVoltMenu && voltMenu) {
      toggleVoltMenu.addEventListener('click', () => {
        console.log('🔄 Toggling Volt menu');
        voltMenu.style.display =
          voltMenu.style.display === 'block' ? 'none' : 'block';
      });
    }

    fetchVoltBalance(); // Fetch balance after login
  } else {
    console.log('🔒 User is not logged in, hiding Volt menu.');
  }
});

/**
 * Fetch Volt Balance from API (only if logged in).
 */
async function fetchVoltBalance() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;

    const response = await fetch(`/api/volt-balance?nocache=${new Date().getTime()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (response.ok) {
      document.getElementById('voltBalance').textContent = `${data.balance}`;
    } else {
      console.error('❌ Failed to fetch Volt balance:', data.message);
      document.getElementById('voltBalance').textContent = 'Error loading';
    }
  } catch (error) {
    console.error('❌ Error fetching Volt balance:', error);
    document.getElementById('voltBalance').textContent = 'Error loading';
  }
}















//========================
// Raffles
//========================
(function () {
  // Utility: Show only the specified section
  const sections = ["landingPage", "rafflesSection"];
  function showSection(sectionId) {
    sections.forEach((id) => {
      document.getElementById(id).style.display = id === sectionId ? "block" : "none";
    });
  }

  const showRafflesButton = document.getElementById("showRafflesButton");
  const rafflesSection = document.getElementById("rafflesSection");
  const rafflesList = document.getElementById("rafflesList");
  const rafflesBackButton = rafflesSection.querySelector(".back-button");

  // Prevent multiple API calls
  let isRaffleListLoading = false;

  // Ensure only one event listener exists
  showRafflesButton.removeEventListener("click", handleShowRaffles);
  showRafflesButton.addEventListener("click", handleShowRaffles);

  async function handleShowRaffles() {
    showSection("rafflesSection");
    await populateRaffleList();
  }

  rafflesBackButton.addEventListener("click", () => {
    showSection("landingPage");
  });

  async function populateRaffleList() {
    if (isRaffleListLoading) return;
    isRaffleListLoading = true;

    rafflesList.innerHTML = ""; // Clears old items before rendering

    try {
      const response = await fetch("/api/shop");
      const data = await response.json();

      // Group by name and sum quantities
      const raffleMap = new Map();
      data.forEach((item) => {
        if (item.name.toLowerCase().includes("raffle ticket")) {
          const normalizedName = item.name.trim().toLowerCase(); // Normalize names

          if (raffleMap.has(normalizedName)) {
            raffleMap.get(normalizedName).quantity += item.quantity; // Merge quantities
          } else {
            raffleMap.set(normalizedName, { ...item, originalName: item.name }); // Store with original name
          }
        }
      });

      const groupedRaffles = Array.from(raffleMap.values());

      if (groupedRaffles.length === 0) {
        rafflesList.innerHTML =
          "<p style='text-align: center;'>No raffle tickets available at the moment.</p>";
        return;
      }

      // Render unique grouped items
      groupedRaffles.forEach((item) => {
        const itemWrapper = document.createElement("div");
        itemWrapper.className = "raffle-item-wrapper";

        const itemContainer = document.createElement("div");
        itemContainer.className = "raffle-item";
        itemContainer.style.cursor = "pointer";

        const detailsSpan = document.createElement("span");
        detailsSpan.innerHTML = `<strong>${item.originalName}</strong> - ⚡${item.price} | QTY: ${item.quantity}`;
        itemContainer.appendChild(detailsSpan);

        const descriptionSpan = document.createElement("span");
        descriptionSpan.innerHTML = item.description.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" target="_blank" class="link">$1</a>'
        );
        itemContainer.appendChild(descriptionSpan);

        // Attach purchase confirmation on click
        itemContainer.addEventListener("click", () => showRaffleConfirmation(item));

        itemWrapper.appendChild(itemContainer);
        rafflesList.appendChild(itemWrapper);
      });
    } catch (error) {
      console.error("Error fetching raffle tickets:", error);
      rafflesList.innerHTML =
        "<p style='text-align: center;'>Failed to load raffle tickets. Please try again later.</p>";
    } finally {
      isRaffleListLoading = false;
    }
  }

  /**
   * Show a confirmation modal before purchasing a raffle ticket.
   * @param {Object} item - Raffle item details.
   */
  function showRaffleConfirmation(item) {
    const modalOverlay = document.createElement("div");
    modalOverlay.className = "modal-overlay";

    const modalBox = document.createElement("div");
    modalBox.className = "modal-box";
    modalBox.innerHTML = `
      <h2>CONFIRM PURCHASE</h2>
      <p>Are you sure you want to buy:</p>
      <p><strong>${item.originalName}</strong> for ⚡${item.price}?</p>
      <div class="modal-buttons">
        <button class="confirm-button" id="confirmRafflePurchase">CONFIRM</button>
        <button class="cancel-button" id="cancelRafflePurchase">CANCEL</button>
      </div>
    `;

    modalOverlay.appendChild(modalBox);
    document.body.appendChild(modalOverlay);

    document.getElementById("confirmRafflePurchase").addEventListener("click", () => {
      modalOverlay.remove();
      buyRaffleTicket(item.originalName);
    });

    document.getElementById("cancelRafflePurchase").addEventListener("click", () => {
      modalOverlay.remove();
    });
  }

  /**
   * Send purchase request for the raffle ticket.
   * @param {string} itemName - Name of the raffle ticket to buy.
   */
  async function buyRaffleTicket(itemName) {
    const token = localStorage.getItem("token");
    if (!token) {
      alert("You must be logged in to buy raffle tickets.");
      return;
    }
  
    try {
      const response = await fetch("/api/buy", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ itemName }),
      });
  
      const result = await response.json();
      if (response.ok) {
        showConfirmationPopup(`✅ Purchase successful! You bought "${itemName}".`);
        // Force refresh Volt balance after purchase
        fetchVoltBalance();
      } else {
        showConfirmationPopup(`❌ Purchase failed: ${result.error}`);
      }
    } catch (error) {
      console.error("Error processing raffle purchase:", error);
      showConfirmationPopup("❌ An error occurred while processing your purchase.");
    }
  }
  

  /**
   * Show a confirmation message popup after purchase.
   * @param {string} message - The message to display.
   */
  function showConfirmationPopup(message) {
    const modalOverlay = document.createElement("div");
    modalOverlay.className = "modal-overlay";

    const modalBox = document.createElement("div");
    modalBox.className = "modal-box";
    modalBox.innerHTML = `
      <p>${message}</p>
      <button class="confirm-button" id="closeModal">OK</button>
    `;

    modalOverlay.appendChild(modalBox);
    document.body.appendChild(modalOverlay);

    document.getElementById("closeModal").addEventListener("click", () => {
      modalOverlay.remove();
    });
  }
})();









// Daily Tasks Countdown Timer (Resets at Midnight EST/EDT)
// ---------------------------------------------------------

/**
 * Returns the absolute UTC timestamp (in milliseconds) for the upcoming midnight 
 * in New York (America/New_York) based on New York’s wall‐clock day.
 *
 * This function first “converts” the current time to New York time by using 
 * toLocaleString() with the appropriate timeZone. It then creates a Date object 
 * from that string (which is parsed as a local Date) and resets it to midnight. 
 * Because the conversion loses the actual New York offset, we compute the difference 
 * between the current absolute time and the parsed “New York time” and adjust accordingly.
 */
function getNextMidnightNY() {
  const now = new Date();
  // Convert current time to a string in New York’s timezone.
  // (The format “en-US” works reliably in most browsers.)
  const nowInNYString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  // Parse that string to get a Date object.
  // (This Date is created in the browser’s local timezone but its time reflects NY’s wall clock.)
  const nowNY = new Date(nowInNYString);
  
  // Create a Date for New York’s midnight today (using the NY wall-clock date)
  const nyMidnightToday = new Date(nowNY);
  nyMidnightToday.setHours(0, 0, 0, 0);
  
  // The upcoming NY midnight is the midnight of the next day.
  nyMidnightToday.setDate(nyMidnightToday.getDate() + 1);
  
  // Because nowNY was parsed in local time, we compute the offset difference between 
  // the true current time (now) and the parsed New York time (nowNY).
  const offsetDiff = now.getTime() - nowNY.getTime();
  
  // Adjust the NY midnight by that difference to get the correct absolute timestamp.
  return nyMidnightToday.getTime() + offsetDiff;
}

/**
 * Updates the countdown timer displayed on the page.
 * The timer shows the remaining time (HH:MM:SS) until midnight in New York.
 */
function updateCountdown() {
  const countdownElem = document.getElementById("countdownTimer");
  if (!countdownElem) return;

  const now = Date.now();
  const nextMidnightUTC = getNextMidnightNY();
  const diff = nextMidnightUTC - now;

  // When the countdown reaches (or passes) zero, force a refresh so the UI can reset.
  if (diff <= 0) {
    location.reload();
    return;
  }

  // Convert the difference into hours, minutes, and seconds.
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  countdownElem.innerText = `${hours.toString().padStart(2, '0')}:` +
                              `${minutes.toString().padStart(2, '0')}:` +
                              `${seconds.toString().padStart(2, '0')}`;
}

// Starts (or restarts) the countdown timer.
let countdownInterval;
function startCountdownTimer() {
  updateCountdown();
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateCountdown, 1000);
}

// Start the countdown when the page loads.
document.addEventListener("DOMContentLoaded", startCountdownTimer);

// Optional: If your UI uses a button to show daily tasks.
const showDailyTasksButton = document.getElementById('showDailyTasksButton');
if (showDailyTasksButton) {
  showDailyTasksButton.addEventListener('click', () => {
    showSection('dailyTasksPage'); // Assumes you have a function to display the desired section.
    startCountdownTimer();
  });
}


// ------------------------------
// Console Section with Rolling Updates & Mobile Log Limit
// ------------------------------
const showConsoleButton = document.getElementById("showConsoleButton");
let consoleUpdateInterval = null; // Store interval reference

if (showConsoleButton) {
  showConsoleButton.addEventListener("click", () => {
    showSection("consoleSection");
    fetchAndDisplayConsoleLogs(); // Fetch logs immediately
    startConsoleUpdates(); // Start rolling updates every 5 seconds
  });
}

// Fetch and display logs
async function fetchAndDisplayConsoleLogs() {
  try {
    const response = await fetch("/api/console");
    if (!response.ok) {
      throw new Error("Failed to fetch console logs");
    }
    let logs = await response.json();
    console.log("Fetched logs:", logs); // Debugging log

    // Ensure logs is an array; if not, try extracting from an object
    if (!Array.isArray(logs)) {
      logs = logs.logs || Object.values(logs);
    }

    // Limit logs to the last 8 items on mobile devices
    if (isMobileDevice() && logs.length > 8) {
      logs = logs.slice(-8);
    }

    const consoleLogs = document.getElementById("consoleLogs");
    if (!consoleLogs) return;

    // Clear previous logs
    consoleLogs.innerHTML = "";

    if (logs.length === 0) {
      consoleLogs.innerHTML = `<li class="log-item">No logs available.</li>`;
    } else {
      logs.forEach(log => {
        const rawTimestamp = log.timestamp || log.time || 'Unknown Time';
        const message = log.message || log.msg || 'Unknown Message';

        // Convert timestamp to local time (hh:mm:ss AM/PM)
        let formattedTime = "Unknown Time";
        if (rawTimestamp !== "Unknown Time") {
          const date = new Date(rawTimestamp);
          formattedTime = date.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
          });
        }

        const li = document.createElement("li");
        li.className = "log-item";
        li.innerHTML = `<strong>[${formattedTime}]</strong> ${message}`;
        consoleLogs.appendChild(li);
      });
    }

    // Force the scrollbar to scroll to the bottom
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
    
  } catch (error) {
    console.error("Error fetching console logs:", error);
    const consoleLogs = document.getElementById("consoleLogs");
    if (consoleLogs) {
      consoleLogs.innerHTML =
        `<li class="log-item error">⚠️ Error loading logs. Please try again later.</li>`;
    }
  }
}

// Start rolling updates every 5 seconds
function startConsoleUpdates() {
  if (consoleUpdateInterval) clearInterval(consoleUpdateInterval);
  consoleUpdateInterval = setInterval(fetchAndDisplayConsoleLogs, 5000);
}

// Stop updates when leaving the console section
function stopConsoleUpdates() {
  if (consoleUpdateInterval) {
    clearInterval(consoleUpdateInterval);
    consoleUpdateInterval = null;
  }
}

// Detect when user leaves the console section (assumes elements with class "back-button" exist)
document.querySelectorAll(".back-button").forEach(button => {
  button.addEventListener("click", stopConsoleUpdates);
});

// Helper function to detect if the user is on a mobile device
function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent);
}










//
// SPECIAL RULES FOR LOGGED IN
//
// Function to handle inventory click events dynamically
function handleInventoryClickEvents() {
  const token = localStorage.getItem("token"); // Check if user is logged in

  document.querySelectorAll(".inventory-item").forEach((itemElement) => {
    const itemName = itemElement.getAttribute("data-name");

    // Remove all existing event listeners by cloning & replacing
    const clonedElement = itemElement.cloneNode(true);
    itemElement.parentNode.replaceChild(clonedElement, itemElement);

    if (token) {
      // ✅ LOGGED IN: Remove click events completely
      clonedElement.onclick = null;
      clonedElement.removeAttribute("onclick");
    } else {
      // 🚀 NOT LOGGED IN: Add click event to copy command & open Discord
      clonedElement.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(`%use "${itemName}"`);
          alert(
            `Copied to clipboard: %use "${itemName}"\n\nClick OK to go to Discord and use your item!`
          );
        } catch (err) {
          console.error("Clipboard copy failed:", err);
          alert("Failed to copy. Please copy manually.");
        }

        window.open(
          "https://discord.com/channels/1014872741846974514/1336779333641179146",
          "_blank"
        );
      });
    }
  });
}

// Call this function AFTER inventory is fetched and rendered
async function fetchInventory() {
  const token = localStorage.getItem("token");
  if (!token) {
    alert('Please log in first!');
    return;
  }

  try {
    const response = await fetch('/api/inventory', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch inventory');
    }

    const data = await response.json();
    const inventoryItems = document.getElementById('inventoryItems');
    inventoryItems.innerHTML = ''; // Clear existing content

    if (!data.length) {
      inventoryItems.innerHTML = '<p class="no-items">You have no items in your inventory.</p>';
      return;
    }

    data.forEach((item) => {
      const itemContainer = document.createElement('div');
      itemContainer.className = 'inventory-item raffle-item bg-content border border-accent rounded-lg p-3 my-2 shadow-md text-primary';
      itemContainer.setAttribute("data-name", item.name);

      // Item title
      const itemTitle = document.createElement('h3');
      itemTitle.className = 'font-bold text-highlight uppercase tracking-wide text-center';
      itemTitle.textContent = `${item.name} (Qty: ${item.quantity})`;
      itemContainer.appendChild(itemTitle);

      // Item description
      const descriptionSpan = document.createElement('p');
      descriptionSpan.className = 'text-body text-primary';
      descriptionSpan.innerHTML = item.description.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" class="link">$1</a>'
      );
      itemContainer.appendChild(descriptionSpan);

      inventoryItems.appendChild(itemContainer);
    });

    // 🔥 Re-attach event listeners dynamically after items are added
    handleInventoryClickEvents();
  } catch (error) {
    console.error('Error fetching inventory:', error);
    inventoryItems.innerHTML = '<p class="error-text text-red-500">Error loading inventory.</p>';
  }
}







  // ------------------------------
  // Back Buttons
  // ------------------------------
  document.querySelectorAll('.back-button').forEach((backButton) => {
    backButton.addEventListener('click', () => {
      showSection('landingPage');
    });
  });
});

});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// ==========================
// EXPORT THE CLIENT
// ==========================
module.exports = { client };

// Finally, log in the bot with your token from .env
client.login(process.env.TOKEN);