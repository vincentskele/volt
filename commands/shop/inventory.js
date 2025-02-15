const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View your or another user\'s inventory.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to view inventory of')
        .setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    try {
      const inventory = await db.getInventory(targetUser.id);
      if (!inventory.length) {
        return interaction.reply({ content: `${targetUser.username} has an empty inventory.`, ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🎒 ${targetUser.username}'s Inventory`)
        .setColor(0x00BFFF)
        .setTimestamp();

      inventory.forEach(item => {
          embed.addFields({            name: `• ${item.name}`,
          value: `**Quantity:** ${item.quantity}\n**Description:** ${item.description || 'No description available'}`,
          inline: false,
        });
      });        

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('View Inventory Error:', err);
      return interaction.reply({ content: `🚫 Inventory error: ${err.message || err}`, ephemeral: true });
    }
  },
};
