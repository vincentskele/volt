const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { PET_ART } = require('../constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pets')
    .setDescription('View your or another user\'s pets.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to view pets of')
        .setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    try {
      const pets = await db.getUserPets(targetUser.id);
      if (!pets.length) {
        return interaction.reply({
          content: `${targetUser.username} has no pets yet! Use \`/create-pet\` to get one.`,
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🐾 ${targetUser.username}'s Pets`)
        .setColor(0x00AE86)
        .setTimestamp();

      pets.forEach(pet => {
        embed.addFields({
          name: `• ${pet.name} (${pet.type.charAt(0).toUpperCase() + pet.type.slice(1)})`,
          value: `Level: ${pet.level} | XP: ${pet.exp}/100\nRecord: ${pet.wins}W - ${pet.losses}L`,
          inline: false
        });
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Pets Command Error:', err);
      return interaction.reply({ content: `🚫 Failed to get pets: ${err.message || err}`, ephemeral: true });
    }
  }
};
