const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../../db');
const { PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-admin')
    .setDescription('Add a user as a bot admin.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to add as admin')
        .setRequired(true)),

  async execute(interaction) {
    try {
      const member = interaction.member;

      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '🚫 Only server administrators can add bot admins.', ephemeral: true });
      }

      const targetUser = interaction.options.getUser('user');

      if (!targetUser) {
        return interaction.reply({ content: '🚫 Could not find the specified user.', ephemeral: true });
      }

      await db.addAdmin(targetUser.id);
      return interaction.reply(`✅ Successfully added <@${targetUser.id}> as a bot admin.`);
    } catch (err) {
      console.error(`Error in add-admin command: ${err}`);
      return interaction.reply({ content: '🚫 Failed to add admin. Please try again later.', ephemeral: true });
    }
  }
};
