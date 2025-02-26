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
      await db.upsertShopItem(ticketCost, raffleTicketName, `Entry ticket for ${raffleName}. Prize: ${prizeInput}`, ticketQuantity);

      const embed = new EmbedBuilder()
        .setTitle(`🎟️ Raffle Started: ${raffleName}`)
        .setDescription(`Prize: **${prizeInput}**\nTicket Cost: **${formatCurrency(ticketCost)}**\nTotal Tickets: **${ticketQuantity * 2}**\n🎉 Ends in **${durationValue} ${timeUnit}**\n🏆 Winners: **${winnersCount}**`)
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
async function concludeRaffle(raffle_id, channel) {
  try {
    const raffle = await db.getRaffleById(raffle_id);
    if (!raffle) {
      console.error(`❌ Raffle ${raffle_id} not found.`);
      return;
    }

    const ticketName = `${raffle.name} Raffle Ticket`;

    // Get the raffle ticket item details from the shop.
    let raffleTicketItem;
    try {
      raffleTicketItem = await db.getShopItemByName(ticketName);
    } catch (err) {
      console.error(`❌ Raffle ticket item "${ticketName}" not found.`);
      await channel.send(`🚫 Raffle ticket item for "${raffle.name}" not found.`);
      return;
    }

    const ticketItemID = raffleTicketItem.itemID;

    // Fetch all inventory rows for this raffle ticket.
    // (You'll need to add this helper function in your db module.)
    const ticketEntries = await db.getInventoryByItemID(ticketItemID);

    // Build an array where each ticket is one entry.
    let entries = [];
    ticketEntries.forEach(entry => {
      for (let i = 0; i < entry.quantity; i++) {
        entries.push(entry.userID);
      }
    });

    if (entries.length === 0) {
      await channel.send(`🚫 The **${raffle.name}** raffle ended, but no tickets were found.`);
      await db.removeRaffleShopItem(raffle.name);
      return;
    }

    // Shuffle entries and pick winners.
    const shuffled = entries.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, raffle.winners);

    // Award prize(s) to winners.
    if (!isNaN(raffle.prize)) {
      const prizeAmount = parseInt(raffle.prize, 10);
      for (const winner of winners) {
        await db.updateWallet(winner, prizeAmount);
        console.log(`💰 ${winner} won ${prizeAmount} coins!`);
      }
    } else {
      const shopItem = await db.getShopItemByName(raffle.prize);
      if (shopItem) {
        for (const winner of winners) {
          await db.addItemToInventory(winner, shopItem.itemID);
          console.log(`🎁 ${winner} won "${shopItem.name}"!`);
        }
      } else {
        console.error(`❌ Could not find shop item "${raffle.prize}"`);
      }
    }

    const winnerMentions = winners.map(userID => `<@${userID}>`).join(', ');
    await channel.send(`🎉 The **${raffle.name}** raffle has ended! Congratulations to: ${winnerMentions}`);

    // Remove raffle ticket from the shop and from all user inventories.
    await db.removeRaffleShopItem(raffle.name);
    console.log(`✅ Raffle ${raffle.id} concluded and raffle tickets removed.`);
  } catch (error) {
    console.error(`❌ Error concluding raffle ${raffle_id}:`, error);
  }
}
