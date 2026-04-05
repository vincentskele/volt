// title-giveaway.js
// Separate-rails giveaway (NOT the `giveaways` table) + supports 31+ days safely.
// Awards either Volts (number) or a Shop Item (string, autocomplete).
//
// DB functions required (new rails):
// - saveTitleGiveaway(messageId, channelId, endTime, prize, winners, name, repeat) -> id
// - getTitleGiveawayEntries(titleGiveawayId) -> [user_id]
// - markTitleGiveawayCompleted(titleGiveawayId) -> true if locked, false if already completed
//
// For reactions (your reaction handler should call these):
// - getTitleGiveawayByMessageId(messageId)
// - addTitleGiveawayEntry(titleGiveawayId, userId)
// - removeTitleGiveawayEntry(titleGiveawayId, userId)
//
// IMPORTANT: This file no longer fails silently if banner file is missing / perms are wrong.
// It will log the error AND followUp to the admin.

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const db = require('../../db');
const { formatCurrency } = require('../../points');

const ENTRY_EMOJI = '🏷️';
const LONG_TIMEOUT_MAX = 2_147_483_647; // ~24.8 days (Node timer cap)

function durationToMs(value, unit) {
  switch (unit) {
    case 'minutes': return value * 60 * 1000;
    case 'hours': return value * 60 * 60 * 1000;
    case 'days': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

// Chunked timer to support 31+ day giveaways safely
function scheduleAt(endTimeMs, fn) {
  const tick = () => {
    const remaining = endTimeMs - Date.now();
    if (remaining <= 0) return fn();
    setTimeout(tick, Math.min(remaining, LONG_TIMEOUT_MAX));
  };
  tick();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('title-giveaway')
    .setDescription('Starts a Title Giveaway (separate rails) awarding Volts or a shop item.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Giveaway name (for identification)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('prize')
        .setDescription('Enter a Volt amount (number) or select a shop item')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option.setName('winners')
        .setDescription('Number of winners to select')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Enter duration (number only)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('timeunit')
        .setDescription('Select time unit')
        .setRequired(true)
        .addChoices(
          { name: 'Minutes', value: 'minutes' },
          { name: 'Hours', value: 'hours' },
          { name: 'Days', value: 'days' }
        )
    )
    .addIntegerOption(option =>
      option.setName('repeat')
        .setDescription('Number of times to repeat (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '🚫 Only admins can start title giveaways.', ephemeral: true });
      }

      const giveawayName = interaction.options.getString('name').trim();
      const prizeInput = interaction.options.getString('prize').trim();
      const winnersCount = interaction.options.getInteger('winners');
      const durationValue = interaction.options.getInteger('duration');
      const timeUnit = interaction.options.getString('timeunit');
      const repeat = interaction.options.getInteger('repeat') || 0;

      if (winnersCount <= 0 || durationValue <= 0) {
        return interaction.reply({ content: '🚫 Invalid values. Ensure winners and duration are positive.', ephemeral: true });
      }

      const durationMs = durationToMs(durationValue, timeUnit);
      if (!durationMs) {
        return interaction.reply({ content: '🚫 Invalid time unit.', ephemeral: true });
      }

      // Validate prize if it's not a number (must exist in shop)
      if (isNaN(prizeInput)) {
        const shopItem = await db.getAnyShopItemByName(prizeInput);
        if (!shopItem) {
          return interaction.reply({
            content: `🚫 Invalid prize. "${prizeInput}" is not a valid shop item.`,
            ephemeral: true
          });
        }
      }

      const channel = await interaction.client.channels.fetch(interaction.channelId);

      const startInstance = async (repeatCount) => {
        const endTime = Date.now() + durationMs;
        const endDate = new Date(endTime);
        const formattedEndDate = endDate.toUTCString().replace(' GMT', ' UTC');

        const embed = new EmbedBuilder()
          .setTitle(`🏷️ Title Giveaway: ${giveawayName}`)
          .setDescription(
            `Prize: **${prizeInput}**\n` +
            `Winners: **${winnersCount}**\n` +
            `⏳ Ends at **${formattedEndDate}**\n\n` +
            `React with ${ENTRY_EMOJI} to enter!`
          )
          .setColor(0x00BFFF)
          .setTimestamp(endDate);

        // Try to attach banner, but do NOT fail if missing
        const bannerPath = path.join(__dirname, '../banner_title.png');
        const files = [];

        if (fs.existsSync(bannerPath)) {
          files.push(new AttachmentBuilder(bannerPath, { name: 'banner_title.png' }));
          embed.setImage('attachment://banner_title.png');
        } else {
          console.warn(`[WARN] banner_title.png not found at: ${bannerPath} (sending without image)`);
        }

        let msg;
        try {
          msg = await channel.send({ embeds: [embed], files });
        } catch (sendErr) {
          console.error('❌ Failed to announce title giveaway:', sendErr);
          try {
            await interaction.followUp({
              content:
                `❌ Failed to announce the giveaway in <#${interaction.channelId}>.\n` +
                `Error: \`${sendErr.message || sendErr}\`\n` +
                `Check bot perms: Send Messages, Embed Links, Attach Files (if using banner).`,
              ephemeral: true
            });
          } catch (_) {}
          return; // stop: don’t create DB entry if we didn’t announce
        }

        // Add entry reaction
        try {
          await msg.react(ENTRY_EMOJI);
        } catch (reactErr) {
          console.warn('⚠️ Could not add reaction emoji (check Add Reactions permission):', reactErr?.message || reactErr);
        }

        // Save to separate rails
        let titleGiveawayId;
        try {
          titleGiveawayId = await db.saveTitleGiveaway(
            msg.id,
            msg.channel.id,
            endTime,
            prizeInput,
            winnersCount,
            giveawayName,
            repeat
          );
        } catch (dbErr) {
          console.error('❌ Failed to saveTitleGiveaway:', dbErr);
          try {
            await channel.send(`⚠️ Giveaway "${giveawayName}" was posted but DB save failed. Check logs.`);
          } catch (_) {}
          return;
        }

        console.log(`[INFO] TITLE giveaway started: "${giveawayName}" | ID=${titleGiveawayId} | Prize="${prizeInput}" | Ends=${formattedEndDate}`);

        // Schedule conclude (31+ day safe)
        scheduleAt(endTime, async () => {
          try {
            const locked = await db.markTitleGiveawayCompleted(titleGiveawayId);
            if (!locked) {
              console.warn(`[WARN] Title giveaway ${titleGiveawayId} already completed. Skipping.`);
              return;
            }

            const participantIDs = await db.getTitleGiveawayEntries(titleGiveawayId);
            console.log(`[INFO] Concluding TITLE giveaway ID=${titleGiveawayId} | entries=${participantIDs.length}`);

            if (!participantIDs.length) {
              await channel.send(`🏷️ Title giveaway "**${giveawayName}**" ended, but no one entered.`);
              return;
            }

            // Pick winners
            const pool = [...participantIDs];
            const winners = [];
            while (winners.length < Math.min(winnersCount, pool.length)) {
              winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
            }

            // Award prize
            if (!isNaN(prizeInput)) {
              const prizeAmount = parseInt(prizeInput, 10);
              for (const winnerId of winners) {
                await db.updateWallet(winnerId, prizeAmount);
              }

              const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
              await channel.send(
                `🏷️ **${giveawayName}** ended!\n` +
                `Winners: ${winnerMentions}\n` +
                `Prize: **${formatCurrency(prizeAmount)}**`
              );
            } else {
              const shopItem = await db.getAnyShopItemByName(prizeInput);
              if (!shopItem) {
                await channel.send(
                  `⚠️ **${giveawayName}** ended, but the prize item "**${prizeInput}**" no longer exists in the shop.`
                );
                return;
              }

              for (const winnerId of winners) {
                await db.addItemToInventory(winnerId, shopItem.itemID);
              }

              const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
              await channel.send(
                `🏷️ **${giveawayName}** ended!\n` +
                `Winners: ${winnerMentions}\n` +
                `Prize: **${shopItem.name}**`
              );
            }
          } catch (err) {
            console.error(`❌ Error concluding title giveaway "${giveawayName}":`, err);
            try {
              await channel.send(`⚠️ Error concluding "**${giveawayName}**". Check logs.`);
            } catch (_) {}
          } finally {
            if (repeatCount > 0) startInstance(repeatCount - 1);
          }
        });
      };

      // Start first instance (don’t await; it schedules itself)
      startInstance(repeat);

      return interaction.reply({
        content: `✅ Title giveaway "${giveawayName}" started! Ends in ${durationValue} ${timeUnit}.${repeat ? ` It will repeat ${repeat} time(s).` : ''}`,
        ephemeral: true
      });
    } catch (err) {
      console.error('❌ title-giveaway execute() fatal error:', err);
      if (!interaction.replied) {
        return interaction.reply({
          content: `🚫 Failed to start title giveaway: ${err.message || 'Unknown error'}`,
          ephemeral: true
        });
      }
    }
  },

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const shopItems = await db.getAllShopItems();

    const filtered = shopItems
      .map(item => ({ name: item.name, value: item.name }))
      .filter(choice => choice.name.toLowerCase().includes(String(focusedValue).toLowerCase()));

    await interaction.respond(filtered.slice(0, 25));
  },
};
