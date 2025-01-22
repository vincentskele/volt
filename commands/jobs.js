// commands/jobs.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  // Define all slash commands handled by this module
  data: [
    // Add Job Command
    new SlashCommandBuilder()
      .setName('add-job')
      .setDescription('Add a new job to the job list (Admin Only).')
      .addStringOption(option =>
        option.setName('description')
          .setDescription('The description of the job')
          .setRequired(true)),
    
    // Job List Command
    new SlashCommandBuilder()
      .setName('joblist')
      .setDescription('View all available jobs and their current assignees.'),
    
    // Work Command
    new SlashCommandBuilder()
      .setName('work')
      .setDescription('Assign yourself to a random job.'),
    
    // Complete Job Command
    new SlashCommandBuilder()
      .setName('complete-job')
      .setDescription('Complete a job and reward a user (Admin Only).')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to reward')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('jobid')
          .setDescription('The ID of the job to complete')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('reward')
          .setDescription('The amount of currency to reward')
          .setRequired(true))
  ],

  /**
   * Execute function to handle both prefix and slash commands.
   * @param {string} commandType - 'slash' or the prefix command name.
   * @param {Message|CommandInteraction} messageOrInteraction - The message or interaction object.
   * @param {Array<string>} args - The arguments provided with the command.
   */
  async execute(commandType, messageOrInteraction, args) {
    if (commandType === 'slash') {
      await this.handleSlashCommand(messageOrInteraction);
    } else {
      await this.handlePrefixCommand(commandType, messageOrInteraction, args);
    }
  },

  /**
   * Handle slash command interactions.
   * @param {CommandInteraction} interaction 
   */
  async handleSlashCommand(interaction) {
    const { commandName, options, member } = interaction;

    switch (commandName) {
      case 'add-job':
        await this.addJobSlash(interaction, options, member);
        break;
      case 'joblist':
        await this.listJobsSlash(interaction);
        break;
      case 'work':
        await this.workSlash(interaction);
        break;
      case 'complete-job':
        await this.completeJobSlash(interaction, options, member);
        break;
      default:
        await interaction.reply({ content: '🚫 Unknown command.', ephemeral: true });
    }
  },

  /**
   * Handle prefix commands.
   * @param {string} commandName 
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async handlePrefixCommand(commandName, message, args) {
    switch (commandName) {
      case 'add-job':
        await this.addJobPrefix(message, args);
        break;
      case 'joblist':
        await this.listJobsPrefix(message);
        break;
      case 'work':
        await this.workPrefix(message);
        break;
      case 'complete-job':
        await this.completeJobPrefix(message, args);
        break;
      default:
        // Unknown command; do nothing or send a default message
        break;
    }
  },

  // ===============================
  // Prefix Command Handlers
  // ===============================

  /**
   * Handle the prefix `$add-job` command.
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async addJobPrefix(message, args) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('🚫 Only admins can add jobs.');
    }
    
    const desc = args.join(' ');
    if (!desc) {
      return message.reply('Usage: `$add-job <description>`');
    }
    
    try {
      await db.addJob(desc);
      return message.reply(`✅ Added job: "${desc}"`);
    } catch (err) {
      console.error('Add Job Prefix Error:', err);
      return message.reply(`🚫 Add job failed: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$joblist` command.
   * @param {Message} message 
   */
  async listJobsPrefix(message) {
    try {
      const jobs = await db.getJobList();
      if (!jobs.length) {
        return message.reply('🚫 No jobs available.');
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🛠️ Jobs List')
        .setColor(0x00AE86)
        .setTimestamp();
      
      jobs.forEach(job => {
        const assignees = job.assignees.length
          ? job.assignees.map(u => `<@${u}>`).join(', ')
          : 'None assigned';
        embed.addFields({ name: `• [ID: ${job.jobID}] ${job.description}`, value: assignees, inline: false });
      });

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('List Jobs Prefix Error:', err);
      return message.reply(`🚫 Joblist error: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$work` command.
   * @param {Message} message 
   */
  async workPrefix(message) {
    try {
      const job = await db.assignRandomJob(message.author.id);
      if (!job) {
        return message.reply('🚫 No job available or you are on all of them.');
      }

      const embed = new EmbedBuilder()
        .setTitle('🛠️ Job Assigned')
        .setDescription(`• **Job ID:** ${job.jobID}\n• **Description:** ${job.description}`)
        .setColor(0x00AE86)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Work Prefix Error:', err);
      return message.reply(`🚫 Work failed: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$complete-job` command.
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async completeJobPrefix(message, args) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('🚫 Only admins can complete jobs.');
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser || args.length < 3) {
      return message.reply('Usage: `$complete-job <@user> <jobID> <reward>`');
    }

    const jobID = parseInt(args[1], 10);
    const reward = parseInt(args[2], 10);
    if (isNaN(jobID) || isNaN(reward)) {
      return message.reply('🚫 Job ID and reward must be numbers.');
    }

    try {
      const result = await db.completeJob(jobID, targetUser.id, reward);
      if (!result) {
        return message.reply(`🚫 Job ${jobID} does not exist.`);
      }
      if (result.notAssigned) {
        return message.reply(`🚫 <@${targetUser.id}> is not assigned to job ${jobID}.`);
      }
      return message.reply(
        `✅ Completed job ${jobID} for <@${targetUser.id}> with reward **${reward}** 🍕!`
      );
    } catch (err) {
      console.error('Complete Job Prefix Error:', err);
      return message.reply(`🚫 Complete job failed: ${err.message || err}`);
    }
  },

  // ===============================
  // Slash Command Handlers
  // ===============================

  /**
   * Handle the slash `/add-job` command.
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   * @param {GuildMember} member 
   */
  async addJobSlash(interaction, options, member) {
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can add jobs.', ephemeral: true });
    }

    const desc = options.getString('description');
    if (!desc) {
      return interaction.reply({ content: '🚫 Description is required.', ephemeral: true });
    }

    try {
      await db.addJob(desc);
      return interaction.reply(`✅ Added job: "${desc}"`);
    } catch (err) {
      console.error('Add Job Slash Error:', err);
      return interaction.reply({ content: `🚫 Add job failed: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/joblist` command.
   * @param {CommandInteraction} interaction 
   */
  async listJobsSlash(interaction) {
    try {
      const jobs = await db.getJobList();
      if (!jobs.length) {
        return interaction.reply('🚫 No jobs available.');
      }

      const embed = new EmbedBuilder()
        .setTitle('🛠️ Jobs List')
        .setColor(0x00AE86)
        .setTimestamp();
      
      jobs.forEach(job => {
        const assignees = job.assignees.length
          ? job.assignees.map(u => `<@${u}>`).join(', ')
          : 'None assigned';
        embed.addFields({ name: `• [ID: ${job.jobID}] ${job.description}`, value: assignees, inline: false });
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('List Jobs Slash Error:', err);
      return interaction.reply({ content: `🚫 Joblist error: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/work` command.
   * @param {CommandInteraction} interaction 
   */
  async workSlash(interaction) {
    try {
      const job = await db.assignRandomJob(interaction.user.id);
      if (!job) {
        return interaction.reply({ content: '🚫 No job available or you are on all of them.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🛠️ Job Assigned')
        .setDescription(`• **Job ID:** ${job.jobID}\n• **Description:** ${job.description}`)
        .setColor(0x00AE86)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Work Slash Error:', err);
      return interaction.reply({ content: `🚫 Work failed: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/complete-job` command.
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   * @param {GuildMember} member 
   */
  async completeJobSlash(interaction, options, member) {
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '🚫 Only admins can complete jobs.', ephemeral: true });
    }

    const targetUser = options.getUser('user');
    const jobID = options.getInteger('jobid');
    const reward = options.getInteger('reward');

    if (!targetUser || !jobID || !reward) {
      return interaction.reply({ content: '🚫 All fields (user, job ID, reward) are required.', ephemeral: true });
    }

    try {
      const result = await db.completeJob(jobID, targetUser.id, reward);
      if (!result) {
        return interaction.reply({ content: `🚫 Job ${jobID} does not exist.`, ephemeral: true });
      }
      if (result.notAssigned) {
        return interaction.reply({ content: `🚫 <@${targetUser.id}> is not assigned to job ${jobID}.`, ephemeral: true });
      }
      return interaction.reply(
        `✅ Completed job ${jobID} for <@${targetUser.id}> with reward **${reward}** 🍕!`
      );
    } catch (err) {
      console.error('Complete Job Slash Error:', err);
      return interaction.reply({ content: `🚫 Complete job failed: ${err.message || err}`, ephemeral: true });
    }
  },

  // ===============================
  // Utility Functions (if any)
  // ===============================
};
