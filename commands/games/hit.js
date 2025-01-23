const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db'); // Ensure your db.js file has necessary functions like blackjackHit

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hit')
    .setDescription('Draw another card in your current Blackjack game.'),
  
  async execute(interaction) {
    try {
      // Check for active games
      const activeGames = await db.getActiveGames(interaction.user.id);
      if (!activeGames.length) {
        return interaction.reply({
          content: '🚫 No active Blackjack game found. Start one with `/blackjack <bet>`.',
          ephemeral: true,
        });
      }

      // Perform the hit action
      const result = await db.blackjackHit(activeGames[0].gameID);
      
      if (!result || !result.playerHand || !result.newCard) {
        throw new Error('Unexpected result format from blackjackHit.');
      }

      const playerTotal = calculateHandTotal(result.playerHand);

      // Build the response embed
      const embed = new EmbedBuilder()
        .setTitle('🎲 Hit!')
        .addFields(
          { name: 'Drew', value: `${formatCard(result.newCard)}`, inline: true },
          { name: 'Your Hand', value: formatHand(result.playerHand), inline: true },
          { name: 'Total', value: `${playerTotal}`, inline: true }
        )
        .setColor(0x00AE86)
        .setTimestamp();

      // Check game status
      if (result.status === 'dealer_win') {
        embed.addFields({ name: '\u200B', value: '💔 Bust! Better luck next time!' });
      } else if (playerTotal === 21) {
        embed.addFields({ name: '\u200B', value: '🎉 21! You should probably stand!' });
      } else {
        embed.setFooter({ text: 'Use `/hit` to draw another card or `/stand` to stay.' });
      }

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Hit Command Error:', err);
      return interaction.reply({
        content: `🚫 An error occurred: ${err.message || 'Unknown error'}`,
        ephemeral: true,
      });
    }
  },
};

// Utility: Format a single card
function formatCard(card) {
  if (!card || !card.value || !card.suit) return '??';
  return `${card.value}${card.suit}`;
}

// Utility: Format a hand of cards
function formatHand(hand) {
  if (!Array.isArray(hand)) return 'No cards';
  return hand.map(card => formatCard(card)).join(' ');
}

// Utility: Calculate the total value of a Blackjack hand
function calculateHandTotal(hand) {
  if (!Array.isArray(hand)) return 0;

  let total = 0;
  let aces = 0;

  for (const card of hand) {
    if (!card || !card.value) continue;

    if (card.value === 'A') {
      aces++;
    } else if (['K', 'Q', 'J'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value, 10);
    }
  }

  for (let i = 0; i < aces; i++) {
    if (total + 11 <= 21) {
      total += 11;
    } else {
      total += 1;
    }
  }

  return total;
}
