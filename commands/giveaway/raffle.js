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
        .setDescription('Enter a Volt amount (number) or select a shop item')
        .setRequired(true)
        .setAutocomplete(true))
    .addIntegerOption(option =>
      option.setName('cost')
        .setDescription(`Ticket cost in ${points.symbol}`)
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantity')
        .setDescription('1/2 the number of tickets you want available')
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
    const raffleTicketName = `${raffleName} Raffle Ticket`;

    // Validate prize: either a number (for Volt) or a valid shop item
    if (!/^\d+$/.test(prizeInput)) {
      try {
        await db.getShopItemByName(prizeInput);
      } catch (err) {
        return interaction.reply({ content: '🚫 Invalid prize. Enter a Volt amount (number) or a valid shop item.', ephemeral: true });
      }
    }

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

      // Upsert the raffle ticket into the shop so users can buy it (or receive it via your website)
      const endDate = new Date(endTime);
const formattedEndDate = endDate.toUTCString().replace(' GMT', ' UTC');

await db.upsertShopItem(
  ticketCost,
  raffleTicketName,
  `Entry ticket for ${raffleName}. 🎁 Prize: ${prizeInput}. 🏆 ${winnersCount} winner(s) will be selected! ⏳ Ends at **${formattedEndDate}**.`,
  ticketQuantity
);

    
const embed = new EmbedBuilder()
    .setTitle(`🎟️ Raffle Started: ${raffleName}`)
    .setDescription(`Prize: **${prizeInput}**\nTicket Cost: **${formatCurrency(ticketCost)}**\nTotal Tickets: **${ticketQuantity * 2}**\n🎉 Ends at **${formattedEndDate}**\n🏆 Winners: **${winnersCount}**`)
    .setColor(0xFFD700)
    .setTimestamp(endDate);

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

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const shopItems = await db.getShopItems();
    const filtered = shopItems
      .map(item => ({ name: item.name, value: item.name }))
      .filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase()));

    await interaction.respond(filtered.slice(0, 25));
  },
};

/**
 * Concludes the raffle by selecting winners based on raffle ticket entries in user inventories.
 * This version builds the pool of entries by querying inventory for the raffle ticket item.
 */
async function concludeRaffle(raffle) {
  try {
    console.log(`🎟️ Concluding raffle: ${raffle.name}`);
    
    // Fetch the channel where the raffle was created
    const channel = await client.channels.fetch(raffle.channel_id).catch(() => null);
    if (!channel) {
      console.error(`❌ Channel ${raffle.channel_id} not found.`);
      return;
    }

    // Fetch the raffle message to check for participants
    let message;
    try {
      message = await channel.messages.fetch(raffle.message_id);
    } catch (err) {
      console.error(`❌ Raffle message ${raffle.message_id} not found.`);
    }

    let participants = [];
    if (message) {
      const reaction = message.reactions.cache.get('🎟️');
      if (reaction) {
        const usersReacted = await reaction.users.fetch();
        participants = usersReacted.filter(user => !user.bot).map(user => user.id);
      }
    }

    // Alternative: Get participants from the database (fallback)
    if (participants.length === 0) {
      console.log("🔄 No reaction-based participants found, checking database...");
      const dbParticipants = await getRaffleParticipants(raffle.id);
      participants = dbParticipants.map(entry => entry.user_id);
    }

    if (participants.length === 0) {
      console.log(`🚨 No valid participants for raffle ${raffle.id}`);
      await channel.send(`🚫 No valid participants for raffle **${raffle.name}**.`);
      await clearRaffleEntries(raffle.id);
      await deleteGiveaway(raffle.id);
      return;
    }

    // Shuffle participants and select winners
    const shuffled = participants.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, raffle.winners);

    if (winners.length === 0) {
      await channel.send(`🚫 No winners could be selected for **${raffle.name}**.`);
      return;
    }

    console.log(`🏆 Winners for raffle ${raffle.id}:`, winners);

    // Announce winners
    const winnerMentions = winners.map(userID => `<@${userID}>`).join(', ');
    await channel.send(`🎉 The **${raffle.name}** raffle has ended! Congratulations to: ${winnerMentions}`);

    // Award prizes
    if (!isNaN(raffle.prize)) {
      // Prize is currency
      const prizeAmount = parseInt(raffle.prize, 10);
      for (const winner of winners) {
        await updateWallet(winner, prizeAmount);
        console.log(`💰 ${winner} won ${prizeAmount} coins!`);
      }
    } else {
      // Prize is a shop item
      const shopItem = await getShopItemByName(raffle.prize);
      if (shopItem) {
        for (const winner of winners) {
          await addItemToInventory(winner, shopItem.itemID);
          console.log(`🎁 ${winner} won "${shopItem.name}"!`);
        }
      } else {
        console.error(`⚠️ Shop item "${raffle.prize}" not found.`);
      }
    }

    // Cleanup: Remove raffle ticket from the shop & clear entries
    console.log(`🧹 Cleaning up raffle ${raffle.id}...`);
    await clearRaffleEntries(raffle.id);
    await deleteGiveaway(raffle.id);
    console.log(`✅ Raffle ${raffle.id} resolved and removed.`);
  } catch (error) {
    console.error(`⚠️ Error concluding raffle ${raffle.id}:`, error);
  }
}
