const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-item')
    .setDescription('Remove an item from the shop. (Admin Only)')
    .addStringOption(option =>
      option.setName('item')
        .setDescription('The name of the item to remove')
        .setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can remove items.', ephemeral: true });
    }

    const itemName = interaction.options.getString('item');

    try {
      await db.removeShopItem(itemName.trim());

      const embed = new EmbedBuilder()
        .setTitle(`✅ Removed ${itemName.trim()} from the Shop`)
        .setColor(0xFF4500)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Remove Shop Item Error:', err);
      return interaction.reply({ content: `🚫 Failed to remove item: ${err.message || err}`, ephemeral: true });
    }
  },
};
