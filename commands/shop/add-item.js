const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../db');
const { points, formatCurrency } = require('../../points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-item')
    .setDescription('Add a new item to the shop. (Admin Only)')
    .addIntegerOption(option =>
      option.setName('price')
        .setDescription(`The price of the item in ${points.symbol}`)
        .setRequired(true))
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The name of the item')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('description')
        .setDescription('A brief description of the item')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantity')
        .setDescription('The quantity available in the shop (default: 1)')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('hidden')
        .setDescription('Hide the item from the public shop (default: false)')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('available')
        .setDescription('Whether the item can be bought in the shop (default: true unless hidden)')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('redeemable')
        .setDescription('Whether the item can be redeemed from inventory (default: true)')
        .setRequired(false)),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can add items.', ephemeral: true });
    }

    const price = interaction.options.getInteger('price');
    const name = interaction.options.getString('name');
    const description = interaction.options.getString('description');
    const quantity = interaction.options.getInteger('quantity') || 1;
    const hidden = interaction.options.getBoolean('hidden') ?? false;
    const availableOption = interaction.options.getBoolean('available');
    const redeemable = interaction.options.getBoolean('redeemable');
    const isAvailable = hidden ? false : (availableOption ?? true);

    if (!price || price <= 0 || !name || !description) {
      return interaction.reply({ content: '🚫 Invalid input. Ensure all fields are filled.', ephemeral: true });
    }

    try {
      await db.addShopItem(
        price,
        name.trim(),
        description.trim(),
        quantity,
        hidden,
        redeemable ?? true,
        isAvailable
      );

      const embed = new EmbedBuilder()
        .setTitle(`✅ Added ${name.trim()} to the Shop`)
        .addFields(
          { name: 'Price', value: `${formatCurrency(price)}` },
          { name: 'Quantity', value: `${quantity}` },
          { name: 'Description', value: `${description.trim()}` },
          { name: 'Hidden', value: `${hidden ? 'Yes' : 'No'}` },
          { name: 'Available', value: `${isAvailable ? 'Yes' : 'No'}` },
          { name: 'Redeemable', value: `${redeemable ?? true ? 'Yes' : 'No'}` }
        )
        .setColor(0x32CD32)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Add Shop Item Error:', err);
      return interaction.reply({ content: `🚫 Failed to add item: ${err.message || err}`, ephemeral: true });
    }
  },
};
