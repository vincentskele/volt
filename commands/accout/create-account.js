const { SlashCommandBuilder } = require('@discordjs/builders');
const { registerUser } = require('../../db.js');


module.exports = {
  data: new SlashCommandBuilder()
    .setName('createaccount')
    .setDescription('Set or update your username and password.')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Your desired username (must be unique)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('password')
        .setDescription('Your password')
        .setRequired(true)
    ),
  async execute(interaction) {
    const username = interaction.options.getString('username');
    const password = interaction.options.getString('password');
    const discord_id = interaction.user.id;

    try {
      const user = await registerUser(discord_id, username, password);
      await interaction.reply({ content: `✅ Account set successfully! Username: **${user.username}**`, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `❌ Error: ${error}`, ephemeral: true });
    }
  },
};
