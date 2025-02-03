const { SlashCommandBuilder } = require('discord.js');
const db = require('../../db'); // Adjust the path if needed

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rewarditem')
    .setDescription('Admin command: Reward a user an item from the shop without a purchase.')
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('The user to reward.')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The name of the item to reward.')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('quantity')
        .setDescription('Quantity of the item to reward (default is 1).')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Check that the caller is an admin.
    try {
      const adminIDs = await db.getAdmins();
      if (!adminIDs.includes(interaction.user.id)) {
        return interaction.reply({
          content: "You don't have permission to use this command.",
          ephemeral: true
        });
      }
    } catch (err) {
      console.error("Error fetching admin list:", err);
      return interaction.reply({
        content: "Error verifying admin status.",
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('target');
    const itemName = interaction.options.getString('item');
    const quantity = interaction.options.getInteger('quantity') || 1;

    if (quantity <= 0) {
      return interaction.reply({
        content: "Quantity must be at least 1.",
        ephemeral: true
      });
    }

    try {
      // Look up the item details from the shop.
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        return interaction.reply({
          content: `Item "${itemName}" is not available in the shop.`,
          ephemeral: true
        });
      }

      // Reward the item by adding it to the target user's inventory.
      await db.addItemToInventory(targetUser.id, shopItem.itemID, quantity);

      return interaction.reply({
        content: `Successfully rewarded ${targetUser.username} with ${quantity} x "${shopItem.name}".`
      });
    } catch (error) {
      console.error("Error rewarding item:", error);
      return interaction.reply({
        content: `Error rewarding item: ${error.message}`,
        ephemeral: true
      });
    }
  },
};
