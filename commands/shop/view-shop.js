const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { currency, formatCurrency } = require('../../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('View items available in the shop.'),

  async execute(interaction) {
    try {
      const items = await db.getShopItems();
      if (!items.length) {
        return interaction.reply({ content: '🚫 The shop is empty.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🛍️ ${currency.name.charAt(0).toUpperCase() + currency.name.slice(1)} Shop`)
        .setColor(0xFFD700)
        .setTimestamp();

      items.forEach(item => {
        embed.addFields({
          name: `• ${item.name} — ${formatCurrency(item.price)}`,
          value: `*${item.description}*\n**Quantity Available:** ${item.quantity}`,
          inline: false,
        });
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('View Shop Error:', err);
      return interaction.reply({ content: `🚫 Error retrieving shop: ${err.message || err}`, ephemeral: true });
    }
  },
};
