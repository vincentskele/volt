const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const {
  saveGiveaway,
  updateWallet,
  getShopItems,
  addItemToInventory,
  getGiveawayEntries,  // <-- IMPORTANT: import getGiveawayEntries from db.js
} = require('../../db'); 
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

      // Banner image for embed
      const bannerPath = path.join(__dirname, '../banner.png');
      const bannerAttachment = new AttachmentBuilder(bannerPath, { name: 'banner.png' });
      
      // Create an embed for the giveaway announcement.
      const giveawayEmbed = new EmbedBuilder()
        .setTitle(`🎉 GIVEAWAY: ${giveawayName} 🎉`)
        .setDescription(`**Duration:** ${duration} ${timeUnit}
**Winners:** ${winners}
**Prize:** ${prizeInput}
\n*Entries are tracked in the database (giveaway_entries)!\nYou may still react with 🎉 as a visual indicator.*`)
        .setImage('attachment://banner.png')
        .setColor(0xffa500);

      // Send the embed
      const giveawayMessage = await interaction.channel.send({
        embeds: [giveawayEmbed],
        files: [bannerAttachment]
      });

      const endTime = Date.now() + durationMs;

      // Save giveaway info to DB
      await saveGiveaway(
        giveawayMessage.id,
        giveawayMessage.channel.id,
        endTime,
        prizeInput,
        winners,
        giveawayName,
        repeat
      );

      // (Optional) Add a reaction for fun—but it won't be used for winner logic
      await giveawayMessage.react('🎉');

      // Timer to end the giveaway
      setTimeout(async () => {
        try {
          // Fetch participants from the database
          const participantIDs = await getGiveawayEntries(giveawayMessage.id);
          console.log(`[INFO] Found ${participantIDs.length} entries in giveaway_entries for giveaway ${giveawayName}`);

          if (participantIDs.length === 0) {
            await interaction.channel.send(`Giveaway "${giveawayName}" ended with no valid participants.`);
            return;
          }

          // Randomly select winners
          const pool = [...participantIDs];
          const selectedWinners = [];
          while (selectedWinners.length < Math.min(winners, pool.length)) {
            const randomIndex = Math.floor(Math.random() * pool.length);
            const winnerId = pool.splice(randomIndex, 1)[0];
            selectedWinners.push(winnerId);
          }

          console.log(`[INFO] Winners selected for ${giveawayName}: ${selectedWinners.join(', ')}`);

          // Announce & award prizes
          if (!isNaN(prizeInput)) {
            // Prize is numeric
            const prizeAmount = parseInt(prizeInput, 10);
            for (const winnerId of selectedWinners) {
              await interaction.channel.send(`🎉 Congrats <@${winnerId}>! You won **${giveawayName}** and received **${prizeAmount}${POINTS_SYMBOL}**.`);
              await updateWallet(winnerId, prizeAmount);
              console.log(`[SUCCESS] ${winnerId} +${prizeAmount}${POINTS_SYMBOL} ${POINTS_NAME}`);
            }
          } else {
            // Prize is a shop item
            const shopItems = await getShopItems();
            const shopItem = shopItems.find(item => item.name.toLowerCase() === prizeInput.toLowerCase());

            if (!shopItem || !shopItem.itemID) {
              console.error(`[ERROR] Shop item not found or missing itemID: "${prizeInput}"`);
              await interaction.channel.send(`Error: Shop item "**${prizeInput}**" not found or missing itemID. Prize distribution failed.`);
            } else {
              for (const winnerId of selectedWinners) {
                await interaction.channel.send(`🎉 Congrats <@${winnerId}>! You won **${giveawayName}** and received **${shopItem.name}**.`);
                const delivered = await addItemToInventory(winnerId, shopItem.itemID);
                if (delivered) {
                  console.log(`[SUCCESS] Added "${shopItem.name}" to ${winnerId}`);
                } else {
                  console.warn(`[WARN] Possibly failed to add "${shopItem.name}" to ${winnerId}`);
                }
              }
            }
          }
        } catch (error) {
          console.error(`[ERROR] Error concluding giveaway "${giveawayName}":`, error);
        } finally {
          // If repeats remain, start the next giveaway
          if (repeatCount > 0) {
            startGiveaway(repeatCount - 1);
          }
        }
      }, durationMs);
    };

    // Start the first giveaway
    startGiveaway(repeat);

    // Confirm to the user
    await interaction.reply({
      content: `✅ Giveaway "${giveawayName}" started! Ends in ${duration} ${timeUnit}. ${repeat ? `It will repeat ${repeat} time(s).` : ''}`,
      ephemeral: true
    });
  }
};
