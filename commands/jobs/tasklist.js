const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
const db = require('../../db');

const TASKS_PER_PAGE = 8;

module.exports = {
  data: new SlashCommandBuilder()
      .setName('tasklist')
      .setDescription('View available tasks with assignment details.'),
  
  async execute(interaction) {
      console.log(`[INFO] User ${interaction.user.id} runs command /tasklist`);
      try {
          const jobList = await db.getJobList();
          if (!jobList || jobList.length === 0) {
              return interaction.reply({ content: '🚫 No tasks available at this time.', ephemeral: true });
          }

          let page = 0;
          await interaction.deferReply();
          
          const generateEmbed = (page) => {
              const start = page * TASKS_PER_PAGE;
              const tasksToShow = jobList.slice(start, start + TASKS_PER_PAGE);
              
              const embed = new EmbedBuilder()
                  .setTitle('📋 Task List')
                  .setDescription(`Showing tasks ${start + 1}-${start + tasksToShow.length} of ${jobList.length}`)
                  .setColor(0x00AE86)
                  .setTimestamp();
              
              tasksToShow.forEach(task => {
                  let assignment = (task.assignees && task.assignees.length > 0)
                      ? task.assignees.map(id => `<@${id}>`).join(', ')
                      : 'Not assigned';
                  embed.addFields({
                      name: `Task #${task.jobID}`,
                      value: `${task.description || 'No description available'}\n**Assigned to:** ${assignment}`,
                      inline: false,
                  });
              });
              return embed;
          };

          const generateComponents = (page) => {
              const selectMenu = new StringSelectMenuBuilder()
                  .setCustomId('tasklist')
                  .setPlaceholder('Choose a task...')
                  .addOptions(
                      jobList.slice(page * TASKS_PER_PAGE, (page + 1) * TASKS_PER_PAGE).map(task => ({
                          label: `Task #${task.jobID}`,
                          description: task.description && task.description.length > 100
                              ? task.description.substring(0, 97) + '...'
                              : task.description || 'No description available',
                          value: task.jobID.toString()
                      }))
                  );
              
              const buttonRow = new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                      .setCustomId('prev_page')
                      .setLabel('◀️ Back')
                      .setStyle(ButtonStyle.Primary)
                      .setDisabled(page === 0),
                  new ButtonBuilder()
                      .setCustomId('next_page')
                      .setLabel('Next ▶️')
                      .setStyle(ButtonStyle.Primary)
                      .setDisabled((page + 1) * TASKS_PER_PAGE >= jobList.length)
              );
              
              return [new ActionRowBuilder().addComponents(selectMenu), buttonRow];
          };

          const message = await interaction.editReply({
              embeds: [generateEmbed(page)],
              components: generateComponents(page)
          });
          
          const collector = message.createMessageComponentCollector({ time: 60000 });
          
          collector.on('collect', async i => {
              if (i.customId === 'prev_page') page--;
              if (i.customId === 'next_page') page++;
              await i.deferUpdate();
              await interaction.editReply({
                  embeds: [generateEmbed(page)],
                  components: generateComponents(page)
              });
          });
      } catch (error) {
          console.error(`[ERROR] /tasklist command: ${error}`);
          return interaction.editReply({ content: `🚫 An error occurred: ${error.message || error}` });
      }
  },
};
