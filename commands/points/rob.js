const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');
const { formatCurrency } = require('../../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rob') // Command name
    .setDescription('Attempt to rob another user.') // Command description
    .addUserOption(option =>
      option.setName('user') // User to rob
        .setDescription('The user to rob')
        .setRequired(true)),
  
  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');

    // Prevent self-robbery
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ 
        content: '🚫 You cannot rob yourself!', 
        ephemeral: true 
      });
    }

    try {
      // Attempt the robbery
      const result = await db.robUser(interaction.user.id, targetUser.id);

      // Handle robbery outcomes
      if (!result.success) {
        return interaction.reply({ 
          content: `🚫 Rob attempt failed: ${result.message}`, 
          ephemeral: true 
        });
      }

      // Successful robbery
      if (result.outcome === 'success') {
        return interaction.reply(
          `💰 You successfully robbed <@${targetUser.id}> and stole **${formatCurrency(result.amountStolen)}**!`
        );
      }

      // Failed robbery with penalty
      if (result.outcome === 'fail') {
        return interaction.reply(
          `👮 Your robbery failed! You were caught and paid **${formatCurrency(result.penalty)}** to <@${targetUser.id}>.`
        );
      }

      // Handle unexpected outcomes
      return interaction.reply({ 
        content: '🚫 An unexpected error occurred during the robbery.', 
        ephemeral: true 
      });

    } catch (err) {
      console.error(`Error in /rob command:`, err);

      // Handle errors gracefully
      return interaction.reply({ 
        content: `🚫 Rob failed due to an internal error: ${err.message || err}`, 
        ephemeral: true 
      });
    }
  }
};
