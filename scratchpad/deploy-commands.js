require('dotenv').config(); // Load variables from .env
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const { CLIENT_ID, GUILD_ID, TOKEN } = process.env;

if (!CLIENT_ID || !TOKEN) {
  console.error('❌ Missing CLIENT_ID or TOKEN in .env file.');
  process.exit(1);
}

// Initialize the REST module
const rest = new REST({ version: '10' }).setToken(TOKEN);

/**
 * Recursively collect all command files from the specified directory.
 * @param {string} dirPath - The directory to search for command files.
 * @param {string[]} commandFiles - The list to store found command files.
 * @returns {string[]} - The list of all command file paths.
 */
function getAllCommandFiles(dirPath, commandFiles = []) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllCommandFiles(fullPath, commandFiles); // Recursively search subdirectories
    } else if (file.endsWith('.js')) {
      commandFiles.push(fullPath);
    }
  }
  return commandFiles;
}

// Collect all command files from the commands directory and subdirectories
const commandsPath = path.join(__dirname, '../commands');
const commandFiles = getAllCommandFiles(commandsPath);

const commands = [];

// Load each command file and collect its data
for (const file of commandFiles) {
  const commandModule = require(file);

  if (!commandModule.data) {
    console.warn(`⚠️  The command module "${file}" is missing a "data" property.`);
    continue;
  }

  if (Array.isArray(commandModule.data)) {
    // If the module exports an array of commands
    for (const cmd of commandModule.data) {
      if (typeof cmd.toJSON === 'function') {
        commands.push(cmd.toJSON());
      } else {
        console.warn(`⚠️  A command in "${file}" does not have a "toJSON" method.`);
      }
    }
  } else if (typeof commandModule.data.toJSON === 'function') {
    // If the module exports a single command
    commands.push(commandModule.data.toJSON());
  } else {
    console.warn(`⚠️  The "data" property in "${file}" is not a SlashCommandBuilder instance.`);
  }
}

if (commands.length === 0) {
  console.error('❌ No valid slash commands found. Deployment aborted.');
  process.exit(1);
}

// Deploy commands
(async () => {
  try {
    console.log(`🔄 Starting to refresh ${commands.length} application (/) commands.`);

    if (GUILD_ID) {
      // Deploy commands to a specific guild (instant update)
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands },
      );
      console.log(`✅ Successfully reloaded ${commands.length} guild (/) commands.`);
    } else {
      // Deploy global commands (takes up to 1 hour to update)
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands },
      );
      console.log(`✅ Successfully reloaded ${commands.length} global (/) commands.`);
    }
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
  }
})();
