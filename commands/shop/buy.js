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
    )
    .addIntegerOption(option =>
      option
        .setName('quantity')
        .setDescription('How many of the item you want to buy')
        .setRequired(false)
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
    let itemName, quantity = 1, user;

    if (typeof messageOrInteraction === 'undefined') {
      // Slash command mode
      const interaction = context;
      itemName = interaction.options.getString('item');
      quantity = interaction.options.getInteger('quantity') || 1;
      user = interaction.user;
    } else {
      // Prefix command mode
      const message = messageOrInteraction;
      if (!args.length) {
        return message.reply(`🚫 Usage: \`${PREFIX}buy <item> [quantity]\``);
      }

      // Check if last arg is a number for quantity
      const lastArg = args[args.length - 1];
      const possibleQty = parseInt(lastArg);
      if (!isNaN(possibleQty)) {
        quantity = possibleQty;
        args.pop();
      }

      itemName = args.join(' ').trim();
      if (
        (itemName.startsWith('"') && itemName.endsWith('"')) ||
        (itemName.startsWith("'") && itemName.endsWith("'"))
      ) {
        itemName = itemName.slice(1, -1);
      }
      user = message.author;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
      const errorPayload = {
        content: `🚫 Quantity must be a positive whole number.`,
        ephemeral: true,
      };
      if (messageOrInteraction) return messageOrInteraction.reply(errorPayload);
      return context.reply(errorPayload);
    }

    try {
      const shopItem = await db.getShopItemByName(itemName);
      if (!shopItem) {
        const replyPayload = {
          content: `🚫 "${itemName}" is not available in the shop.`,
          ephemeral: true,
        };
        if (messageOrInteraction) return messageOrInteraction.reply(replyPayload);
        return context.reply(replyPayload);
      }

      if (shopItem.quantity < quantity) {
        const replyPayload = {
          content: `🚫 Only ${shopItem.quantity} left in stock for "${shopItem.name}".`,
          ephemeral: true,
        };
        if (messageOrInteraction) return messageOrInteraction.reply(replyPayload);
        return context.reply(replyPayload);
      }

      const totalCost = shopItem.price * quantity;
      const { wallet } = await db.getBalances(user.id);
      if (wallet < totalCost) {
        const replyPayload = {
          content: `🚫 You only have ${formatCurrency(wallet)}, but **${shopItem.name} x${quantity}** costs ${formatCurrency(totalCost)}.`,
          ephemeral: true,
        };
        if (messageOrInteraction) return messageOrInteraction.reply(replyPayload);
        return context.reply(replyPayload);
      }

      await db.updateWallet(user.id, -totalCost);
      await db.addItemToInventory(user.id, shopItem.itemID, quantity);
      await db.updateShopItemQuantity(shopItem.itemID, shopItem.quantity - quantity);

      const embed = new EmbedBuilder()
        .setTitle(`✅ Purchased ${shopItem.name} x${quantity}`)
        .setDescription(`You have bought **${shopItem.name} x${quantity}** for ${formatCurrency(totalCost)}.`)
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
      if (messageOrInteraction) return messageOrInteraction.reply(errorPayload);
      return context.reply(errorPayload);
    }
  },
};
