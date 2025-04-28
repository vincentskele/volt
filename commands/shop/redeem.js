const { SlashCommandBuilder } = require('discord.js');
const { redeemItem, getInventory } = require('../../db'); // Ensure you have both functions

module.exports = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Use (redeem) an item from your inventory.')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The name of the item to use.')
        .setRequired(true)
        .setAutocomplete(true) // Enable autocomplete
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const itemName = interaction.options.getString('item');

    if (!itemName) {
      return interaction.reply({
        content: 'Please specify an item to use.',
        ephemeral: true,
      });
    }

    try {
      // Fetch user inventory to verify ownership
      const inventory = await getInventory(userId);
      const ownedItem = inventory.find(item => item.name.toLowerCase() === itemName.toLowerCase());

      if (!ownedItem) {
        return interaction.reply({
          content: `🚫 You do not have "${itemName}" in your inventory.`,
          ephemeral: true,
        });
      }

      // Attempt to redeem the item
      const resultMsg = await redeemItem(userId, itemName);

      return interaction.reply({ content: resultMsg });
    } catch (error) {
      console.error('Error using item:', error);
      return interaction.reply({
        content: error?.toString() || 'An error occurred while using the item.',
        ephemeral: true,
      });
    }
  },

  async autocomplete(interaction) {
    const userId = interaction.user.id;
    const focusedValue = interaction.options.getFocused();
    
    let inventoryItems;
    try {
      // Fetch user's inventory
      const inventory = await getInventory(userId);
      inventoryItems = inventory.map(item => item.name); // Extract item names

    } catch (error) {
      console.error('Error fetching inventory for autocomplete:', error);
      inventoryItems = [];
    }

    // Filter based on user input
    const filtered = inventoryItems
      .filter(name => name.toLowerCase().includes(focusedValue.toLowerCase()))
      .slice(0, 25); // Discord allows a max of 25 options

    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },
};
