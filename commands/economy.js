const { currency, formatCurrency } = require('../currency');
const { PermissionsBitField } = require('discord.js');
const db = require('../db');

class EconomyModule {
  // Check balance for self or mentioned user
  static async balance(message) {
    const targetUser = message.mentions.users.first() || message.author;
    const { wallet, bank } = await db.getBalances(targetUser.id);
    
    return message.reply(
      `**${targetUser.username}'s Balance**\n` +
      `Wallet: ${formatCurrency(wallet)}\n` +
      `Bank: ${formatCurrency(bank)}\n` +
      `Total: ${formatCurrency(wallet + bank)}`
    );
  }

  // Deposit money from wallet to bank
  static async deposit(message, args) {
    const amount = parseInt(args[0], 10);
    if (isNaN(amount) || amount <= 0) {
      return message.reply('Usage: `$deposit <amount>`');
    }

    try {
      await db.deposit(message.author.id, amount);
      return message.reply(`✅ Deposited ${formatCurrency(amount)} into your bank.`);
    } catch (err) {
      return message.reply(`🚫 Deposit failed: ${err}`);
    }
  }

  // Withdraw money from bank to wallet
  static async withdraw(message, args) {
    const amount = parseInt(args[0], 10);
    if (isNaN(amount) || amount <= 0) {
      return message.reply('Usage: `$withdraw <amount>`');
    }

    try {
      await db.withdraw(message.author.id, amount);
      return message.reply(`✅ Withdrew ${formatCurrency(amount)} to your wallet.`);
    } catch (err) {
      return message.reply(`🚫 Withdraw failed: ${err}`);
    }
  }

  // Rob another user's wallet
  static async rob(message, args) {
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply('Usage: `$rob @user`');
    }

    if (targetUser.id === message.author.id) {
      return message.reply('🚫 You cannot rob yourself!');
    }

    try {
      const result = await db.robUser(message.author.id, targetUser.id);
      
      if (!result.success) {
        return message.reply(`🚫 Rob attempt failed: ${result.message}`);
      }

      if (result.outcome === 'success') {
        return message.reply(
          `💰 You robbed <@${targetUser.id}> and stole **${formatCurrency(result.amountStolen)}**!`
        );
      } else {
        return message.reply(
          `👮 Your robbery failed! You paid **${formatCurrency(result.penalty)}** to <@${targetUser.id}>.`
        );
      }
    } catch (err) {
      return message.reply(`🚫 Rob failed: ${err}`);
    }
  }

  // Admin command to generate money
  static async bake(message) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply(`🚫 Only an admin can bake ${currency.symbol}.`);
    }

    await db.updateWallet(message.author.id, 6969);
    return message.reply(`${currency.symbol} You baked 6969 ${currency.name} into your wallet!`);
  }

  // Transfer money between users
  static async giveMoney(message, args) {
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply('Usage: `$give-money @user <amount>`');
    }

    const amount = parseInt(args[1], 10);
    if (isNaN(amount) || amount <= 0) {
      return message.reply('🚫 Please specify a valid amount.');
    }

    try {
      await db.transferFromWallet(message.author.id, targetUser.id, amount);
      return message.reply(`✅ You gave ${formatCurrency(amount)} to <@${targetUser.id}>!`);
    } catch (err) {
      return message.reply(`🚫 Transfer failed: ${err}`);
    }
  }

  // Give item to another user
  static async giveItem(message, args) {
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply('Usage: `$give-item @user <item name>`');
    }

    args.shift(); // Remove the mention
    const itemName = args.join(' ');
    if (!itemName) {
      return message.reply('Please specify the item name.');
    }

    try {
      await db.transferItem(message.author.id, targetUser.id, itemName, 1);
      return message.reply(`✅ You sent 1 "${itemName}" to <@${targetUser.id}>.`);
    } catch (err) {
      return message.reply(`🚫 Item transfer failed: ${err}`);
    }
  }

  // Redeem/use an item
  static async redeem(message, args) {
    const itemName = args.join(' ');
    if (!itemName) {
      return message.reply('Usage: `$redeem <item name>`');
    }

    try {
      await db.redeemItem(message.author.id, itemName);
      return message.reply(`🎉 You have redeemed **${itemName}**!`);
    } catch (err) {
      return message.reply(`🚫 Redemption failed: ${err}`);
    }
  }

  // Show leaderboard
  static async leaderboard(message) {
    try {
      const lb = await db.getLeaderboard();
      if (!lb.length) {
        return message.reply('🚫 No data for leaderboard.');
      }

      const lines = lb.map((row, i) => {
        const total = row.wallet + row.bank;
        return `\`${i + 1}\`. <@${row.userID}> - Wallet: ${formatCurrency(row.wallet)}, Bank: ${formatCurrency(row.bank)} (Total: ${formatCurrency(total)})`;
      });

      return message.reply(`**${currency.symbol} Leaderboard (Top 10)**\n${lines.join('\n')}`);
    } catch (err) {
      return message.reply(`🚫 Leaderboard failed: ${err}`);
    }
  }

  // Command handler
  static async execute(command, message, args) {
    switch (command) {
      case 'balance':
        return this.balance(message);
      case 'deposit':
        return this.deposit(message, args);
      case 'withdraw':
        return this.withdraw(message, args);
      case 'rob':
        return this.rob(message, args);
      case 'bake':
        return this.bake(message);
      case 'give-money':
        return this.giveMoney(message, args);
      case 'give-item':
        return this.giveItem(message, args);
      case 'redeem':
        return this.redeem(message, args);
      case 'leaderboard':
        return this.leaderboard(message);
      default:
        return null;
    }
  }
}

module.exports = EconomyModule;
