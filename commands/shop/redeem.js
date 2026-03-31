const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { redeemItem, getInventory, logItemRedemption } = require('../../db'); // Ensure you have both functions

const ROBO_CHECK_HOLDERS_PATH =
  process.env.ROBO_CHECK_HOLDERS_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'robo-check', 'src', 'data', 'holders.json');

function readRoboCheckHolders() {
  try {
    if (!fs.existsSync(ROBO_CHECK_HOLDERS_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(ROBO_CHECK_HOLDERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Error reading Robo-Check holders file:', error);
    return [];
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Use (redeem) an item from your inventory.')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The name of the item to use.')
        .setRequired(true)
        .setAutocomplete(true) // Enable autocomplete
    )
    .addStringOption(option =>
      option
        .setName('wallet')
        .setDescription('Paste your Solana wallet address here.')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const itemName = interaction.options.getString('item');
    const walletAddress = interaction.options.getString('wallet');

    if (!itemName) {
      return interaction.reply({
        content: 'Please specify an item to use.',
        ephemeral: true,
      });
    }
    if (!walletAddress) {
      return interaction.reply({
        content: 'Please paste your Solana wallet address.',
        ephemeral: true,
      });
    }

    try {
      await interaction.deferReply();
      // Fetch user inventory to verify ownership
      const inventory = await getInventory(userId);
      const ownedItem = inventory.find(item => item.name.toLowerCase() === itemName.toLowerCase());

      if (!ownedItem) {
        return interaction.editReply({
          content: `🚫 You do not have "${itemName}" in your inventory.`,
        });
      }

      // Attempt to redeem the item
      const resultMsg = await redeemItem(userId, itemName);
      await interaction.editReply({ content: resultMsg });

      const now = new Date();
      const unix = Math.floor(now.getTime() / 1000);
      let channelName = 'Unknown Channel';
      let messageLink = null;
      try {
        if (interaction.channel) {
          channelName = `#${interaction.channel.name}`;
        }
        const replyMessage = await interaction.fetchReply();
        if (interaction.guildId && interaction.channelId && replyMessage?.id) {
          messageLink = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${replyMessage.id}`;
        }
      } catch (fetchErr) {
        console.error('Failed to fetch reply for message link:', fetchErr);
      }
      const beforeQty = ownedItem.quantity;
      const afterQty = Math.max(beforeQty - 1, 0);
      const commandText = `/redeem item="${itemName}" wallet="${walletAddress}"`;

      try {
        await logItemRedemption({
          userID: userId,
          userTag: interaction.user.tag,
          itemName,
          walletAddress,
          source: 'discord',
          channelName,
          channelId: interaction.channelId,
          messageLink,
          commandText,
          inventoryBefore: beforeQty,
          inventoryAfter: afterQty,
        });
      } catch (dbErr) {
        console.error('Failed to store redemption log:', dbErr);
      }

      const channelId = process.env.SUBMISSION_CHANNEL_ID;
      if (channelId) {
        const messageLines = [
          '🧾 Item Redeemed',
          `Who: ${interaction.user.tag} (${interaction.user.id})`,
          `What: ${itemName}`,
          `Where: Discord /redeem in ${channelName}`,
          `Channel ID: ${interaction.channelId || 'unknown'}`,
          `Inventory: ${itemName} ${beforeQty} -> ${afterQty}`,
          `When: <t:${unix}:F>`,
          `Solana Wallet: ${walletAddress}`,
          `Command: ${commandText}`,
        ];
        if (messageLink) {
          messageLines.push(`Message: ${messageLink}`);
        }
        try {
          const channel = await interaction.client.channels.fetch(channelId);
          if (channel) {
            await channel.send(messageLines.join('\n'));
          }
        } catch (logErr) {
          console.error('Failed to log redemption:', logErr);
        }
      }

      return;
    } catch (error) {
      console.error('Error using item:', error);
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: error?.toString() || 'An error occurred while using the item.',
        });
      }
      return interaction.reply({
        content: error?.toString() || 'An error occurred while using the item.',
        ephemeral: true,
      });
    }
  },

  async autocomplete(interaction) {
    const userId = interaction.user.id;
    const focused = interaction.options.getFocused(true);
    const focusedValue = focused.value || '';

    if (focused.name === 'wallet') {
      const holders = readRoboCheckHolders();
      const holder = holders.find((entry) => String(entry.discordId) === String(userId));
      if (!holder?.walletAddress) {
        return interaction.respond([]);
      }
      const label = `Robo-Check wallet (${holder.walletAddress.slice(0, 4)}...${holder.walletAddress.slice(-4)})`;
      return interaction.respond([{ name: label, value: holder.walletAddress }]);
    }
    
    let inventoryItems;
    try {
      // Fetch user's inventory
      const inventory = await getInventory(userId);
      inventoryItems = inventory.map(item => item.name); // Extract item names

    } catch (error) {
      console.error('Error fetching inventory for autocomplete:', error);
      inventoryItems = [];
    }

    // Filter based on user input
    const filtered = inventoryItems
      .filter(name => name.toLowerCase().includes(focusedValue.toLowerCase()))
      .slice(0, 25); // Discord allows a max of 25 options

    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },
};
