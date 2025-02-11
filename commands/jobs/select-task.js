// File: select-task.js

const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    MessageFlags 
  } = require('discord.js');
  const db = require('../../db');
  
  module.exports = {
    data: new SlashCommandBuilder()
      .setName('select-task')
      .setDescription('Choose a specific job from the available list.'),
    
    async execute(interaction) {
      // Log only when the command is run.
      console.log(`[INFO] User ${interaction.user.id} runs command /select-task`);
      try {
        const userID = interaction.user.id;
  
        // Check if the user already has a job.
        const existingJob = await db.getUserJob(userID);
        if (existingJob) {
          const embed = new EmbedBuilder()
            .setTitle('🛠️ You Already Have a Job')
            .setDescription(`Your current job: **${existingJob}**`)
            .setColor(0xFFA500)
            .setTimestamp();
          return interaction.reply({ embeds: [embed], flags: MessageFlags.EPHEMERAL });
        }
  
        // Retrieve available jobs.
        const jobList = await db.getJobList();
        if (!jobList || jobList.length === 0) {
          return interaction.reply({
            content: '🚫 No jobs available at this time.',
            flags: MessageFlags.EPHEMERAL,
          });
        }
  
        // Build an embed listing available jobs.
        const embed = new EmbedBuilder()
          .setTitle('📋 Available Jobs')
          .setDescription('Select a job from the dropdown menu below.')
          .setColor(0x00AE86)
          .setTimestamp();
        
        jobList.forEach((job) => {
          embed.addFields({
            name: `Job #${job.jobID}`,
            value: job.description || 'No description available',
            inline: false,
          });
        });
  
        // Create a dropdown (select menu) for available jobs.
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select-task')
          .setPlaceholder('Choose a job...')
          .addOptions(
            jobList.map((job) => ({
              label: `Job #${job.jobID}`,
              description: job.description && job.description.length > 100
                ? job.description.substring(0, 97) + '...'
                : job.description || 'No description available',
              value: job.jobID.toString(),
            }))
          );
  
        const row = new ActionRowBuilder().addComponents(selectMenu);
        return interaction.reply({
          embeds: [embed],
          components: [row],
          flags: MessageFlags.EPHEMERAL,
        });
      } catch (error) {
        console.error(`[ERROR] /select-task command: ${error}`);
        return interaction.reply({
          content: `🚫 An error occurred: ${error.message || error}`,
          flags: MessageFlags.EPHEMERAL,
        });
      }
    },
  };
  