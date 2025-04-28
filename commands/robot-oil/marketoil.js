const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('marketoil')
    .setDescription('View all Robot Oil listings on the market.'),

  async execute(interaction) {
    try {
      const listings = await db.getRobotOilMarketListings();
      
      if (!listings.length) {
        return interaction.reply({ content: '🚫 No Robot Oil listings available.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🛢️ Robot Oil Market')
        .setColor(0xFFA500)
        .setTimestamp()
        .setFooter({ text: 'Cheapest listings shown first.' });

      listings.forEach((listing, index) => {
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '•';
        embed.addFields({
          name: `${emoji} Listing #${listing.listing_id}`,
          value: `**Seller:** <@${listing.seller_id}>\n**Price:** ${listing.price_per_unit} coins each\n**Available:** ${listing.quantity}`,
          inline: false,
        });
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Market Oil Error:', err);
      return interaction.reply({ content: `🚫 Error retrieving Robot Oil listings: ${err.message || err}`, ephemeral: true });
    }
  },
};
