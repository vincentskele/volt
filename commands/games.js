// commands/games.js
const db = require('../db');

class GamesModule {
  static formatCard(card) {
    if (!card || !card.value || !card.suit) return '??';
    return `${card.value}${card.suit}`;
  }

  static formatHand(hand) {
    if (!Array.isArray(hand)) return 'No cards';
    return hand.map(card => this.formatCard(card)).join(' ');
  }

  static calculateHandTotal(hand) {
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

  static async blackjackCommand(message, args) {
    const bet = parseInt(args[0], 10);
    if (isNaN(bet) || bet <= 0) {
      return message.reply('Usage: `$blackjack <bet>`');
    }

    try {
      // First check if user already has an active game
      const activeGames = await db.getActiveGames(message.author.id);
      if (activeGames.length > 0) {
        return message.reply('🚫 You already have an active blackjack game! Use `$hit` or `$stand` to finish it.');
      }

      const game = await db.startBlackjackGame(message.author.id, bet);
      const playerTotal = this.calculateHandTotal(game.playerHand);
      
      const response = [
        '🎲 **Blackjack Game Started!**',
        `Bet: ${bet} 🍕\n`,
        'Your hand:',
        this.formatHand(game.playerHand),
        `Total: ${playerTotal}\n`,
        'Dealer shows:',
        this.formatHand(game.dealerHand),
        '\nType `$hit` to draw another card or `$stand` to stay.'
      ];

      if (playerTotal === 21) {
        response.push('\n🎉 **BLACKJACK!** Stand to collect your winnings!');
      }
      
      return message.reply(response.join('\n'));
    } catch (err) {
      return message.reply(`🚫 ${err}`);
    }
  }

  static async hitCommand(message) {
    try {
      const activeGames = await db.getActiveGames(message.author.id);
      if (!activeGames.length) {
        return message.reply('🚫 No active blackjack game found. Start one with `$blackjack <bet>`');
      }
      
      const result = await db.blackjackHit(activeGames[0].gameID);
      const playerTotal = this.calculateHandTotal(result.playerHand);
      
      const response = [
        `Drew: ${this.formatCard(result.newCard)}`,
        '\nYour hand:',
        this.formatHand(result.playerHand),
        `Total: ${playerTotal}`
      ];

      if (result.status === 'dealer_win') {
        response.push('\n💔 Bust! Better luck next time!');
      } else if (playerTotal === 21) {
        response.push('\n🎉 21! You should probably stand!');
      } else {
        response.push('\nType `$hit` for another card or `$stand` to stay.');
      }
      
      return message.reply(response.join('\n'));
    } catch (err) {
      return message.reply(`🚫 ${err}`);
    }
  }

  static async standCommand(message) {
    try {
      const activeGames = await db.getActiveGames(message.author.id);
      if (!activeGames.length) {
        return message.reply('🚫 No active blackjack game found. Start one with `$blackjack <bet>`');
      }
      
      const game = activeGames[0];
      const result = await db.blackjackStand(game.gameID);
      
      const response = [
        '🎲 **Final Hands**\n',
        'Dealer:',
        this.formatHand(result.dealerHand),
        `Total: ${result.dealerTotal}\n`,
        'Your hand:',
        this.formatHand(game.playerHand),
        `Total: ${result.playerTotal}\n`
      ];

      switch (result.status) {
        case 'player_win':
          if (result.playerTotal === 21 && game.playerHand.length === 2) {
            response.push(`🎉 **BLACKJACK!** You win ${Math.floor(game.bet * 2.5)} 🍕!`);
          } else {
            response.push(`🎉 You win ${game.bet * 2} 🍕!`);
          }
          break;
        case 'dealer_win':
          if (result.dealerTotal === 21 && result.dealerHand.length === 2) {
            response.push('💔 Dealer Blackjack! Better luck next time!');
          } else {
            response.push('💔 Dealer wins! Better luck next time!');
          }
          break;
        case 'push':
          response.push(`😅 Push! Your ${game.bet} 🍕 bet has been returned.`);
          break;
      }
      
      return message.reply(response.join('\n'));
    } catch (err) {
      return message.reply(`🚫 ${err}`);
    }
  }

  static async execute(command, message, args) {
    switch (command) {
      case 'blackjack':
        return this.blackjackCommand(message, args);
      case 'hit':
        return this.hitCommand(message);
      case 'stand':
        return this.standCommand(message);
      default:
        return null;
    }
  }
}

module.exports = GamesModule;
