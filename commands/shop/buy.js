// commands/shop/buy.js

// 1) Dependencies / Debug Helpers
const path = require('path');

// Clear the entire require cache to ensure you get the most recent version of all modules.
Object.keys(require.cache).forEach(key => delete require.cache[key]);

// Use the absolute path to load the db.js file
const dbPath = path.join(__dirname, '..', '..', 'db.js');
const db = require(dbPath);

console.log('DEBUG: Loaded db from =>', require.resolve(dbPath));
console.log('DEBUG: db object keys =>', Object.keys(db)); // Verify that addItemToInventory appears

// 2) Other imports for the slash command
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { points, formatCurrency } = require('../../points');

// 3) Export the Slash Command
module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Purchase an item from the shop.')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The name of the item to buy')
        .setRequired(true)
    ),

  // 4) Command Logic
  async execute(interaction) {
    // Get the item name provided by the user
    const itemName = interaction.options.getString('item');
    if (!itemName) {
      return interaction.reply({
        content: '🚫 Item name is required.',
        ephemeral: true,
      });
    }

    try {
      // Look up the shop item by name
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        return interaction.reply({
          content: `🚫 "${itemName}" not found in the shop.`,
          ephemeral: true,
        });
      }

      // Check the user's wallet balance
      const { wallet } = await db.getBalances(interaction.user.id);
      if (wallet < shopItem.price) {
        return interaction.reply({
          content: `🚫 You only have ${formatCurrency(wallet)}, but **${shopItem.name}** costs ${formatCurrency(shopItem.price)}.`,
          ephemeral: true,
        });
      }

      console.log('DEBUG: Buying item =>', shopItem.name);
      console.log('DEBUG: typeof db.addItemToInventory =>', typeof db.addItemToInventory);

      // Deduct the item price from the user's wallet
      await db.updateWallet(interaction.user.id, -shopItem.price);

      // Add the purchased item to the user's inventory
      await db.addItemToInventory(interaction.user.id, shopItem.itemID, 1);

      // Build and send a success embed
      const embed = new EmbedBuilder()
        .setTitle(`✅ Purchased ${shopItem.name}`)
        .setDescription(`You have bought **${shopItem.name}** for ${formatCurrency(shopItem.price)}.`)
        .setColor(0x32CD32)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Buy Item Error:', err);
      return interaction.reply({
        content: `🚫 Purchase failed: ${err.message || err}`,
        ephemeral: true,
      });
    }
  },
};
