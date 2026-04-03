const { SlashCommandBuilder } = require('@discordjs/builders');
const {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const db = require('../../db');
const { formatCurrency } = require('../../points');

const QUEST_MODAL_PREFIX = 'complete-quest';
const QUEST_LOG_CHANNEL_ID = process.env.QUEST_SUBMISSION_CHANNEL_ID || process.env.SUBMISSION_CHANNEL_ID;

async function ensureAdmin(interaction) {
  const botAdmins = await db.getAdmins();
  const isServerAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
  const isBotAdmin = botAdmins.includes(interaction.user.id);
  return isServerAdmin || isBotAdmin;
}

async function loadQuestTargets(userID) {
  const [pendingSubmissions, assignedJob] = await Promise.all([
    db.getPendingJobSubmissions(userID),
    db.getAssignedJob(userID),
  ]);

  const pendingQuests = pendingSubmissions.map((submission) => ({
    source: 'pending',
    submissionId: submission.submission_id,
    jobID: submission.jobID,
    title: submission.title || submission.description || `Quest #${submission.jobID || submission.submission_id}`,
    description: submission.description || 'No proof/description provided.',
    imageUrl: submission.image_url || null,
  }));

  const assignedQuest = assignedJob
    ? {
        source: 'assigned',
        jobID: assignedJob.jobID,
        title: assignedJob.description || `Quest #${assignedJob.jobID}`,
        description: assignedJob.description || `Quest #${assignedJob.jobID}`,
        imageUrl: null,
      }
    : null;

  return { pendingQuests, assignedQuest };
}

function formatQuestSummary(quests, targetUserID) {
  return quests
    .map((quest) => {
      return [
        `Submission #${quest.submissionId} for <@${targetUserID}>`,
        `Quest: ${quest.title}`,
        `Proof: ${quest.description}`,
        `Upload: ${quest.imageUrl || 'No image uploaded'}`,
      ].join('\n');
    })
    .join('\n\n')
    .slice(0, 3800);
}

function splitTotalReward(totalReward, questCount) {
  const total = Number(totalReward);
  if (!Number.isFinite(total) || total < 0 || !Number.isInteger(total)) {
    throw new Error('Invalid reward amount.');
  }
  if (!questCount) return [];

  const baseReward = Math.floor(total / questCount);
  let remainder = total % questCount;

  return Array.from({ length: questCount }, () => {
    const reward = baseReward + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return reward;
  });
}

async function postCompletionLog(interaction, targetUserID, quests, questRewards, totalReward) {
  if (!QUEST_LOG_CHANNEL_ID) return;

  try {
    const channel = await interaction.client.channels.fetch(QUEST_LOG_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('✅ Quest Marked Complete')
      .setColor(0x22c55e)
      .addFields(
        { name: 'User', value: `<@${targetUserID}>`, inline: true },
        { name: 'Marked By', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Total Volts Awarded', value: String(totalReward), inline: true },
        {
          name: 'Quests Completed',
          value: quests
            .map((quest, index) => {
              const uploadText = quest.imageUrl ? ` — [Upload](${quest.imageUrl})` : '';
              return `• ${quest.title} — ${questRewards[index] || 0} Volts${uploadText}`;
            })
            .join('\n')
            .slice(0, 1024) || '—',
          inline: false,
        }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (notifyErr) {
    console.warn('⚠️ Failed to send quest completion log:', notifyErr);
  }
}

async function completeQuestTargets(interaction, targetUserID, totalRewardAmount, quests) {
  const questRewards = splitTotalReward(totalRewardAmount, quests.length);
  let completedCount = 0;
  let totalReward = 0;

  for (let index = 0; index < quests.length; index += 1) {
    const quest = quests[index];
    const questReward = questRewards[index] || 0;

    if (quest.source === 'pending') {
      const pendingResult = await db.completePendingJobSubmissions(targetUserID, [quest.submissionId], questReward);
      if (pendingResult.success) {
        completedCount += pendingResult.completedCount;
        totalReward += pendingResult.totalReward;
      }
    } else if (quest.source === 'assigned') {
      const assignedResult = await db.completeJob(targetUserID, questReward);
      if (assignedResult.success) {
        completedCount += 1;
        totalReward += questReward;
      }
    }
  }

  if (!completedCount) {
    return interaction.reply({
      content: `🚫 <@${targetUserID}> does not have an active quest to complete.`,
      ephemeral: true,
    });
  }

  await postCompletionLog(interaction, targetUserID, quests, questRewards, totalReward);

  if (totalReward === 0) {
    return interaction.reply(
      `😆 OOOHHH NICE TRY, BUT QUEST INCOMPLETE! <@${targetUserID}> had ${completedCount} quest(s) closed with no reward!`
    );
  }

  return interaction.reply(
    `✅ Completed ${completedCount} quest(s) for <@${targetUserID}> with **${formatCurrency(totalReward)}** total!`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('complete-quest')
    .setDescription('Complete a quest and charge up a user’s Solarian (Admin Only).')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to charge up')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('reward')
        .setDescription('The total amount of Volts to award across all quests')
        .setRequired(true)
    ),

  async execute(interaction) {
    const { options } = interaction;

    try {
      if (!(await ensureAdmin(interaction))) {
        return interaction.reply({ content: '🚫 Only bot admins or server administrators can complete quests.', ephemeral: true });
      }

      const targetUser = options.getUser('user');
      const totalRewardAmount = options.getInteger('reward');

      if (!targetUser) {
        return interaction.reply({ content: '🚫 A user must be specified.', ephemeral: true });
      }

      const { pendingQuests, assignedQuest } = await loadQuestTargets(targetUser.id);
      const questsToComplete = pendingQuests.length ? pendingQuests : (assignedQuest ? [assignedQuest] : []);

      if (!questsToComplete.length) {
        return interaction.reply({ content: `🚫 <@${targetUser.id}> does not have an active quest to complete.`, ephemeral: true });
      }

      if (pendingQuests.length > 1) {
        const questSummaryInput = new TextInputBuilder()
          .setCustomId('questSummary')
          .setLabel(`Submitted quests: ${pendingQuests.length}`)
          .setStyle(TextInputStyle.Paragraph)
          .setValue(formatQuestSummary(pendingQuests, targetUser.id))
          .setRequired(false);

        const rewardInput = new TextInputBuilder()
          .setCustomId('totalRewardAmount')
          .setLabel('Total Volts for all quests')
          .setStyle(TextInputStyle.Short)
          .setValue(String(totalRewardAmount))
          .setRequired(true);

        const modal = new ModalBuilder()
          .setCustomId(`${QUEST_MODAL_PREFIX}:${targetUser.id}`)
          .setTitle('Complete Multiple Quests')
          .addComponents(
            new ActionRowBuilder().addComponents(questSummaryInput),
            new ActionRowBuilder().addComponents(rewardInput)
          );

        return interaction.showModal(modal);
      }

      return completeQuestTargets(interaction, targetUser.id, totalRewardAmount, questsToComplete);
    } catch (err) {
      console.error('Complete Job Slash Error:', err);
      return interaction.reply({ content: `🚫 Complete quest failed: ${err.message || err}`, ephemeral: true });
    }
  },

  async handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith(`${QUEST_MODAL_PREFIX}:`)) return false;

    try {
      if (!(await ensureAdmin(interaction))) {
        await interaction.reply({ content: '🚫 Only bot admins or server administrators can complete quests.', ephemeral: true });
        return true;
      }

      const targetUserID = interaction.customId.split(':')[1];
      const totalRewardAmount = Number(interaction.fields.getTextInputValue('totalRewardAmount'));
      if (!Number.isInteger(totalRewardAmount) || totalRewardAmount < 0) {
        await interaction.reply({ content: '🚫 Please enter a valid volts amount.', ephemeral: true });
        return true;
      }

      const { pendingQuests, assignedQuest } = await loadQuestTargets(targetUserID);
      const questsToComplete = pendingQuests.length ? pendingQuests : (assignedQuest ? [assignedQuest] : []);

      if (!questsToComplete.length) {
        await interaction.reply({ content: `🚫 <@${targetUserID}> does not have an active quest to complete.`, ephemeral: true });
        return true;
      }

      await completeQuestTargets(interaction, targetUserID, totalRewardAmount, questsToComplete);
      return true;
    } catch (err) {
      console.error('Complete Quest Modal Error:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `🚫 Complete quest failed: ${err.message || err}`, ephemeral: true });
      }
      return true;
    }
  },
};
