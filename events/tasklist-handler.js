// File: tasklist-handler.js

const { Events, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  name: 'interactionCreate', // Must match the Discord event name exactly.
  async execute(interaction) {
    // Process only select menu interactions with customId "tasklist"
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'tasklist') return;
    
    try {
      const userID = interaction.user.id;
      
      // Check if the user already has a task.
      const existingJob = await db.getUserJob(userID);
      if (existingJob) {
        // Inform the user privately if they already have a task.
        return interaction.reply({ content: '🚫 You already have a task!', ephemeral: true });
      }
      
      // Get the selected task ID from the dropdown.
      const selectedTaskID = interaction.values[0];
      
      // Attempt to assign the task.
      const task = await db.assignJobById(userID, selectedTaskID);
      if (!task) {
        return interaction.reply({ content: `🚫 Failed to assign task with ID ${selectedTaskID}`, ephemeral: true });
      }
      
      // Log and announce in the channel.
      console.log(`[INFO] User ${userID} assigned task ${task.description}`);
      await interaction.channel.send(
        `✅ Task assigned: <@${userID}> is now assigned to **${task.description}** (Task #${task.jobID}).`
      );
      
      // Re-fetch the updated task list.
      const jobList = await db.getJobList();
      if (!jobList || jobList.length === 0) {
        return interaction.update({ content: '🚫 No tasks available at this time.', components: [] });
      }
      
      const MAX_TASKS_PER_PAGE = 10;
      const tasksToShow = jobList.slice(0, MAX_TASKS_PER_PAGE);
      const totalTasks = jobList.length;
      
      // Rebuild the embed.
      const embed = new EmbedBuilder()
        .setTitle('📋 Task List')
        .setDescription('Select a task from the dropdown below. (Message refreshes on selection)')
        .setColor(0x00AE86)
        .setTimestamp();
      
      tasksToShow.forEach(taskItem => {
        let assignment = (taskItem.assignees && taskItem.assignees.length > 0)
          ? taskItem.assignees.map(id => `<@${id}>`).join(', ')
          : 'Not assigned';
        embed.addFields({
          name: `Task #${taskItem.jobID}`,
          value: `${taskItem.description || 'No description available'}\nAssigned to: ${assignment}`,
          inline: false,
        });
      });
      
      if (totalTasks > MAX_TASKS_PER_PAGE) {
        embed.setFooter({ text: `Showing ${MAX_TASKS_PER_PAGE} of ${totalTasks} tasks. (Pagination not implemented)` });
      }
      
      // Rebuild the dropdown with all tasks.
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('tasklist')
        .setPlaceholder('Choose a task...')
        .addOptions(
          jobList.map(taskItem => ({
            label: `Task #${taskItem.jobID}`,
            description: taskItem.description && taskItem.description.length > 100
              ? taskItem.description.substring(0, 97) + '...'
              : taskItem.description || 'No description available',
            value: taskItem.jobID.toString()
          }))
        );
      
      const row = new ActionRowBuilder().addComponents(selectMenu);
      
      // Update the public task list message.
      return interaction.update({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error(`[ERROR] tasklist-handler: ${error}`);
      return interaction.reply({ content: `🚫 An error occurred: ${error.message || error}`, ephemeral: true });
    }
  },
};
