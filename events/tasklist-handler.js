const {
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const db = require('../db');

function buildCooldownText(quest) {
  if (!quest.cooldown_value || !quest.cooldown_unit) return 'None';
  const amount = Number(quest.cooldown_value);
  return `${amount} ${quest.cooldown_unit}${amount === 1 ? '' : 's'}`;
}

function buildQuestListPayload(jobList) {
  const questsToShow = jobList.slice(0, 25);
  const embed = new EmbedBuilder()
    .setTitle('📋 Quest List')
    .setDescription('Select a quest to view its details. You will confirm before it is assigned.')
    .setColor(0x00AE86)
    .setTimestamp();

  if (jobList.length > questsToShow.length) {
    embed.setFooter({ text: `Showing the first ${questsToShow.length} of ${jobList.length} quests.` });
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('questlist')
    .setPlaceholder('Choose a quest...')
    .addOptions(
      questsToShow.map((quest) => ({
        label: `Quest #${quest.jobID}`,
        description: quest.description && quest.description.length > 100
          ? `${quest.description.substring(0, 97)}...`
          : quest.description || 'No description available',
        value: `quest_${quest.jobID}`,
      }))
    );

  return {
    content: null,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(selectMenu)],
  };
}

async function showQuestDetails(interaction) {
  const selectedQuestID = interaction.values[0].replace('quest_', '');
  const [jobList, assignedJob] = await Promise.all([
    db.getJobList(),
    db.getAssignedJob(interaction.user.id),
  ]);
  const selectedQuest = jobList.find((quest) => String(quest.jobID) === selectedQuestID);

  if (!selectedQuest) {
    return interaction.update({
      content: '🚫 That quest is no longer available.',
      embeds: [],
      components: [],
    });
  }

  const assignees = Array.isArray(selectedQuest.assignees) && selectedQuest.assignees.length
    ? selectedQuest.assignees.map((id) => `<@${id}>`).join(', ')
    : 'Nobody yet';
  const embed = new EmbedBuilder()
    .setTitle(`📜 Quest #${selectedQuest.jobID}`)
    .setDescription(selectedQuest.description || 'No description available')
    .addFields(
      { name: 'Assigned to', value: assignees, inline: true },
      { name: 'Cooldown', value: buildCooldownText(selectedQuest), inline: true }
    )
    .setColor(0x00AE86)
    .setTimestamp();

  if (assignedJob) {
    embed.addFields({
      name: 'Your active quest',
      value: `You already have Quest #${assignedJob.jobID}: ${assignedJob.description}`,
    });
  }

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`quest_claim:${selectedQuest.jobID}`)
      .setLabel(assignedJob ? 'You already have a quest' : 'Claim Quest')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(assignedJob)),
    new ButtonBuilder()
      .setCustomId('quest_back')
      .setLabel('Back to Quests')
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.update({ content: null, embeds: [embed], components: [actions] });
}

async function claimQuest(interaction) {
  const jobID = interaction.customId.split(':')[1];
  try {
    const assignedQuest = await db.assignJobById(interaction.user.id, jobID);
    const embed = new EmbedBuilder()
      .setTitle('⚡ Quest Assigned')
      .setDescription(assignedQuest.description)
      .addFields(
        { name: 'Quest', value: `#${assignedQuest.jobID}`, inline: true },
        { name: 'Cooldown', value: buildCooldownText(assignedQuest), inline: true },
        {
          name: 'Next step',
          value: 'Complete the quest, then use **Submit Quest** below or `/submit-quest` to send proof for review.',
        }
      )
      .setColor(0x22c55e)
      .setTimestamp();

    const actions = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`quest_submit:${assignedQuest.jobID}`)
        .setLabel('Submit Quest')
        .setEmoji('📤')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('quest_back')
        .setLabel('Browse Quests')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.update({ content: null, embeds: [embed], components: [actions] });
  } catch (error) {
    const message = error?.message || String(error);
    return interaction.update({
      content: `🚫 Could not claim this quest: ${message}`,
      embeds: [],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('quest_back')
            .setLabel('Back to Quests')
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
  }
}

async function openSubmissionModal(interaction) {
  const submitCommand = interaction.client.commands.get('submit-quest');
  if (!submitCommand || typeof submitCommand.showSubmissionModal !== 'function') {
    return interaction.reply({
      content: '🚫 Quest submission is temporarily unavailable. Try `/submit-quest`.',
      ephemeral: true,
    });
  }
  return submitCommand.showSubmissionModal(interaction);
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const isQuestSelect = interaction.isStringSelectMenu() && interaction.customId === 'questlist';
    const isQuestButton = interaction.isButton() && (
      interaction.customId === 'quest_back'
      || interaction.customId.startsWith('quest_claim:')
      || interaction.customId.startsWith('quest_submit:')
    );
    if (!isQuestSelect && !isQuestButton) return;

    try {
      if (isQuestSelect) return await showQuestDetails(interaction);
      if (interaction.customId.startsWith('quest_claim:')) return await claimQuest(interaction);
      if (interaction.customId.startsWith('quest_submit:')) return await openSubmissionModal(interaction);

      const jobList = await db.getJobList();
      if (!jobList.length) {
        return interaction.update({ content: '🚫 No quests are available right now.', embeds: [], components: [] });
      }
      return interaction.update(buildQuestListPayload(jobList));
    } catch (error) {
      console.error('[ERROR] Quest interaction handler:', error);
      const payload = { content: `🚫 Quest action failed: ${error?.message || error}`, ephemeral: true };
      if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
      return interaction.reply(payload);
    }
  },
};
