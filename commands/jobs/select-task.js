// File: tasklist.js

const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder 
  } = require('discord.js');
  const db = require('../../db');
  
  module.exports = {
    data: new SlashCommandBuilder()
      .setName('tasklist')
      .setDescription('View available tasks with assignment details.'),
    
    async execute(interaction) {
      // Log only when the command is run.
      console.log(`[INFO] User ${interaction.user.id} runs command /tasklist`);
      try {
        // Retrieve available tasks from your DB.
        const jobList = await db.getJobList();
        if (!jobList || jobList.length === 0) {
          return interaction.reply({ content: '🚫 No tasks available at this time.', ephemeral: true });
        }
  
        // For a fixed-size display, limit the number of tasks shown.
        const MAX_TASKS_PER_PAGE = 10;
        const tasksToShow = jobList.slice(0, MAX_TASKS_PER_PAGE);
        const totalTasks = jobList.length;
        
        // Build the embed.
        const embed = new EmbedBuilder()
          .setTitle('📋 Task List')
          .setDescription('Select a task from the dropdown below. (Message refreshes on selection)')
          .setColor(0x00AE86)
          .setTimestamp();
        
        tasksToShow.forEach(task => {
          // Show assignment status: list mentions if assigned; else “Not assigned”.
          let assignment = (task.assignees && task.assignees.length > 0)
            ? task.assignees.map(id => `<@${id}>`).join(', ')
            : 'Not assigned';
          embed.addFields({
            name: `Task #${task.jobID}`,
            value: `${task.description || 'No description available'}\nAssigned to: ${assignment}`,
            inline: false,
          });
        });
        
        if (totalTasks > MAX_TASKS_PER_PAGE) {
          embed.setFooter({ text: `Showing ${MAX_TASKS_PER_PAGE} of ${totalTasks} tasks. (Pagination not implemented)` });
        }
        
        // Create a dropdown with all tasks.
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('tasklist')
          .setPlaceholder('Choose a task...')
          .addOptions(
            jobList.map(task => ({
              label: `Task #${task.jobID}`,
              description: task.description && task.description.length > 100
                ? task.description.substring(0, 97) + '...'
                : task.description || 'No description available',
              value: task.jobID.toString()
            }))
          );
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        // Send the message publicly (without ephemeral flags).
        return interaction.reply({ embeds: [embed], components: [row] });
      } catch (error) {
        console.error(`[ERROR] /tasklist command: ${error}`);
        return interaction.reply({ content: `🚫 An error occurred: ${error.message || error}`, ephemeral: true });
      }
    },
  };
  