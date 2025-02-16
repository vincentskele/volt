const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../db');
const { points, formatCurrency } = require('../../points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raffle')
    .setDescription('Starts a raffle with a prize and ticket cost.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The name of the raffle')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('prize')
        .setDescription('The prize (either a shop item or a Volt amount)')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('cost')
        .setDescription(`Ticket cost in ${points.symbol}`)
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantity')
        .setDescription('Total number of tickets available')
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
        return interaction.reply({ content: `🚫 A raffle named "${raffleName}" is already running!`, ephemeral: true });
      }

      const raffleId = await db.createRaffle(
        interaction.channelId, raffleName, prizeInput, ticketCost, ticketQuantity, winnersCount, endTime
      );

      const embed = new EmbedBuilder()
        .setTitle(`🎟️ Raffle Started: ${raffleName}`)
        .setDescription(`Prize: **${prizeInput}**\nTicket Cost: **${formatCurrency(ticketCost)}**\nTotal Tickets: **${ticketQuantity}**\n🎉 Ends in **${durationValue} ${timeUnit}**`)
        .setColor(0xFFD700)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Schedule raffle conclusion
      setTimeout(async () => {
        await concludeRaffle(raffleId, interaction.channel);
      }, durationMs);
    } catch (err) {
      console.error('⚠️ Raffle Creation Error:', err);
      return interaction.reply({ content: `🚫 Failed to start raffle: ${err.message || err}`, ephemeral: true });
    }
  },
};

/**
 * Concludes the raffle, picks winners, removes shop item, and clears entries.
 */
async function concludeRaffle(raffleId, channel) {
    try {
      const raffle = await db.getRaffleById(raffleId);
      if (!raffle) {
        console.error(`❌ Raffle ${raffleId} not found.`);
        return;
      }
  
      // Fetch participants
      const participants = await db.getRaffleParticipants(raffleId);
      if (!participants || participants.length === 0) {
        await channel.send(`🚫 The **${raffle.name}** raffle ended, but no one entered.`);
        await db.removeRaffleShopItem(raffle.name);
        await db.clearRaffleEntries(raffleId);
        return;
      }
  
      console.log(`🎟️ Raffle "${raffle.name}" has ${participants.length} participants.`);
  
      // Shuffle and pick winners
      const shuffled = participants.sort(() => Math.random() - 0.5);
      const winners = shuffled.slice(0, Math.min(raffle.winners, participants.length));
  
      if (winners.length === 0) {
        console.error(`❌ No winners could be selected for raffle ${raffle.name}.`);
        return;
      }
  
      // Determine if prize is a currency amount or a shop item
      if (!isNaN(raffle.prize)) {
        const prizeAmount = parseInt(raffle.prize);
        for (const winner of winners) {
          await db.updateWallet(winner.user_id, prizeAmount);
          console.log(`💰 ${winner.user_id} won ${prizeAmount} coins!`);
        }
      } else {
        const shopItem = await db.getShopItemByName(raffle.prize);
        if (shopItem) {
          for (const winner of winners) {
            await db.addItemToInventory(winner.user_id, shopItem.itemID);
            console.log(`🎁 ${winner.user_id} won "${shopItem.name}"!`);
          }
        } else {
          console.error(`❌ Could not find shop item "${raffle.prize}"`);
        }
      }
  
      // Announce winners
      const winnerMentions = winners.map(w => `<@${w.user_id}>`).join(', ');
      await channel.send(`🎉 The **${raffle.name}** raffle has ended! Congratulations to: ${winnerMentions}`);
  
      // Clean up the raffle shop item and entries
      await db.removeRaffleShopItem(raffle.name);
      await db.clearRaffleEntries(raffleId);
  
      console.log(`✅ Raffle "${raffle.name}" concluded and cleaned up.`);
    } catch (error) {
      console.error(`❌ Error concluding raffle ${raffleId}:`, error);
    }
  }
  
