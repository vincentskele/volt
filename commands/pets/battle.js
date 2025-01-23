const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { currency, formatCurrency } = require('../../currency');
const { PET_ART } = require('../constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('battle')
    .setDescription('Battle your pet against another user\'s pet.')
    .addStringOption(option =>
      option.setName('your_pet')
        .setDescription('Your pet\'s name')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('opponent')
        .setDescription('The user you want to battle')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('their_pet')
        .setDescription('Opponent\'s pet\'s name')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription(`The amount of ${currency.symbol} to bet`)
        .setRequired(true)),

  async execute(interaction) {
    const yourPetName = interaction.options.getString('your_pet');
    const opponent = interaction.options.getUser('opponent');
    const theirPetName = interaction.options.getString('their_pet');
    const bet = interaction.options.getInteger('bet');

    if (opponent.id === interaction.user.id) {
      return interaction.reply({ content: '🚫 You cannot battle yourself!', ephemeral: true });
    }

    if (bet <= 0) {
      return interaction.reply({ content: '🚫 Please specify a positive bet amount.', ephemeral: true });
    }

    try {
      const [pet1, pet2] = await Promise.all([
        db.getPet(interaction.user.id, yourPetName),
        db.getPet(opponent.id, theirPetName)
      ]);

      if (!pet1) {
        return interaction.reply({ content: `🚫 You don\'t have a pet named "${yourPetName}"`, ephemeral: true });
      }

      if (!pet2) {
        return interaction.reply({ content: `🚫 ${opponent.username} doesn\'t have a pet named "${theirPetName}"`, ephemeral: true });
      }

      const result = await db.battlePets(pet1.petID, pet2.petID, bet);
      const winner = result.winner;
      const loser = result.loser;

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Battle Results ⚔️')
        .addFields(
          { name: '**Winner:**', value: `${winner.name} (${winner.type.charAt(0).toUpperCase() + winner.type.slice(1)})`, inline: true },
          { name: '**Loser:**', value: `${loser.name} (${loser.type.charAt(0).toUpperCase() + loser.type.slice(1)})`, inline: true },
          { name: '**Power:**', value: `${Math.floor(result.winnerPower)} vs ${Math.floor(result.loserPower)}`, inline: true },
          { name: '**Reward:**', value: `${formatCurrency(bet * 2)} 🍕`, inline: false },
          { name: '**New Record:**', value: 
            `${winner.name}: ${winner.wins + 1}W - ${winner.losses}L\n` +
            `${loser.name}: ${loser.wins}W - ${loser.losses + 1}L`, inline: false }
        )
        .setColor(0xFF0000)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Battle Command Error:', err);
      return interaction.reply({ content: `🚫 Battle failed: ${err.message || err}`, ephemeral: true });
    }
  }
};
