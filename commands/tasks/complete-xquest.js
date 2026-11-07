const {
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const db = require('../../db');
const { formatCurrency } = require('../../points');

const MODAL_PREFIX = 'complete-xquest';
const QUEST_LOG_CHANNEL_ID = process.env.QUEST_SUBMISSION_CHANNEL_ID || process.env.SUBMISSION_CHANNEL_ID;

async function ensureAdmin(interaction) {
  const botAdmins = await db.getAdmins();
  const isServerAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
  return isServerAdmin || botAdmins.includes(interaction.user.id);
}

function formatSubmissionSummary(submissions) {
  const summary = submissions.map((submission, index) => [
    `${index + 1}. ${submission.action}`,
    submission.tweet_url,
  ].join('\n')).join('\n\n');

  return summary.length <= 3900
    ? summary
    : `${summary.slice(0, 3860)}\n\n…additional submissions omitted`;
}

async function showCompletionModal(interaction, targetUserID, submissions) {
  const summaryInput = new TextInputBuilder()
    .setCustomId('xQuestSummary')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(formatSubmissionSummary(submissions))
    .setRequired(false);

  const summaryLabel = new LabelBuilder()
    .setLabel(`Pending X quests: ${submissions.length}`.slice(0, 45))
    .setDescription('Review the actions and links. Changes to this summary are ignored.')
    .setTextInputComponent(summaryInput);

  const rewardInput = new TextInputBuilder()
    .setCustomId('totalRewardAmount')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Total Volts to award')
    .setRequired(true);

  const rewardLabel = new LabelBuilder()
    .setLabel('Total Volts')
    .setDescription('This total is distributed across all pending X quests.')
    .setTextInputComponent(rewardInput);

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}:${targetUserID}`)
    .setTitle('Complete X Quests')
    .addLabelComponents(summaryLabel, rewardLabel);

  return interaction.showModal(modal);
}

async function sendCompletionLog(interaction, targetUserID, submissions, result) {
  if (!QUEST_LOG_CHANNEL_ID) return;
  try {
    const channel = await interaction.client.channels.fetch(QUEST_LOG_CHANNEL_ID);
    if (!channel?.isTextBased()) return;

    const links = submissions
      .map((submission, index) => `• ${submission.action} — [View Tweet ${index + 1}](${submission.tweet_url})`)
      .join('\n')
      .slice(0, 1024);
    const embed = new EmbedBuilder()
      .setTitle('✅ X Quests Marked Complete')
      .setColor(0x22c55e)
      .addFields(
        { name: 'User', value: `<@${targetUserID}>`, inline: true },
        { name: 'Marked By', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Total Volts Awarded', value: String(result.totalReward), inline: true },
        { name: 'Completed X Quests', value: links || '—' }
      )
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.warn('⚠️ Failed to send X quest completion log:', error);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('complete-xquest')
    .setDescription('Review and complete a user’s pending X quests (Admin Only).')
    .addStringOption((option) => option
      .setName('user')
      .setDescription('Select a user with pending X quests')
      .setRequired(true)
      .setAutocomplete(true)),

  async autocomplete(interaction) {
    try {
      if (!(await ensureAdmin(interaction))) return interaction.respond([]);
      const focused = interaction.options.getFocused(true);
      if (focused.name !== 'user') return interaction.respond([]);

      const search = String(focused.value || '').trim().toLowerCase();
      const pendingUsers = await db.getPendingXQuestUsers();
      const choices = pendingUsers
        .map((pendingUser) => {
          const member = interaction.guild?.members?.cache?.get(pendingUser.userID);
          const discordUser = member?.user || interaction.client.users.cache.get(pendingUser.userID);
          const displayName = member?.displayName
            || discordUser?.globalName
            || discordUser?.username
            || pendingUser.username
            || pendingUser.userID;
          return {
            name: `${displayName} — ${pendingUser.pending_count} pending`.slice(0, 100),
            value: String(pendingUser.userID),
            searchText: `${displayName} ${pendingUser.username || ''} ${pendingUser.userID}`.toLowerCase(),
          };
        })
        .filter((choice) => !search || choice.searchText.includes(search))
        .slice(0, 25)
        .map(({ name, value }) => ({ name, value }));
      return interaction.respond(choices);
    } catch (error) {
      console.error('Complete X Quest Autocomplete Error:', error);
      if (!interaction.responded) await interaction.respond([]);
    }
  },

  async execute(interaction) {
    try {
      if (!(await ensureAdmin(interaction))) {
        return interaction.reply({ content: '🚫 Only bot admins or server administrators can complete X quests.', ephemeral: true });
      }
      const targetUserID = interaction.options.getString('user');
      if (!/^\d{17,20}$/.test(targetUserID || '')) {
        return interaction.reply({ content: '🚫 Please select a user from the pending X quest list.', ephemeral: true });
      }
      const submissions = await db.getPendingXQuestSubmissions(targetUserID);
      if (!submissions.length) {
        return interaction.reply({ content: `🚫 <@${targetUserID}> has no pending X quests.`, ephemeral: true });
      }
      return showCompletionModal(interaction, targetUserID, submissions);
    } catch (error) {
      console.error('Complete X Quest Slash Error:', error);
      return interaction.reply({ content: `🚫 Complete X quest failed: ${error.message || error}`, ephemeral: true });
    }
  },

  async handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith(`${MODAL_PREFIX}:`)) return false;
    try {
      if (!(await ensureAdmin(interaction))) {
        await interaction.reply({ content: '🚫 Only bot admins or server administrators can complete X quests.', ephemeral: true });
        return true;
      }

      const targetUserID = interaction.customId.split(':')[1];
      const totalReward = Number(interaction.fields.getTextInputValue('totalRewardAmount').trim());
      if (!Number.isInteger(totalReward) || totalReward < 0) {
        await interaction.reply({ content: '🚫 Please enter a valid whole-number Volt amount.', ephemeral: true });
        return true;
      }

      await interaction.deferReply({ ephemeral: true });
      const submissions = await db.getPendingXQuestSubmissions(targetUserID);
      if (!submissions.length) {
        await interaction.editReply(`🚫 <@${targetUserID}> has no pending X quests.`);
        return true;
      }

      const result = await db.completePendingXQuestSubmissions(targetUserID, totalReward, interaction.user.id);
      if (!result.success) {
        await interaction.editReply('🚫 These X quests were already processed.');
        return true;
      }

      await sendCompletionLog(interaction, targetUserID, submissions, result);
      await interaction.editReply(
        `✅ Completed ${result.completedCount} X quest(s) for <@${targetUserID}> with **${formatCurrency(result.totalReward)}** total.`
      );
      return true;
    } catch (error) {
      console.error('Complete X Quest Modal Error:', error);
      const message = `🚫 Complete X quest failed: ${error.message || error}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply(message);
      else await interaction.reply({ content: message, ephemeral: true });
      return true;
    }
  },
};
