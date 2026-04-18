const { SlashCommandBuilder } = require('discord.js');
const db = require('../../db'); // This imports our db module

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transferitem')
    .setDescription('Transfer an item from your inventory to another user.')
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('The user to transfer the item to.')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The name of the item to transfer.')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('quantity')
        .setDescription('The quantity to transfer (default is 1).')
        .setRequired(false)
    ),

  async execute(interaction) {
    const senderId = interaction.user.id;
    const targetUser = interaction.options.getUser('target');
    const itemName = interaction.options.getString('item');
    const quantity = interaction.options.getInteger('quantity') || 1;

    // Basic validations
    if (quantity <= 0) {
      return interaction.reply({ content: "Quantity must be at least 1.", ephemeral: true });
    }
    if (targetUser.id === senderId) {
      return interaction.reply({ content: "You cannot transfer items to yourself.", ephemeral: true });
    }

    try {
      // 1. Look up the item details from the shop.
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        return interaction.reply({ content: `Item "${itemName}" does not exist in the shop.`, ephemeral: true });
      }

      await db.transferInventoryItem(senderId, targetUser.id, shopItem.itemID, quantity, {
        actorUserId: senderId,
        source: 'slash_transferitem',
      });

      return interaction.reply({
        content: `Successfully transferred ${quantity} x "${shopItem.name}" to ${targetUser.username}.`,
      });
    } catch (error) {
      console.error("Error transferring item:", error);
      return interaction.reply({
        content: `Error transferring item: ${error.message}`,
        ephemeral: true,
      });
    }
  },
};
