require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

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
          client.commands.set(command.data.name, command); // Slash command registration
          commandModules[command.data.name] = command; // Prefix command registration
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

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is ready to use commands with prefix "${PREFIX}".`);
});

// Handle prefix commands
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const [command, ...args] = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = command.toLowerCase();

  try {
    const command = commandModules[commandName];
    if (!command) {
      return message.reply(`🚫 Unknown command: "${commandName}". Use \`${PREFIX}help\` for a list of available commands.`);
    }
    await command.execute('prefix', message, args);
  } catch (error) {
    console.error('Error handling prefix command:', error);
    await message.reply('🚫 An error occurred while processing your command.');
  }
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return interaction.reply({ content: '🚫 Command not found. Try again or use /help.', ephemeral: true });
  }

  try {
    await command.execute(interaction); // Pass the correct interaction object
  } catch (error) {
    console.error(`Error executing slash command ${interaction.commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '🚫 There was an error executing that command!', ephemeral: true });
    } else {
      await interaction.reply({ content: '🚫 There was an error executing that command!', ephemeral: true });
    }
  }
});

// Login the bot
client.login(process.env.TOKEN);
