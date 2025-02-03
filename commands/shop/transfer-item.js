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

      // 2. Check the sender's inventory for that item using the raw SQLite instance.
      const senderRow = await new Promise((resolve, reject) => {
        // Note: We use "db.db.get" because the exported object has a property "db" which is our raw SQLite instance.
        db.db.get(
          `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`,
          [senderId, shopItem.itemID],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (!senderRow || senderRow.quantity < quantity) {
        return interaction.reply({
          content: `You do not have enough of "${itemName}" to transfer. You have ${senderRow ? senderRow.quantity : 0}.`,
          ephemeral: true,
        });
      }

      // 3. Update the sender's inventory:
      //    Subtract the transferred quantity (if quantity becomes 0, delete the row).
      const newQuantity = senderRow.quantity - quantity;
      await new Promise((resolve, reject) => {
        if (newQuantity > 0) {
          db.db.run(
            `UPDATE inventory SET quantity = ? WHERE userID = ? AND itemID = ?`,
            [newQuantity, senderId, shopItem.itemID],
            function(err) {
              if (err) reject(err);
              else resolve();
            }
          );
        } else {
          db.db.run(
            `DELETE FROM inventory WHERE userID = ? AND itemID = ?`,
            [senderId, shopItem.itemID],
            function(err) {
              if (err) reject(err);
              else resolve();
            }
          );
        }
      });

      // 4. Add the item(s) to the target user's inventory using our helper function.
      await db.addItemToInventory(targetUser.id, shopItem.itemID, quantity);

      // 5. Reply with a success message.
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
