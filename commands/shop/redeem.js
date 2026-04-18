const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { redeemItem, getInventory, logItemRedemption } = require('../../db'); // Ensure you have both functions
const roboCheckAccountStore = require(path.resolve(__dirname, '..', '..', '..', 'robo-check', 'src', 'accountStore.js'));

const ROBO_CHECK_HOLDERS_PATH =
  process.env.ROBO_CHECK_HOLDERS_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'robo-check', 'src', 'data', 'holders.json');

const SUBMISSION_EMBED_COLORS = {
  itemRedemption: 0x8b5cf6,
};

function getSolanaExplorerUrl(walletAddress) {
  if (!walletAddress) return null;
  return `https://solscan.io/account/${walletAddress}`;
}

function formatSolanaWalletMessage(walletAddress) {
  if (!walletAddress) return null;
  return `${walletAddress}`;
}

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

function getLinkedWalletsForUser(userId) {
  try {
    const account = roboCheckAccountStore.getAccountByDiscordId(String(userId), roboCheckAccountStore.readVerifiedEntries());
    if (Array.isArray(account?.wallets) && account.wallets.length) {
      return account.wallets;
    }
  } catch (error) {
    console.error('Error reading Robo-Check verified wallets:', error);
  }

  const holders = readRoboCheckHolders();
  const holder = holders.find((entry) => String(entry.discordId) === String(userId));
  if (Array.isArray(holder?.wallets) && holder.wallets.length) {
    return holder.wallets;
  }
  if (holder?.walletAddress) {
    return [{ walletAddress: holder.walletAddress, isPrimary: true }];
  }
  return [];
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
      const commandText = `/redeem item="${itemName}" wallet="[redacted]"`;

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

      const channelId = process.env.ITEM_REDEMPTION_CHANNEL_ID || process.env.SUBMISSION_CHANNEL_ID;
      if (channelId) {
        try {
          const channel = await interaction.client.channels.fetch(channelId);
          if (channel) {
            const fields = [
              { name: 'Who', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
              { name: 'What', value: itemName, inline: true },
              { name: 'Where', value: `Discord /redeem in ${channelName}`, inline: true },
              { name: 'Channel ID', value: interaction.channelId || 'unknown', inline: true },
              { name: 'Inventory', value: `${itemName} ${beforeQty} → ${afterQty}`, inline: false },
              { name: 'When', value: `<t:${unix}:F>`, inline: false },
              { name: 'Command', value: commandText, inline: false },
            ];
            if (messageLink) {
              fields.push({ name: 'Message', value: messageLink, inline: false });
            }
            const embed = new EmbedBuilder()
              .setTitle('🧾 Item Redeemed')
              .setColor(SUBMISSION_EMBED_COLORS.itemRedemption)
              .addFields(fields)
              .setTimestamp(now);
            await channel.send({ embeds: [embed] });
            const walletMessage = formatSolanaWalletMessage(walletAddress);
            if (walletMessage) {
              await channel.send({ content: walletMessage });
            }
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
      const linkedWallets = getLinkedWalletsForUser(userId);
      if (!linkedWallets.length) {
        return interaction.respond([]);
      }
      const normalizedFocusedValue = String(focusedValue || '').trim().toLowerCase();
      return interaction.respond(
        linkedWallets
          .filter((wallet) => !normalizedFocusedValue || wallet.walletAddress.toLowerCase().includes(normalizedFocusedValue))
          .slice(0, 25)
          .map((wallet) => {
            const labelPrefix = wallet.isPrimary ? 'Primary wallet' : 'Linked wallet';
            const shortened = `${wallet.walletAddress.slice(0, 4)}...${wallet.walletAddress.slice(-4)}`;
            return {
              name: `${labelPrefix} (${shortened})`,
              value: wallet.walletAddress,
            };
          })
      );
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
