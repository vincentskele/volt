const { SlashCommandBuilder } = require('discord.js');
const { getActiveGiveaways, getGiveawayEntries } = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('List all active giveaways and show if you have entered.'),

  async execute(interaction) {
    const activeGiveaways = await getActiveGiveaways();

    if (!activeGiveaways.length) {
      return interaction.reply({ content: '🚫 No active giveaways at the moment.', ephemeral: true });
    }

    let giveawayList = '**🎉 Active Giveaways:**\n\n';

    for (const [index, giveaway] of activeGiveaways.entries()) {
      const currentTime = Date.now();
      let remainingTime = giveaway.end_time - currentTime;
      let timeDisplay = remainingTime <= 0 ? 'Expired' : formatTime(remainingTime);

      // Handle repeat count
      const repeatCount = parseInt(giveaway.repeat ?? giveaway.repeats ?? giveaway.repeat_count ?? 0, 10);
      const repeatText = repeatCount > 0 ? `(Repeats ${repeatCount} more time${repeatCount === 1 ? '' : 's'})` : '';

      // ✅ Fetch entries from the database (Discord + Website signups)
      let hasEntered = false;
      try {
        const entries = await getGiveawayEntries(giveaway.id);
        hasEntered = entries.includes(interaction.user.id);
      } catch (err) {
        console.error(`❌ Error fetching giveaway entries for ${giveaway.id}:`, err);
      }

      // ✅ Construct giveaway message
      giveawayList += `**${index + 1}.** 🎉 **${giveaway.giveaway_name || 'Unnamed Giveaway'}**\n` +
        `[**Click Here and React to Enter**](https://discord.com/channels/${interaction.guildId}/${giveaway.channel_id}/${giveaway.message_id})\n` +
        `> **Prize:** ${isNaN(giveaway.prize) ? giveaway.prize || 'Unknown' : `${giveaway.prize} Volts`}\n` +
        `> **Winners:** ${giveaway.winners || 'Unknown'}\n` +
        `> **Time Remaining:** ${timeDisplay} ${repeatText}\n` +
        `> **Entered:** ${hasEntered ? '✅ Yes' : '❌ No'}\n\n`;
    }

    interaction.reply({ content: giveawayList.trim(), ephemeral: false });
  },
};

/**
 * Formats remaining time in days, hours, and minutes.
 * @param {number} ms - Remaining time in milliseconds.
 * @returns {string} Formatted time.
 */
function formatTime(ms) {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours > 0 ? hours + 'h ' : ''}${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
