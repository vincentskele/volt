const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Assign yourself to a random job.'),

  async execute(interaction) {
    try {
      const userID = interaction.user.id;

      // Check if user already has a job
      const existingJob = await db.getUserJob(userID);

      if (existingJob) {
        const embed = new EmbedBuilder()
          .setTitle('🛠️ You Already Have a Job')
          .setDescription(`**${existingJob}**`)
          .setColor(0xFFA500)
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // Assign a new job
      const job = await db.assignRandomJob(userID);
      if (!job) {
        return interaction.reply({ content: '🚫 No job available or you are on all of them.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🛠️ Job Assigned')
        .setDescription(`**${job.description}**`)
        .setColor(0x00AE86)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Work Slash Error:', err);
      return interaction.reply({ content: `🚫 Work failed: ${err.message || err}`, ephemeral: true });
    }
  }
};
