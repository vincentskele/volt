const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../db');
const { formatCurrency } = require('../../points');
const PREFIX = process.env.PREFIX || '$';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Purchase an item from the shop.')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The name of the item to buy')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  // This is used for slash command autocomplete
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    try {
      const items = await db.getShopItems();
      const choices = items
        .filter(item => item.quantity > 0)
        .map(item => item.name);
      
      const filtered = choices.filter(choice => choice.toLowerCase().includes(focusedValue));
      await interaction.respond(filtered.slice(0, 25).map(choice => ({ name: choice, value: choice })));
    } catch (err) {
      console.error('Autocomplete Error:', err);
      await interaction.respond([]);
    }
  },

  // Our execute function now supports both slash and prefix usage.
  async execute(context, messageOrInteraction, args) {
    let itemName, user;

    if (typeof messageOrInteraction === 'undefined') {
      // Slash command mode: `context` is the interaction.
      const interaction = context;
      itemName = interaction.options.getString('item');
      user = interaction.user;
    } else {
      // Prefix command mode: `messageOrInteraction` is the message, and `args` is an array of arguments.
      const message = messageOrInteraction;
      if (!args.length) {
        return message.reply(`🚫 Usage: \`${PREFIX}buy <item>\``);
      }
      // Join all args into one string.
      itemName = args.join(' ').trim();
      // If the item name is wrapped in quotes (single or double), remove them.
      if (
        (itemName.startsWith('"') && itemName.endsWith('"')) ||
        (itemName.startsWith("'") && itemName.endsWith("'"))
      ) {
        itemName = itemName.slice(1, -1);
      }
      user = message.author;
    }

    try {
      // Retrieve the shop item by name.
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        const replyPayload = {
          content: `🚫 "${itemName}" is not available in the shop.`,
          ephemeral: true,
        };
        if (messageOrInteraction) {
          return messageOrInteraction.reply(replyPayload);
        } else {
          return context.reply(replyPayload);
        }
      }

      // Check stock.
      if (shopItem.quantity <= 0) {
        const replyPayload = {
          content: `🚫 "${shopItem.name}" is out of stock.`,
          ephemeral: true,
        };
        if (messageOrInteraction) {
          return messageOrInteraction.reply(replyPayload);
        } else {
          return context.reply(replyPayload);
        }
      }

      // Check the user's wallet balance.
      const { wallet } = await db.getBalances(user.id);
      if (wallet < shopItem.price) {
        const replyPayload = {
          content: `🚫 You only have ${formatCurrency(wallet)}, but **${shopItem.name}** costs ${formatCurrency(shopItem.price)}.`,
          ephemeral: true,
        };
        if (messageOrInteraction) {
          return messageOrInteraction.reply(replyPayload);
        } else {
          return context.reply(replyPayload);
        }
      }

      // Deduct the item price from the user's wallet.
      await db.updateWallet(user.id, -shopItem.price);

      // Add the purchased item to the user's inventory.
      await db.addItemToInventory(user.id, shopItem.itemID, 1);

      // Decrease the shop quantity.
      await db.updateShopItemQuantity(shopItem.itemID, shopItem.quantity - 1);

      // Build a success embed.
      const embed = new EmbedBuilder()
        .setTitle(`✅ Purchased ${shopItem.name}`)
        .setDescription(`You have bought **${shopItem.name}** for ${formatCurrency(shopItem.price)}.`)
        .setColor(0x32CD32)
        .setTimestamp();

      if (messageOrInteraction) {
        return messageOrInteraction.reply({ embeds: [embed] });
      } else {
        return context.reply({ embeds: [embed] });
      }
    } catch (err) {
      console.error('Buy Item Error:', err);
      const errorPayload = {
        content: `🚫 Purchase failed: ${err.message || err}`,
        ephemeral: true,
      };
      if (messageOrInteraction) {
        return messageOrInteraction.reply(errorPayload);
      } else {
        return context.reply(errorPayload);
      }
    }
  },
};
