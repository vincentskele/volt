// commands/giveaway-create.js
const { SlashCommandBuilder } = require('discord.js');
const {
  saveGiveaway,
  updateWallet,
  getShopItemByName,
  addItemToInventory
} = require('../../db');
require('dotenv').config();

const CURRENCY_NAME = process.env.CURRENCY_NAME || 'Coins';
const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-create')
    .setDescription('Create a giveaway for currency or shop items.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Giveaway name (for identification)')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Duration of the giveaway')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('timeunit')
        .setDescription('Unit of time: minutes, hours, or days')
        .setRequired(true)
        .addChoices(
          { name: 'Minutes', value: 'minutes' },
          { name: 'Hours', value: 'hours' },
          { name: 'Days', value: 'days' }
        )
    )
    .addIntegerOption(option =>
      option.setName('winners')
        .setDescription('Number of winners to select')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('prize')
        .setDescription('Prize: either a currency amount (number) or a shop item name (text)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const giveawayName = interaction.options.getString('name');
    const duration = interaction.options.getInteger('duration');
    const timeUnit = interaction.options.getString('timeunit');
    const winners = interaction.options.getInteger('winners');
    const prizeInput = interaction.options.getString('prize');

    // Convert duration into milliseconds.
    let durationMs;
    switch (timeUnit) {
      case 'minutes': durationMs = duration * 60 * 1000; break;
      case 'hours': durationMs = duration * 60 * 60 * 1000; break;
      case 'days': durationMs = duration * 24 * 60 * 60 * 1000; break;
      default: durationMs = duration * 60 * 1000;
    }

    // Determine if the prize is currency or a shop item.
    const prizeCurrency = parseInt(prizeInput, 10);
    const prizeValue = isNaN(prizeCurrency)
      ? prizeInput
      : `${prizeCurrency} ${CURRENCY_SYMBOL}${CURRENCY_NAME}`;

    // Build and send the giveaway announcement.
    const announcement = `🎉 **GIVEAWAY: ${giveawayName}** 🎉

React with 🎉 to join!
**Duration:** ${duration} ${timeUnit}
**Winners:** ${winners}
**Prize:** ${prizeValue}`;

    const giveawayMessage = await interaction.channel.send(announcement);
    await giveawayMessage.react('🎉');

    // Save the giveaway to the database.
    const endTime = Date.now() + durationMs;
    await saveGiveaway(giveawayMessage.id, giveawayMessage.channel.id, endTime, prizeValue, winners, giveawayName);

    await interaction.reply({ content: `✅ Giveaway "${giveawayName}" started! It will end in ${duration} ${timeUnit}.`, ephemeral: true });

    // (Optional) You might schedule the conclusion here if not handled centrally.
    setTimeout(async () => {
      // Giveaway conclusion is typically handled by your bot's centralized giveaway logic.
    }, durationMs);
  },
};
