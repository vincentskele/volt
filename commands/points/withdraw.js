const { SlashCommandBuilder } = require('@discordjs/builders');
const { formatCurrency } = require('../../currency');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Withdraw money from your bank to your wallet.')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The amount to withdraw')
        .setRequired(true)),
  
  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    if (amount <= 0) {
      return interaction.reply({ content: 'Please specify a positive amount to withdraw.', ephemeral: true });
    }

    try {
      await db.withdraw(interaction.user.id, amount);
      return interaction.reply(`✅ Withdrew ${formatCurrency(amount)} to your wallet.`);
    } catch (err) {
      return interaction.reply({ content: `🚫 Withdraw failed: ${err}`, ephemeral: true });
    }
  }
};
