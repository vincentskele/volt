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
  getActiveRaffles,
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
    GatewayIntentBits.GuildVoiceStates,

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

const raffleCommand = require('./commands/giveaway/raffle.js');
raffleCommand.setClient(client);

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

const db = require('./db'); // Now "db" is available

// Now you can do db.getRaffleParticipants, db.removeRaffleShopItem, etc.
const { concludeRaffle } = require('./commands/giveaway/raffle.js');


/**
 * Restore and schedule active giveaways on bot startup.
 */
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  const activeGiveaways = await getActiveGiveaways();
  console.log(`🚦 Restoring ${activeGiveaways.length} active giveaways...`);

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

client.once('ready', async () => {
  console.log('🔄 Checking active raffles on startup...');

  const activeRaffles = await getActiveRaffles();
  console.log(`🔄 Restoring ${activeRaffles.length} active raffles...`);

  for (const raffle of activeRaffles) {
    const timeLeft = raffle.end_time - Date.now();

    if (timeLeft > 0) {
      setTimeout(() => {
        concludeRaffle(raffle.id);
      }, timeLeft);
      console.log(`📅 Scheduled raffle "${raffle.name}" (ID: ${raffle.id}) to conclude in ${timeLeft}ms.`);
    } else {
      await concludeRaffle(raffle.id);
      console.log(`⏰ Raffle "${raffle.name}" (ID: ${raffle.id}) was past end time and concluded immediately.`);
    }
  }
});

// Check every 60 seconds if any raffles have passed their end time.
setInterval(async () => {
  try {
    const activeRaffles = await getActiveRaffles();
    for (const raffle of activeRaffles) {
      if (Date.now() >= raffle.end_time) {
        console.log(`⏰ Raffle "${raffle.name}" is past its end time. Concluding now...`);
        await concludeRaffle(raffle.id);
      }
    }
  } catch (error) {
    console.error('⚠️ Error polling raffles:', error);
  }
}, 60_000);



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
    
    // Only try to respond if we haven't already
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ 
          content: '🚫 There was an error executing that command!', 
          ephemeral: true 
        });
      } catch (err) {
        console.error('Failed to send error response:', err);
      }
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

// ==========================
// 🎧 VOICE PRESENCE REWARDS (DAO Call)
// ==========================

const voicePresenceMap = new Map(); // { userId: { joinedAt, totalMinutes, rewardedToday } }
let hasLoggedWindowStart = false;

client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.member?.user?.id || oldState.member?.user?.id;
  if (!userId) return;

  const joinedChannelId = newState.channelId;
  const leftChannelId = oldState.channelId;
  const targetChannelId = process.env.VOICE_REWARD_CHANNEL_ID;

  const joinedTarget = joinedChannelId === targetChannelId;
  const leftTarget = leftChannelId === targetChannelId && joinedChannelId !== targetChannelId;

  if (joinedTarget) {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const rewardDay = parseInt(process.env.VOICE_REWARD_DAY, 10);
    const rewardHour = parseInt(process.env.VOICE_REWARD_HOUR, 10);
    const rewardDuration = parseInt(process.env.VOICE_REWARD_DURATION, 10);
    const isInWindow = currentDay === rewardDay && currentHour === rewardHour && currentMinute < rewardDuration;

    const existing = voicePresenceMap.get(userId);
    if (!existing) {
      voicePresenceMap.set(userId, {
        joinedAt: Date.now(),
        totalMinutes: 0,
        rewardedToday: false,
      });
    } else if (!existing.joinedAt) {
      existing.joinedAt = Date.now();
      voicePresenceMap.set(userId, existing);
    }

    if (isInWindow) {
      const user = client.users.cache.get(userId);
      console.log(`🎙️ ${user?.tag || userId} joined the voice channel during the reward window.`);
    }
  }

  if (leftTarget && voicePresenceMap.has(userId)) {
    const session = voicePresenceMap.get(userId);
    if (session.joinedAt) {
      const minutesInSession = Math.floor((Date.now() - session.joinedAt) / 60000);
      session.totalMinutes += minutesInSession;
      session.joinedAt = null;
      voicePresenceMap.set(userId, session);
    }
  }
});

setInterval(() => {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const rewardDay = parseInt(process.env.VOICE_REWARD_DAY, 10);
  const rewardHour = parseInt(process.env.VOICE_REWARD_HOUR, 10);
  const rewardDuration = parseInt(process.env.VOICE_REWARD_DURATION, 10);
  const requiredMinutes = parseInt(process.env.VOICE_REWARD_MINUTES_REQUIRED, 10);
  const rewardAmount = parseInt(process.env.VOICE_REWARD_AMOUNT, 10);

  const isInWindow = currentDay === rewardDay && currentHour === rewardHour && currentMinute < rewardDuration;

  if (isInWindow && !hasLoggedWindowStart) {
    console.log(`🕒 DAO call reward window has started (${rewardDuration} min, requires ${requiredMinutes} min presence)`);
    hasLoggedWindowStart = true;
  }

  if (!isInWindow && hasLoggedWindowStart) {
    hasLoggedWindowStart = false;
  }

  if (!isInWindow) return;

  for (const [userId, session] of voicePresenceMap.entries()) {
    const activeMinutes = session.joinedAt ? Math.floor((Date.now() - session.joinedAt) / 60000) : 0;
    const totalMinutes = session.totalMinutes + activeMinutes;

    if (!session.rewardedToday && totalMinutes >= requiredMinutes) {
      updateWallet(userId, rewardAmount);
      session.rewardedToday = true;
      voicePresenceMap.set(userId, session);

      const user = client.users.cache.get(userId);
      console.log(`🏆 ${user?.tag || userId} awarded ${rewardAmount} Volts for attending the DAO call (${totalMinutes} min).`);

    }
  }
}, 60_000);

// ==========================
// 🎲 TRIVIA BOT
// ==========================
const triviaQuestions = require('./questions.json');
const MS_IN_24_HOURS = 86400000;
const triviaAskedToday = new Set();
let triviaCountToday = 0;
let activeCollector = null;

/**
 * Get a random unused trivia question
 */
function getRandomTrivia() {
  const unused = triviaQuestions.filter(q => !triviaAskedToday.has(q.question));
  if (unused.length === 0) return null;
  return unused[Math.floor(Math.random() * unused.length)];
}

/**
 * Ask a trivia question and wait for an answer
 */
async function askTriviaQuestion() {
  const rewardAmount = parseInt(process.env.TRIVIA_REWARD_AMOUNT, 10) || 50;
  const channel = await client.channels.fetch(process.env.TRIVIA_CHANNEL_ID);
  if (!channel) return console.error("⚠️ Trivia channel not found.");

  const trivia = getRandomTrivia();
  if (!trivia) return console.warn("⚠️ No unused trivia questions left today.");

  triviaAskedToday.add(trivia.question);
  triviaCountToday++;

  if (activeCollector) {
    activeCollector.stop('next-question');
    activeCollector = null;
  }

  await channel.send(`🎲 Trivia Time! First to answer correctly wins ${rewardAmount} Volts:\n**${trivia.question}**`);
  console.log(`🧠 Trivia #${triviaCountToday} asked: ${trivia.question}`);

  const collector = channel.createMessageCollector({
    filter: msg => !msg.author.bot,
    time: MS_IN_24_HOURS, // safety timeout
  });

  activeCollector = collector;

  collector.on('collect', async msg => {
    const userAnswer = msg.content.toLowerCase().trim();
    const acceptedAnswers = trivia.answers || [trivia.answer];
    const isCorrect = acceptedAnswers.some(ans => userAnswer.includes(ans.toLowerCase()));

    if (isCorrect) {
      collector.stop('answered');
      await updateWallet(msg.author.id, rewardAmount);
      await channel.send(`✅ Correct! ${msg.author} wins ${rewardAmount} Volts!`);
      console.log(`🏆 ${msg.author.tag} won trivia #${triviaCountToday} (+${rewardAmount} Volts)`);
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'answered') return;
    if (reason === 'next-question') {
      console.log(`⌛ No correct answer for trivia #${triviaCountToday - 1}. Moving on.`);
    } else {
      console.log(`❌ Trivia collector ended with reason: ${reason}`);
    }
  });
}

/**
 * Schedules today's trivia questions, spaced randomly over the remaining time until midnight EST
 */
function scheduleDailyTriviaQuestions() {
  const maxPerDay = parseInt(process.env.TRIVIA_QUESTIONS_PER_DAY, 10) || 3;

  const now = new Date();
  const midnightEST = new Date(now.toISOString().split('T')[0] + 'T05:00:00.000Z');
  let msUntilMidnight = midnightEST.getTime() - now.getTime();
  if (msUntilMidnight < 0) msUntilMidnight += MS_IN_24_HOURS;

  console.log(`📅 Scheduling ${maxPerDay} trivia questions for the next ${Math.floor(msUntilMidnight / 1000 / 60)} minutes.`);

  for (let i = 0; i < maxPerDay; i++) {
    const delay = Math.floor(Math.random() * msUntilMidnight);
    setTimeout(() => askTriviaQuestion(), delay);
  }
}

/**
 * Resets counters and schedules the next day's trivia + next reset
 */
function scheduleTriviaReset() {
  const now = new Date();
  const midnightEST = new Date(now.toISOString().split('T')[0] + 'T05:00:00.000Z');
  let delay = midnightEST.getTime() - now.getTime();
  if (delay < 0) delay += MS_IN_24_HOURS;

  setTimeout(() => {
    triviaAskedToday.clear();
    triviaCountToday = 0;

    if (activeCollector) {
      activeCollector.stop('reset');
      activeCollector = null;
    }

    console.log("🔄 Trivia reset for new day.");
    scheduleDailyTriviaQuestions();
    scheduleTriviaReset();
  }, delay);
}

// 🟢 Start trivia loop on bot start
scheduleDailyTriviaQuestions(); // Safe to run once, schedules based on remaining day
scheduleTriviaReset();

// ==========================
// EXPORT THE CLIENT
// ==========================
module.exports = { client };

// Finally, log in the bot with your token from .env
client.login(process.env.TOKEN);