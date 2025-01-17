require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const db = require('./db'); // Import database logic

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '$';

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const [command, ...args] = message.content.slice(PREFIX.length).trim().split(/ +/);
  const userID = message.author.id;

  try {
    switch (command.toLowerCase()) {
      case 'pizzahelp':
        const helpMessage = `
**Pizza Bot Commands:**
🍕 **$pizzahelp**: Show this list of commands.
🍕 **$balance [@user]**: Check your balance or mention another user to see theirs.
🍕 **$bake**: Admin-only. Bake 6969 🍕 for yourself.
🍕 **$give-money @user <amount>**: Send 🍕 to another user.
🍕 **$leaderboard**: View the top 10 pizza holders.
🍕 **$add-admin @user**: Admin-only. Add a bot-specific admin.
🍕 **$remove-admin @user**: Admin-only. Remove a bot-specific admin.
🍕 **$list-admins**: List all bot-specific admins.

Shop Commands:
🛍️ **$shop**: View available items in the shop.
🛍️ **$buy <item name>**: Purchase an item.
🛍️ **$inventory** or **$inv [@user]**: View inventory.
🛍️ **$transfer @user <item name>**: Give an item to someone.
🛍️ **$add-item <price> <name> <description>**: Admin-only. Add a shop item.
🛍️ **$remove-item <name>**: Admin-only. Remove a shop item.

Joblist Commands:
🛠️ **$add-job <description>**: Admin-only. Add a task to the joblist.
🛠️ **$joblist**: View all pending tasks in the joblist.
🛠️ **$complete-job <jobID>**: Admin-only. Mark a task as completed.
        `;
        message.reply(helpMessage);
        break;

      case 'balance':
        const target = message.mentions.users.first() || message.author;
        const balance = await db.getBalance(target.id);
        message.reply(`${target.username} has ${balance} 🍕`);
        break;

      case 'bake':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('🚫 You lack the permissions to bake pizzas!');
        }
        await db.addBalance(userID, 6969);
        message.reply('🍕 You baked 6969 pizzas!');
        break;

      case 'give-money':
        if (args.length < 2) {
          return message.reply('🚫 Usage: $give-money @user <amount>');
        }

        const recipient = message.mentions.users.first();
        const amount = parseInt(args[1]);

        if (!recipient) {
          return message.reply('🚫 Please mention a valid user to give pizzas to.');
        }

        if (isNaN(amount) || amount <= 0) {
          return message.reply('🚫 Please specify a valid amount greater than 0.');
        }

        try {
          await db.transferBalance(userID, recipient.id, amount);
          message.reply(`✅ Successfully transferred ${amount} 🍕 to ${recipient.username}.`);
        } catch (error) {
          console.error('Error transferring money:', error);
          message.reply(`🚫 ${error}`);
        }
        break;

      case 'leaderboard':
        const leaderboard = await db.getLeaderboard();
        message.reply(leaderboard);
        break;

      case 'add-job':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('🚫 Only administrators can add jobs!');
        }
        const jobDescription = args.join(' ');
        if (!jobDescription) {
          return message.reply('🚫 Please provide a description for the job.');
        }
        try {
          const result = await db.addJob(jobDescription);
          message.reply(result);
        } catch (error) {
          console.error(error);
          message.reply('🚫 Failed to add the job.');
        }
        break;

      case 'joblist':
        try {
          const jobs = await db.getJobs();
          message.reply(jobs);
        } catch (error) {
          console.error(error);
          message.reply('🚫 Failed to retrieve the job list.');
        }
        break;

      case 'complete-job':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('🚫 Only administrators can mark jobs as completed!');
        }
        const jobID = parseInt(args[0]);
        if (!jobID || isNaN(jobID)) {
          return message.reply('🚫 Please specify a valid job ID.');
        }
        try {
          const result = await db.completeJob(jobID);
          message.reply(result);
        } catch (error) {
          console.error(error);
          message.reply('🚫 Failed to mark the job as completed.');
        }
        break;

      default:
        message.reply('🚫 Unknown command!');
    }
  } catch (error) {
    console.error('Error handling command:', error);
    message.reply('🚫 An error occurred while processing your command.');
  }
});

client.login(process.env.TOKEN);

