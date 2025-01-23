const { REST, Routes } = require('discord.js');
require('dotenv').config();

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🔄 Started clearing global (/) commands.');

    const commands = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));
    if (commands.length > 0) {
      for (const command of commands) {
        await rest.delete(Routes.applicationCommand(process.env.CLIENT_ID, command.id));
      }
      console.log('✅ All global (/) commands deleted.');
    } else {
      console.log('⚠️ No global commands to delete.');
    }
  } catch (error) {
    console.error('Error clearing global commands:', error);
  }
})();
