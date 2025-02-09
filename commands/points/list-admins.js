const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-admins')
    .setDescription('List all bot admins.'),
  
  async execute(interaction) {
    try {
      const admins = await db.getAdmins();
      if (!admins.length) {
        return interaction.reply('📝 No bot admins configured.');
      }

      const adminList = admins.map(adminID => `<@${adminID}>`).join('\n');
      return interaction.reply(`**📝 Bot Admins:**\n${adminList}`);
    } catch (err) {
      return interaction.reply({ content: `🚫 Failed to retrieve admin list: ${err}`, ephemeral: true });
    }
  }
};
