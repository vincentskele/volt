const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { currency, formatCurrency } = require('../../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Purchase an item from the shop.')
    .addStringOption(option =>
      option.setName('item')
        .setDescription('The name of the item to buy')
        .setRequired(true)),

  async execute(interaction) {
    const itemName = interaction.options.getString('item');
    if (!itemName) {
      return interaction.reply({ content: '🚫 Item name is required.', ephemeral: true });
    }

    try {
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        return interaction.reply({ content: `🚫 "${itemName}" not found in the shop.`, ephemeral: true });
      }

      const { wallet } = await db.getBalances(interaction.user.id);
      if (wallet < shopItem.price) {
        return interaction.reply({
          content: `🚫 You only have ${formatCurrency(wallet)}, but **${shopItem.name}** costs ${formatCurrency(shopItem.price)}.`,
          ephemeral: true,
        });
      }

      // Process purchase
      await db.updateWallet(interaction.user.id, -shopItem.price);
      await db.addItemToInventory(interaction.user.id, shopItem.itemID, 1);

      const embed = new EmbedBuilder()
        .setTitle(`✅ Purchased ${shopItem.name}`)
        .setDescription(`You have bought **${shopItem.name}** for ${formatCurrency(shopItem.price)}.`)
        .setColor(0x32CD32)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Buy Item Error:', err);
      return interaction.reply({ content: `🚫 Purchase failed: ${err.message || err}`, ephemeral: true });
    }
  },
};
