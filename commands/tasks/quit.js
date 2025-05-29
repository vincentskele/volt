const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');
const { formatCurrency } = require('../../points'); // Import points module

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quit')
    .setDescription('Quit your active Quest without receiving a reward.'),

  async execute(interaction) {
    const { user } = interaction;

    try {
      // Get the user's active Quest
      const activeJob = await db.getActiveJob(user.id);
      if (!activeJob) {
        return interaction.reply({ content: `🚫 You do not have an active Quest to quit.`, ephemeral: true });
      }

      // Quit the Quest (same as completing with reward 0)
      const result = await db.completeJob(user.id, 0);
      if (!result.success) {
        return interaction.reply({ content: `🚫 Failed to quit your Quest.`, ephemeral: true });
      }

      return interaction.reply(
        `😆 OOOHHH NICE TRY, BUT Quest INCOMPLETE! <@${user.id}> didn't get any reward!`
      );
    } catch (err) {
      console.error('Quit Quest Slash Error:', err);
      return interaction.reply({ content: `🚫 Quit Quest failed: ${err.message || err}`, ephemeral: true });
    }
  },
};
