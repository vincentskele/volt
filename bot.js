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
  // Ignore bot messages and any non-command messages
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const [command, ...args] = message.content.slice(PREFIX.length).trim().split(/ +/);
  const userID = message.author.id;

  try {
    switch (command.toLowerCase()) {
      /**
       * HELP
       */
      case 'pizzahelp': {
        const helpMessage = `
**Pizza Bot Commands (with Bank & Rob):**
**Basic Economy:**
  🍕 **$balance** [@user]: Shows wallet & bank for you or another user.
  🍕 **$deposit <amount>**: Move money from wallet to bank.
  🍕 **$withdraw <amount>**: Move money from bank to wallet.
  🍕 **$rob @user**: Attempt to rob another user's wallet.

**Admin Bake & Transfers:**
  🍕 **$bake** (Admin): Get 6969 in your wallet.
  🍕 **$give-money @user <amount>**: Give wallet money to another user.
  🍕 **$give-item @user <item name>**: Send 1 item to another user.
  🍕 **$redeem <item name>**: Use/redeem an item in your inventory.

**Shop & Inventory:**
  🛍️ **$shop**: View items for sale.
  🛍️ **$buy <item name>**: Purchase an item (spends from wallet).
  🛍️ **$inventory** (or **$inv**) [@user]: Show someone's items.
  🛍️ **$add-item <price> <name> - <description>** (Admin)
  🛍️ **$remove-item <item name>** (Admin)

**Leaderboard & Admin System:**
  🍕 **$leaderboard**: Shows top 10 total (wallet+bank).
  🍕 **$add-admin @user**, **$remove-admin @user**, **$list-admins**

**Jobs (multi-assignee example):**
  🛠️ **$add-job <desc>** (Admin): Create a new job.
  🛠️ **$joblist**: View all jobs & assignees.
  🛠️ **$work**: Assign yourself to a random job.
  🛠️ **$complete-job <jobID>** (Admin): Pay & unassign everyone.
        `;
        return message.reply(helpMessage);
      }

      /**
       * BALANCE
       * - Now shows wallet & bank
       */
      case 'balance': {
        const targetUser = message.mentions.users.first() || message.author;
        const { wallet, bank } = await db.getBalances(targetUser.id);
        return message.reply(
          `**${targetUser.username}'s Balance**\n` +
          `Wallet: ${wallet} 🍕\n` +
          `Bank: ${bank} 🍕\n` +
          `Total: ${wallet + bank} 🍕`
        );
      }

      /**
       * DEPOSIT (move from wallet -> bank)
       */
      case 'deposit': {
        const amount = parseInt(args[0], 10);
        if (isNaN(amount) || amount <= 0) {
          return message.reply('Usage: `$deposit <amount>` (positive number).');
        }
        try {
          await db.deposit(userID, amount);
          return message.reply(`✅ Deposited ${amount} 🍕 into your bank.`);
        } catch (err) {
          return message.reply(`🚫 Deposit failed: ${err}`);
        }
      }

      /**
       * WITHDRAW (move from bank -> wallet)
       */
      case 'withdraw': {
        const amount = parseInt(args[0], 10);
        if (isNaN(amount) || amount <= 0) {
          return message.reply('Usage: `$withdraw <amount>` (positive number).');
        }
        try {
          await db.withdraw(userID, amount);
          return message.reply(`✅ Withdrew ${amount} 🍕 from your bank to your wallet.`);
        } catch (err) {
          return message.reply(`🚫 Withdraw failed: ${err}`);
        }
      }

      /**
       * ROB
       * - Attempts to rob another user's wallet
       * - 50% chance to succeed
       * - If success, steals a random portion (e.g. 10-40%) of target's wallet
       * - If fail, the robber pays a penalty to target (optional!)
       */
      case 'rob': {
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply('Usage: `$rob @user`');
        }
        if (targetUser.id === userID) {
          return message.reply('🚫 You cannot rob yourself!');
        }
        try {
          const result = await db.robUser(userID, targetUser.id);
          if (!result.success) {
            return message.reply(`🚫 Rob attempt failed: ${result.message}`);
          }
          if (result.outcome === 'success') {
            return message.reply(
              `💰 You successfully robbed <@${targetUser.id}> and stole **${result.amountStolen}** 🍕!`
            );
          } else {
            return message.reply(
              `👮 Your robbery failed! You paid **${result.penalty}** 🍕 to <@${targetUser.id}> as a penalty.`
            );
          }
        } catch (err) {
          return message.reply(`🚫 Rob failed: ${err}`);
        }
      }

      /**
       * BAKE (Admin)
       */
      case 'bake': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only an admin can bake 🍕.');
        }
        await db.updateWallet(userID, 6969); // +6969 to wallet
        return message.reply('🍕 You baked 6969 pizzas into your wallet!');
      }

      /**
       * GIVE MONEY
       * - Now we always move from the giver's wallet to the recipient's wallet
       */
      case 'give-money': {
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply('Usage: `$give-money @user <amount>`');
        }
        const amount = parseInt(args[1], 10);
        if (isNaN(amount) || amount <= 0) {
          return message.reply('🚫 Please specify a valid amount. Usage: `$give-money @user 100`');
        }
        try {
          await db.transferFromWallet(userID, targetUser.id, amount);
          return message.reply(`✅ You gave ${amount} 🍕 (wallet) to <@${targetUser.id}>!`);
        } catch (err) {
          return message.reply(`🚫 Transfer failed: ${err}`);
        }
      }

      /**
       * GIVE-ITEM
       */
      case 'give-item': {
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply('Usage: `$give-item @user <item name>`');
        }
        args.shift(); // remove mention
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('Please specify the item name.');
        }
        try {
          await db.transferItem(userID, targetUser.id, itemName, 1);
          return message.reply(`✅ You sent 1 of "${itemName}" to <@${targetUser.id}>.`);
        } catch (err) {
          return message.reply(`🚫 Item transfer failed: ${err}`);
        }
      }

      /**
       * REDEEM
       */
      case 'redeem': {
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('Usage: `$redeem <item name>`');
        }
        try {
          await db.redeemItem(userID, itemName);
          return message.reply(`🎉 You redeemed **${itemName}**!`);
        } catch (err) {
          return message.reply(`🚫 Redemption failed: ${err}`);
        }
      }

      /**
       * LEADERBOARD
       * - Now sorts by (wallet+bank) desc
       */
      case 'leaderboard': {
        try {
          const leaderboard = await db.getLeaderboard();
          if (!leaderboard.length) {
            return message.reply('🚫 No data available for the leaderboard.');
          }
          const lines = leaderboard.map((row, i) => {
            const total = row.wallet + row.bank;
            return `\`${i + 1}\`. <@${row.userID}> - Wallet: ${row.wallet}, Bank: ${row.bank} (Total: ${total})`;
          });
          return message.reply(`**🍕 Leaderboard (Top 10 by total) 🍕**\n${lines.join('\n')}`);
        } catch (err) {
          return message.reply(`🚫 Failed to retrieve leaderboard: ${err}`);
        }
      }

      /**
       * SHOP & INVENTORY
       */
      case 'shop': {
        try {
          const items = await db.getShopItems();
          if (!items.length) {
            return message.reply('🚫 The shop is empty.');
          }
          const lines = items.map(it => 
            `• **${it.name}** — Cost: ${it.price}\n   *${it.description}*`
          );
          return message.reply(`🛍️ **Shop Items:**\n${lines.join('\n')}`);
        } catch (err) {
          return message.reply(`🚫 Failed retrieving shop: ${err}`);
        }
      }

      case 'buy': {
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('🚫 Usage: `$buy <item name>`');
        }
        try {
          // Get item
          const shopItem = await db.getShopItemByName(itemName);
          if (!shopItem) {
            return message.reply(`🚫 "${itemName}" not found in shop.`);
          }
          // Check wallet
          const { wallet } = await db.getBalances(userID);
          if (wallet < shopItem.price) {
            return message.reply(
              `🚫 You only have ${wallet} in your wallet, but "${shopItem.name}" costs ${shopItem.price}.`
            );
          }
          // Subtract from wallet
          await db.updateWallet(userID, -shopItem.price);
          // Add item
          await db.addItemToInventory(userID, shopItem.itemID, 1);
          return message.reply(`✅ You purchased **${shopItem.name}** for ${shopItem.price} 🍕!`);
        } catch (err) {
          return message.reply(`🚫 Purchase failed: ${err}`);
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
          return message.reply(`🚫 Inventory retrieval failed: ${err}`);
        }
      }

      case 'add-item': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only admins can add shop items.');
        }
        const [priceStr, ...rest] = args;
        if (!priceStr || !rest.length) {
          return message.reply('🚫 Usage: `$add-item <price> <name> - <description>`');
        }
        const price = parseInt(priceStr, 10);
        if (isNaN(price)) {
          return message.reply('🚫 Price must be a valid number.');
        }
        const split = rest.join(' ').split(' - ');
        if (split.length < 2) {
          return message.reply('🚫 Use `$add-item <price> <name> - <description>`');
        }
        const itemName = split[0];
        const itemDesc = split[1];
        try {
          await db.addShopItem(price, itemName, itemDesc);
          return message.reply(`✅ Added **${itemName}** to the shop for ${price} 🍕.`);
        } catch (err) {
          return message.reply(`🚫 Failed to add item: ${err}`);
        }
      }

      case 'remove-item': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only admins can remove shop items.');
        }
        const itemToRemove = args.join(' ');
        if (!itemToRemove) {
          return message.reply('🚫 Usage: `$remove-item <item name>`');
        }
        try {
          await db.removeShopItem(itemToRemove);
          return message.reply(`✅ Removed **${itemToRemove}** from the shop.`);
        } catch (err) {
          return message.reply(`🚫 Failed to remove item: ${err}`);
        }
      }

      /**
       * JOB COMMANDS (Multi-Assignee Example)
       */
      case 'add-job': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only admins can add jobs.');
        }
        const desc = args.join(' ');
        if (!desc) {
          return message.reply('🚫 Usage: `$add-job <description>`');
        }
        try {
          await db.addJob(desc);
          return message.reply(`✅ Added job: "${desc}"`);
        } catch (err) {
          return message.reply(`🚫 Failed to add job: ${err}`);
        }
      }

      case 'joblist': {
        try {
          const jobs = await db.getJobList();
          if (!jobs.length) {
            return message.reply('🚫 No jobs available.');
          }
          const lines = jobs.map(job => {
            if (!job.assignees.length) {
              return `• [ID: ${job.jobID}] ${job.description} — Assigned: None`;
            }
            const assignedStr = job.assignees.map(uid => `<@${uid}>`).join(', ');
            return `• [ID: ${job.jobID}] ${job.description} — Assigned: ${assignedStr}`;
          });
          return message.reply(`🛠️ **Jobs List:**\n${lines.join('\n')}`);
        } catch (err) {
          return message.reply(`🚫 Failed retrieving jobs: ${err}`);
        }
      }

      case 'work': {
        try {
          const job = await db.assignRandomJob(userID);
          if (!job) {
            return message.reply('🚫 No unassigned jobs available for you.');
          }
          return message.reply(`🛠️ You are now assigned to: "${job.description}" (Job ID: ${job.jobID})`);
        } catch (err) {
          return message.reply(`🚫 Failed assigning job: ${err}`);
        }
      }

      case 'complete-job': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only admins can complete a job.');
        }
        const jobID = parseInt(args[0], 10);
        if (isNaN(jobID)) {
          return message.reply('🚫 Usage: `$complete-job <jobID>`');
        }
        try {
          const result = await db.completeJob(jobID);
          if (!result) {
            return message.reply(`🚫 Job ${jobID} does not exist.`);
          }
          if (!result.assignees.length) {
            return message.reply(`✅ Job ${jobID} completed. Nobody was assigned.`);
          }
          const mentions = result.assignees.map(uid => `<@${uid}>`).join(', ');
          return message.reply(
            `✅ Job ${jobID} completed! Each assigned user got **${result.payAmount}** 🍕: ${mentions}`
          );
        } catch (err) {
          return message.reply(`🚫 Failed completing job: ${err}`);
        }
      }

      /**
       * BOT-SPECIFIC ADMIN COMMANDS
       */
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
          return message.reply(`🚫 Failed to add admin: ${err}`);
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
          return message.reply(`🚫 Failed to remove admin: ${err}`);
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
          return message.reply(`🚫 Failed retrieving admin list: ${err}`);
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

