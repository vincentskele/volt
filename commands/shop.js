// commands/shop.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { currency, formatCurrency } = require('../currency'); // Import the currency module

module.exports = {
  // Define all slash commands handled by this module
  data: [
    // View Shop Command
    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('View items available in the shop.'),
    
    // Buy Item Command
    new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Purchase an item from the shop.')
      .addStringOption(option =>
        option.setName('item')
          .setDescription('The name of the item to buy')
          .setRequired(true)),
    
    // View Inventory Command
    new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('View your or another user\'s inventory.')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to view inventory of')
          .setRequired(false)),
    
    // Add Shop Item Command (Admin Only)
    new SlashCommandBuilder()
      .setName('add-item')
      .setDescription('Add a new item to the shop. (Admin Only)')
      .addIntegerOption(option =>
        option.setName('price')
          .setDescription(`The price of the item in ${currency.symbol}`)
          .setRequired(true))
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the item')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('description')
          .setDescription('A brief description of the item')
          .setRequired(true)),
    
    // Remove Shop Item Command (Admin Only)
    new SlashCommandBuilder()
      .setName('remove-item')
      .setDescription('Remove an item from the shop. (Admin Only)')
      .addStringOption(option =>
        option.setName('item')
          .setDescription('The name of the item to remove')
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
      // Assuming commandType is the command name for prefix commands
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
      case 'shop':
        await this.viewShopSlash(interaction);
        break;
      case 'buy':
        await this.buyItemSlash(interaction, options);
        break;
      case 'inventory':
        await this.viewInventorySlash(interaction, options);
        break;
      case 'add-item':
        await this.addShopItemSlash(interaction, options, member);
        break;
      case 'remove-item':
        await this.removeShopItemSlash(interaction, options, member);
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
      case 'shop':
        await this.viewShopPrefix(message);
        break;
      case 'buy':
        await this.buyItemPrefix(message, args);
        break;
      case 'inventory':
      case 'inv':
        await this.viewInventoryPrefix(message, args);
        break;
      case 'add-item':
        await this.addShopItemPrefix(message, args);
        break;
      case 'remove-item':
        await this.removeShopItemPrefix(message, args);
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
   * Handle the prefix `$shop` command.
   * @param {Message} message 
   */
  async viewShopPrefix(message) {
    try {
      const items = await db.getShopItems();
      if (!items.length) {
        return message.reply('🚫 The shop is empty.');
      }

      const embed = new EmbedBuilder()
        .setTitle(`🛍️ ${currency.name.charAt(0).toUpperCase() + currency.name.slice(1)} Shop`)
        .setColor(0xFFD700)
        .setTimestamp();

      items.forEach(item => {
        embed.addFields({
          name: `• ${item.name} — ${formatCurrency(item.price)}`,
          value: `*${item.description}*`,
          inline: false
        });
      });

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('View Shop Prefix Error:', err);
      return message.reply(`🚫 Error retrieving shop: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$buy` command.
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async buyItemPrefix(message, args) {
    const itemName = args.join(' ');
    if (!itemName) {
      return message.reply(`Usage: \`$buy <item name>\``);
    }
    
    try {
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        return message.reply(`🚫 "${itemName}" not found in the shop.`);
      }
      
      const { wallet } = await db.getBalances(message.author.id);
      if (wallet < shopItem.price) {
        return message.reply(
          `🚫 You only have ${formatCurrency(wallet)}, but **${shopItem.name}** costs ${formatCurrency(shopItem.price)}.`
        );
      }
      
      // Process purchase
      await db.updateWallet(message.author.id, -shopItem.price);
      await db.addItemToInventory(message.author.id, shopItem.itemID, 1);
      
      const embed = new EmbedBuilder()
        .setTitle(`✅ Purchased ${shopItem.name}`)
        .setDescription(`You have bought **${shopItem.name}** for ${formatCurrency(shopItem.price)}.`)
        .setColor(0x32CD32)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Buy Item Prefix Error:', err);
      return message.reply(`🚫 Purchase failed: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$inventory` or `$inv` command.
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async viewInventoryPrefix(message, args) {
    const targetUser = message.mentions.users.first() || message.author;
    
    try {
      const inventory = await db.getInventory(targetUser.id);
      if (!inventory.length) {
        return message.reply(`${targetUser.username} has an empty inventory.`);
      }
      
      const embed = new EmbedBuilder()
        .setTitle(`🎒 ${targetUser.username}'s Inventory`)
        .setColor(0x00BFFF)
        .setTimestamp();

      inventory.forEach(item => {
        embed.addFields({
          name: `• ${item.name}`,
          value: `Quantity: ${item.quantity}`,
          inline: false
        });
      });

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('View Inventory Prefix Error:', err);
      return message.reply(`🚫 Inventory error: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$add-item` command. (Admin Only)
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async addShopItemPrefix(message, args) {
    if (!(await this.isAdmin(message))) {
      return message.reply('🚫 Only admins can add items.');
    }

    const [priceStr, ...rest] = args;
    if (!priceStr || !rest.length) {
      return message.reply('Usage: `$add-item <price> <name> - <description>`');
    }

    const price = parseInt(priceStr, 10);
    if (isNaN(price) || price <= 0) {
      return message.reply('🚫 Price must be a positive number.');
    }

    const itemContent = rest.join(' ');
    const [name, description] = itemContent.split(' - ');
    if (!description) {
      return message.reply('🚫 Format: `$add-item <price> <name> - <description>`');
    }

    try {
      await db.addShopItem(price, name.trim(), description.trim());
      
      const embed = new EmbedBuilder()
        .setTitle(`✅ Added ${name.trim()} to the Shop`)
        .addFields({
          name: 'Price',
          value: `${formatCurrency(price)}`
        }, {
          name: 'Description',
          value: `${description.trim()}`
        })
        .setColor(0x32CD32)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Add Shop Item Prefix Error:', err);
      return message.reply(`🚫 Failed to add item: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$remove-item` command. (Admin Only)
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async removeShopItemPrefix(message, args) {
    if (!(await this.isAdmin(message))) {
      return message.reply('🚫 Only admins can remove items.');
    }

    const itemName = args.join(' ');
    if (!itemName) {
      return message.reply('Usage: `$remove-item <item name>`');
    }

    try {
      await db.removeShopItem(itemName);
      
      const embed = new EmbedBuilder()
        .setTitle(`✅ Removed ${itemName} from the Shop`)
        .setColor(0xFF4500)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Remove Shop Item Prefix Error:', err);
      return message.reply(`🚫 Failed to remove item: ${err.message || err}`);
    }
  },

  // ===============================
  // Slash Command Handlers
  // ===============================

  /**
   * Handle the slash `/shop` command.
   * @param {CommandInteraction} interaction 
   */
  async viewShopSlash(interaction) {
    try {
      const items = await db.getShopItems();
      if (!items.length) {
        return interaction.reply({ content: '🚫 The shop is empty.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🛍️ ${currency.name.charAt(0).toUpperCase() + currency.name.slice(1)} Shop`)
        .setColor(0xFFD700)
        .setTimestamp();

      items.forEach(item => {
        embed.addFields({
          name: `• ${item.name} — ${formatCurrency(item.price)}`,
          value: `*${item.description}*`,
          inline: false
        });
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('View Shop Slash Error:', err);
      return interaction.reply({ content: `🚫 Error retrieving shop: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/buy` command.
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   */
  async buyItemSlash(interaction, options) {
    const itemName = options.getString('item');
    if (!itemName) {
      return interaction.reply({ content: '🚫 Item name is required.', ephemeral: true });
    }

    try {
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        return interaction.reply({ content: `🚫 "${itemName}" not found in the shop.`, ephemeral: true });
      }
      
      const { wallet } = await db.getBalances(interaction.user.id);
      if (wallet < shopItem.price) {
        return interaction.reply({
          content: `🚫 You only have ${formatCurrency(wallet)}, but **${shopItem.name}** costs ${formatCurrency(shopItem.price)}.`,
          ephemeral: true
        });
      }
      
      // Process purchase
      await db.updateWallet(interaction.user.id, -shopItem.price);
      await db.addItemToInventory(interaction.user.id, shopItem.itemID, 1);
      
      const embed = new EmbedBuilder()
        .setTitle(`✅ Purchased ${shopItem.name}`)
        .setDescription(`You have bought **${shopItem.name}** for ${formatCurrency(shopItem.price)}.`)
        .setColor(0x32CD32)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Buy Item Slash Error:', err);
      return interaction.reply({ content: `🚫 Purchase failed: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/inventory` command.
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   */
  async viewInventorySlash(interaction, options) {
    const targetUser = options.getUser('user') || interaction.user;
    
    try {
      const inventory = await db.getInventory(targetUser.id);
      if (!inventory.length) {
        return interaction.reply({
          content: `${targetUser.username} has an empty inventory.`,
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🎒 ${targetUser.username}'s Inventory`)
        .setColor(0x00BFFF)
        .setTimestamp();

      inventory.forEach(item => {
        embed.addFields({
          name: `• ${item.name}`,
          value: `Quantity: ${item.quantity}`,
          inline: false
        });
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('View Inventory Slash Error:', err);
      return interaction.reply({ content: `🚫 Inventory error: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/add-item` command. (Admin Only)
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   * @param {GuildMember} member 
   */
  async addShopItemSlash(interaction, options, member) {
    if (!(await this.isAdmin(interaction, member))) {
      return interaction.reply({ content: '🚫 Only admins can add items.', ephemeral: true });
    }

    const price = options.getInteger('price');
    const name = options.getString('name');
    const description = options.getString('description');

    if (!price || price <= 0) {
      return interaction.reply({ content: '🚫 Price must be a positive number.', ephemeral: true });
    }

    if (!name || !description) {
      return interaction.reply({ content: '🚫 Name and description are required.', ephemeral: true });
    }

    try {
      await db.addShopItem(price, name.trim(), description.trim());

      const embed = new EmbedBuilder()
        .setTitle(`✅ Added ${name.trim()} to the Shop`)
        .addFields({
          name: 'Price',
          value: `${formatCurrency(price)}`
        }, {
          name: 'Description',
          value: `${description.trim()}`
        })
        .setColor(0x32CD32)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Add Shop Item Slash Error:', err);
      return interaction.reply({ content: `🚫 Failed to add item: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/remove-item` command. (Admin Only)
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   * @param {GuildMember} member 
   */
  async removeShopItemSlash(interaction, options, member) {
    if (!(await this.isAdmin(interaction, member))) {
      return interaction.reply({ content: '🚫 Only admins can remove items.', ephemeral: true });
    }

    const itemName = options.getString('item');
    if (!itemName) {
      return interaction.reply({ content: '🚫 Item name is required.', ephemeral: true });
    }

    try {
      await db.removeShopItem(itemName.trim());

      const embed = new EmbedBuilder()
        .setTitle(`✅ Removed ${itemName.trim()} from the Shop`)
        .setColor(0xFF4500)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Remove Shop Item Slash Error:', err);
      return interaction.reply({ content: `🚫 Failed to remove item: ${err.message || err}`, ephemeral: true });
    }
  },

  // ===============================
  // Utility Functions
  // ===============================

  /**
   * Check if the user is an admin (either Discord admin or custom bot admin).
   * @param {Message|CommandInteraction} messageOrInteraction 
   * @param {GuildMember} member 
   * @returns {Promise<boolean>}
   */
  async isAdmin(messageOrInteraction, member = null) {
    let userId;
    let userPermissions;

    if (messageOrInteraction.isCommand) {
      // Slash command
      userId = messageOrInteraction.user.id;
      userPermissions = member.permissions;
    } else {
      // Prefix command
      userId = messageOrInteraction.author.id;
      userPermissions = messageOrInteraction.member.permissions;
    }

    const isDiscordAdmin = userPermissions.has(PermissionsBitField.Flags.Administrator);
    const isBotAdmin = await db.getAdmins().then(admins => admins.includes(userId));
    return isDiscordAdmin || isBotAdmin;
  }
};
