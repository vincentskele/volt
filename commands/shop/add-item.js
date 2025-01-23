const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../db');
const { currency, formatCurrency } = require('../../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-item')
    .setDescription('Add a new item to the shop. (Admin Only)')
    .addIntegerOption(option =>
      option.setName('price')
        .setDescription(`The price of the item in ${currency.symbol}`)
        .setRequired(true))
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The name of the item')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('description')
        .setDescription('A brief description of the item')
        .setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can add items.', ephemeral: true });
    }

    const price = interaction.options.getInteger('price');
    const name = interaction.options.getString('name');
    const description = interaction.options.getString('description');

    if (!price || price <= 0 || !name || !description) {
      return interaction.reply({ content: '🚫 Invalid input. Ensure all fields are filled.', ephemeral: true });
    }

    try {
      await db.addShopItem(price, name.trim(), description.trim());

      const embed = new EmbedBuilder()
        .setTitle(`✅ Added ${name.trim()} to the Shop`)
        .addFields({
          name: 'Price',
          value: `${formatCurrency(price)}`
        }, {
          name: 'Description',
          value: `${description.trim()}`
        })
        .setColor(0x32CD32)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Add Shop Item Error:', err);
      return interaction.reply({ content: `🚫 Failed to add item: ${err.message || err}`, ephemeral: true });
    }
  },
};
