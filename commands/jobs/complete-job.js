const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const db = require('../../db');

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
      option.setName('jobid')
        .setDescription('The ID of the job to complete')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('reward')
        .setDescription('The amount of currency to reward')
        .setRequired(true)
    ),

  async execute(interaction) {
    const { options, member } = interaction;

    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can complete jobs.', ephemeral: true });
    }

    const targetUser = options.getUser('user');
    const jobID = options.getInteger('jobid');
    const reward = options.getInteger('reward');

    if (!targetUser || !jobID || !reward) {
      return interaction.reply({ content: '🚫 All fields (user, job ID, reward) are required.', ephemeral: true });
    }

    try {
      const result = await db.completeJob(jobID, targetUser.id, reward);
      if (!result) {
        return interaction.reply({ content: `🚫 Job ${jobID} does not exist.`, ephemeral: true });
      }
      if (result.notAssigned) {
        return interaction.reply({ content: `🚫 <@${targetUser.id}> is not assigned to job ${jobID}.`, ephemeral: true });
      }
      return interaction.reply(
        `✅ Completed job ${jobID} for <@${targetUser.id}> with reward **${reward}** 🍕!`
      );
    } catch (err) {
      console.error('Complete Job Slash Error:', err);
      return interaction.reply({ content: `🚫 Complete job failed: ${err.message || err}`, ephemeral: true });
    }
  }
};
