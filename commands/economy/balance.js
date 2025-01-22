const { SlashCommandBuilder } = require('@discordjs/builders');
const { formatCurrency } = require('../../currency');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your balance or another user\'s balance.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to check the balance of')
        .setRequired(false)),

  async execute(interaction) {
    try {
      // Get the target user or default to the interaction user
      const targetUser = interaction.options.getUser('user') || interaction.user;

      // Fetch balances from the database
      const { wallet, bank } = await db.getBalances(targetUser.id);

      // Reply with the user's balance
      await interaction.reply(
        `**${targetUser.username}'s Balance**\n` +
        `Wallet: ${formatCurrency(wallet)}\n` +
        `Bank: ${formatCurrency(bank)}\n` +
        `Total: ${formatCurrency(wallet + bank)}`
      );
    } catch (err) {
      console.error('Error in /balance command:', err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: '🚫 Failed to retrieve balance.', ephemeral: true });
      } else {
        await interaction.reply({ content: '🚫 Failed to retrieve balance.', ephemeral: true });
      }
    }
  }
};
