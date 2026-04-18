const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

const volt = {
  name: 'Bot',
  prefix: '$',
  symbol: '⚡',
  helpCommand: 'help',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Displays a list of available commands and their descriptions.'),

  async execute(interaction) {
    try {
      const embed = new EmbedBuilder()
        .setTitle(`Volt Bot Commands`)
        .setDescription(
          `Here are the available commands.\n` +
          `You can use them with slash commands: \`/command\``
        )
        .setColor(0x00AE86)
        .addFields(
          {
            name: '**Volt System**',
            value:
              `⚡ **volts** [@user]: Check Solarians Volts.\n` +
              `⚡ **leaderboard**: Shows top 10 most charged Solarians.\n` +
              `⚡ **give** [@user]: transfers Volts to a user.\n` +
              `⚡ **deposit / withdraw**: Legacy commands now that Volt balances are unified.`,
            inline: false,
          },
          {
            name: '**Shop & Inventory**',
            value:
              `🛍️ **shop**: View items for sale.\n` +
              `🛍️ **buy <item name>**: Purchase an item from the shop.\n` +
              `🛍️ **use <item name>**: Use an item from your inventory.\n` +
              `🛍️ **inventory** [@user]: View your or another user's inventory.`,
            inline: false,
          },
          {
            name: '**Jobs and Giveaway**',
            value:
              `💼 **work**: Get assigned a random task from the joblist.\n` +
              `💼 **tasklist**: Show the current list of jobs with asignees.\n` +
              `🛍️ **giveaway**: View the list of giveaways and see which ones youre entered in.`,
            inline: false,
          },
          {
            name: '**Admin Commands**',
            value:
              `💻🔑 **giveaway-create <name> <duration> <time unit> <winners> <prize> <repeat #>**: Create a new giveaway.\n` +
              `💻🔑 **add-task <description>**: Add to the task list.\n` +
              `💻🔑 **remove-task <JobID>**: Remove from the task list.\n` +
              `💻🔑 **complete-task @user <amount>**: Mark users task as complete and gives Volts.\n` +
              `💻🔑 **remove-item <name>**: Remove shop item.\n` +
              `💻🔑 **add-item <price> <name> - <desc>**: Add a shop item.`,
            inline: false,
          }
        )
        .setFooter({ text: `Type /help for this message again!` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error handling /help command:', error);
      await interaction.reply({ content: '🚫 An error occurred while displaying the help message.', ephemeral: true });
    }
  },
};
