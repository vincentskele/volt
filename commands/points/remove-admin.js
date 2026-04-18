const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');
const { PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-admin')
    .setDescription('Remove a user from bot admins.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to remove from admins')
        .setRequired(true)),
  
  async execute(interaction) {
    const member = interaction.member;
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only server administrators can remove bot admins.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    try {
      await db.removeAdmin(targetUser.id, {
        actorUserId: interaction.user.id,
        source: 'discord_remove_admin',
      });
      return interaction.reply(`✅ Successfully removed <@${targetUser.id}> from bot admins.`);
    } catch (err) {
      return interaction.reply({ content: `🚫 Failed to remove admin: ${err}`, ephemeral: true });
    }
  }
};
