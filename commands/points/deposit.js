const { SlashCommandBuilder } = require('@discordjs/builders'); // For creating slash commands
const { formatCurrency } = require('../../points'); // Custom points formatting module
const db = require('../../db'); // Database module

module.exports = {
  // Command definition
  data: new SlashCommandBuilder()
    .setName('deposit') // Command name
    .setDescription('Transfer Volts from your Solarian to your battery bank.') // Command description
    .addIntegerOption(option =>
      option.setName('amount') // Option to specify the deposit amount
        .setDescription('The amount to deposit') // Option description
        .setRequired(true)), // Option is required

  // Command execution logic
  async execute(interaction) {
    // Get the amount specified by the user
    const amount = interaction.options.getInteger('amount');

    // Validate the amount
    if (amount <= 0) {
      return interaction.reply({ content: '🚫 Please specify a positive amount to transfer.', ephemeral: true });
    }

    try {
      // Deposit the amount into the user's battery bank account in the database
      await db.deposit(interaction.user.id, amount);

      // Respond with a success message
      return interaction.reply(`✅ Transfered ${formatCurrency(amount)} into your battery bank.`);
    } catch (err) {
      // Handle errors gracefully and log them
      console.error(`Error in deposit command for user ${interaction.user.id}:`, err);
      return interaction.reply({ content: `🚫 Transfer failed: ${err.message || err}`, ephemeral: true });
    }
  }
};
