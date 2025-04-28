const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buyoil')
    .setDescription('Buy Robot Oil from a market listing.')
    .addIntegerOption(option =>
      option.setName('listing_id')
        .setDescription('The ID of the listing you want to buy from')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantity')
        .setDescription('How much Robot Oil you want to buy')
        .setRequired(true)),

  async execute(interaction) {
    const listingID = interaction.options.getInteger('listing_id');
    const quantity = interaction.options.getInteger('quantity');
    const buyerID = interaction.user.id;

    if (quantity <= 0) {
      return interaction.reply({ content: '🚫 Quantity must be greater than zero.', ephemeral: true });
    }

    try {
      const message = await db.buyRobotOilFromMarket(buyerID, listingID, quantity);
      await interaction.reply({ content: message });
    } catch (error) {
      console.error('❌ Error in /buyoil:', error);
      await interaction.reply({ content: `🚫 Failed to complete purchase: ${error.message || error}`, ephemeral: true });
    }
  },
};
