// commands/giveaway-list.js
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
      // Use the correct property name (end_time) from the DB.
      const remainingTime = giveaway.end_time - Date.now();
      let timeDisplay = '';

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

      // Check persistent state for giveaway entries using the giveaway id.
      let hasEntered = false;
      try {
        const entries = await getGiveawayEntries(giveaway.id);
        hasEntered = entries.includes(interaction.user.id);
      } catch (err) {
        console.error(`Error checking giveaway entries: ${err.message}`);
      }

      giveawayList += `**${index + 1}.** [🎉 **Click Here**](https://discord.com/channels/${interaction.guildId}/${giveaway.channel_id}/${giveaway.message_id})\n` +
        `> **Prize:** ${giveaway.prize || 'Unknown'}\n` +
        `> **Winners:** ${giveaway.winners || 'Unknown'}\n` +
        `> **Time Remaining:** ${timeDisplay}\n` +
        `> **Entered:** ${hasEntered ? '✅ Yes' : '❌ No'}\n\n`;
    }

    interaction.reply({ content: giveawayList.trim(), ephemeral: false });
  },
};
