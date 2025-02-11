const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const db = require('../../db');
const { points, formatCurrency } = require('../../points'); // Import points module

module.exports = {
  data: new SlashCommandBuilder()
    .setName('complete-job')
    .setDescription('Complete a job and charge up a user’s Solarian (Admin Only).')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to charge up')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('reward')
        .setDescription('The amount of Volts to transfer')
        .setRequired(true)
    ),

  async execute(interaction) {
    const { options, member, user } = interaction;

    try {
      // Fetch the list of bot admins
      const botAdmins = await db.getAdmins(); // Returns an array of user IDs
      
      // Check if the user is either a server admin or a bot admin
      const isServerAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
      const isBotAdmin = botAdmins.includes(user.id);

      if (!isServerAdmin && !isBotAdmin) {
        return interaction.reply({ content: '🚫 Only bot admins or server administrators can complete jobs.', ephemeral: true });
      }

      const targetUser = options.getUser('user');
      const reward = options.getInteger('reward');

      // Validate input
      if (!targetUser) {
        return interaction.reply({ content: '🚫 A user must be specified.', ephemeral: true });
      }

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

      // Special message if reward is 0
      if (reward === 0) {
        return interaction.reply(
          `😆 OOOHHH NICE TRY, BUT JOB INCOMPLETE! <@${targetUser.id}> didn't get any reward!`
        );
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
