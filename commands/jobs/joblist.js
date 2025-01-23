const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('joblist')
    .setDescription('View all available jobs and their current assignees.'),

  async execute(interaction) {
    try {
      await interaction.deferReply();
      const jobs = await db.getJobList();
      
      if (!jobs || jobs.length === 0) {
        return interaction.editReply('No jobs are currently available.');
      }

      const embed = new EmbedBuilder()
        .setTitle('🛠️ Available Jobs')
        .setColor(0x00AE86)
        .setDescription('Here are all available jobs and their current assignees:')
        .setTimestamp();

      for (const job of jobs) {
        const assigneeText = job.assignees && job.assignees.length > 0
          ? job.assignees.map(id => `<@${id}>`).join(', ')
          : 'No assignees';

        embed.addFields({
          name: `Job #${job.jobID}`,
          value: `📝 ${job.description}\n👥 **Assignees:** ${assigneeText}`,
          inline: false
        });
      }

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Joblist Error:', error);
      const errorMessage = error.message || error;
      return interaction.editReply({
        content: `Error retrieving job list: ${errorMessage}`,
        ephemeral: true
      });
    }
  }
};