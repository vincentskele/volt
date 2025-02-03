// commands/giveaway-create.js
const { SlashCommandBuilder } = require('discord.js');
const {
  updateWallet,
  getShopItemByName,
  addItemToInventory,
  saveGiveaway,
  deleteGiveaway,
} = require('../../db');
require('dotenv').config();

const CURRENCY_NAME = process.env.CURRENCY_NAME || 'Coins';
const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-create')
    .setDescription('Create a giveaway for currency or shop items.')
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
    const duration = interaction.options.getInteger('duration');
    const timeUnit = interaction.options.getString('timeunit');
    const winners = interaction.options.getInteger('winners');
    const prizeInput = interaction.options.getString('prize');

    // Convert the duration into milliseconds.
    let durationMs;
    switch (timeUnit) {
      case 'minutes': durationMs = duration * 60 * 1000; break;
      case 'hours': durationMs = duration * 60 * 60 * 1000; break;
      case 'days': durationMs = duration * 24 * 60 * 60 * 1000; break;
      default: durationMs = duration * 60 * 1000;
    }

    // Determine whether the prize is a currency amount or a shop item.
    const prizeCurrency = parseInt(prizeInput, 10);
    const prizeType = isNaN(prizeCurrency) ? 'item' : 'currency';
    const prizeValue = prizeType === 'currency'
      ? `${prizeCurrency} ${CURRENCY_SYMBOL}${CURRENCY_NAME}`
      : prizeInput;

    // Build and send the giveaway announcement.
    const giveawayAnnouncement = `🎉 **GIVEAWAY TIME!** 🎉
    
React with 🎉 to join!
**Duration:** ${duration} ${timeUnit}
**Winners:** ${winners}
**Prize:** ${prizeValue}`;

    const giveawayMessage = await interaction.channel.send(giveawayAnnouncement);
    await giveawayMessage.react('🎉');

    // Save the giveaway to the database with its scheduled end time.
    await saveGiveaway(
      giveawayMessage.id,
      giveawayMessage.channel.id,
      Date.now() + durationMs,
      prizeValue,
      winners
    );

    await interaction.reply({ content: `✅ Giveaway started! It will end in ${duration} ${timeUnit}.`, ephemeral: true });

    // Inline setTimeout to conclude the giveaway if the bot stays online.
    setTimeout(async () => {
      try {
        const fetchedMessage = await giveawayMessage.fetch();
        const reaction = fetchedMessage.reactions.cache.get('🎉');
        if (!reaction) {
          fetchedMessage.channel.send('🚫 No one participated in the giveaway.');
          await deleteGiveaway(giveawayMessage.id);
          return;
        }

        const usersReacted = await reaction.users.fetch();
        const participants = usersReacted.filter(user => !user.bot);
        if (participants.size === 0) {
          fetchedMessage.channel.send('🚫 No one participated in the giveaway.');
          await deleteGiveaway(giveawayMessage.id);
          return;
        }

        const participantArray = Array.from(participants.values());
        const selectedWinners = [];
        while (selectedWinners.length < winners && selectedWinners.length < participantArray.length) {
          const randomIndex = Math.floor(Math.random() * participantArray.length);
          const selectedUser = participantArray[randomIndex];
          if (!selectedWinners.includes(selectedUser)) {
            selectedWinners.push(selectedUser);
          }
        }

        // Award prizes.
        if (prizeType === 'currency') {
          for (const winner of selectedWinners) {
            await updateWallet(winner.id, prizeCurrency);
          }
        } else {
          for (const winner of selectedWinners) {
            try {
              const shopItem = await getShopItemByName(prizeValue);
              await addItemToInventory(winner.id, shopItem.itemID, 1);
            } catch (err) {
              console.error(`Error awarding shop item to ${winner.id}:`, err);
              fetchedMessage.channel.send(`🚫 Failed to award shop item to <@${winner.id}>.`);
            }
          }
        }

        const winnersMention = selectedWinners.map(user => `<@${user.id}>`).join(', ');
        await fetchedMessage.channel.send(`🎉 Congratulations ${winnersMention}! You won **${prizeValue}**!`);
        await deleteGiveaway(giveawayMessage.id);
      } catch (err) {
        console.error('Error concluding giveaway:', err);
      }
    }, durationMs);
  },
};
