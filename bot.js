// bot.js
require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const {
  getActiveGiveaways,
  deleteGiveaway,
  updateWallet,
  getShopItemByName,
  addItemToInventory,
  // Note: saveGiveaway is used by the command, but you may also export it here if needed.
} = require('./db'); // Import your database functions

// Initialize the bot client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = process.env.PREFIX || '$';
client.commands = new Collection();

// Command mapping for prefix-based commands
const commandModules = {};

// Directory to load commands from
const commandsPath = path.join(__dirname, 'commands');

// Load commands dynamically
const loadCommands = (dir) => {
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
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command); // For slash command registration
          commandModules[command.data.name] = command; // For prefix command registration
          console.log(`Loaded command: ${command.data.name}`);
        } else {
          console.warn(`⚠️ Skipped loading "${entry}" due to missing "data" or "execute".`);
        }
      } catch (err) {
        console.error(`❌ Error loading command "${entry}":`, err);
      }
    }
  }
};

// Load all commands from the commands directory
loadCommands(commandsPath);

/**
 * Unified function to conclude a giveaway.
 * It fetches the giveaway message, collects valid (non‑bot) participants,
 * randomly picks winners, awards the prize (handling both currency and shop items),
 * sends an announcement, and deletes the giveaway from the database.
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

    const participantArray = Array.from(participants.values());
    const selectedWinners = [];
    while (selectedWinners.length < giveaway.winners && selectedWinners.length < participantArray.length) {
      const randomIndex = Math.floor(Math.random() * participantArray.length);
      const selectedUser = participantArray[randomIndex];
      if (!selectedWinners.includes(selectedUser)) {
        selectedWinners.push(selectedUser);
      }
    }

    // Award prizes
    // Try to parse the prize as a number to determine if it's a currency giveaway.
    const prizeCurrency = parseInt(giveaway.prize, 10);
    for (const winner of selectedWinners) {
      if (!isNaN(prizeCurrency)) {
        // Currency giveaway
        await updateWallet(winner.id, prizeCurrency);
        console.log(`💰 Updated wallet for ${winner.id}: +${prizeCurrency}`);
      } else {
        // Shop item giveaway
        try {
          const shopItem = await getShopItemByName(giveaway.prize);
          await addItemToInventory(winner.id, shopItem.itemID, 1);
          console.log(`🎁 Awarded shop item "${giveaway.prize}" to ${winner.id}`);
        } catch (err) {
          console.error(`❌ Failed to award shop item to ${winner.id}:`, err);
        }
      }
    }

    const winnersMention = selectedWinners.map(user => `<@${user.id}>`).join(', ');
    await channel.send(`🎉 Congratulations ${winnersMention}! You won **${giveaway.prize}**!`);
    await deleteGiveaway(giveaway.message_id);
    console.log(`✅ Giveaway ${giveaway.message_id} resolved and deleted from DB.`);
  } catch (err) {
    console.error('❌ Error concluding giveaway:', err);
  }
}

// When the bot is ready, restore any active giveaways.
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is ready to use commands with prefix "${PREFIX}".`);

  // Restore active giveaways on bot restart
  const activeGiveaways = await getActiveGiveaways();
  console.log(`🔄 Restoring ${activeGiveaways.length} active giveaways...`);

  for (const giveaway of activeGiveaways) {
    const remainingTime = giveaway.end_time - Date.now();
    if (remainingTime > 0) {
      // If the giveaway is still running, schedule its conclusion.
      setTimeout(async () => {
        await concludeGiveaway(giveaway);
      }, remainingTime);
      console.log(`Scheduled giveaway ${giveaway.message_id} to conclude in ${remainingTime}ms.`);
    } else {
      // If the giveaway has already ended, conclude it immediately.
      await concludeGiveaway(giveaway);
    }
  }
});

// Handle prefix commands.
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const [command, ...args] = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = command.toLowerCase();

  try {
    const commandModule = commandModules[commandName];
    if (!commandModule) {
      return message.reply(`🚫 Unknown command: "${commandName}". Use \`${PREFIX}help\` for a list of available commands.`);
    }
    await commandModule.execute('prefix', message, args);
  } catch (error) {
    console.error('Error handling prefix command:', error);
    await message.reply('🚫 An error occurred while processing your command.');
  }
});

// Handle slash commands.
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return interaction.reply({ content: '🚫 Command not found. Try again or use /help.', ephemeral: true });
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing slash command ${interaction.commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '🚫 There was an error executing that command!', ephemeral: true });
    } else {
      await interaction.reply({ content: '🚫 There was an error executing that command!', ephemeral: true });
    }
  }
});

// Log in the bot.
client.login(process.env.TOKEN);
