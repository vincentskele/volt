const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Assign yourself to a random job.'),

  async execute(interaction) {
    try {
      const job = await db.assignRandomJob(interaction.user.id);
      if (!job) {
        return interaction.reply({ content: '🚫 No job available or you are on all of them.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🛠️ Job Assigned')
        .setDescription(`• **Job ID:** ${job.jobID}\n• **Description:** ${job.description}`)
        .setColor(0x00AE86)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Work Slash Error:', err);
      return interaction.reply({ content: `🚫 Work failed: ${err.message || err}`, ephemeral: true });
    }
  }
};
