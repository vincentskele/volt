const { SlashCommandBuilder } = require('@discordjs/builders');
const { registerUser } = require('../../db.js');


module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetpassword')
    .setDescription('Reset your account password.')
    .addStringOption(option =>
      option.setName('newpassword')
        .setDescription('Enter your new password')
        .setRequired(true)
    ),
  async execute(interaction) {
    const newPassword = interaction.options.getString('newpassword');
    const discord_id = interaction.user.id;

    try {
      await registerUser(discord_id, newPassword);
      await interaction.reply({ content: `✅ Your password has been successfully reset.`, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `❌ Error resetting password: ${error}`, ephemeral: true });
    }
  },
};
