const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-job')
    .setDescription('Add a new job to the job list (Admin Only).')
    .addStringOption(option =>
      option.setName('description')
        .setDescription('The description of the job')
        .setRequired(true)
    ),

  async execute(interaction) {
    const { options, member } = interaction;

    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can add jobs.', ephemeral: true });
    }

    const description = options.getString('description');
    if (!description) {
      return interaction.reply({ content: '🚫 A job description is required.', ephemeral: true });
    }

    try {
      const result = await db.addJob(description);
      if (!result || !result.jobID) {
        throw new Error('Job could not be added to the database.');
      }

      return interaction.reply({
        content: `✅ **Job Added Successfully!**
**Job ID:** ${result.jobID}
**Description:** ${description}`,
        ephemeral: false,
      });
    } catch (error) {
      console.error('Error adding job:', error);
      return interaction.reply({
        content: `🚫 **Failed to add the job.** Please try again later.
**Error:** ${error.message || error}`,
        ephemeral: true,
      });
    }
  },
};
