const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const {
  saveGiveaway,
  updateWallet,
  getPrizeShopItemByName,
  getAllShopItems,
  addItemToInventory,
  getGiveawayEntries,
} = require('../../db'); 
require('dotenv').config();

const POINTS_NAME = process.env.POINTS_NAME || 'Coins';
const POINTS_SYMBOL = process.env.POINTS_SYMBOL || '';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('create-giveaway')
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
        .setAutocomplete(true)
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

    // Validate prize if it's not a number (must be a valid shop item)
    if (isNaN(prizeInput)) {
      const shopItem = await getPrizeShopItemByName(prizeInput);
      if (!shopItem) {
        return interaction.reply({
          content: `🚫 Invalid prize. "${prizeInput}" is not a valid shop item.`,
          ephemeral: true
        });
      }
    }

    console.log(`[INFO] Starting giveaway: "${giveawayName}" | Prize: "${prizeInput}" | Repeats: ${repeat}`);

    // Convert duration into milliseconds.
    let durationMs;
    switch (timeUnit) {
      case 'minutes': durationMs = duration * 60 * 1000; break;
      case 'hours':   durationMs = duration * 60 * 60 * 1000; break;
      case 'days':    durationMs = duration * 24 * 60 * 60 * 1000; break;
      default:        durationMs = duration * 60 * 1000;
    }

    // Helper function to start a giveaway instance.
    const startGiveaway = async (repeatCount) => {
      console.log(`[INFO] Giveaway "${giveawayName}" started! Remaining repeats: ${repeatCount}`);

      // Banner image for embed
      const bannerPath = path.join(__dirname, '../banner.png');
      const files = [];
      const giveawayEmbed = new EmbedBuilder()
        .setTitle(`🎉 GIVEAWAY: ${giveawayName} 🎉`)
        .setDescription(
          `**Duration:** ${duration} ${timeUnit}\n` +
          `**Winners:** ${winners}\n` +
          `**Prize:** ${prizeInput}\n\n` +
          `*React with 🎉 or use the online dashboard to enter!*`
        )
        .setColor(0xffa500);

      if (fs.existsSync(bannerPath)) {
        files.push(new AttachmentBuilder(bannerPath, { name: 'banner.png' }));
        giveawayEmbed.setImage('attachment://banner.png');
      } else {
        console.warn(`[WARN] banner.png not found at: ${bannerPath} (sending without image)`);
      }

      // Send the embed message.
      const giveawayMessage = await interaction.channel.send({
        embeds: [giveawayEmbed],
        files,
      });

      const endTime = Date.now() + durationMs;

      // Save giveaway info to DB and capture the auto-generated giveaway ID.
      const giveawayId = await saveGiveaway(
        giveawayMessage.id,
        giveawayMessage.channel.id,
        endTime,
        prizeInput,
        winners,
        giveawayName,
        repeat
      );

      // Add a reaction for entries.
      await giveawayMessage.react('🎉');

      // Timer to conclude the giveaway after durationMs.
      setTimeout(async () => {
        try {
          const participantIDs = await getGiveawayEntries(giveawayId);
          console.log(`[INFO] Found ${participantIDs.length} entries for giveaway "${giveawayName}" (ID: ${giveawayId})`);

          if (participantIDs.length === 0) {
            await interaction.channel.send(`Giveaway "${giveawayName}" ended with no valid participants.`);
            return;
          }

          // Randomly select winners.
          const pool = [...participantIDs];
          const selectedWinners = [];
          while (selectedWinners.length < Math.min(winners, pool.length)) {
            const randomIndex = Math.floor(Math.random() * pool.length);
            const winnerId = pool.splice(randomIndex, 1)[0];
            selectedWinners.push(winnerId);
          }

          console.log(`[INFO] Winners selected for "${giveawayName}": ${selectedWinners.join(', ')}`);

          // Award prizes based on prize type.
          if (!isNaN(prizeInput)) {
            const prizeAmount = parseInt(prizeInput, 10);
            for (const winnerId of selectedWinners) {
              await interaction.channel.send(`🎉 Congrats <@${winnerId}>! You won **${giveawayName}** and received **${prizeAmount}${POINTS_SYMBOL}**.`);
              await updateWallet(winnerId, prizeAmount);
              console.log(`[SUCCESS] Awarded ${prizeAmount}${POINTS_SYMBOL} to ${winnerId}`);
            }
          } else {
            const shopItem = await getPrizeShopItemByName(prizeInput);
            if (!shopItem || !shopItem.itemID) {
              console.error(`[ERROR] Shop item "${prizeInput}" not found or missing itemID.`);
              await interaction.channel.send(`Error: Shop item "**${prizeInput}**" not found. Prize distribution failed.`);
            } else {
              for (const winnerId of selectedWinners) {
                await interaction.channel.send(`🎉 Congrats <@${winnerId}>! You won **${giveawayName}** and received **${shopItem.name}**.`);
                await addItemToInventory(winnerId, shopItem.itemID);
                console.log(`[SUCCESS] Added "${shopItem.name}" to ${winnerId}`);
              }
            }
          }
        } catch (error) {
          console.error(`[ERROR] Error concluding giveaway "${giveawayName}":`, error);
        } finally {
          if (repeatCount > 0) {
            startGiveaway(repeatCount - 1);
          }
        }
      }, durationMs);
    };

    // Start the first giveaway.
    startGiveaway(repeat);

    await interaction.reply({
      content: `✅ Giveaway "${giveawayName}" started! Ends in ${duration} ${timeUnit}.${repeat ? ` It will repeat ${repeat} time(s).` : ''}`,
      ephemeral: true
    });
  },

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const shopItems = await getAllShopItems();
    const filtered = shopItems
      .map(item => ({ name: item.name, value: item.name }))
      .filter(choice => choice.name.toLowerCase().includes(String(focusedValue).toLowerCase()));
    await interaction.respond(filtered.slice(0, 25));
  },
};
