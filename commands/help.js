const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

const currency = {
  name: 'Bot',
  prefix: '$',
  symbol: '💰',
  helpCommand: 'help',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Displays a list of available commands and their descriptions.'),

  async execute(interaction) {
    try {
      const embed = new EmbedBuilder()
        .setTitle(`${currency.name} Bot Commands`)
        .setDescription(
          `Here are the available commands for the ${currency.name} Bot.\n` +
          `You can use these commands with either:\n` +
          `- The legacy prefix: \`${currency.prefix}command\`\n` +
          `- Slash commands: \`/command\``
        )
        .setColor(0x00AE86)
        .addFields(
          {
            name: '**Basic Economy**',
            value:
              `${currency.symbol} **balance** [@user]: Check wallet & bank balances.\n` +
              `${currency.symbol} **deposit <amount>**: Deposit money into your bank.\n` +
              `${currency.symbol} **withdraw <amount>**: Withdraw money from your bank.`,
            inline: false,
          },
          {
            name: '**Games**',
            value:
              `🎲 **blackjack <bet>**: Start a blackjack game.\n` +
              `🎲 **hit**: Draw another card in blackjack.\n` +
              `🎲 **stand**: Keep your current hand in blackjack.`,
            inline: false,
          },
          {
            name: '**Shop & Inventory**',
            value:
              `🛍️ **shop**: View items for sale.\n` +
              `🛍️ **buy <item name>**: Purchase an item from the shop.\n` +
              `🛍️ **inventory** (or **inv**) [@user]: View your or another user's inventory.`,
            inline: false,
          },
          {
            name: '**Admin Commands**',
            value:
              `${currency.symbol} **give-money @user <amount>**: Transfer wallet money to another user.\n` +
              `${currency.symbol} **add-item <price> <name> - <desc>** (Admin): Add a shop item.`,
            inline: false,
          }
        )
        .setFooter({ text: `Type /help or ${currency.prefix}${currency.helpCommand} for this message again!` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error handling /help command:', error);
      await interaction.reply({ content: '🚫 An error occurred while displaying the help message.', ephemeral: true });
    }
  },
};
