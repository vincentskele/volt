const { SlashCommandBuilder } = require('discord.js');
const { updateWallet, getShopItemByName, addItemToInventory } = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-create')
    .setDescription('Create a giveaway for currency or shop items.')
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Duration of the giveaway in minutes')
        .setRequired(true)
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

  /**
   * Executes the giveaway-create command.
   * 
   * For prefix commands, this function is called with three parameters:
   *   - 'prefix'
   *   - message object
   *   - args array
   *
   * For slash commands, it is called with a single parameter (the interaction).
   *
   * @param  {...any} args
   */
  async execute(...args) {
    let isPrefix = false;
    let duration, winners, prizeInput;
    let interaction; // will hold either the message or the interaction object

    // Check if the command is invoked as a prefix command.
    if (args[0] === 'prefix') {
      isPrefix = true;
      // args[1] is the message and args[2] is the array of arguments.
      interaction = args[1];
      const commandArgs = args[2];
      duration = parseInt(commandArgs[0], 10);
      winners = parseInt(commandArgs[1], 10);
      prizeInput = commandArgs.slice(2).join(' ');
    } else {
      // Slash command: the first argument is the interaction.
      interaction = args[0];
      duration = interaction.options.getInteger('duration');
      winners = interaction.options.getInteger('winners');
      prizeInput = interaction.options.getString('prize');
    }

    // Validate parameters.
    if (isNaN(duration) || duration <= 0) {
      const errorMsg = '🚫 Please provide a valid duration (in minutes).';
      return isPrefix
        ? interaction.reply(errorMsg)
        : interaction.reply({ content: errorMsg, ephemeral: true });
    }
    if (isNaN(winners) || winners <= 0) {
      const errorMsg = '🚫 Please provide a valid number of winners.';
      return isPrefix
        ? interaction.reply(errorMsg)
        : interaction.reply({ content: errorMsg, ephemeral: true });
    }

    // Determine prize type:
    // - If prizeInput converts to a valid integer, treat it as currency.
    // - Otherwise, treat it as a shop item name.
    const prizeCurrency = parseInt(prizeInput, 10);
    let prizeType, prizeValue;
    if (!isNaN(prizeCurrency)) {
      prizeType = 'currency';
      prizeValue = prizeCurrency;
    } else {
      prizeType = 'item';
      prizeValue = prizeInput.trim();
    }

    // Build the giveaway announcement.
    const giveawayAnnouncement = `🎉 **GIVEAWAY TIME!** 🎉

React with 🎉 to join!
**Duration:** ${duration} minute(s)
**Winners:** ${winners}
**Prize:** ${prizeType === 'currency' ? `${prizeValue} coins` : prizeValue}`;

    // Send the giveaway message.
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

    // Add the 🎉 reaction so users know how to join.
    try {
      await giveawayMessage.react('🎉');
    } catch (err) {
      console.error('Failed to add reaction:', err);
    }

    // Let the command issuer know that the giveaway has started.
    const confirmationMsg = `✅ Giveaway started! It will end in ${duration} minute(s).`;
    if (isPrefix) {
      interaction.reply(confirmationMsg);
    } else {
      // Using ephemeral flag (note: if deprecated, you may need to update to use flags)
      interaction.followUp({ content: confirmationMsg, ephemeral: true });
    }

    // Set a timer to conclude the giveaway.
    setTimeout(async () => {
      try {
        // Re-fetch the message to ensure we have the latest reactions.
        const fetchedMessage = await giveawayMessage.fetch();
        const reaction = fetchedMessage.reactions.cache.get('🎉');
        if (!reaction) {
          return fetchedMessage.channel.send('🚫 No one participated in the giveaway.');
        }

        // Fetch all users who reacted (filtering out bots).
        const usersReacted = await reaction.users.fetch();
        const participants = usersReacted.filter(user => !user.bot);

        if (participants.size === 0) {
          fetchedMessage.channel.send('🚫 No one participated in the giveaway.');
          return;
        }

        // Randomly select winners.
        const participantArray = Array.from(participants.values());
        const winnersCount = Math.min(winners, participantArray.length);
        const selectedWinners = [];
        while (selectedWinners.length < winnersCount) {
          const randomIndex = Math.floor(Math.random() * participantArray.length);
          const selectedUser = participantArray[randomIndex];
          if (!selectedWinners.includes(selectedUser)) {
            selectedWinners.push(selectedUser);
          }
        }

        // Award the prize to each winner.
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

        // Announce the winners.
        const winnersMention = selectedWinners.map(user => `<@${user.id}>`).join(', ');
        const prizeDisplay = prizeType === 'currency' ? `${prizeValue} coins` : prizeValue;
        fetchedMessage.channel.send(`🎉 Congratulations ${winnersMention}! You won **${prizeDisplay}**!`);
      } catch (err) {
        console.error('Error concluding giveaway:', err);
      }
    }, duration * 60000); // Convert minutes to milliseconds.
  },
};
