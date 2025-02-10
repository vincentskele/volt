const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');
const { formatCurrency } = require('../../currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('drain') // Command name
    .setDescription('Attempt to drain another Solarian.') // Command description
    .addUserOption(option =>
      option.setName('user') // User to drain
        .setDescription('The Solarian to drain')
        .setRequired(true)),
  
  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');

    // Prevent self-robbery
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ 
        content: '🚫 You cannot drain yourself!', 
        ephemeral: true 
      });
    }

    try {
      // Attempt the robbery
      const result = await db.robUser(interaction.user.id, targetUser.id);

      // Handle robbery outcomes
      if (!result.success) {
        return interaction.reply({ 
          content: `🚫 Drain attempt failed: ${result.message}`, 
          ephemeral: true 
        });
      }

      // Successful robbery
      if (result.outcome === 'success') {
        return interaction.reply(
          `⚡⚡⚡ You successfully drained <@${targetUser.id}> and drained **${formatCurrency(result.amountStolen)}**!`
        );
      }

      // Failed robbery with penalty
      if (result.outcome === 'fail') {
        return interaction.reply(
          `⚡⚡ZAPPEP⚡⚡ Your drain failed! You drained yourself and lost **${formatCurrency(result.penalty)}** to <@${targetUser.id}>.`
        );
      }

      // Handle unexpected outcomes
      return interaction.reply({ 
        content: '🚫 An unexpected error occurred during the drain.', 
        ephemeral: true 
      });

    } catch (err) {
      console.error(`Error in /drain command:`, err);

      // Handle errors gracefully
      return interaction.reply({ 
        content: `🚫 Drain failed due to an internal error: ${err.message || err}`, 
        ephemeral: true 
      });
    }
  }
};
