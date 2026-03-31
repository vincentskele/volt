const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-task')
    .setDescription('Add a new job to the job list (Admin Only).')
    .addStringOption(option =>
      option.setName('description')
        .setDescription('The description of the job')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('cooldown')
        .setDescription('Optional cooldown amount for this quest')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('cooldown-unit')
        .setDescription('Cooldown unit (required if cooldown amount is set)')
        .addChoices(
          { name: 'Minute', value: 'minute' },
          { name: 'Hour', value: 'hour' },
          { name: 'Day', value: 'day' },
          { name: 'Month', value: 'month' },
        )
        .setRequired(false)
    ),

  async execute(interaction) {
    const { options, member } = interaction;

    // Check if the user is an admin
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can add jobs.', ephemeral: true });
    }

    const description = options.getString('description');
    const cooldownValue = options.getInteger('cooldown');
    const cooldownUnit = options.getString('cooldown-unit');
    if (!description) {
      return interaction.reply({ content: '🚫 A job description is required.', ephemeral: true });
    }
    if (cooldownValue && !cooldownUnit) {
      return interaction.reply({ content: '🚫 Please provide a cooldown unit when setting a cooldown.', ephemeral: true });
    }
    if (cooldownUnit && !cooldownValue) {
      return interaction.reply({ content: '🚫 Please provide a cooldown amount when setting a cooldown.', ephemeral: true });
    }

    try {
      // Add the new job to the database
      const result = await db.addJob(description, cooldownValue, cooldownUnit);
      if (!result || !result.jobID) {
        throw new Error('Job could not be added to the database.');
      }

      // Renumber jobs to maintain sequential IDs
      await renumberJobs();

      return interaction.reply({
        content: `✅ **Job Added Successfully!**
**Job ID:** ${result.jobID}
**Description:** ${description}${result.cooldown_value && result.cooldown_unit ? `\n**Cooldown:** ${result.cooldown_value} ${result.cooldown_unit}${result.cooldown_value === 1 ? '' : 's'}` : ''}`,
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

// Helper function to renumber jobs in the database
async function renumberJobs() {
  try {
    const jobs = await db.getAllJobs(); // Fetch all jobs from the database
    if (!jobs || jobs.length === 0) return;

    // Sort jobs by current ID
    jobs.sort((a, b) => a.jobID - b.jobID);

    // Reassign IDs starting from 1
    for (let i = 0; i < jobs.length; i++) {
      const newID = i + 1;
      if (jobs[i].jobID !== newID) {
        await db.updateJobID(jobs[i].jobID, newID); // Update the job ID in the database
      }
    }
  } catch (error) {
    console.error('Error renumbering jobs:', error);
  }
}
