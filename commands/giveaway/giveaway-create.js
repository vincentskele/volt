const { SlashCommandBuilder } = require('discord.js');
const { updateWallet, getShopItemByName, addItemToInventory } = require('../../db');

// Load environment variables
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

  async execute(...args) {
    let isPrefix = false;
    let duration, timeUnit, winners, prizeInput;
    let interaction;

    if (args[0] === 'prefix') {
      isPrefix = true;
      interaction = args[1];
      const commandArgs = args[2];

      duration = parseInt(commandArgs[0], 10);
      timeUnit = commandArgs[1].toLowerCase();
      winners = parseInt(commandArgs[2], 10);
      prizeInput = commandArgs.slice(3).join(' ');
    } else {
      interaction = args[0];
      duration = interaction.options.getInteger('duration');
      timeUnit = interaction.options.getString('timeunit');
      winners = interaction.options.getInteger('winners');
      prizeInput = interaction.options.getString('prize');
    }

    if (isNaN(duration) || duration <= 0) {
      return interaction.reply({ content: '🚫 Please provide a valid duration.', ephemeral: true });
    }
    if (!['minutes', 'hours', 'days'].includes(timeUnit)) {
      return interaction.reply({ content: '🚫 Invalid time unit. Use minutes, hours, or days.', ephemeral: true });
    }
    if (isNaN(winners) || winners <= 0) {
      return interaction.reply({ content: '🚫 Please provide a valid number of winners.', ephemeral: true });
    }

    // Convert time to milliseconds
    let durationMs;
    switch (timeUnit) {
      case 'minutes':
        durationMs = duration * 60 * 1000;
        break;
      case 'hours':
        durationMs = duration * 60 * 60 * 1000;
        break;
      case 'days':
        durationMs = duration * 24 * 60 * 60 * 1000;
        break;
    }

    const prizeCurrency = parseInt(prizeInput, 10);
    let prizeType, prizeValue;
    if (!isNaN(prizeCurrency)) {
      prizeType = 'currency';
      prizeValue = prizeCurrency;
    } else {
      prizeType = 'item';
      prizeValue = prizeInput.trim();
    }

    const giveawayAnnouncement = `🎉 **GIVEAWAY TIME!** 🎉

React with 🎉 to join!
**Duration:** ${duration} ${timeUnit}
**Winners:** ${winners}
**Prize:** ${prizeType === 'currency' ? `${prizeValue} ${CURRENCY_SYMBOL}${CURRENCY_NAME}` : prizeValue}`;

    let giveawayMessage;
    try {
      if (isPrefix) {
        giveawayMessage = await interaction.channel.send(giveawayAnnouncement);
      } else {
        await interaction.reply(giveawayAnnouncement);
        giveawayMessage = await interaction.fetchReply();
      }
    } catch (err) {
      console.error('Error sending giveaway announcement:', err);
      return;
    }

    try {
      await giveawayMessage.react('🎉');
    } catch (err) {
      console.error('Failed to add reaction:', err);
    }

    interaction.followUp({ content: `✅ Giveaway started! It will end in ${duration} ${timeUnit}.`, ephemeral: true });

    setTimeout(async () => {
      try {
        const fetchedMessage = await giveawayMessage.fetch();
        const reaction = fetchedMessage.reactions.cache.get('🎉');
        if (!reaction) return fetchedMessage.channel.send('🚫 No one participated in the giveaway.');

        const usersReacted = await reaction.users.fetch();
        const participants = usersReacted.filter(user => !user.bot);

        if (participants.size === 0) {
          fetchedMessage.channel.send('🚫 No one participated in the giveaway.');
          return;
        }

        const participantArray = Array.from(participants.values());
        const winnersCount = Math.min(winners, participantArray.length);
        const selectedWinners = [];
        while (selectedWinners.length < winnersCount) {
          const randomIndex = Math.floor(Math.random() * participantArray.length);
          const selectedUser = participantArray[randomIndex];
          if (!selectedWinners.includes(selectedUser)) selectedWinners.push(selectedUser);
        }

        for (const winner of selectedWinners) {
          if (prizeType === 'currency') {
            await updateWallet(winner.id, prizeValue);
          } else {
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
        const prizeDisplay = prizeType === 'currency' ? `${prizeValue} ${CURRENCY_SYMBOL}${CURRENCY_NAME}` : prizeValue;
        fetchedMessage.channel.send(`🎉 Congratulations ${winnersMention}! You won **${prizeDisplay}**!`);
      } catch (err) {
        console.error('Error concluding giveaway:', err);
      }
    }, durationMs);
  },
};
