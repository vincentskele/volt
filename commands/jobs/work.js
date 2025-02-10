const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Assign yourself to a job.'),
  
  async execute(interaction) {
    try {
      const userID = interaction.user.id;
      
      // Check if the user already has a job.
      const existingJob = await db.getUserJob(userID);
      if (existingJob) {
        const embed = new EmbedBuilder()
          .setTitle('🛠️ You Already Have a Job')
          .setDescription(`**${existingJob}**`)
          .setColor(0xFFA500)
          .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      
      // Assign a job using the round-robin (cycled) logic.
      const job = await db.assignCycledJob(userID);
      
      // Create and send the embed message.
      const embed = new EmbedBuilder()
        .setTitle('🛠️ Job Assigned')
        .setDescription(`**${job.description}**`)
        .setColor(0x00AE86)
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
      
    } catch (err) {
      console.error('Work Slash Error:', err);
      // If the error indicates the user already has a job, send that message.
      if (err === 'User already has an assigned job') {
        const existingJob = await db.getUserJob(interaction.user.id);
        const embed = new EmbedBuilder()
          .setTitle('🛠️ You Already Have a Job')
          .setDescription(`**${existingJob}**`)
          .setColor(0xFFA500)
          .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      return interaction.reply({ content: `🚫 Work failed: ${err.message || err}`, ephemeral: true });
    }
  }
};
