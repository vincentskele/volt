const {
  SlashCommandBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const db = require('../../db');

const QUEST_SUBMISSION_CHANNEL_ID = process.env.QUEST_SUBMISSION_CHANNEL_ID || process.env.SUBMISSION_CHANNEL_ID;
const SUBMISSION_COLOR = 0x3b82f6;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const submissionContexts = new Map();

function isImageAttachment(attachment) {
  if (!attachment) return true;
  if (attachment.contentType) return attachment.contentType.startsWith('image/');
  return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(attachment.name || '');
}

function rememberSubmissionContext(contextID, context) {
  submissionContexts.set(contextID, context);
  const timer = setTimeout(() => submissionContexts.delete(contextID), 15 * 60 * 1000);
  timer.unref?.();
}

async function showSubmissionModal(interaction) {
  const userID = interaction.user.id;
  const [assignedJob, pendingSubmissions] = await Promise.all([
    db.getAssignedJob(userID),
    db.getPendingJobSubmissions(userID),
  ]);

  if (!assignedJob) {
    const message = pendingSubmissions.length
      ? '⏳ Your quest has already been submitted and is waiting for admin review.'
      : '🚫 You do not have an assigned quest. Use `/quests` to claim one first.';
    return interaction.reply({ content: message, ephemeral: true });
  }

  const contextID = interaction.id;
  rememberSubmissionContext(contextID, {
    userID,
    jobID: assignedJob.jobID,
  });

  const descriptionInput = new TextInputBuilder()
    .setCustomId('questDescription')
    .setLabel('Quest Description')
    .setPlaceholder('Describe your work')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(1)
    .setMaxLength(2000)
    .setRequired(true);

  const imageUpload = new FileUploadBuilder()
    .setCustomId('questImage')
    .setFileTypes('image')
    .setMinValues(0)
    .setMaxValues(1)
    .setRequired(false);
  const imageUploadLabel = new LabelBuilder()
    .setLabel('Proof Image (optional)')
    .setDescription('Upload one image, or leave this blank.')
    .setFileUploadComponent(imageUpload);

  const modal = new ModalBuilder()
    .setCustomId(`submit-quest:${contextID}:${assignedJob.jobID}`)
    .setTitle(`Submit Quest #${assignedJob.jobID}`)
    .addComponents(
      new ActionRowBuilder().addComponents(descriptionInput),
      imageUploadLabel
    );

  return interaction.showModal(modal);
}

async function sendSubmissionToChannel(interaction, assignedJob, description, imageUrl) {
  if (!QUEST_SUBMISSION_CHANNEL_ID) {
    throw new Error('Quest submission channel is not configured.');
  }

  const channel = await interaction.client.channels.fetch(QUEST_SUBMISSION_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Quest submission channel was not found.');
  }

  const title = assignedJob.description;
  const footerText = `Submitted by: ${interaction.user.tag} (<@${interaction.user.id}>)`;
  const embedDescription = `**Title:** ${title}\n**Description:** ${description}`.slice(0, 4096);
  const embed = new EmbedBuilder()
    .setTitle('📢 New Job Submission!')
    .setColor(SUBMISSION_COLOR)
    .setDescription(embedDescription)
    .setFooter({ text: footerText })
    .setTimestamp();

  if (imageUrl) {
    embed.addFields({ name: '📷 Image URL', value: `[Click to View](${imageUrl})` });
  }

  return channel.send({ embeds: [embed] });
}

async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith('submit-quest:')) return false;

  const [, contextID, modalJobID] = interaction.customId.split(':');
  const context = submissionContexts.get(contextID);
  submissionContexts.delete(contextID);

  if (context && context.userID !== interaction.user.id) {
    await interaction.reply({ content: '🚫 This submission form belongs to another user.', ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  let submissionID = null;
  try {
    const assignedJob = await db.getAssignedJob(interaction.user.id);
    if (!assignedJob || String(assignedJob.jobID) !== String(modalJobID)) {
      const pending = await db.getPendingJobSubmissions(interaction.user.id);
      const message = pending.length
        ? '⏳ Your quest has already been submitted and is waiting for admin review.'
        : '🚫 This quest is no longer assigned to you.';
      await interaction.editReply(message);
      return true;
    }

    const description = interaction.fields.getTextInputValue('questDescription').trim();
    if (!description) {
      await interaction.editReply('🚫 Please provide a quest description.');
      return true;
    }

    const uploadedImages = interaction.fields.getUploadedFiles('questImage');
    const image = uploadedImages?.first() || null;
    if (image && !isImageAttachment(image)) {
      await interaction.editReply('🚫 The proof attachment must be an image.');
      return true;
    }
    if (image && image.size > MAX_IMAGE_SIZE) {
      await interaction.editReply('🚫 The proof image must be 5 MB or smaller.');
      return true;
    }
    const imageUrl = image?.url || null;
    const createResult = await db.createJobSubmission(
      interaction.user.id,
      assignedJob.jobID,
      assignedJob.description,
      description,
      imageUrl
    );

    if (!createResult.created) {
      await interaction.editReply('⏳ This quest has already been submitted and is waiting for admin review.');
      return true;
    }
    submissionID = createResult.submissionId;

    await sendSubmissionToChannel(interaction, assignedJob, description, imageUrl);
    try {
      await db.clearJobAssignment(interaction.user.id, assignedJob.jobID);
    } catch (assignmentError) {
      console.error('❌ Quest submitted, but assignment cleanup failed:', assignmentError);
    }

    await interaction.editReply(
      `✅ **Quest #${assignedJob.jobID} submitted successfully!** An admin will review it and award your Volts.`
    );
    return true;
  } catch (error) {
    console.error('❌ Discord quest submission failed:', error);
    if (submissionID) {
      try {
        await db.deleteJobSubmission(submissionID);
      } catch (rollbackError) {
        console.error('❌ Failed to roll back Discord quest submission:', rollbackError);
      }
    }
    await interaction.editReply(`🚫 Quest submission failed: ${error?.message || error}`);
    return true;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit-quest')
    .setDescription('Submit your active quest for admin review.'),

  execute: showSubmissionModal,
  showSubmissionModal,
  handleModalSubmit,
};
