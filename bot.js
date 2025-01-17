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

      case 'add-admin':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('🚫 Only administrators can add bot admins!');
        }
        const newAdmin = message.mentions.users.first();
        if (!newAdmin) {
          return message.reply('🚫 Please mention a user to add as admin.');
        }
        await db.addAdmin(newAdmin.id);
        message.reply(`✅ Added ${newAdmin.username} as a bot admin.`);
        break;

      case 'remove-admin':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('🚫 Only administrators can remove bot admins!');
        }
        const removeAdmin = message.mentions.users.first();
        if (!removeAdmin) {
          return message.reply('🚫 Please mention a user to remove as admin.');
        }
        await db.removeAdmin(removeAdmin.id);
        message.reply(`✅ Removed ${removeAdmin.username} from bot admins.`);
        break;

      case 'list-admins':
        const admins = await db.getAdmins();
        message.reply(admins);
        break;

      case 'shop':
        const shopItems = await db.getShopItems();
        message.reply(shopItems);
        break;

      case 'add-item':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('🚫 Only administrators can add items to the shop!');
        }
        const [price, ...itemDetails] = args;
        const itemName = itemDetails.slice(0, itemDetails.length - 1).join(' ');
        const itemDescription = itemDetails[itemDetails.length - 1];
        if (!price || isNaN(price) || !itemName || !itemDescription) {
          return message.reply('🚫 Usage: $add-item <price> <name> <description>');
        }
        await db.addItem(parseInt(price), itemName, itemDescription);
        message.reply(`✅ Added **${itemName}** to the shop for ${price} 🍕. Description: ${itemDescription}`);
        break;

      case 'remove-item':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('🚫 Only administrators can remove items from the shop!');
        }
        const removeItemName = args.join(' ');
        if (!removeItemName) {
          return message.reply('🚫 Usage: $remove-item <name>');
        }
        await db.removeItem(removeItemName);
        message.reply(`✅ Removed **${removeItemName}** from the shop.`);
        break;

      case 'buy':
        if (args.length < 1) {
          return message.reply('🚫 Please specify an item to buy!');
        }
        const itemNameToBuy = args.join(' ');
        try {
          const purchaseResult = await db.buyItem(userID, itemNameToBuy);
          message.reply(purchaseResult);
        } catch (error) {
          console.error('Error during purchase:', error);
          message.reply(`🚫 ${error}`);
        }
        break;

      case 'inventory':
      case 'inv':
        const inventoryUser = message.mentions.users.first() || message.author;
        const inventory = await db.getInventory(inventoryUser.id);
        message.reply(inventory);
        break;

      case 'transfer':
        if (args.length < 2) {
          return message.reply('🚫 Usage: $transfer @user <item name>');
        }
        const transferRecipient = message.mentions.users.first();
        const itemToTransfer = args.slice(1).join(' ');
        const transferResult = await db.transferItem(userID, transferRecipient.id, itemToTransfer);
        message.reply(transferResult);
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

