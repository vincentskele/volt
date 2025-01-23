const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { formatCurrency } = require('../../currency'); // Assuming you have a utility for formatting currency

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stand')
    .setDescription('Stay with your current hand in your Blackjack game.'),
  
  async execute(interaction) {
    try {
      // Check for active Blackjack games
      const activeGames = await db.getActiveGames(interaction.user.id);
      if (!activeGames.length) {
        return interaction.reply({
          content: '🚫 No active Blackjack game found. Start one with `/blackjack <bet>`',
          ephemeral: true,
        });
      }

      const game = activeGames[0];
      const result = await db.blackjackStand(game.gameID);

      // Ensure the result contains expected data
      if (!result || !result.dealerHand || !result.playerTotal || !result.status) {
        throw new Error('Unexpected result format from blackjackStand.');
      }

      // Build the response embed
      const embed = new EmbedBuilder()
        .setTitle('🎲 Final Hands')
        .addFields(
          { name: "Dealer's Hand", value: `${formatHand(result.dealerHand)}`, inline: false },
          { name: "Dealer's Total", value: `${result.dealerTotal}`, inline: true },
          { name: 'Your Hand', value: `${formatHand(game.playerHand)}`, inline: false },
          { name: 'Your Total', value: `${result.playerTotal}`, inline: true }
        )
        .setColor(0x00AE86)
        .setTimestamp();

      // Outcome messages
      const outcomeMessages = {
        player_win: game.playerHand.length === 2 && result.playerTotal === 21
          ? `🎉 **BLACKJACK!** You win ${formatCurrency(Math.floor(game.bet * 2.5))}!`
          : `🎉 You win ${formatCurrency(game.bet * 2)}!`,
        dealer_win: result.dealerHand.length === 2 && result.dealerTotal === 21
          ? '💔 Dealer Blackjack! Better luck next time!'
          : '💔 Dealer wins! Better luck next time!',
        push: `😅 Push! Your ${formatCurrency(game.bet)} bet has been returned.`,
      };

      embed.addFields({
        name: '\u200B',
        value: outcomeMessages[result.status] || '🚫 An unexpected result occurred.',
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Stand Command Error:', err);
      return interaction.reply({
        content: `🚫 An error occurred: ${err.message || 'Unknown error'}`,
        ephemeral: true,
      });
    }
  },
};

// Utility: Format a hand of cards
function formatHand(hand) {
  if (!Array.isArray(hand)) return 'No cards';
  return hand.map(card => `${card.value}${card.suit}`).join(' ');
}
