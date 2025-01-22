// commands/shop.js
const { PermissionsBitField } = require('discord.js');
const db = require('../db');

class ShopModule {
  /**
   * Check if the user is an admin (either Discord admin or custom bot admin).
   */
  static async isAdmin(message) {
    const isDiscordAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isBotAdmin = await db.getAdmins().then(admins => admins.includes(message.author.id));
    return isDiscordAdmin || isBotAdmin;
  }

  static async viewShop(message) {
    try {
      const items = await db.getShopItems();
      if (!items.length) {
        return message.reply('🚫 The shop is empty.');
      }
      const lines = items.map(
        it => `• **${it.name}** — ${it.price} 🍕\n   *${it.description}*`
      );
      return message.reply(`🛍️ **Shop Items:**\n${lines.join('\n')}`);
    } catch (err) {
      return message.reply(`🚫 Error retrieving shop: ${err}`);
    }
  }

  static async buyItem(message, args) {
    const itemName = args.join(' ');
    if (!itemName) {
      return message.reply('Usage: `$buy <item name>`');
    }
    
    try {
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        return message.reply(`🚫 "${itemName}" not found in the shop.`);
      }
      
      const { wallet } = await db.getBalances(message.author.id);
      if (wallet < shopItem.price) {
        return message.reply(
          `🚫 You only have ${wallet} 🍕, but **${shopItem.name}** costs ${shopItem.price} 🍕.`
        );
      }
      
      // Process purchase
      await db.updateWallet(message.author.id, -shopItem.price);
      await db.addItemToInventory(message.author.id, shopItem.itemID, 1);
      return message.reply(`✅ You purchased **${shopItem.name}**!`);
    } catch (err) {
      return message.reply(`🚫 Purchase failed: ${err}`);
    }
  }

  static async viewInventory(message, args) {
    const targetUser = message.mentions.users.first() || message.author;
    
    try {
      const inventory = await db.getInventory(targetUser.id);
      if (!inventory.length) {
        return message.reply(`🚫 ${targetUser.username} has an empty inventory.`);
      }
      
      const itemList = inventory.map(i => `• **${i.name}** x${i.quantity}`).join('\n');
      return message.reply(`🎒 **${targetUser.username}'s Inventory:**\n${itemList}`);
    } catch (err) {
      return message.reply(`🚫 Inventory error: ${err}`);
    }
  }

  static async addShopItem(message, args) {
    if (!(await this.isAdmin(message))) {
      return message.reply('🚫 Only admins can add items.');
    }

    const [priceStr, ...rest] = args;
    if (!priceStr || !rest.length) {
      return message.reply('Usage: `$add-item <price> <name> - <description>`');
    }

    const price = parseInt(priceStr, 10);
    if (isNaN(price) || price <= 0) {
      return message.reply('Price must be a positive number.');
    }

    const itemContent = rest.join(' ');
    const [name, description] = itemContent.split(' - ');
    if (!description) {
      return message.reply('Format: `$add-item <price> <name> - <description>`');
    }

    try {
      await db.addShopItem(price, name.trim(), description.trim());
      return message.reply(`✅ Added **${name}** to the shop for ${price} 🍕.`);
    } catch (err) {
      return message.reply(`🚫 Failed to add item: ${err}`);
    }
  }

  static async removeShopItem(message, args) {
    if (!(await this.isAdmin(message))) {
      return message.reply('🚫 Only admins can remove items.');
    }

    const itemName = args.join(' ');
    if (!itemName) {
      return message.reply('Usage: `$remove-item <item name>`');
    }

    try {
      await db.removeShopItem(itemName);
      return message.reply(`✅ Removed **${itemName}** from the shop.`);
    } catch (err) {
      return message.reply(`🚫 Failed to remove item: ${err}`);
    }
  }

  static async execute(command, message, args) {
    switch (command) {
      case 'shop':
        return this.viewShop(message);
      case 'buy':
        return this.buyItem(message, args);
      case 'inventory':
      case 'inv':
        return this.viewInventory(message, args);
      case 'add-item':
        return this.addShopItem(message, args);
      case 'remove-item':
        return this.removeShopItem(message, args);
      default:
        return null;
    }
  }
}

module.exports = ShopModule;

