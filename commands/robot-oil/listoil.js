const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listoil')
    .setDescription('List your Robot Oil for sale on the market.')
    .addIntegerOption(option =>
      option.setName('quantity')
        .setDescription('How many Robot Oil you want to list')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('price')
        .setDescription('Price per unit (coins)')
        .setRequired(true)),

  async execute(interaction) {
    const quantity = interaction.options.getInteger('quantity');
    const pricePerUnit = interaction.options.getInteger('price');
    const sellerID = interaction.user.id;

    if (quantity <= 0 || pricePerUnit <= 0) {
      return interaction.reply({ content: '🚫 Quantity and price must be greater than zero.', ephemeral: true });
    }

    try {
      const message = await db.listRobotOilForSale(sellerID, quantity, pricePerUnit);
      await interaction.reply({ content: message });
    } catch (error) {
      console.error('❌ Error in /listoil:', error);
      await interaction.reply({ content: `🚫 Failed to list Robot Oil: ${error.message || error}`, ephemeral: true });
    }
  },
};
