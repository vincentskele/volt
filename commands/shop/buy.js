const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { points, formatCurrency } = require('../../points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Purchase an item from the shop.')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The name of the item to buy')
        .setRequired(true)
        .setAutocomplete(true) // Enable autofill for available items
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    try {
      const items = await db.getShopItems();
      const choices = items
        .filter(item => item.quantity > 0) // Only show in-stock items
        .map(item => item.name);
      
      const filtered = choices.filter(choice => choice.toLowerCase().includes(focusedValue));
      await interaction.respond(filtered.slice(0, 25).map(choice => ({ name: choice, value: choice })));
    } catch (err) {
      console.error('Autocomplete Error:', err);
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    const itemName = interaction.options.getString('item');

    try {
      // Retrieve the shop item
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        return interaction.reply({
          content: `🚫 "${itemName}" is not available in the shop.`,
          ephemeral: true,
        });
      }

      // Check if the item is in stock
      if (shopItem.quantity <= 0) {
        return interaction.reply({
          content: `🚫 "${shopItem.name}" is out of stock.`,
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

      // Deduct item price from the user's wallet
      await db.updateWallet(interaction.user.id, -shopItem.price);

      // Add the purchased item to the user's inventory
      await db.addItemToInventory(interaction.user.id, shopItem.itemID, 1);

      // Decrease shop quantity
      await db.updateShopItemQuantity(shopItem.itemID, shopItem.quantity - 1);

      // Send success message
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
