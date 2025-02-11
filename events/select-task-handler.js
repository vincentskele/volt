// File: select-task-handler.js

const { Events, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  name: 'interactionCreate', // Use lower-case event name.
  async execute(interaction) {
    // Process only select menu interactions with customId "select-task"
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'select-task') return;

    try {
      await interaction.deferReply({ ephemeral: true });
      const userID = interaction.user.id;
      const selectedJobID = interaction.values[0];

      // Check if the user already has a job.
      const existingJob = await db.getUserJob(userID);
      if (existingJob) {
        return interaction.editReply({ content: '🚫 You already have a job!' });
      }

      // Attempt to assign the selected job.
      const job = await db.assignJobById(userID, selectedJobID);
      if (!job) {
        return interaction.editReply({ content: `🚫 Failed to assign job with ID ${selectedJobID}` });
      }

      // Log only when the assignment is successful.
      console.log(`[INFO] User ${userID} assigned task ${job.description}`);

      const embed = new EmbedBuilder()
        .setTitle('✅ Job Assigned')
        .setDescription(`You have been assigned to **${job.description}** (Job #${job.jobID}).`)
        .setColor(0x00AE86)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`[ERROR] select-task-handler: ${error}`);
      try {
        await interaction.editReply({
          content: `🚫 An error occurred while assigning the job: ${error.message || error}`,
        });
      } catch (err) {
        console.error(`[ERROR] Failed to edit reply: ${err}`);
      }
    }
  },
};
