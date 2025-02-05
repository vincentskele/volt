const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { formatCurrency } = require('../../currency'); // Import currency formatter

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the top users by wallet balance.'),

  async execute(interaction) {
    try {
      // Fetch top 10 users by wallet balance
      const topUsers = await db.getLeaderboard();

      if (!topUsers.length) {
        return interaction.reply({ content: '🚫 No leaderboard data available.', ephemeral: true });
      }

      // Format leaderboard
      const leaderboard = topUsers
        .map((user, index) => `**${index + 1}.** <@${user.userID}> - **${formatCurrency(user.wallet)}**`)
        .join('\n');

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle('🏆 Leaderboard - Top Wallets')
        .setDescription(leaderboard)
        .setColor(0xFFD700)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Leaderboard Slash Error:', err);
      return interaction.reply({ content: `🚫 Failed to fetch leaderboard: ${err.message || err}`, ephemeral: true });
    }
  }
};
