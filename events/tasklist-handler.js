const { Events, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  name: 'interactionCreate', // Must match the Discord event name exactly.
  async execute(interaction) {
    // Process only select menu interactions with customId "questlist"
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'questlist') return;
    
    try {
      const userID = interaction.user.id;
      
      // Check if the user already has a quest.
      const existingJob = await db.getUserJob(userID);
      if (existingJob) {
        return interaction.reply({ content: '🚫 You already have a quest!', ephemeral: true });
      }
      
      // Get the selected quest ID from the dropdown.
      const selectedQuestID = interaction.values[0];
      
      // Attempt to assign the quest.
      const quest = await db.assignJobById(userID, selectedQuestID);
      if (!quest) {
        return interaction.reply({ content: `🚫 Failed to assign quest with ID ${selectedQuestID}`, ephemeral: true });
      }
      
      // Log and announce in the channel.
      console.log(`[INFO] User ${userID} assigned quest ${quest.description}`);
      await interaction.channel.send(
        `✅ Quest assigned: <@${userID}> is now assigned to **${quest.description}** (Quest #${quest.jobID}).`
      );
      
      // Re-fetch the updated quest list.
      const jobList = await db.getJobList();
      if (!jobList || jobList.length === 0) {
        return interaction.update({ content: '🚫 No quests available at this time.', components: [] });
      }
      
      const MAX_QUESTS_PER_PAGE = 10;
      const questsToShow = jobList.slice(0, MAX_QUESTS_PER_PAGE);
      const totalQuests = jobList.length;
      
      // Rebuild the embed.
      const embed = new EmbedBuilder()
        .setTitle('📋 Quest List')
        .setDescription('Select a quest from the dropdown below. (Message refreshes on selection)')
        .setColor(0x00AE86)
        .setTimestamp();
      
      questsToShow.forEach(questItem => {
        let assignment = (questItem.assignees && questItem.assignees.length > 0)
          ? questItem.assignees.map(id => `<@${id}>`).join(', ')
          : 'Not assigned';
        embed.addFields({
          name: `Quest #${questItem.jobID}`,
          value: `${questItem.description || 'No description available'}\nAssigned to: ${assignment}`,
          inline: false,
        });
      });
      
      if (totalQuests > MAX_QUESTS_PER_PAGE) {
        embed.setFooter({ text: `Showing ${MAX_QUESTS_PER_PAGE} of ${totalQuests} quests. (Pagination not implemented)` });
      }
      
      // Rebuild the dropdown with all quests.
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('questlist')  // Make sure this matches the one in `/quests` command
        .setPlaceholder('Choose a quest...')
        .addOptions(
          jobList.map(questItem => ({
            label: `Quest #${questItem.jobID}`,
            description: questItem.description && questItem.description.length > 100
              ? questItem.description.substring(0, 97) + '...'
              : questItem.description || 'No description available',
            value: questItem.jobID.toString()
          }))
        );
      
      const row = new ActionRowBuilder().addComponents(selectMenu);
      
      // Update the public quest list message.
      return interaction.update({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error(`[ERROR] questlist-handler: ${error}`);
      return interaction.reply({ content: `🚫 An error occurred: ${error.message || error}`, ephemeral: true });
    }
  },
};
