const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder 
} = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quests')
    .setDescription('View available quests with details.'),
  
  async execute(interaction) {
    console.log(`[INFO] User ${interaction.user.id} runs command /quests`);
    try {
      const jobList = await db.getJobList();
      if (!jobList || jobList.length === 0) {
        return interaction.reply({ content: '🚫 No quests available at this time.', ephemeral: true });
      }

      const questsToShow = jobList.slice(0, 25);
      const embed = new EmbedBuilder()
        .setTitle('📋 Quest List')
        .setDescription('Select a quest to view its details. You will confirm before it is assigned.')
        .setColor(0x00AE86)
        .setTimestamp();

      if (jobList.length > questsToShow.length) {
        embed.setFooter({ text: `Showing the first ${questsToShow.length} of ${jobList.length} quests.` });
      }
      
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('questlist')  // Ensure the handler listens for this ID
        .setPlaceholder('Choose a quest...')
        .addOptions(
          questsToShow.map(task => ({
            label: `Quest #${task.jobID}`,
            description: task.description && task.description.length > 100
              ? task.description.substring(0, 97) + '...'
              : task.description || 'No description available',
            value: `quest_${task.jobID}`  // Ensure a unique identifier is set
          }))
        );
      
      const row = new ActionRowBuilder().addComponents(selectMenu);
      
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    } catch (error) {
      console.error(`[ERROR] /quests command: ${error}`);
      return interaction.reply({ content: `🚫 An error occurred: ${error.message || error}`, ephemeral: true });
    }
  },
};
