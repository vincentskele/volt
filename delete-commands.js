// delete-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');

const { CLIENT_ID, GUILD_ID, TOKEN } = process.env;

if (!CLIENT_ID || !TOKEN) {
  console.error('❌ Missing CLIENT_ID or TOKEN in .env file.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    if (GUILD_ID) {
      // Delete guild-specific commands
      const guildCommands = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
      for (const command of guildCommands) {
        await rest.delete(Routes.applicationGuildCommand(CLIENT_ID, GUILD_ID, command.id));
        console.log(`Deleted guild command: ${command.name}`);
      }
      console.log('✅ All guild (/) commands deleted.');
    } else {
      // Delete global commands
      const globalCommands = await rest.get(Routes.applicationCommands(CLIENT_ID));
      for (const command of globalCommands) {
        await rest.delete(Routes.applicationCommand(CLIENT_ID, command.id));
        console.log(`Deleted global command: ${command.name}`);
      }
      console.log('✅ All global (/) commands deleted.');
    }
  } catch (error) {
    console.error('❌ Error deleting commands:', error);
  }
})();
