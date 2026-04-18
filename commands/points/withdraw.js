const { SlashCommandBuilder } = require('@discordjs/builders');
const { formatCurrency } = require('../../points');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Legacy command kept for compatibility after the balance merge.')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The amount to transfer')
        .setRequired(true)),
  
  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    if (amount <= 0) {
      return interaction.reply({ content: 'Please specify a positive amount to transfer.', ephemeral: true });
    }

    try {
      await db.withdraw(interaction.user.id, amount, {
        source: 'withdraw_command',
      });
      return interaction.reply(
        `ℹ️ Volt balances are unified now, so there’s nothing to transfer. Your ${formatCurrency(amount)} is already in your main balance.`
      );
    } catch (err) {
      return interaction.reply({ content: `🚫 Transfer failed: ${err}`, ephemeral: true });
    }
  }
};
