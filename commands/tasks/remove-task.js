const { SlashCommandBuilder } = require('discord.js');
const db = require('../../db'); // Adjust the path if needed

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-task')
    .setDescription('Admin command: Remove a task from the list.')
    .addIntegerOption(option =>
      option
        .setName('jobid')
        .setDescription('The ID of the task to remove.')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Check that the caller is an admin.
    try {
      const adminIDs = await db.getAdmins();
      if (!adminIDs.includes(interaction.user.id)) {
        return interaction.reply({
          content: "You don't have permission to use this command.",
          ephemeral: true
        });
      }
    } catch (err) {
      console.error("Error fetching admin list:", err);
      return interaction.reply({
        content: "Error verifying admin status.",
        ephemeral: true
      });
    }

    const jobId = interaction.options.getInteger('jobid');
    if (!jobId) {
      return interaction.reply({ content: "Task ID is required.", ephemeral: true });
    }

    try {
      await db.deleteJobById(jobId, { actorUserId: interaction.user.id });

      return interaction.reply({
        content: `Job with ID ${jobId} was successfully removed.`
      });
    } catch (error) {
      console.error("Error removing job:", error);
      if (String(error?.message || '').toLowerCase().includes('not found')) {
        return interaction.reply({
          content: `No job with ID ${jobId} was found.`,
          ephemeral: true
        });
      }
      return interaction.reply({
        content: `Error removing job: ${error.message}`,
        ephemeral: true
      });
    }
  },
};
