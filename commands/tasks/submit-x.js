const {
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const QUEST_SUBMISSION_CHANNEL_ID = process.env.QUEST_SUBMISSION_CHANNEL_ID || process.env.SUBMISSION_CHANNEL_ID;
const SUBMISSION_COLOR = 0x000000;
const X_ACTIONS = ['posted', 'comment', 'retweet', 'like'];

function normalizeTweetUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!['x.com', 'twitter.com'].includes(hostname)) return null;
    if (!/^\/[^/]+\/status\/\d+(?:\/|$)/i.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function showSubmissionModal(interaction) {
  const actionSelect = new StringSelectMenuBuilder()
    .setCustomId('xAction')
    .setPlaceholder('Choose an X action')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(X_ACTIONS.map((action) => ({
      label: action,
      value: action,
    })));

  const actionLabel = new LabelBuilder()
    .setLabel('Submission Type')
    .setDescription('Select the X action you completed.')
    .setStringSelectMenuComponent(actionSelect);

  const tweetLink = new TextInputBuilder()
    .setCustomId('tweetLink')
    .setPlaceholder('https://x.com/user/status/1234567890')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(15)
    .setMaxLength(500)
    .setRequired(true);

  const tweetLinkLabel = new LabelBuilder()
    .setLabel('Tweet Link')
    .setDescription('Paste the link to the tweet.')
    .setTextInputComponent(tweetLink);

  const modal = new ModalBuilder()
    .setCustomId('submit-x:submission')
    .setTitle('Submit X Quest')
    .addLabelComponents(actionLabel, tweetLinkLabel);

  return interaction.showModal(modal);
}

async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith('submit-x:')) return false;

  await interaction.deferReply({ ephemeral: true });
  try {
    const action = interaction.fields.getStringSelectValues('xAction')[0];
    const tweetUrl = normalizeTweetUrl(interaction.fields.getTextInputValue('tweetLink'));

    if (!X_ACTIONS.includes(action)) {
      await interaction.editReply('🚫 Please select a valid submission type.');
      return true;
    }
    if (!tweetUrl) {
      await interaction.editReply('🚫 Please provide a valid x.com or twitter.com tweet link.');
      return true;
    }
    if (!QUEST_SUBMISSION_CHANNEL_ID) {
      throw new Error('Quest submission channel is not configured.');
    }

    const channel = await interaction.client.channels.fetch(QUEST_SUBMISSION_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Quest submission channel was not found.');
    }

    const embed = new EmbedBuilder()
      .setTitle('𝕏 New X Quest Submission!')
      .setColor(SUBMISSION_COLOR)
      .addFields(
        { name: 'Submission Type', value: action, inline: true },
        { name: 'Tweet Link', value: `[View Tweet](${tweetUrl})` }
      )
      .setFooter({ text: `Submitted by: ${interaction.user.tag} (${interaction.user.id})` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await interaction.editReply('✅ Your X quest was submitted successfully.');
    return true;
  } catch (error) {
    console.error('❌ Discord X quest submission failed:', error);
    await interaction.editReply(`🚫 X quest submission failed: ${error?.message || error}`);
    return true;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit-x')
    .setDescription('Submit a completed X quest.'),
  execute: showSubmissionModal,
  handleModalSubmit,
  normalizeTweetUrl,
};
