require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const db = require('./db'); // The updated DB logic from above

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

  console.log('Command:', command);

  try {
    switch (command.toLowerCase()) {
      case 'pizzahelp': {
        const helpMessage = `
**Pizza Bot Commands (Now with redeemable items):**
🍕 **$pizzahelp**: Show this list of commands.
🍕 **$balance [@user]**: Check your balance or mention another user to see theirs.
🍕 **$bake**: Admin-only. Bake 6969 🍕 for yourself.
🍕 **$give-money @user <amount>**: Send 🍕 to another user.
🍕 **$give-item @user <item name>**: Send 1 of an item to another user.
🍕 **$redeem <item name>**: Use/redeem an item from your inventory.
🍕 **$leaderboard**: View the top 10 pizza holders.
🍕 **$add-admin @user**: Admin-only. Add a bot-specific admin.
🍕 **$remove-admin @user**: Admin-only. Remove a bot-specific admin.
🍕 **$list-admins**: List all bot-specific admins.

Shop Commands:
🛍️ **$shop**: View available items in the shop.
🛍️ **$buy <item name>**: Purchase an item.
🛍️ **$inventory** or **$inv [@user]**: View inventory.
🛍️ **$add-item <price> <name> - <description>**: Admin-only. Add a shop item.
🛍️ **$remove-item <name>**: Admin-only. Remove a shop item.

Joblist Commands:
🛠️ **$add-job <description>**: Admin-only. Add a task to the joblist.
🛠️ **$joblist**: View all *unassigned* tasks in the joblist.
🛠️ **$complete-job <jobID>**: Admin-only. Mark a task as completed (worker gets paid).
🛠️ **$work**: Assign yourself a random job (if you don't already have one).
        `;
        return message.reply(helpMessage);
      }

      // BALANCE
      case 'balance': {
        const target = message.mentions.users.first() || message.author;
        const balance = await db.getBalance(target.id);
        return message.reply(`${target.username} has ${balance} 🍕`);
      }

      // ADMIN-ONLY BAKE
      case 'bake': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 You must be an admin to bake 🍕!');
        }
        const amountToBake = 6969;
        await db.updateBalance(userID, amountToBake);
        return message.reply(`🍕 You baked **${amountToBake}** pizzas for yourself!`);
      }

      // GIVE-MONEY
      case 'give-money': {
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply('🚫 Please mention a user to give money to. Usage: `$give-money @user 100`');
        }
        const amount = parseInt(args[1], 10);
        if (isNaN(amount) || amount <= 0) {
          return message.reply('🚫 Please specify a valid amount. Usage: `$give-money @user 100`');
        }

        const giverBalance = await db.getBalance(userID);
        if (giverBalance < amount) {
          return message.reply(`🚫 You only have ${giverBalance} 🍕 and cannot give ${amount} 🍕.`);
        }

        try {
          await db.transferBalanceFromTo(userID, targetUser.id, amount);
          return message.reply(`✅ You gave ${amount} 🍕 to <@${targetUser.id}>!`);
        } catch (error) {
          console.error('Error transferring balance:', error);
          return message.reply('🚫 Failed to transfer funds.');
        }
      }

      // GIVE-ITEM (hard-coded to send 1 item)
      case 'give-item': {
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply('Usage: `$give-item @user <item name>`');
        }

        // Remove the mention from args
        args.shift(); 
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('Please specify the item name. Usage: `$give-item @user <item name>`');
        }

        try {
          // Always send 1
          await db.transferItem(message.author.id, targetUser.id, itemName, 1);
          return message.reply(`✅ You sent 1 of "${itemName}" to ${targetUser.username}.`);
        } catch (error) {
          console.error('Error transferring item:', error);
          return message.reply(`🚫 Failed to send item: ${error}`);
        }
      }

      /**
       * REDEEM an item (new command)
       * Usage: $redeem <item name>
       * Removes 1 item from the user's inventory and announces it.
       */
      case 'redeem': {
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('Usage: `$redeem <item name>`');
        }
        try {
          await db.redeemItem(userID, itemName);
          // If success, item was removed from inventory
          return message.reply(`🎉 You have redeemed **${itemName}**!`);
        } catch (error) {
          console.error('Error redeeming item:', error);
          return message.reply(`🚫 Could not redeem item: ${error}`);
        }
      }

      // LEADERBOARD
      case 'leaderboard': {
        try {
          const leaderboard = await db.getLeaderboard();
          if (!leaderboard || !leaderboard.length) {
            return message.reply('🚫 No data available for the leaderboard.');
          }
          const top10 = leaderboard.slice(0, 10);
          const formatted = top10
            .map((user, index) => `\`${index + 1}\`. <@${user.userID}> - **${user.balance} 🍕**`)
            .join('\n');
          return message.reply(`**🍕 Leaderboard (Top 10) 🍕**\n${formatted}`);
        } catch (error) {
          console.error('Error retrieving leaderboard:', error);
          return message.reply('🚫 Failed to retrieve the leaderboard.');
        }
      }

      // SHOP COMMANDS
      case 'shop': {
        try {
          const shopItems = await db.getShopItems();
          if (!shopItems || !shopItems.length) {
            return message.reply('🚫 The shop is empty.');
          }
          const shopList = shopItems
            .map(item => `• **${item.name}** — Cost: ${item.price} 🍕\n   *${item.description}*`)
            .join('\n');
          return message.reply(`🛍️ **Shop Items:**\n${shopList}`);
        } catch (error) {
          console.error('Error retrieving shop items:', error);
          return message.reply('🚫 Failed to retrieve shop items.');
        }
      }

      case 'buy': {
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('🚫 Please specify the item name. Usage: `$buy <item name>`');
        }
        try {
          const shopItem = await db.getShopItemByName(itemName);
          if (!shopItem) {
            return message.reply(`🚫 Item "${itemName}" doesn't exist in the shop.`);
          }
          const userBalance = await db.getBalance(userID);
          if (userBalance < shopItem.price) {
            return message.reply(`🚫 You don't have enough 🍕. **Price:** ${shopItem.price}, **Your Balance:** ${userBalance}`);
          }
          await db.updateBalance(userID, -shopItem.price);
          await db.addItemToInventory(userID, shopItem.itemID, 1);
          return message.reply(`✅ You purchased **${shopItem.name}** for ${shopItem.price} 🍕!`);
        } catch (error) {
          console.error('Error processing purchase:', error);
          return message.reply('🚫 Failed to complete the purchase.');
        }
      }

      case 'inventory':
      case 'inv': {
        const userToCheck = message.mentions.users.first() || message.author;
        try {
          const inventoryItems = await db.getInventory(userToCheck.id);
          if (!inventoryItems || !inventoryItems.length) {
            return message.reply(`🚫 ${userToCheck.username} has an empty inventory.`);
          }
          const itemList = inventoryItems
            .map(item => `• **${item.name}** x${item.quantity}`)
            .join('\n');
          return message.reply(`🎒 **${userToCheck.username}'s Inventory:**\n${itemList}`);
        } catch (error) {
          console.error('Error retrieving inventory:', error);
          return message.reply('🚫 Failed to retrieve inventory.');
        }
      }

      // ADD-ITEM (ADMIN-ONLY)
      case 'add-item': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 You must be an admin to add items to the shop.');
        }
        // $add-item <price> <name> - <description>
        const [priceString, ...itemSplit] = args;
        if (!priceString || !itemSplit.length) {
          return message.reply('🚫 Usage: $add-item <price> <name> - <description>');
        }
        const price = parseInt(priceString, 10);
        if (isNaN(price)) {
          return message.reply('🚫 The price must be a valid number.');
        }

        const itemArgs = itemSplit.join(' ').split(' - ');
        if (itemArgs.length < 2) {
          return message.reply('🚫 Please use the format: $add-item <price> <name> - <description>');
        }
        const itemName = itemArgs[0];
        const itemDescription = itemArgs[1];

        try {
          await db.addShopItem(price, itemName, itemDescription);
          return message.reply(`✅ Successfully added **${itemName}** to the shop for ${price} 🍕.`);
        } catch (error) {
          console.error('Error adding item:', error);
          return message.reply('🚫 Failed to add item to the shop.');
        }
      }

      // REMOVE-ITEM (ADMIN-ONLY)
      case 'remove-item': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 You must be an admin to remove items from the shop.');
        }
        const itemToRemove = args.join(' ');
        if (!itemToRemove) {
          return message.reply('🚫 Please specify the item name to remove. Usage: `$remove-item <item name>`');
        }
        try {
          await db.removeShopItem(itemToRemove);
          return message.reply(`✅ Successfully removed **${itemToRemove}** from the shop.`);
        } catch (error) {
          console.error('Error removing item:', error);
          return message.reply('🚫 Failed to remove item from the shop.');
        }
      }

      // JOB COMMANDS
      case 'add-job': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only administrators can add jobs!');
        }
        const jobDescription = args.join(' ');
        if (!jobDescription) {
          return message.reply('🚫 Usage: $add-job <description>');
        }
        try {
          await db.addJob(jobDescription);
          return message.reply(`✅ Successfully added a job: "${jobDescription}"`);
        } catch (error) {
          console.error('Error adding job:', error);
          return message.reply('🚫 Failed to add the job.');
        }
      }

      case 'joblist': {
        try {
          const jobs = await db.getJobList();
          if (!jobs.length) {
            return message.reply('🚫 No pending (unassigned) jobs at the moment.');
          }
          const jobList = jobs
            .map(job => `• [ID: ${job.jobID}] ${job.description}`)
            .join('\n');
          return message.reply(`🛠️ **Unassigned Jobs:**\n${jobList}`);
        } catch (error) {
          console.error('Error retrieving job list:', error);
          return message.reply('🚫 Failed to retrieve the job list.');
        }
      }

      case 'work': {
        try {
          const job = await db.assignRandomJob(userID);
          if (!job) {
            return message.reply('🚫 No new jobs available at the moment, or you already have one.');
          }
          return message.reply(`🛠️ **Current Task:** ${job.description} (Job ID: ${job.jobID})`);
        } catch (error) {
          console.error('Error assigning job:', error);
          return message.reply('🚫 Failed to assign a job.');
        }
      }

      case 'complete-job': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only administrators can mark a job as completed.');
        }
        const jobID = parseInt(args[0], 10);
        if (isNaN(jobID)) {
          return message.reply('🚫 Usage: $complete-job <jobID> (must be a valid number)');
        }
        try {
          const result = await db.completeJob(jobID);
          if (!result) {
            return message.reply(`🚫 Could not complete job ID ${jobID}. Check if it exists or was already completed.`);
          }
          if (result.assignedUser) {
            return message.reply(
              `✅ Job ${jobID} completed! <@${result.assignedUser}> earned **${result.payAmount}** 🍕.`
            );
          } else {
            return message.reply(`✅ Job ${jobID} completed (no assigned user).`);
          }
        } catch (error) {
          console.error('Error completing job:', error);
          return message.reply('🚫 Failed to complete the job.');
        }
      }

      // BOT-SPECIFIC ADMIN COMMANDS
      case 'add-admin': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 You must be an admin to add another admin.');
        }
        const adminToAdd = message.mentions.users.first();
        if (!adminToAdd) {
          return message.reply('🚫 Please mention a valid user to add as an admin.');
        }
        try {
          await db.addAdmin(adminToAdd.id);
          return message.reply(`✅ Successfully added <@${adminToAdd.id}> as an admin.`);
        } catch (error) {
          console.error('Error adding admin:', error);
          return message.reply('🚫 Failed to add the admin.');
        }
      }

      case 'remove-admin': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 You must be an admin to remove another admin.');
        }
        const adminToRemove = message.mentions.users.first();
        if (!adminToRemove) {
          return message.reply('🚫 Please mention a valid user to remove as an admin.');
        }
        try {
          await db.removeAdmin(adminToRemove.id);
          return message.reply(`✅ Successfully removed <@${adminToRemove.id}> as an admin.`);
        } catch (error) {
          console.error('Error removing admin:', error);
          return message.reply('🚫 Failed to remove the admin.');
        }
      }

      case 'list-admins': {
        try {
          const admins = await db.getAdmins();
          if (!admins.length) {
            return message.reply('🚫 No admins have been added yet.');
          }
          const adminList = admins.map((adminID) => `<@${adminID}>`).join('\n');
          return message.reply(`👮 **Current Admins:**\n${adminList}`);
        } catch (error) {
          console.error('Error listing admins:', error);
          return message.reply('🚫 Failed to retrieve the admin list.');
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

