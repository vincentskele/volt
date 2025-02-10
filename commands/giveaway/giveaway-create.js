const { SlashCommandBuilder } = require('discord.js');
const {
  saveGiveaway,
  updateWallet,
  getShopItems,
  addItemToInventory
} = require('../../db'); // Ensure the path to your db methods is correct
require('dotenv').config();

const POINTS_NAME = process.env.POINTS_NAME || 'Coins';
const POINTS_SYMBOL = process.env.POINTS_SYMBOL || '';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-create')
    .setDescription('Create a giveaway for points or shop items.')
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
        .setDescription('Prize: either a points amount (number) or a shop item name (text)')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('repeat')
        .setDescription('Number of times to repeat the giveaway (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const giveawayName = interaction.options.getString('name');
    const duration = interaction.options.getInteger('duration');
    const timeUnit = interaction.options.getString('timeunit');
    const winners = interaction.options.getInteger('winners');
    const prizeInput = interaction.options.getString('prize').trim();
    // "repeat" represents the number of additional giveaways after the first one.
    const repeat = interaction.options.getInteger('repeat') || 0;

    console.log(`[INFO] Starting giveaway: "${giveawayName}" | Prize: "${prizeInput}" | Repeats: ${repeat}`);

    // Convert duration into milliseconds.
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
      default:
        durationMs = duration * 60 * 1000;
    }

    // Helper function to start a giveaway instance.
    const startGiveaway = async (repeatCount) => {
      console.log(`[INFO] Giveaway "${giveawayName}" started! Remaining repeats: ${repeatCount}`);

      // Announce the giveaway.
      const announcement = `🎉 **GIVEAWAY: ${giveawayName}** 🎉\n\n` +
        `React with 🎉 to participate!\n` +
        `**Duration:** ${duration} ${timeUnit}\n` +
        `**Winners:** ${winners}\n` +
        `**Prize:** ${prizeInput}`;

      const giveawayMessage = await interaction.channel.send(announcement);
      await giveawayMessage.react('🎉');

      const endTime = Date.now() + durationMs;

      // Save giveaway info to the DB, now including the repeat value.
      await saveGiveaway(
        giveawayMessage.id,
        giveawayMessage.channel.id,
        endTime,
        prizeInput,
        winners,
        giveawayName,
        repeat
      );

      // Timer to end the giveaway.
      setTimeout(async () => {
        try {
          // Fetch the giveaway message.
          const fetchedMessage = await interaction.channel.messages.fetch(giveawayMessage.id);
          const reaction = fetchedMessage.reactions.cache.get('🎉');

          if (!reaction) {
            await interaction.channel.send(`Giveaway "${giveawayName}" ended with no participants.`);
          } else {
            // Get all users who reacted and filter out bots.
            const users = await reaction.users.fetch();
            const participants = users.filter(user => !user.bot);

            if (participants.size === 0) {
              await interaction.channel.send(`Giveaway "${giveawayName}" ended with no valid participants.`);
            } else {
              // Determine how many winners to pick.
              const winnerCount = Math.min(winners, participants.size);
              const participantsArray = Array.from(participants.values());
              const winnersList = [];

              while (winnersList.length < winnerCount) {
                const randomIndex = Math.floor(Math.random() * participantsArray.length);
                const winner = participantsArray.splice(randomIndex, 1)[0];
                winnersList.push(winner);
              }

              console.log(`[INFO] Winners selected: ${winnersList.map(w => w.username).join(', ')}`);

              // Award prizes based on the prize type.
              if (!isNaN(prizeInput)) {
                // Prize is a points amount.
                const prizeAmount = parseInt(prizeInput, 10);

                for (const winner of winnersList) {
                  await interaction.channel.send(
                    `Congrats <@${winner.id}>! You won **${giveawayName}** and have been given (**${prizeAmount}${POINTS_SYMBOL}**).`
                  );
                  await updateWallet(winner.id, prizeAmount);
                  console.log(`[SUCCESS] ${winner.username} (${winner.id}) received ${prizeAmount}${POINTS_SYMBOL} ${POINTS_NAME}`);
                }
              } else {
                // Prize is assumed to be a shop item.
                const shopItems = await getShopItems();
                const shopItem = shopItems.find(item => item.name.toLowerCase() === prizeInput.toLowerCase());

                if (!shopItem || !shopItem.itemID) {
                  console.error(`[ERROR] Shop item not found or missing itemID: "${prizeInput}"`);
                  await interaction.channel.send(
                    `Error: Shop item "**${prizeInput}**" not found or missing itemID. Prize distribution failed.`
                  );
                } else {
                  for (const winner of winnersList) {
                    await interaction.channel.send(
                      `Congrats <@${winner.id}>! You won **${giveawayName}** and have been given (**${shopItem.name}**).`
                    );
                    const delivered = await addItemToInventory(winner.id, shopItem.itemID);
                    if (delivered) {
                      console.log(`[SUCCESS] Added "${shopItem.name}" to ${winner.username} (${winner.id})`);
                    } else {
                      console.warn(`[WARN] Possibly failed to add "${shopItem.name}" to ${winner.username} (${winner.id})`);
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error(`[ERROR] Error concluding giveaway "${giveawayName}": ${error}`);
        } finally {
          // Always check if we have repeats left and start the next giveaway.
          if (repeatCount > 0) {
            startGiveaway(repeatCount - 1);
          }
        }
      }, durationMs);
    };

    // Start the first giveaway.
    startGiveaway(repeat);

    // Confirm the giveaway creation to the command user.
    await interaction.reply({
      content: `✅ Giveaway "${giveawayName}" started! It will end in ${duration} ${timeUnit}. ${repeat > 0 ? `It will repeat ${repeat} time(s).` : ''}`,
      ephemeral: true
    });
  }
};
