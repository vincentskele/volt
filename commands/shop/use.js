const { SlashCommandBuilder } = require('discord.js');
const { redeemItem } = require('../../db'); // Adjust path to your database logic if needed

module.exports = {
  // Slash command builder configuration
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use (redeem) an item from your inventory.')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The name of the item to use.')
        .setRequired(true)
    ),

  // Slash command execution
  async execute(interaction) {
    const userId = interaction.user.id;
    const itemName = interaction.options.getString('item');

    // Ensure the item name is provided
    if (!itemName) {
      return interaction.reply({
        content: 'Please specify an item name to use.',
        ephemeral: true,
      });
    }

    try {
      // Attempt to redeem the item
      const resultMsg = await redeemItem(userId, itemName);

      // Respond with the success message
      return interaction.reply({ content: resultMsg });
    } catch (error) {
      // Handle errors (e.g., item not found)
      console.error('Error using item:', error);
      return interaction.reply({
        content: error?.toString() || 'An error occurred while using the item.',
        ephemeral: true,
      });
    }
  },
};
