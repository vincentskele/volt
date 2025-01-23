const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { formatCurrency } = require('../../currency'); // Currency formatting utility

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Start a game of Blackjack.')
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('The amount to bet')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      // Retrieve bet amount
      const bet = interaction.options.getInteger('bet');
      if (bet <= 0) {
        return interaction.reply({
          content: '🚫 Please specify a positive amount to bet.',
          ephemeral: true,
        });
      }

      // Check for an active game
      const activeGames = await db.getActiveGames(interaction.user.id);
      if (activeGames.length > 0) {
        const game = activeGames[0];
        
        // **Parse the hands here if they aren't already parsed**
        if (typeof game.playerHand === 'string') {
          game.playerHand = JSON.parse(game.playerHand);
        }
        if (typeof game.dealerHand === 'string') {
          game.dealerHand = JSON.parse(game.dealerHand);
        }

        return interaction.reply({
          content: `🚫 You already have an active Blackjack game! Use \`/hit\` or \`/stand\` to finish it.`,
          embeds: [
            generateGameEmbed(game, 'Your current Blackjack game:')
          ],
          ephemeral: true,
        });
      }

      // Start a new game
      const game = await db.startBlackjackGame(interaction.user.id, bet);
      const playerTotal = calculateHandTotal(game.playerHand);

      // Create embed for the new game
      const embed = new EmbedBuilder()
        .setTitle('🎲 Blackjack Game Started!')
        .addFields(
          { name: 'Bet', value: formatCurrency(bet), inline: true },
          { name: 'Your Hand', value: formatHand(game.playerHand), inline: true },
          { name: 'Total', value: `${playerTotal}`, inline: true },
          { name: 'Dealer Shows', value: formatCard(game.dealerHand[0]), inline: true }
        )
        .setColor(0x00AE86)
        .setTimestamp();

      // Add footer for instructions
      if (playerTotal === 21) {
        embed.addFields({ name: '\u200B', value: '🎉 **BLACKJACK!** Use `/stand` to collect your winnings!' });
      } else {
        embed.setFooter({ text: 'Use `/hit` to draw another card or `/stand` to stay.' });
      }

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Blackjack Command Error:', err);
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

// Utility: Calculate the total value of a hand
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
      total += parseInt(card.value, 10) || 0;
    }
  }

  for (let i = 0; i < aces; i++) {
    total += (total + 11 <= 21) ? 11 : 1;
  }

  return total;
}

// Utility: Generate an embed for an active game
function generateGameEmbed(game, title = 'Your Blackjack Game:') {
    return new EmbedBuilder()
      .setTitle(title)
      .addFields(
        { name: 'Bet', value: formatCurrency(game.bet), inline: true },
        { name: 'Your Hand', value: formatHand(game.playerHand), inline: true },
        { name: 'Total', value: `${calculateHandTotal(game.playerHand)}`, inline: true },
        { name: 'Dealer Shows', value: formatCard(game.dealerHand[0]), inline: true }
      )
      .setColor(0x00AE86)
      .setTimestamp();
  }
