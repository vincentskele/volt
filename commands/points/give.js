const { SlashCommandBuilder } = require('@discordjs/builders');
const { formatCurrency } = require('../../currency');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Transfer points to another user.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to give points to')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The amount to give')
        .setRequired(true)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    if (amount <= 0) {
      return interaction.reply({ content: '🚫 Please specify a positive amount to give.', ephemeral: true });
    }

    if (interaction.user.id === targetUser.id) {
      return interaction.reply({ content: '🚫 You cannot give points to yourself.', ephemeral: true });
    }

    try {
      // Transfer money using the database method
      await db.transferFromWallet(interaction.user.id, targetUser.id, amount);

      return interaction.reply(`✅ You gave ${formatCurrency(amount)} to <@${targetUser.id}>!`);
    } catch (err) {
      console.error(`Error transferring money from ${interaction.user.id} to ${targetUser.id}:`, err);
      return interaction.reply({ content: `🚫 Transfer failed: ${err.message}`, ephemeral: true });
    }
  }
};
