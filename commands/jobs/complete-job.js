const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const db = require('../../db');
const { currency, formatCurrency } = require('../../currency'); // Import currency module

module.exports = {
  data: new SlashCommandBuilder()
    .setName('complete-job')
    .setDescription('Complete a job and reward a user (Admin Only).')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to reward')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('reward')
        .setDescription('The amount of currency to reward')
        .setRequired(true)
    ),

  async execute(interaction) {
    const { options, member } = interaction;

    // Check for admin permissions
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can complete jobs.', ephemeral: true });
    }

    const targetUser = options.getUser('user');
    const reward = options.getInteger('reward');

    // Validate input
    if (!targetUser || reward <= 0) {
      return interaction.reply({ content: '🚫 User and reward amount are required, and reward must be positive.', ephemeral: true });
    }

    try {
      // Get the user's active job (no need to input job ID manually)
      const activeJob = await db.getActiveJob(targetUser.id);
      if (!activeJob) {
        return interaction.reply({ content: `🚫 <@${targetUser.id}> does not have an active job to complete.`, ephemeral: true });
      }

      // Complete the job
      const result = await db.completeJob(targetUser.id, reward);
      if (!result.success) {
        return interaction.reply({ content: `🚫 Failed to complete the job for <@${targetUser.id}>.`, ephemeral: true });
      }

      return interaction.reply(
        `✅ Completed job for <@${targetUser.id}> with reward **${formatCurrency(reward)}**!`
      );
    } catch (err) {
      console.error('Complete Job Slash Error:', err);
      return interaction.reply({ content: `🚫 Complete job failed: ${err.message || err}`, ephemeral: true });
    }
  },
};
