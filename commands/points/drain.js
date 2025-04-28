const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');
const { formatCurrency } = require('../../points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('drain')
    .setDescription("Attempt to drain another Solarian's Volts (Be careful you might get shocked!)")
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The Solarian to drain')
        .setRequired(true)),
  
  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');

    // Prevent self-drain
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ 
        content: '🚫 You cannot drain yourself!', 
        ephemeral: true 
      });
    }

    try {
      // Fetch the attacker's balance
      const attackerBalance = await db.getUserBalance(interaction.user.id);

      // Block if attacker has less than 1 Volt
      if (!attackerBalance || attackerBalance < 1) {
        return interaction.reply({ 
          content: '🚫 You must have at least 1 Volt to attempt a drain!', 
          ephemeral: true 
        });
      }

      // Attempt the drain
      const result = await db.robUser(interaction.user.id, targetUser.id);

      if (!result.success) {
        return interaction.reply({ 
          content: `🚫 Drain attempt failed: ${result.message}`, 
          ephemeral: true 
        });
      }

      if (result.outcome === 'success') {
        return interaction.reply(
          `⚡⚡⚡ You successfully drained <@${targetUser.id}> and stole **${formatCurrency(result.amountStolen)}**!`
        );
      }

      if (result.outcome === 'fail') {
        return interaction.reply(
          `⚡⚡ZAPPED⚡⚡ You got shocked! You lost **${formatCurrency(result.penalty)}** to <@${targetUser.id}>.`
        );
      }

      return interaction.reply({ 
        content: '🚫 An unexpected error occurred during the drain.', 
        ephemeral: true 
      });

    } catch (err) {
      console.error(`Error in /drain command:`, err);

      return interaction.reply({ 
        content: `🚫 Drain failed due to an internal error: ${err.message || err}`, 
        ephemeral: true 
      });
    }
  }
};
