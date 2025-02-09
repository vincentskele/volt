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

    let giveawayList = '**Active Giveaways: Click to go to message and then react to enter.**\n\n';

    for (const [index, giveaway] of activeGiveaways.entries()) {
      const currentTime = Date.now();
      let remainingTime = giveaway.end_time - currentTime;
      let timeDisplay = '';

      console.log('[DEBUG] Giveaway details:', giveaway);

      if (remainingTime <= 0) {
        timeDisplay = 'Expired';
      } else {
        const days = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
        const hours = Math.floor((remainingTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));

        if (days > 0) {
          timeDisplay = `${days}d ${hours > 0 ? hours + 'h ' : ''}${minutes}m`;
        } else if (hours > 0) {
          timeDisplay = `${hours}h ${minutes}m`;
        } else {
          timeDisplay = `${minutes}m`;
        }
      }

      // Handle repeat count
      const repeatCount = parseInt(giveaway.repeat ?? giveaway.repeats ?? giveaway.repeat_count ?? 0, 10);
      const repeatText = repeatCount > 0
        ? `(Repeats ${repeatCount} more time${repeatCount === 1 ? '' : 's'})`
        : '';

      // Check if user has entered the giveaway
      let hasEntered = false;
      try {
        const entries = await getGiveawayEntries(giveaway.id);
        hasEntered = entries.includes(interaction.user.id);
      } catch (err) {
        console.error(`Error checking giveaway entries: ${err.message}`);
      }

      // Include giveaway name
      giveawayList += `**${index + 1}.** 🎉 **${giveaway.giveaway_name || 'Unnamed Giveaway'}**\n` +
        `[**Click Here to Enter**](https://discord.com/channels/${interaction.guildId}/${giveaway.channel_id}/${giveaway.message_id})\n` +
        `> **Prize:** ${giveaway.prize || 'Unknown'}\n` +
        `> **Winners:** ${giveaway.winners || 'Unknown'}\n` +
        `> **Time Remaining:** ${timeDisplay} ${repeatText}\n` +
        `> **Entered:** ${hasEntered ? '✅ Yes' : '❌ No'}\n\n`;
    }

    interaction.reply({ content: giveawayList.trim(), ephemeral: false });
  },
};
