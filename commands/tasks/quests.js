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

      const embed = new EmbedBuilder()
        .setTitle('📋 Quest List')
        .setDescription('Select a quest from the dropdown below. (Message refreshes on selection)')
        .setColor(0x00AE86)
        .setTimestamp();
      
      jobList.forEach(task => {
        let assignment = (task.assignees && task.assignees.length > 0)
          ? task.assignees.map(id => `<@${id}>`).join(', ')
          : 'Not assigned';
        embed.addFields({
          name: `Quest #${task.jobID}`,
          value: `${task.description || 'No description available'}\nAssigned to: ${assignment}`,
          inline: false,
        });
      });
      
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('questlist')  // Ensure the handler listens for this ID
        .setPlaceholder('Choose a quest...')
        .addOptions(
          jobList.map(task => ({
            label: `Quest #${task.jobID}`,
            description: task.description && task.description.length > 100
              ? task.description.substring(0, 97) + '...'
              : task.description || 'No description available',
            value: `quest_${task.jobID}`  // Ensure a unique identifier is set
          }))
        );
      
      const row = new ActionRowBuilder().addComponents(selectMenu);
      
      return interaction.reply({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error(`[ERROR] /quests command: ${error}`);
      return interaction.reply({ content: `🚫 An error occurred: ${error.message || error}`, ephemeral: true });
    }
  },
};

// Ensure you have an interaction handler for the select menu
module.exports.selectMenuHandler = async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  
  if (interaction.customId === 'questlist') { // Ensure this matches the updated ID
    const selectedQuestId = interaction.values[0].replace('quest_', '');
    
    // Fetch quest details from the database (or cache)
    const jobList = await db.getJobList();
    const selectedQuest = jobList.find(task => task.jobID.toString() === selectedQuestId);

    if (!selectedQuest) {
      return interaction.reply({ content: '🚫 Selected quest not found.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📜 Quest #${selectedQuest.jobID}`)
      .setDescription(selectedQuest.description || 'No description available')
      .addFields({ name: 'Assigned to:', value: selectedQuest.assignees.length > 0 ? selectedQuest.assignees.map(id => `<@${id}>`).join(', ') : 'Not assigned' })
      .setColor(0x00AE86)
      .setTimestamp();

    return interaction.update({ embeds: [embed] });
  }
};
