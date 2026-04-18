const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const db = require('../../db');
const { points, formatCurrency } = require('../../points');

const LONG_TIMEOUT_MAX = 2_147_483_647;

function setClient(discordClient) {
  db.setDiscordClient(discordClient);
}

function scheduleAt(endTimeMs, fn) {
  const tick = () => {
    const remaining = endTimeMs - Date.now();
    if (remaining <= 0) return fn();
    setTimeout(tick, Math.min(remaining, LONG_TIMEOUT_MAX));
  };
  tick();
}

module.exports = {
  setClient,
  data: new SlashCommandBuilder()
    .setName('create-raffle')
    .setDescription('Starts a raffle with a prize and ticket cost.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The name of the raffle')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('prize')
        .setDescription('Enter a Volt amount (number) or select a shop item')
        .setRequired(true)
        .setAutocomplete(true))
    .addIntegerOption(option =>
      option.setName('cost')
        .setDescription(`Ticket cost in ${points.symbol}`)
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantity')
        .setDescription('Number of tickets you want available')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('winners')
        .setDescription('Number of winners')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Enter duration (number only)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('timeunit')
        .setDescription('Select time unit')
        .setRequired(true)
        .addChoices(
          { name: 'Minutes', value: 'minutes' },
          { name: 'Hours', value: 'hours' },
          { name: 'Days', value: 'days' }
        )),
  
  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can start raffles.', ephemeral: true });
    }

    const raffleName = interaction.options.getString('name').trim();
    const prizeInput = interaction.options.getString('prize').trim();
    const ticketCost = interaction.options.getInteger('cost');
    const ticketQuantity = interaction.options.getInteger('quantity');
    const winnersCount = interaction.options.getInteger('winners');
    const durationValue = interaction.options.getInteger('duration');
    const timeUnit = interaction.options.getString('timeunit');

    let durationMs;
    switch (timeUnit) {
      case 'minutes': durationMs = durationValue * 60 * 1000; break;
      case 'hours': durationMs = durationValue * 60 * 60 * 1000; break;
      case 'days': durationMs = durationValue * 24 * 60 * 60 * 1000; break;
      default: return interaction.reply({ content: '🚫 Invalid time unit.', ephemeral: true });
    }

    const endTime = Date.now() + durationMs;
    if (ticketCost <= 0 || ticketQuantity <= 0 || winnersCount <= 0 || durationValue <= 0) {
      return interaction.reply({ content: '🚫 Invalid values. Ensure all inputs are positive.', ephemeral: true });
    }

    try {
      const activeRaffles = await db.getActiveRaffles();
      if (activeRaffles.some(raffle => raffle.name === raffleName)) {
        return interaction.reply({ 
          content: `🚫 A raffle named "${raffleName}" is already running!`, 
          ephemeral: true 
        });
      }

      // Validate prize if it's not a number (must be a valid shop item)
      if (isNaN(prizeInput)) {
        const shopItem = await db.getAnyShopItemByName(prizeInput);
        if (!shopItem) {
          return interaction.reply({ 
            content: `🚫 Invalid prize. "${prizeInput}" is not a valid shop item.`, 
            ephemeral: true 
          });
        }
      }

      const raffleId = await db.createRaffle(
        interaction.channelId, 
        raffleName, 
        prizeInput, 
        ticketCost, 
        ticketQuantity, 
        winnersCount, 
        endTime
      );

      const endDate = new Date(endTime);
      const formattedEndDate = endDate.toUTCString().replace(' GMT', ' UTC');

      const bannerPath = path.join(__dirname, '../banner_title.png');
      const files = [];
      const embed = new EmbedBuilder()
        .setTitle(`🎟️ Raffle Started: ${raffleName}`)
        .setDescription(
          `Prize: **${prizeInput}**\n` +
          `Ticket Cost: **${formatCurrency(ticketCost)}**\n` +
          `Total Tickets: **${ticketQuantity}**\n` +
          `🎉 Ends at **${formattedEndDate}**\n` +
          `🏆 Winners: **${winnersCount}**`
        )
        .setColor(0xFFD700)
        .setTimestamp(endDate);

      if (fs.existsSync(bannerPath)) {
        files.push(new AttachmentBuilder(bannerPath, { name: 'banner_title.png' }));
        embed.setImage('attachment://banner_title.png');
      } else {
        console.warn(`[WARN] banner_title.png not found at: ${bannerPath} (sending without image)`);
      }

      await interaction.reply({ embeds: [embed], files });

      // Schedule raffle conclusion
      scheduleAt(endTime, async () => {
        try {
          await concludeRaffle(raffleId);
        } catch (err) {
          console.error('⚠️ Error concluding raffle:', err);
        }
      });

    } catch (err) {
      console.error('⚠️ Raffle Creation Error:', err);
      // Only reply if we haven't already
      if (!interaction.replied) {
        await interaction.reply({ 
          content: `🚫 Failed to start raffle: ${err.message || 'Unknown error'}`, 
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
      .filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase()));

    await interaction.respond(filtered.slice(0, 25));
  },

  concludeRaffle,
};

async function concludeRaffle(raffleId) {
  const raffle = await db.getRaffleById(raffleId);
  if (!raffle) {
    console.error(`❌ Cannot conclude raffle: no raffle found with ID ${raffleId}`);
    return;
  }
  await db.concludeRaffle(raffle);
}
