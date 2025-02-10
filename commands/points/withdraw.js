const { SlashCommandBuilder } = require('@discordjs/builders');
const { formatCurrency } = require('../../currency');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Charge your Solarian with Volts from your battery bank.')
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
      await db.withdraw(interaction.user.id, amount);
      return interaction.reply(`✅ Charged their Solarian with ${formatCurrency(amount)} from their battery bank.`);
    } catch (err) {
      return interaction.reply({ content: `🚫 Transfer failed: ${err}`, ephemeral: true });
    }
  }
};
