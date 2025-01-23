const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { PET_ART } = require('../constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('create-pet')
    .setDescription('Create a new pet.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The name of your pet')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('type')
        .setDescription('The type of pet')
        .setRequired(true)
        .addChoices(
          { name: 'Dragon', value: 'dragon' },
          { name: 'Phoenix', value: 'phoenix' },
          { name: 'Griffin', value: 'griffin' },
          { name: 'Unicorn', value: 'unicorn' }
        )),

  async execute(interaction) {
    const name = interaction.options.getString('name');
    const type = interaction.options.getString('type').toLowerCase();

    const validTypes = Object.keys(PET_ART);
    if (!validTypes.includes(type)) {
      return interaction.reply({ content: `🚫 Invalid pet type. Choose from: ${validTypes.join(', ')}`, ephemeral: true });
    }

    try {
      await db.createPet(interaction.user.id, name, type);

      const embed = new EmbedBuilder()
        .setTitle(`🎉 Congratulations on your new ${type}!`)
        .setDescription(`**Name:** ${name}\n**Type:** ${type.charAt(0).toUpperCase() + type.slice(1)}`)
        .setColor(0x00AE86)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      if (err.toString().includes('UNIQUE')) {
        return interaction.reply({ content: '🚫 You already have a pet with that name!', ephemeral: true });
      }
      console.error('Create Pet Command Error:', err);
      return interaction.reply({ content: `🚫 Failed to create pet: ${err.message || err}`, ephemeral: true });
    }
  }
};
