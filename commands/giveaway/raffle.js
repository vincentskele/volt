const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const db = require('../../db');
const { points, formatCurrency } = require('../../points');

let client;

function setClient(discordClient) {
  client = discordClient;
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
      setTimeout(async () => {
        try {
          await concludeRaffle(raffleId);
        } catch (err) {
          console.error('⚠️ Error concluding raffle:', err);
        }
      }, durationMs);

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

/**
 * Concludes the raffle by selecting winners based on raffle ticket entries in user inventories.
 * This version builds the pool of entries by querying inventory for the raffle ticket item.
 */
async function concludeRaffle(raffleId) {
  try {
    // First get the raffle data since we're only passed the ID
    const raffle = await db.getRaffleById(raffleId);
    
    if (!raffle) {
      console.error(`❌ Cannot conclude raffle: no raffle found with ID ${raffleId}`);
      return;
    }

    console.log(`🎟️ Concluding raffle: ${raffle.name} (ID: ${raffle.id})`);

    if (!client) {
      console.error('❌ Discord client not initialized in raffle module');
      return;
    }

    // Get the raffle ticket item ID first
    const ticketName = `${raffle.name} Raffle Ticket`;
    const ticketItem = await db.getShopItemByName(ticketName);
    
    if (!ticketItem) {
      console.error(`❌ Could not find ticket item "${ticketName}"`);
      return;
    }

    // Get all users who have this ticket in their inventory
    const ticketHolders = await db.getInventoryByItemID(ticketItem.itemID);
    
    // Create an array of entries where each user appears once for each ticket they own
    const entries = [];
    for (const holder of ticketHolders) {
      // Add an entry for each ticket the user owns
      for (let i = 0; i < holder.quantity; i++) {
        entries.push(holder.userID);
      }
    }

    if (entries.length === 0) {
      console.log(`🚫 No participants found for raffle "${raffle.name}"`);
      
      // Try to announce if we can
      try {
        const channel = await client.channels.fetch(raffle.channel_id);
        await channel.send(`🚫 The **${raffle.name}** raffle ended, but no one entered.`);
      } catch (err) {
        console.error(`❌ Could not send no-participants message:`, err);
      }
      
      // Clean up
      await db.removeRaffleShopItem(raffle.name);
      return;
    }

    console.log(`📊 Found ${entries.length} total entries from ${ticketHolders.length} unique participants`);

    // Shuffle & pick winners
    const shuffled = entries.sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, raffle.winners);

    console.log(`🎟️ Selected ${winners.length} winners from ${entries.length} total entries`);

    // Award prizes
    if (!isNaN(raffle.prize)) {
      // Prize is currency
      const prizeAmount = parseInt(raffle.prize, 10);
      for (const winnerId of winners) {
        await db.updateWallet(winnerId, prizeAmount);
        console.log(`💰 User ${winnerId} won ${prizeAmount} coins`);
      }
    } else {
      // Prize is a shop item
      const shopItem = await db.getAnyShopItemByName(raffle.prize);
      if (!shopItem) {
        console.error(`⚠️ Shop item "${raffle.prize}" not found`);
        // Try to announce error
        try {
          const channel = await client.channels.fetch(raffle.channel_id);
          await channel.send(`⚠️ Error: Prize item "${raffle.prize}" no longer exists in the shop!`);
        } catch (err) {
          console.error('Could not announce prize error:', err);
        }
        return;
      }
      
      // Award the item to winners
      for (const winnerId of winners) {
        try {
          await db.addItemToInventory(winnerId, shopItem.itemID);
          console.log(`🎁 User ${winnerId} won "${shopItem.name}"`);
        } catch (err) {
          console.error(`Failed to award item to ${winnerId}:`, err);
        }
      }
    }

    // 🎁 Bonus: Award Robot Oil to all participants (one per unique participant)
try {
  const robotOil = await db.getAnyShopItemByName('Robot Oil');
  if (robotOil) {
    const awarded = new Set();
    for (const holder of ticketHolders) {
      if (!awarded.has(holder.userID)) {
        await db.addItemToInventory(holder.userID, robotOil.itemID);
        console.log(`🛢️ Gave Robot Oil to ${holder.userID}`);
        awarded.add(holder.userID);
      }
    }
  } else {
    console.warn('⚠️ Robot Oil item not found in items table!');
  }
} catch (err) {
  console.error('❌ Failed to award Robot Oil:', err);
}


    // Announce winners if possible
    try {
      const channel = await client.channels.fetch(raffle.channel_id);
      const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
      await channel.send(`🎉 Congratulations to the winners: ${winnerMentions}!`);
    } catch (err) {
      console.error('❌ Could not announce winners:', err);
    }

    // Clean up
    await db.removeRaffleShopItem(raffle.name);

  } catch (err) {
    console.error('⚠️ Raffle Conclusion Error:', err);
    // Only reply if we haven't already
    if (!interaction.replied) {
      await interaction.reply({ 
        content: '🚫 Failed to conclude raffle. Please try again later.', 
        ephemeral: true 
      });
    }
  }
}
