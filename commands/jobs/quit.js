const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');
const { formatCurrency } = require('../../currency'); // Import currency module

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quit')
    .setDescription('Quit your active job without receiving a reward.'),

  async execute(interaction) {
    const { user } = interaction;

    try {
      // Get the user's active job
      const activeJob = await db.getActiveJob(user.id);
      if (!activeJob) {
        return interaction.reply({ content: `🚫 You do not have an active job to quit.`, ephemeral: true });
      }

      // Quit the job (same as completing with reward 0)
      const result = await db.completeJob(user.id, 0);
      if (!result.success) {
        return interaction.reply({ content: `🚫 Failed to quit your job.`, ephemeral: true });
      }

      return interaction.reply(
        `😆 OOOHHH NICE TRY, BUT JOB INCOMPLETE! <@${user.id}> didn't get any reward!`
      );
    } catch (err) {
      console.error('Quit Job Slash Error:', err);
      return interaction.reply({ content: `🚫 Quit job failed: ${err.message || err}`, ephemeral: true });
    }
  },
};
