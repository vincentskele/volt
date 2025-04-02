const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { formatCurrency } = require('../../points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rafflelist')
    .setDescription('Displays all active raffles and your ticket count for each.'),

  async execute(interaction) {
    try {
      const activeRaffles = await db.getActiveRaffles();
      if (!activeRaffles || activeRaffles.length === 0) {
        return interaction.reply({ content: '🚫 There are no active raffles at the moment.', ephemeral: true });
      }

      const userId = interaction.user.id;
      const userTickets = await db.getUserTickets(userId);
      const ticketCounts = userTickets.reduce((acc, ticket) => {
        acc[ticket.raffleName] = ticket.quantity;
        return acc;
      }, {});

      const embed = new EmbedBuilder()
        .setTitle('🎟️ Active Raffles')
        .setColor(0xFFD700)
        .setTimestamp();

      for (const raffle of activeRaffles) {
        let formattedEndDate;
        const endDate = new Date(Number(raffle.endTime));
        
        if (!isNaN(endDate.getTime())) {
          formattedEndDate = endDate.toUTCString().replace(' GMT', ' UTC');
        } else {
          // Fallback: Attempt to extract date from shop item description
          const shopItem = await db.getShopItemByName(`${raffle.name} Raffle Ticket`);
          if (shopItem && shopItem.description) {
            const match = shopItem.description.match(/\*\*(.*?)\*\*/); // Extracts content between ** **
            if (match) {
              formattedEndDate = match[1];
            }
          }
        }
        
        embed.addFields({
          name: `🟢 ${raffle.name}`,
          value: `🎁 **Prize:** ${raffle.prize}
` +
                 `💰 **Ticket Cost:** ${raffle.cost ? formatCurrency(raffle.cost) : 'Unknown'}
` +
                 `🎟️ **Your Tickets:** ${ticketCounts[raffle.name] || 0}
` +
                 `🏆 **Winners:** ${raffle.winners}
` +
                 `⏳ **Ends at:** ${formattedEndDate || 'Unknown'}`,
          inline: false
        });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('⚠️ Error fetching raffle list:', err);
      await interaction.reply({ content: `🚫 Failed to fetch raffle list: ${err.message}`, ephemeral: true });
    }
  }
};