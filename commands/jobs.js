// commands/jobs.js
const { PermissionsBitField } = require('discord.js');
const db = require('../db');

class JobsModule {
  static async addJob(message, args) {
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
      return message.reply(`🚫 Add job failed: ${err}`);
    }
  }

  static async listJobs(message) {
    try {
      const jobs = await db.getJobList();
      if (!jobs.length) {
        return message.reply('🚫 No jobs available.');
      }
      
      const lines = jobs.map(j => {
        if (!j.assignees.length) {
          return `• [ID: ${j.jobID}] ${j.description} — None assigned`;
        }
        const assignedStr = j.assignees.map(u => `<@${u}>`).join(', ');
        return `• [ID: ${j.jobID}] ${j.description} — ${assignedStr}`;
      });
      
      return message.reply(`🛠️ **Jobs List:**\n${lines.join('\n')}`);
    } catch (err) {
      return message.reply(`🚫 Joblist error: ${err}`);
    }
  }

  static async workCommand(message) {
    try {
      const job = await db.assignRandomJob(message.author.id);
      if (!job) {
        return message.reply('🚫 No job available or you are on all of them.');
      }
      return message.reply(`🛠️ Assigned to job ID ${job.jobID}: "${job.description}"`);
    } catch (err) {
      return message.reply(`🚫 Work failed: ${err}`);
    }
  }

  static async completeJob(message, args) {
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
      return message.reply('Job ID and reward must be numbers.');
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
      return message.reply(`🚫 Complete job failed: ${err}`);
    }
  }

  static async execute(command, message, args) {
    switch (command) {
      case 'add-job':
        return this.addJob(message, args);
      case 'joblist':
        return this.listJobs(message);
      case 'work':
        return this.workCommand(message);
      case 'complete-job':
        return this.completeJob(message, args);
      default:
        return null;
    }
  }
}

module.exports = JobsModule;
