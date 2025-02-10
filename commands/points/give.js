const { SlashCommandBuilder } = require('@discordjs/builders');
const { formatCurrency } = require('../../currency');
const db = require('../../db');
const PREFIX = process.env.PREFIX || '$';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Transfer points to another user.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to give points to')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The amount to give')
        .setRequired(true)),

  async execute(context, messageOrInteraction, args) {
    let targetUser, amount, senderId;

    if (context === 'prefix') {
      // Prefix-based command handling
      if (args.length < 2) {
        return messageOrInteraction.reply(`🚫 Usage: \`${PREFIX}give @user amount\``);
      }
      
      targetUser = messageOrInteraction.mentions.users.first();
      amount = parseInt(args[1], 10);
      senderId = messageOrInteraction.author.id;
      
      if (!targetUser || isNaN(amount)) {
        return messageOrInteraction.reply(`🚫 Invalid syntax. Usage: \`${PREFIX}give @user amount\``);
      }
    } else {
      // Slash command handling
      targetUser = messageOrInteraction.options.getUser('user');
      amount = messageOrInteraction.options.getInteger('amount');
      senderId = messageOrInteraction.user.id;
    }

    if (amount <= 0) {
      return messageOrInteraction.reply({ content: '🚫 Please specify a positive amount to give.', ephemeral: true });
    }

    if (senderId === targetUser.id) {
      return messageOrInteraction.reply({ content: '🚫 You cannot give points to yourself.', ephemeral: true });
    }

    try {
      // Transfer money using the database method
      await db.transferFromWallet(senderId, targetUser.id, amount);

      return messageOrInteraction.reply(`✅ You gave ${formatCurrency(amount)} to <@${targetUser.id}>!`);
    } catch (err) {
      console.error(`Error transferring money from ${senderId} to ${targetUser.id}:`, err);
      return messageOrInteraction.reply({ content: `🚫 Transfer failed: ${err.message}`, ephemeral: true });
    }
  }
};
