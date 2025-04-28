const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('canceloil')
    .setDescription('Cancel your Robot Oil listing and return unsold oil.')
    .addIntegerOption(option =>
      option.setName('listing_id')
        .setDescription('The ID of the listing you want to cancel')
        .setRequired(true)),

  async execute(interaction) {
    const listingID = interaction.options.getInteger('listing_id');
    const sellerID = interaction.user.id;

    try {
      const message = await db.cancelRobotOilListing(sellerID, listingID);
      await interaction.reply({ content: message });
    } catch (error) {
      console.error('❌ Error in /canceloil:', error);
      await interaction.reply({ content: `🚫 Failed to cancel listing: ${error.message || error}`, ephemeral: true });
    }
  },
};
