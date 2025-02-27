const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const db = require('../../db');
const { points, formatCurrency } = require('../../points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('points')
    .setDescription('Award points to a user directly (Admin Only).')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to award points to')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The amount of Volts to award')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for awarding points (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const { options, member, user } = interaction;

    try {
      // Fetch the list of bot admins - using existing getAdmins function
      const botAdmins = await db.getAdmins();
      
      // Check if the user is either a server admin or a bot admin
      const isServerAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
      const isBotAdmin = botAdmins.includes(user.id);

      if (!isServerAdmin && !isBotAdmin) {
        return interaction.reply({ content: '🚫 Only bot admins or server administrators can award points.', ephemeral: true });
      }

      const targetUser = options.getUser('user');
      const amount = options.getInteger('amount');
      const reason = options.getString('reason') || 'No reason provided';

      // Validate input
      if (!targetUser) {
        return interaction.reply({ content: '🚫 A user must be specified.', ephemeral: true });
      }

      if (amount <= 0) {
        return interaction.reply({ content: '🚫 Points amount must be greater than zero.', ephemeral: true });
      }

      // Use the existing updateWallet function to add points
      const result = await db.updateWallet(targetUser.id, amount);
      
      if (!result || !result.changes) {
        return interaction.reply({ content: `🚫 Failed to award points to <@${targetUser.id}>.`, ephemeral: true });
      }

      // We could add transaction logging here in the future
      // For now we'll use what's available in the existing codebase

      return interaction.reply(
        `✅ Awarded **${formatCurrency(amount)}** to <@${targetUser.id}>!\nReason: ${reason}`
      );
    } catch (err) {
      console.error('Points Award Slash Error:', err);
      return interaction.reply({ content: `🚫 Points award failed: ${err.message || err}`, ephemeral: true });
    }
  },
};