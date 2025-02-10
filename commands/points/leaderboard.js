const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { formatCurrency } = require('../../points');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the top users by total Volts (wallet + battery bank).'),

  async execute(interaction) {
    try {
      // Fetch top users
      const topUsers = await db.getLeaderboard();

      if (!topUsers.length) {
        return interaction.reply({ content: '🚫 No leaderboard data available.', ephemeral: true });
      }

      // Format leaderboard
      const leaderboard = topUsers
        .map((user, index) => {
          const totalBalance = formatCurrency(user.totalBalance);
          const banked = user.bank; // Raw bank amount without formatting
          return `**${index + 1}.** <@${user.userID}> - **${totalBalance}**  (${banked} battery bank)`;
        })
        .join('\n');

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle('🏆 Leaderboard - Top Balances')
        .setDescription(leaderboard)
        .setColor(0xFFD700) // Gold color
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error(`Error in leaderboard command for user ${interaction.user.id}:`, err);
      return interaction.reply({ content: `🚫 Failed to fetch leaderboard: ${err.message || err}`, ephemeral: true });
    }
  },
};
