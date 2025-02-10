const { SlashCommandBuilder } = require('@discordjs/builders');
const { formatCurrency } = require('../../currency');
const db = require('../../db');
const PREFIX = process.env.PREFIX || '$';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Transfer Volts to another user.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to transfer Volts to')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The amount to transfer')
        .setRequired(true)),

  async execute(context, messageOrInteraction, args) {
    // We'll distinguish between prefix and slash commands by checking if the second argument is provided.
    let targetUser, amount, senderId;

    // If messageOrInteraction is undefined, we assume it's a slash command
    if (typeof messageOrInteraction === 'undefined') {
      // Slash command handling
      const interaction = context; // In this case, 'context' is actually the interaction.
      targetUser = interaction.options.getUser('user');
      amount = interaction.options.getInteger('amount');
      senderId = interaction.user.id;
    } else {
      // Prefix-based command handling
      const message = messageOrInteraction;
      // Expecting the syntax: $give @user amount
      if (args.length < 2) {
        return message.reply(`🚫 Usage: \`${PREFIX}give @user amount\``);
      }

      targetUser = message.mentions.users.first();
      amount = parseInt(args[1], 10);
      senderId = message.author.id;

      if (!targetUser || isNaN(amount)) {
        return message.reply(`🚫 Invalid syntax. Usage: \`${PREFIX}give @user amount\``);
      }
    }

    // Validate amount and prevent self-transfers
    if (amount <= 0) {
      const replyPayload = { content: '🚫 Please specify a positive amount to give.', ephemeral: true };
      if (messageOrInteraction) {
        return messageOrInteraction.reply(replyPayload);
      } else {
        return context.reply(replyPayload);
      }
    }

    if (senderId === targetUser.id) {
      const replyPayload = { content: '🚫 You cannot give Volts to yourself.', ephemeral: true };
      if (messageOrInteraction) {
        return messageOrInteraction.reply(replyPayload);
      } else {
        return context.reply(replyPayload);
      }
    }

    try {
      // Transfer money using the database method
      await db.transferFromWallet(senderId, targetUser.id, amount);
      const successMessage = `✅ You gave ${formatCurrency(amount)} to <@${targetUser.id}>!`;
      if (messageOrInteraction) {
        return messageOrInteraction.reply(successMessage);
      } else {
        return context.reply(successMessage);
      }
    } catch (err) {
      console.error(`Error transferring money from ${senderId} to ${targetUser.id}:`, err);
      const errorPayload = { content: `🚫 Transfer failed: ${err.message}`, ephemeral: true };
      if (messageOrInteraction) {
        return messageOrInteraction.reply(errorPayload);
      } else {
        return context.reply(errorPayload);
      }
    }
  }
};
