require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const db = require('./db'); // The updated DB logic below

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
  console.log('Received message:', message.content);

  // Ignore bot messages and any non-command messages
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const [command, ...args] = message.content.slice(PREFIX.length).trim().split(/ +/);
  const userID = message.author.id;

  try {
    switch (command.toLowerCase()) {
      case 'pizzahelp': {
        const helpMessage = `
**Pizza Bot Commands (multi-assign jobs):**
🍕 **$pizzahelp**: Show this list of commands.
🍕 **$balance [@user]**: Check your balance.
🍕 **$bake** (admin): Bake 6969 🍕 for yourself.
🍕 **$give-money @user <amount>**: Send 🍕 to another user.
🍕 **$give-item @user <item name>**: Send an item to another user.
🍕 **$redeem <item name>**: Redeem an item from your inventory.
🍕 **$leaderboard**: Top 10 pizza holders.
🍕 **$add-admin @user** / **$remove-admin @user** / **$list-admins**.

Shop:
🛍️ **$shop** / **$buy <item>** / **$inventory** (or **$inv**) [@user]
🛍️ **$add-item <price> <name> - <description>** (admin)
🛍️ **$remove-item <name>** (admin)

Jobs (multi-assignee):
🛠️ **$add-job <description>** (admin): Create a new job.
🛠️ **$joblist**: View all jobs and *all* assigned users.
🛠️ **$work**: Assign yourself to a random job *even if it already has other assignees*.
🛠️ **$complete-job <jobID>** (admin): Mark a job complete; pays *all* assigned users.
        `;
        return message.reply(helpMessage);
      }

      // -----------------------------
      // ECONOMY EXAMPLES
      // -----------------------------
      case 'balance': {
        const target = message.mentions.users.first() || message.author;
        const balance = await db.getBalance(target.id);
        return message.reply(`${target.username} has ${balance} 🍕`);
      }

      case 'bake': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only an admin can bake 🍕.');
        }
        const amountToBake = 6969;
        await db.updateBalance(userID, amountToBake);
        return message.reply(`🍕 You baked **${amountToBake}** pizzas for yourself!`);
      }

      case 'give-money': {
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply('🚫 Usage: `$give-money @user <amount>`');
        }
        const amount = parseInt(args[1], 10);
        if (isNaN(amount) || amount <= 0) {
          return message.reply('🚫 Please specify a valid amount.');
        }
        // Check balance
        const giverBalance = await db.getBalance(userID);
        if (giverBalance < amount) {
          return message.reply(`🚫 You only have ${giverBalance} 🍕.`);
        }
        try {
          await db.transferBalanceFromTo(userID, targetUser.id, amount);
          return message.reply(`✅ You gave ${amount} 🍕 to <@${targetUser.id}>!`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Transfer failed.');
        }
      }

      // -----------------------------
      // ITEMS & INVENTORY
      // -----------------------------
      case 'give-item': {
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply('Usage: `$give-item @user <item name>`');
        }
        // Remove mention
        args.shift();
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('Please specify the item name.');
        }
        try {
          await db.transferItem(message.author.id, targetUser.id, itemName, 1);
          return message.reply(`✅ You sent 1 of "${itemName}" to <@${targetUser.id}>.`);
        } catch (err) {
          console.error(err);
          return message.reply(`🚫 Failed to send item: ${err}`);
        }
      }

      case 'redeem': {
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('Usage: `$redeem <item name>`');
        }
        try {
          await db.redeemItem(userID, itemName);
          return message.reply(`🎉 You redeemed **${itemName}**!`);
        } catch (err) {
          console.error(err);
          return message.reply(`🚫 Redemption failed: ${err}`);
        }
      }

      case 'leaderboard': {
        try {
          const leaderboard = await db.getLeaderboard();
          if (!leaderboard.length) {
            return message.reply('🚫 No data available for leaderboard.');
          }
          const formatted = leaderboard
            .map((user, i) => `\`${i + 1}\`. <@${user.userID}> - **${user.balance} 🍕**`)
            .join('\n');
          return message.reply(`**🍕 Leaderboard (Top 10) 🍕**\n${formatted}`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed retrieving leaderboard.');
        }
      }

      // -----------------------------
      // SHOP
      // -----------------------------
      case 'shop': {
        try {
          const items = await db.getShopItems();
          if (!items.length) {
            return message.reply('🚫 The shop is empty.');
          }
          const list = items
            .map(item => `• **${item.name}** (Cost: ${item.price})\n   *${item.description}*`)
            .join('\n');
          return message.reply(`🛍️ **Shop Items:**\n${list}`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed to retrieve shop items.');
        }
      }

      case 'buy': {
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('🚫 Usage: `$buy <item name>`');
        }
        try {
          const item = await db.getShopItemByName(itemName);
          if (!item) {
            return message.reply(`🚫 "${itemName}" not found in shop.`);
          }
          const userBal = await db.getBalance(userID);
          if (userBal < item.price) {
            return message.reply(`🚫 You only have ${userBal}, but **${item.name}** costs ${item.price}.`);
          }
          // purchase
          await db.updateBalance(userID, -item.price);
          await db.addItemToInventory(userID, item.itemID, 1);
          return message.reply(`✅ Purchased **${item.name}** for ${item.price} 🍕!`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Purchase failed.');
        }
      }

      case 'inventory':
      case 'inv': {
        const who = message.mentions.users.first() || message.author;
        try {
          const inv = await db.getInventory(who.id);
          if (!inv.length) {
            return message.reply(`🚫 ${who.username} has an empty inventory.`);
          }
          const txt = inv.map(i => `• **${i.name}** x${i.quantity}`).join('\n');
          return message.reply(`🎒 **${who.username}'s Inventory:**\n${txt}`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed retrieving inventory.');
        }
      }

      case 'add-item': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only an admin can add shop items.');
        }
        const [priceStr, ...rest] = args;
        if (!priceStr || !rest.length) {
          return message.reply('🚫 Usage: `$add-item <price> <name> - <description>`');
        }
        const price = parseInt(priceStr, 10);
        if (isNaN(price)) {
          return message.reply('🚫 Price must be a number.');
        }
        const split = rest.join(' ').split(' - ');
        if (split.length < 2) {
          return message.reply('🚫 Please use `$add-item <price> <name> - <description>`');
        }
        const itemName = split[0];
        const itemDesc = split[1];
        try {
          await db.addShopItem(price, itemName, itemDesc);
          return message.reply(`✅ Added **${itemName}** for ${price} 🍕.`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed adding shop item.');
        }
      }

      case 'remove-item': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only an admin can remove shop items.');
        }
        const itemToRemove = args.join(' ');
        if (!itemToRemove) {
          return message.reply('🚫 Usage: `$remove-item <item name>`');
        }
        try {
          await db.removeShopItem(itemToRemove);
          return message.reply(`✅ Removed **${itemToRemove}** from the shop.`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed removing shop item.');
        }
      }

      // -----------------------------
      // JOBS (MULTI-ASSIGNEE)
      // -----------------------------
      case 'add-job': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only administrators can add jobs.');
        }
        const desc = args.join(' ');
        if (!desc) {
          return message.reply('🚫 Usage: `$add-job <description>`');
        }
        try {
          await db.addJob(desc);
          return message.reply(`✅ Added job: "${desc}"`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed to add job.');
        }
      }

      case 'joblist': {
        try {
          const jobs = await db.getJobList();
          if (!jobs.length) {
            return message.reply('🚫 No jobs available.');
          }
          // Each job can have multiple assignees
          const lines = jobs.map(job => {
            // Build list of assigned users (as mentions)
            if (!job.assignees || !job.assignees.length) {
              return `• [ID: ${job.jobID}] ${job.description} — Assigned to: None`;
            }
            const mentions = job.assignees.map(u => `<@${u}>`).join(', ');
            return `• [ID: ${job.jobID}] ${job.description} — Assigned to: ${mentions}`;
          });
          return message.reply(`🛠️ **Jobs List:**\n${lines.join('\n')}`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed retrieving job list.');
        }
      }

      case 'work': {
        try {
          // Assign the user to a random job (even if it already has other assignees)
          const job = await db.assignRandomJob(userID);
          if (!job) {
            return message.reply('🚫 No jobs found to assign you to.');
          }
          return message.reply(`🛠️ **You are now assigned** to: "${job.description}" (Job ID: ${job.jobID})`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed to assign a job.');
        }
      }

      case 'complete-job': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only administrators can complete a job.');
        }
        const jobID = parseInt(args[0], 10);
        if (isNaN(jobID)) {
          return message.reply('🚫 Usage: `$complete-job <jobID>`');
        }
        try {
          const result = await db.completeJob(jobID);
          if (!result) {
            return message.reply(`🚫 Job ID ${jobID} does not exist.`);
          }
          if (!result.assignees || !result.assignees.length) {
            return message.reply(`✅ Job ${jobID} completed. Nobody was assigned.`);
          }
          const paidMentions = result.assignees.map(u => `<@${u}>`).join(', ');
          return message.reply(
            `✅ Job ${jobID} completed! Paid each assigned user **${result.payAmount}** 🍕: ${paidMentions}`
          );
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed completing job.');
        }
      }

      // -----------------------------
      // BOT-SPECIFIC ADMIN COMMANDS
      // -----------------------------
      case 'add-admin': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only an admin can add another admin.');
        }
        const adminUser = message.mentions.users.first();
        if (!adminUser) {
          return message.reply('🚫 Usage: `$add-admin @user`');
        }
        try {
          await db.addAdmin(adminUser.id);
          return message.reply(`✅ Added <@${adminUser.id}> as a bot admin.`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed to add admin.');
        }
      }

      case 'remove-admin': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only an admin can remove another admin.');
        }
        const adminUser = message.mentions.users.first();
        if (!adminUser) {
          return message.reply('🚫 Usage: `$remove-admin @user`');
        }
        try {
          await db.removeAdmin(adminUser.id);
          return message.reply(`✅ Removed <@${adminUser.id}> from bot admins.`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed to remove admin.');
        }
      }

      case 'list-admins': {
        try {
          const admins = await db.getAdmins();
          if (!admins.length) {
            return message.reply('🚫 No admins have been added yet.');
          }
          const list = admins.map(a => `<@${a}>`).join('\n');
          return message.reply(`👮 **Current Admins:**\n${list}`);
        } catch (err) {
          console.error(err);
          return message.reply('🚫 Failed retrieving admin list.');
        }
      }

      default:
        return message.reply('🚫 Unknown command!');
    }
  } catch (error) {
    console.error('Error handling command:', error);
    return message.reply('🚫 An error occurred while processing your command.');
  }
});

client.login(process.env.TOKEN);

