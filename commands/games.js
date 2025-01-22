// commands/games.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../db');

module.exports = {
  // Define all slash commands handled by this module
  data: [
    // Blackjack Command
    new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('Start a game of Blackjack.')
      .addIntegerOption(option =>
        option.setName('bet')
          .setDescription('The amount to bet')
          .setRequired(true)),
    
    // Hit Command
    new SlashCommandBuilder()
      .setName('hit')
      .setDescription('Draw another card in your current Blackjack game.'),
    
    // Stand Command
    new SlashCommandBuilder()
      .setName('stand')
      .setDescription('Stay with your current hand in your Blackjack game.')
  ],

  /**
   * Execute function to handle both prefix and slash commands.
   * @param {string} commandType - 'slash' or the prefix command name.
   * @param {Message|CommandInteraction} messageOrInteraction - The message or interaction object.
   * @param {Array<string>} args - The arguments provided with the command.
   */
  async execute(commandType, messageOrInteraction, args) {
    if (commandType === 'slash') {
      await this.handleSlashCommand(messageOrInteraction);
    } else {
      await this.handlePrefixCommand(commandType, messageOrInteraction, args);
    }
  },

  /**
   * Handle slash command interactions.
   * @param {CommandInteraction} interaction 
   */
  async handleSlashCommand(interaction) {
    const { commandName, options, user, member } = interaction;

    switch (commandName) {
      case 'blackjack':
        await this.blackjackSlash(interaction, options);
        break;
      case 'hit':
        await this.hitSlash(interaction);
        break;
      case 'stand':
        await this.standSlash(interaction);
        break;
      default:
        await interaction.reply({ content: '🚫 Unknown command.', ephemeral: true });
    }
  },

  /**
   * Handle prefix commands.
   * @param {string} commandName 
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async handlePrefixCommand(commandName, message, args) {
    switch (commandName) {
      case 'blackjack':
        await this.blackjackPrefix(message, args);
        break;
      case 'hit':
        await this.hitPrefix(message);
        break;
      case 'stand':
        await this.standPrefix(message);
        break;
      default:
        // Unknown command; do nothing or send a default message
        break;
    }
  },

  // ===============================
  // Prefix Command Handlers
  // ===============================

  /**
   * Handle the prefix `$blackjack` command.
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async blackjackPrefix(message, args) {
    const bet = parseInt(args[0], 10);
    if (isNaN(bet) || bet <= 0) {
      return message.reply('Usage: `$blackjack <bet>`');
    }

    try {
      // First check if user already has an active game
      const activeGames = await db.getActiveGames(message.author.id);
      if (activeGames.length > 0) {
        return message.reply('🚫 You already have an active Blackjack game! Use `$hit` or `$stand` to finish it.');
      }

      const game = await db.startBlackjackGame(message.author.id, bet);
      const playerTotal = this.calculateHandTotal(game.playerHand);

      const embed = new EmbedBuilder()
        .setTitle('🎲 Blackjack Game Started!')
        .addFields(
          { name: 'Bet', value: `${bet} 🍕`, inline: true },
          { name: 'Your Hand', value: this.formatHand(game.playerHand), inline: true },
          { name: 'Total', value: `${playerTotal}`, inline: true },
          { name: 'Dealer Shows', value: `${this.formatCard(game.dealerHand[0])}`, inline: true }
        )
        .setColor(0x00AE86)
        .setTimestamp();

      if (playerTotal === 21) {
        embed.addFields({ name: '\u200B', value: '🎉 **BLACKJACK!** Stand to collect your winnings!' });
      } else {
        embed.setFooter({ text: 'Type `$hit` to draw another card or `$stand` to stay.' });
      }

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Blackjack Command Error:', err);
      return message.reply(`🚫 An error occurred: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$hit` command.
   * @param {Message} message 
   */
  async hitPrefix(message) {
    try {
      const activeGames = await db.getActiveGames(message.author.id);
      if (!activeGames.length) {
        return message.reply('🚫 No active Blackjack game found. Start one with `$blackjack <bet>`');
      }

      const result = await db.blackjackHit(activeGames[0].gameID);
      const playerTotal = this.calculateHandTotal(result.playerHand);

      const embed = new EmbedBuilder()
        .setTitle('🎲 Hit!')
        .addFields(
          { name: 'Drew', value: `${this.formatCard(result.newCard)}`, inline: true },
          { name: 'Your Hand', value: this.formatHand(result.playerHand), inline: true },
          { name: 'Total', value: `${playerTotal}`, inline: true }
        )
        .setColor(0x00AE86)
        .setTimestamp();

      if (result.status === 'dealer_win') {
        embed.addFields({ name: '\u200B', value: '💔 Bust! Better luck next time!' });
      } else if (playerTotal === 21) {
        embed.addFields({ name: '\u200B', value: '🎉 21! You should probably stand!' });
      } else {
        embed.setFooter({ text: 'Type `$hit` for another card or `$stand` to stay.' });
      }

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Hit Command Error:', err);
      return message.reply(`🚫 An error occurred: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$stand` command.
   * @param {Message} message 
   */
  async standPrefix(message) {
    try {
      const activeGames = await db.getActiveGames(message.author.id);
      if (!activeGames.length) {
        return message.reply('🚫 No active Blackjack game found. Start one with `$blackjack <bet>`');
      }

      const game = activeGames[0];
      const result = await db.blackjackStand(game.gameID);

      const embed = new EmbedBuilder()
        .setTitle('🎲 Final Hands')
        .addFields(
          { name: 'Dealer\'s Hand', value: `${this.formatHand(result.dealerHand)}`, inline: false },
          { name: 'Dealer\'s Total', value: `${result.dealerTotal}`, inline: true },
          { name: 'Your Hand', value: `${this.formatHand(game.playerHand)}`, inline: false },
          { name: 'Your Total', value: `${result.playerTotal}`, inline: true }
        )
        .setColor(0x00AE86)
        .setTimestamp();

      switch (result.status) {
        case 'player_win':
          if (result.playerTotal === 21 && game.playerHand.length === 2) {
            embed.addFields({ name: '\u200B', value: `🎉 **BLACKJACK!** You win ${Math.floor(game.bet * 2.5)} 🍕!` });
          } else {
            embed.addFields({ name: '\u200B', value: `🎉 You win ${game.bet * 2} 🍕!` });
          }
          break;
        case 'dealer_win':
          if (result.dealerTotal === 21 && result.dealerHand.length === 2) {
            embed.addFields({ name: '\u200B', value: '💔 Dealer Blackjack! Better luck next time!' });
          } else {
            embed.addFields({ name: '\u200B', value: '💔 Dealer wins! Better luck next time!' });
          }
          break;
        case 'push':
          embed.addFields({ name: '\u200B', value: `😅 Push! Your ${game.bet} 🍕 bet has been returned.` });
          break;
        default:
          embed.addFields({ name: '\u200B', value: '🚫 An unexpected result occurred.' });
          break;
      }

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Stand Command Error:', err);
      return message.reply(`🚫 An error occurred: ${err.message || err}`);
    }
  },

  // ===============================
  // Slash Command Handlers
  // ===============================

  /**
   * Handle the slash `/blackjack` command.
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   */
  async blackjackSlash(interaction, options) {
    const bet = options.getInteger('bet');
    if (bet <= 0) {
      return interaction.reply({ content: '🚫 Please specify a positive amount to bet.', ephemeral: true });
    }

    try {
      // Check if user already has an active game
      const activeGames = await db.getActiveGames(interaction.user.id);
      if (activeGames.length > 0) {
        return interaction.reply({ content: '🚫 You already have an active Blackjack game! Use `/hit` or `/stand` to finish it.', ephemeral: true });
      }

      const game = await db.startBlackjackGame(interaction.user.id, bet);
      const playerTotal = this.calculateHandTotal(game.playerHand);

      const embed = new EmbedBuilder()
        .setTitle('🎲 Blackjack Game Started!')
        .addFields(
          { name: 'Bet', value: `${bet} 🍕`, inline: true },
          { name: 'Your Hand', value: this.formatHand(game.playerHand), inline: true },
          { name: 'Total', value: `${playerTotal}`, inline: true },
          { name: 'Dealer Shows', value: `${this.formatCard(game.dealerHand[0])}`, inline: true }
        )
        .setColor(0x00AE86)
        .setTimestamp();

      if (playerTotal === 21) {
        embed.addFields({ name: '\u200B', value: '🎉 **BLACKJACK!** Stand to collect your winnings!' });
      } else {
        embed.setFooter({ text: 'Use `/hit` to draw another card or `/stand` to stay.' });
      }

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Blackjack Slash Command Error:', err);
      return interaction.reply({ content: `🚫 An error occurred: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/hit` command.
   * @param {CommandInteraction} interaction 
   */
  async hitSlash(interaction) {
    try {
      const activeGames = await db.getActiveGames(interaction.user.id);
      if (!activeGames.length) {
        return interaction.reply({ content: '🚫 No active Blackjack game found. Start one with `/blackjack <bet>`', ephemeral: true });
      }

      const result = await db.blackjackHit(activeGames[0].gameID);
      const playerTotal = this.calculateHandTotal(result.playerHand);

      const embed = new EmbedBuilder()
        .setTitle('🎲 Hit!')
        .addFields(
          { name: 'Drew', value: `${this.formatCard(result.newCard)}`, inline: true },
          { name: 'Your Hand', value: this.formatHand(result.playerHand), inline: true },
          { name: 'Total', value: `${playerTotal}`, inline: true }
        )
        .setColor(0x00AE86)
        .setTimestamp();

      if (result.status === 'dealer_win') {
        embed.addFields({ name: '\u200B', value: '💔 Bust! Better luck next time!' });
      } else if (playerTotal === 21) {
        embed.addFields({ name: '\u200B', value: '🎉 21! You should probably stand!' });
      } else {
        embed.setFooter({ text: 'Use `/hit` to draw another card or `/stand` to stay.' });
      }

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Hit Slash Command Error:', err);
      return interaction.reply({ content: `🚫 An error occurred: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/stand` command.
   * @param {CommandInteraction} interaction 
   */
  async standSlash(interaction) {
    try {
      const activeGames = await db.getActiveGames(interaction.user.id);
      if (!activeGames.length) {
        return interaction.reply({ content: '🚫 No active Blackjack game found. Start one with `/blackjack <bet>`', ephemeral: true });
      }

      const game = activeGames[0];
      const result = await db.blackjackStand(game.gameID);

      const embed = new EmbedBuilder()
        .setTitle('🎲 Final Hands')
        .addFields(
          { name: 'Dealer\'s Hand', value: `${this.formatHand(result.dealerHand)}`, inline: false },
          { name: 'Dealer\'s Total', value: `${result.dealerTotal}`, inline: true },
          { name: 'Your Hand', value: `${this.formatHand(game.playerHand)}`, inline: false },
          { name: 'Your Total', value: `${result.playerTotal}`, inline: true }
        )
        .setColor(0x00AE86)
        .setTimestamp();

      switch (result.status) {
        case 'player_win':
          if (result.playerTotal === 21 && game.playerHand.length === 2) {
            embed.addFields({ name: '\u200B', value: `🎉 **BLACKJACK!** You win ${Math.floor(game.bet * 2.5)} 🍕!` });
          } else {
            embed.addFields({ name: '\u200B', value: `🎉 You win ${game.bet * 2} 🍕!` });
          }
          break;
        case 'dealer_win':
          if (result.dealerTotal === 21 && result.dealerHand.length === 2) {
            embed.addFields({ name: '\u200B', value: '💔 Dealer Blackjack! Better luck next time!' });
          } else {
            embed.addFields({ name: '\u200B', value: '💔 Dealer wins! Better luck next time!' });
          }
          break;
        case 'push':
          embed.addFields({ name: '\u200B', value: `😅 Push! Your ${game.bet} 🍕 bet has been returned.` });
          break;
        default:
          embed.addFields({ name: '\u200B', value: '🚫 An unexpected result occurred.' });
          break;
      }

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Stand Slash Command Error:', err);
      return interaction.reply({ content: `🚫 An error occurred: ${err.message || err}`, ephemeral: true });
    }
  },

  // ===============================
  // Utility Functions
  // ===============================

  /**
   * Format a single card.
   * @param {Object} card 
   * @returns {string}
   */
  formatCard(card) {
    if (!card || !card.value || !card.suit) return '??';
    return `${card.value}${card.suit}`;
  },

  /**
   * Format a hand of cards.
   * @param {Array<Object>} hand 
   * @returns {string}
   */
  formatHand(hand) {
    if (!Array.isArray(hand)) return 'No cards';
    return hand.map(card => this.formatCard(card)).join(' ');
  },

  /**
   * Calculate the total value of a hand.
   * @param {Array<Object>} hand 
   * @returns {number}
   */
  calculateHandTotal(hand) {
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
        total += parseInt(card.value) || 0;
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
};
