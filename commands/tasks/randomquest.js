const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('randomquest')
    .setDescription('Assign yourself to a random quest.'),
  
  async execute(interaction) {
    try {
      const userID = interaction.user.id;
      
      // Check if the user already has a job.
      const existingJob = await db.getUserJob(userID);
      if (existingJob) {
        const embed = new EmbedBuilder()
          .setTitle('🛠️ You are already on a quest!')
          .setDescription(`**${existingJob}**`)
          .setColor(0xFFA500)
          .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      
      // Assign a job using the round-robin (cycled) logic.
      const job = await db.assignCycledJob(userID);
      
      // Create and send the embed message.
      const embed = new EmbedBuilder()
        .setTitle('🛠️ Quest Assigned')
        .setDescription(`**${job.description}**`)
        .setColor(0x00AE86)
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
      
    } catch (err) {
      console.error('Work Slash Error:', err);
      // If the error indicates the user already has a job, send that message.
      if (err === 'User already has an assigned quest') {
        const existingJob = await db.getUserJob(interaction.user.id);
        const embed = new EmbedBuilder()
          .setTitle('🛠️ You Already Have a Quest')
          .setDescription(`**${existingJob}**`)
          .setColor(0xFFA500)
          .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      const message = err?.message || err;
      const isCooldown = typeof message === 'string' && message.toLowerCase().includes('cooldown');
      return interaction.reply({ content: `🚫 Work failed: ${message}`, ephemeral: !isCooldown });
    }
  }
};
