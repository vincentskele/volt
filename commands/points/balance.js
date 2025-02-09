const { SlashCommandBuilder } = require('@discordjs/builders');
const { formatCurrency } = require('../../currency');
const db = require('../../db');

module.exports = {
  // Slash command registration
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your balance or another user\'s balance.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to check the balance of')
        .setRequired(false)),

  // Slash command execution
  async execute(interaction) {
    await handleBalanceCommand(interaction, true);
  },

  // Prefix command execution
  async executePrefix(message, args) {
    const targetUser = message.mentions.users.first() || message.author;
    await handleBalanceCommand(message, false, targetUser);
  },
};

// Shared command handler for both slash and prefix commands
async function handleBalanceCommand(ctx, isSlash, targetUser = null) {
  try {
    let user;

    // Resolve the user based on the command type
    if (isSlash) {
      user = ctx.options?.getUser('user') || ctx.user; // Slash command: options user or interaction user
    } else {
      user = targetUser; // Prefix command: resolved user from mentions or author
    }

    if (!user) {
      throw new Error('Unable to determine user.');
    }

    // Fetch balances from the database
    const { wallet, bank } = await db.getBalances(user.id);

    // Format the response
    const response =
      `**${user.username}'s Balance**\n` +
      `Wallet: ${formatCurrency(wallet)}\n` +
      `Bank: ${formatCurrency(bank)}\n` +
      `Total: ${formatCurrency(wallet + bank)}`;

    // Send the response
    if (isSlash) {
      await ctx.reply(response);
    } else {
      await ctx.channel.send(response);
    }
  } catch (error) {
    console.error('Error in balance command:', error);

    const errorMsg = '🚫 Failed to retrieve balance.';
    if (isSlash) {
      if (ctx.replied || ctx.deferred) {
        await ctx.followUp({ content: errorMsg, ephemeral: true });
      } else {
        await ctx.reply({ content: errorMsg, ephemeral: true });
      }
    } else {
      await ctx.channel.send(errorMsg).catch(console.error);
    }
  }
}
