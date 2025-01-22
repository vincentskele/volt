// commands/help.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { currency } = require('../currency');

module.exports = {
  // Define the slash command for help
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Displays a list of available commands and their descriptions.'),

  /**
   * Execute function to handle both prefix and slash commands.
   * @param {string} commandType - 'slash' or the prefix command name.
   * @param {Message|CommandInteraction} messageOrInteraction - The message or interaction object.
   * @param {Array<string>} args - The arguments provided with the command.
   */
  async execute(commandType, messageOrInteraction, args) {
    if (commandType === 'slash') {
      await this.handleSlashCommand(messageOrInteraction);
    } else if (commandType === currency.helpCommand) {
      await this.handlePrefixCommand(messageOrInteraction);
    }
  },

  /**
   * Handle slash command interactions.
   * @param {CommandInteraction} interaction 
   */
  async handleSlashCommand(interaction) {
    try {
      const embed = this.getHelpEmbed();
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error handling /help command:', error);
      await interaction.reply({ content: '🚫 An error occurred while displaying the help message.', ephemeral: true });
    }
  },

  /**
   * Handle prefix help command.
   * @param {Message} message 
   */
  async handlePrefixCommand(message) {
    try {
      // Send the help message as an embed for consistency
      const embed = this.getHelpEmbed();
      await message.channel.send({ embeds: [embed] });
      return true;
    } catch (error) {
      console.error('Error sending help message:', error);
      try {
        await message.channel.send('🚫 An error occurred while displaying the help message.');
      } catch (err) {
        console.error('Failed to send fallback error message:', err);
      }
    }
  },

  /**
   * Generate the help embed message.
   * @returns {EmbedBuilder}
   */
  getHelpEmbed() {
    return new EmbedBuilder()
      .setTitle(`${currency.name.charAt(0).toUpperCase() + currency.name.slice(1)} Bot Commands`)
      .setDescription(`Here are the available commands for the ${currency.name} Bot. Use them with either the legacy prefix (e.g., \`${currency.prefix}command\`) or as slash commands (e.g., \`/command\`).`)
      .setColor(0x00AE86)
      .setTimestamp()
      .addFields(
        {
          name: '**Basic Economy**',
          value:
            `${currency.symbol} **$balance** [@user]: Shows wallet & bank for you or another user.\n` +
            `${currency.symbol} **$deposit <amount>**: Move money from wallet to bank.\n` +
            `${currency.symbol} **$withdraw <amount>**: Move money from bank to wallet.\n` +
            `${currency.symbol} **$rob @user**: Attempt to rob another user's wallet.`,
          inline: false,
        },
        {
          name: '**Admin Commands**',
          value:
            `${currency.symbol} **$bake** (Admin): Get 6969 in your wallet.\n` +
            `${currency.symbol} **$give-money @user <amount>**: Give wallet money to another user.\n` +
            `${currency.symbol} **$give-item @user <item name>**: Send 1 item to another user.\n` +
            `${currency.symbol} **$redeem <item name>**: Use/redeem an item in your inventory.`,
          inline: false,
        },
        {
          name: '**Shop & Inventory**',
          value:
            `🛍️ **$shop**: View items for sale.\n` +
            `🛍️ **$buy <item name>**: Purchase an item (from your wallet).\n` +
            `🛍️ **$inventory** (or **$inv**) [@user]: Show someone's items.\n` +
            `🛍️ **$add-item <price> <name> - <desc>** (Admin)\n` +
            `🛍️ **$remove-item <name>** (Admin)`,
          inline: false,
        },
        {
          name: '**Leaderboard & Admin System**',
          value:
            `${currency.symbol} **$leaderboard**: Shows top 10 total (wallet + bank).\n` +
            `${currency.symbol} **$add-admin @user**, **$remove-admin @user**, **$list-admins**`,
          inline: false,
        },
        {
          name: '**Jobs (multi-assignee, per-user completion)**',
          value:
            `🛠️ **$add-job <desc>** (Admin): Create a new job.\n` +
            `🛠️ **$joblist**: View all jobs & current assignees.\n` +
            `🛠️ **$work**: Assign yourself to a random job (multi-person).\n` +
            `🛠️ **$complete-job <@user> <jobID> <reward>** (Admin): Pays user for job completion.`,
          inline: false,
        },
        {
          name: '**Pet System**',
          value:
            `🐾 **$create-pet <name> <type>**: Create a pet (types: dragon, phoenix, griffin, unicorn).\n` +
            `🐾 **$pets** [@user]: View your or another user's pets.\n` +
            `🐾 **$battle <your pet> @user <their pet> <bet>**: Battle pets for ${currency.name} rewards!`,
          inline: false,
        },
        {
          name: '**Games**',
          value:
            `🎲 **$blackjack <bet>**: Start a blackjack game.\n` +
            `🎲 **$hit**: Draw another card in blackjack.\n` +
            `🎲 **$stand**: Stay with your current hand in blackjack.`,
          inline: false,
        }
      )
      .setFooter({ text: `Type /help or $${currency.helpCommand} for this help message again!` });
  },
};
