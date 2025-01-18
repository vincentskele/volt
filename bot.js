require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const db = require('./db'); // The updated DB logic

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '$';

function formatCard(card) {
  if (!card || !card.value || !card.suit) {
    return '??';
  }
  return `${card.value}${card.suit}`;
}

function formatHand(hand) {
  if (!Array.isArray(hand)) {
    return 'No cards';
  }
  return hand.map(card => formatCard(card)).join(' ');
}

function calculateHandTotal(hand) {
  if (!Array.isArray(hand)) {
    return 0;
  }
  
  let total = 0;
  let aces = 0;
  
  for (const card of hand) {
    if (!card || !card.value) continue;
    
    if (card.value === 'A') {
      aces++;
    } else if (['K', 'Q', 'J'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value) || 0;
    }
  }
  
  for (let i = 0; i < aces; i++) {
    if (total + 11 <= 21) {
      total += 11;
    } else {
      total += 1;
    }
  }
  
  return total;
}
function getActiveGames(userID) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM blackjack_games WHERE userID = ? AND status = "active"',
      [userID],
      (err, games) => {
        if (err) return reject(err);
        if (!games) return resolve([]);
        games.forEach(game => {
          game.playerHand = JSON.parse(game.playerHand);
          game.dealerHand = JSON.parse(game.dealerHand);
        });
        resolve(games);
      }
    );
  });
}


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
**Pizza Bot Commands (with Bank, Rob, Jobs, Pets & Games):**

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
  🛍️ **$buy <item name>**: Purchase an item (from your wallet).
  🛍️ **$inventory** (or **$inv**) [@user]: Show someone's items.
  🛍️ **$add-item <price> <name> - <desc>** (Admin)
  🛍️ **$remove-item <name>** (Admin)

**Leaderboard & Admin System:**
  🍕 **$leaderboard**: Shows top 10 total (wallet+bank).
  🍕 **$add-admin @user**, **$remove-admin @user**, **$list-admins**

**Jobs (multi-assignee, per-user completion):**
  🛠️ **$add-job <desc>** (Admin): Create a new job.
  🛠️ **$joblist**: View all jobs & current assignees.
  🛠️ **$work**: Assign yourself to a random job (multi-person).
  🛠️ **$complete-job <@user> <jobID> <reward>** (Admin): Pays user for job completion

**Pet System:**
  🐾 **$create-pet <name> <type>**: Create a pet (types: dragon, phoenix, griffin, unicorn)
  🐾 **$pets** [@user]: View your or another user's pets
  🐾 **$battle <your pet> @user <their pet> <bet>**: Battle pets for pizza rewards!

**Games:**
  🎲 **$blackjack <bet>**: Start a blackjack game
  🎲 **$hit**: Draw another card in blackjack
  🎲 **$stand**: Stay with your current hand in blackjack
        `;
        return message.reply(helpMessage);
      }

      /**
       * BALANCE (Shows wallet & bank)
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
       * DEPOSIT
       */
      case 'deposit': {
        const amount = parseInt(args[0], 10);
        if (isNaN(amount) || amount <= 0) {
          return message.reply('Usage: `$deposit <amount>`');
        }
        try {
          await db.deposit(userID, amount);
          return message.reply(`✅ Deposited ${amount} 🍕 into your bank.`);
        } catch (err) {
          return message.reply(`🚫 Deposit failed: ${err}`);
        }
      }

      /**
       * WITHDRAW
       */
      case 'withdraw': {
        const amount = parseInt(args[0], 10);
        if (isNaN(amount) || amount <= 0) {
          return message.reply('Usage: `$withdraw <amount>`');
        }
        try {
          await db.withdraw(userID, amount);
          return message.reply(`✅ Withdrew ${amount} 🍕 to your wallet.`);
        } catch (err) {
          return message.reply(`🚫 Withdraw failed: ${err}`);
        }
      }

      /**
       * ROB
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
              `💰 You robbed <@${targetUser.id}> and stole **${result.amountStolen}** 🍕!`
            );
          } else {
            return message.reply(
              `👮 Your robbery failed! You paid **${result.penalty}** 🍕 to <@${targetUser.id}>.`
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
        await db.updateWallet(userID, 6969);
        return message.reply('🍕 You baked 6969 pizzas into your wallet!');
      }

      /**
       * GIVE-MONEY (Wallet -> Wallet)
       */
      case 'give-money': {
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply('Usage: `$give-money @user <amount>`');
        }
        const amount = parseInt(args[1], 10);
        if (isNaN(amount) || amount <= 0) {
          return message.reply('🚫 Please specify a valid amount.');
        }
        try {
          await db.transferFromWallet(userID, targetUser.id, amount);
          return message.reply(`✅ You gave ${amount} 🍕 to <@${targetUser.id}>!`);
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
          return message.reply(`🎉 You have redeemed **${itemName}**!`);
        } catch (err) {
          return message.reply(`🚫 Redemption failed: ${err}`);
        }
      }

      /**
       * LEADERBOARD
       */
      case 'leaderboard': {
        try {
          const lb = await db.getLeaderboard();
          if (!lb.length) {
            return message.reply('🚫 No data for leaderboard.');
          }
          const lines = lb.map((row, i) => {
            const total = row.wallet + row.bank;
            return `\`${i + 1}\`. <@${row.userID}> - Wallet: ${row.wallet}, Bank: ${row.bank} (Total: ${total})`;
          });
          return message.reply(`**🍕 Leaderboard (Top 10)**\n${lines.join('\n')}`);
        } catch (err) {
          return message.reply(`🚫 Leaderboard failed: ${err}`);
        }
      }
      /**
       * GAMES
       */
/**
 * BLACKJACK COMMANDS
 */
case 'blackjack': {
  const bet = parseInt(args[0], 10);
  if (isNaN(bet) || bet <= 0) {
    return message.reply('Usage: `$blackjack <bet>`');
  }
  try {
    const game = await db.startBlackjackGame(userID, bet);
    const playerTotal = calculateHandTotal(game.playerHand);
    const response = [
      '🎲 **Blackjack Game Started!**',
      `Bet: ${bet} 🍕\n`,
      'Your hand:',
      formatHand(game.playerHand),
      `Total: ${playerTotal}\n`,
      'Dealer shows:',
      formatHand(game.dealerHand),
      '\nType `$hit` to draw another card or `$stand` to stay.'
    ];
    return message.reply(response.join('\n'));
  } catch (err) {
    return message.reply(`🚫 ${err}`);
  }
}

case 'hit': {
  try {
    const games = await db.getActiveGames(userID);
    if (!games.length) {
      return message.reply('🚫 No active blackjack game found.');
    }
    const result = await db.blackjackHit(games[0].gameID);
    
    const response = [
      `Drew: ${formatCard(result.newCard)}`,
      '\nYour hand:',
      formatHand(result.playerHand),
      `Total: ${calculateHandTotal(result.playerHand)}`
    ];

    if (result.status === 'dealer_win') {
      response.push('\n💔 Bust! Better luck next time!');
    } else {
      response.push('\nType `$hit` for another card or `$stand` to stay.');
    }
    
    return message.reply(response.join('\n'));
  } catch (err) {
    return message.reply(`🚫 ${err}`);
  }
}

case 'stand': {
  try {
    const games = await db.getActiveGames(userID);
    if (!games.length) {
      return message.reply('🚫 No active blackjack game found.');
    }
    const result = await db.blackjackStand(games[0].gameID);
    
    const response = [
      'Final hands:\n',
      'Dealer:',
      formatHand(result.dealerHand),
      `Total: ${result.dealerTotal}\n`,
      'Your hand:',
      formatHand(games[0].playerHand),
      `Total: ${result.playerTotal}\n`
    ];

    switch (result.status) {
      case 'player_win':
        response.push(`🎉 You win ${games[0].bet * 2} 🍕!`);
        break;
      case 'dealer_win':
        response.push('💔 Dealer wins! Better luck next time!');
        break;
      case 'push':
        response.push(`😅 Push! Your ${games[0].bet} 🍕 bet has been returned.`);
        break;
    }
    
    return message.reply(response.join('\n'));
  } catch (err) {
    return message.reply(`🚫 ${err}`);
  }
}

      /**
       * PET COMMANDS
       */
      case 'create-pet': {
        if (args.length < 2) {
          return message.reply('Usage: `$create-pet <name> <type>`\nTypes: dragon, phoenix, griffin, unicorn');
        }
        const type = args.pop().toLowerCase();
        const name = args.join(' ');
        
        const validTypes = ['dragon', 'phoenix', 'griffin', 'unicorn'];
        if (!validTypes.includes(type)) {
          return message.reply(`Invalid pet type. Choose from: ${validTypes.join(', ')}`);
        }
        
        try {
          await db.createPet(userID, name, type);
          return message.reply(`🎉 Congratulations on your new ${type} named **${name}**!`);
        } catch (err) {
          if (err.toString().includes('UNIQUE')) {
            return message.reply('You already have a pet with that name!');
          }
          return message.reply(`🚫 Failed to create pet: ${err}`);
        }
      }

      case 'pets': {
        const targetUser = message.mentions.users.first() || message.author;
        try {
          const pets = await db.getUserPets(targetUser.id);
          if (!pets.length) {
            return message.reply(`${targetUser.username} has no pets yet! Use \`$create-pet\` to get one.`);
          }
          
          const petList = pets.map(p => 
            `• **${p.name}** (${p.type})\n` +
            `  Level ${p.level} | XP: ${p.exp}/100\n` +
            `  Record: ${p.wins}W - ${p.losses}L`
          ).join('\n\n');
          
          return message.reply(
            `🐾 **${targetUser.username}'s Pets:**\n\n${petList}`
          );
        } catch (err) {
          return message.reply(`🚫 Failed to get pets: ${err}`);
        }
      }

      case 'battle': {
        // Syntax: $battle <pet name> @user <their pet name> <bet>
        if (args.length < 4) {
          return message.reply('Usage: `$battle <your pet> @opponent <their pet> <bet>`');
        }
        
        const opponent = message.mentions.users.first();
        if (!opponent) {
          return message.reply('Please @mention your opponent.');
        }
        if (opponent.id === userID) {
          return message.reply('You cannot battle yourself!');
        }

        // Parse arguments
        const opponentMentionIndex = args.findIndex(arg => arg.startsWith('<@'));
        const pet1Name = args.slice(0, opponentMentionIndex).join(' ');
        const pet2Name = args.slice(opponentMentionIndex + 1, -1).join(' ');
        const bet = parseInt(args[args.length - 1], 10);

        if (isNaN(bet) || bet <= 0) {
          return message.reply('Please specify a valid bet amount.');
        }

        try {
          // Get both pets
          const [pet1, pet2] = await Promise.all([
            db.getPet(userID, pet1Name),
            db.getPet(opponent.id, pet2Name)
          ]);

          if (!pet1) {
            return message.reply(`You don't have a pet named "${pet1Name}"`);
          }
          if (!pet2) {
            return message.reply(`${opponent.username} doesn't have a pet named "${pet2Name}"`);
          }

          // Battle!
          const result = await db.battlePets(pet1.petID, pet2.petID, bet);
          
          // Format response with ASCII art
          const winnerArt = getArtForPet(result.winner.type);
          const response = [
            '⚔️ **BATTLE RESULTS** ⚔️\n',
            winnerArt,
            `\n**${result.winner.name}** (Level ${result.winner.level}) is VICTORIOUS!`,
            `Power: ${Math.floor(result.winnerPower)} vs ${Math.floor(result.loserPower)}`,
            `\nWinner receives ${bet * 2} 🍕!`,
            `\nNew Record:`,
            `${result.winner.name}: ${result.winner.wins + 1}W - ${result.winner.losses}L`,
            `${result.loser.name}: ${result.loser.wins}W - ${result.loser.losses + 1}L`
          ];
          
          return message.reply(response.join('\n'));
        } catch (err) {
          return message.reply(`🚫 Battle failed: ${err}`);
        }
      }

// Add these helper functions at the bottom of bot.js:

function getArtForPet(type) {
  const art = {
    dragon: `
      /\\___/\\
     (  o o  )
      (  T  ) 
     .^'^'^'^.
    .'/  |  \\'.
   /  |  |  |  \\
   |,-'--|--'-.|`,
    phoenix: `
       ,//\\
      /// \\\\
     ///   \\\\
    ///     \\\\
   ///  ___  \\\\
  ///  /  \\  \\\\
 ///  /   /\\  \\\\`,
    griffin: `
      /\\/\\
     ((ovo))
     ():::()
      VV-VV`,
    unicorn: `
     /\\     
    ( \\\\    
     \\ \\\\  
     _\\_\\\\__
    (______)\\
     \\______/`
  };
  
  return art[type] || '';
}

      /**
       * SHOP
       */
      case 'shop': {
        try {
          const items = await db.getShopItems();
          if (!items.length) {
            return message.reply('🚫 The shop is empty.');
          }
          const lines = items.map(
            it => `• **${it.name}** — ${it.price}\n   *${it.description}*`
          );
          return message.reply(`🛍️ **Shop Items:**\n${lines.join('\n')}`);
        } catch (err) {
          return message.reply(`🚫 Error retrieving shop: ${err}`);
        }
      }

      case 'buy': {
        const itemName = args.join(' ');
        if (!itemName) {
          return message.reply('Usage: `$buy <item name>`');
        }
        try {
          const shopItem = await db.getShopItemByName(itemName);
          if (!shopItem) {
            return message.reply(`🚫 "${itemName}" not in the shop.`);
          }
          const { wallet } = await db.getBalances(userID);
          if (wallet < shopItem.price) {
            return message.reply(
              `🚫 You only have ${wallet}, but **${shopItem.name}** costs ${shopItem.price}.`
            );
          }
          // Subtract from wallet, add item
          await db.updateWallet(userID, -shopItem.price);
          await db.addItemToInventory(userID, shopItem.itemID, 1);
          return message.reply(`✅ You purchased **${shopItem.name}**!`);
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
          return message.reply(`🚫 Inventory error: ${err}`);
        }
      }

      case 'add-item': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only admins can add items.');
        }
        const [priceStr, ...rest] = args;
        if (!priceStr || !rest.length) {
          return message.reply('Usage: `$add-item <price> <name> - <description>`');
        }
        const price = parseInt(priceStr, 10);
        if (isNaN(price)) {
          return message.reply('Price must be a number.');
        }
        const split = rest.join(' ').split(' - ');
        if (split.length < 2) {
          return message.reply('Format: `$add-item <price> <name> - <description>`');
        }
        const itemName = split[0];
        const itemDesc = split[1];
        try {
          await db.addShopItem(price, itemName, itemDesc);
          return message.reply(`✅ Added **${itemName}** for ${price}.`);
        } catch (err) {
          return message.reply(`🚫 Add item failed: ${err}`);
        }
      }

      case 'remove-item': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only admins can remove items.');
        }
        const itemToRemove = args.join(' ');
        if (!itemToRemove) {
          return message.reply('Usage: `$remove-item <item name>`');
        }
        try {
          await db.removeShopItem(itemToRemove);
          return message.reply(`✅ Removed **${itemToRemove}** from shop.`);
        } catch (err) {
          return message.reply(`🚫 Remove item failed: ${err}`);
        }
      }

      /**
       * JOB COMMANDS
       * (Multi-assignee, Per-user completion)
       */
      case 'add-job': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only admins can add jobs.');
        }
        const desc = args.join(' ');
        if (!desc) {
          return message.reply('Usage: `$add-job <description>`');
        }
        try {
          await db.addJob(desc);
          return message.reply(`✅ Added job: "${desc}"`);
        } catch (err) {
          return message.reply(`🚫 Add job failed: ${err}`);
        }
      }

      case 'joblist': {
        try {
          const jobs = await db.getJobList();
          if (!jobs.length) {
            return message.reply('🚫 No jobs available.');
          }
          const lines = jobs.map(j => {
            if (!j.assignees.length) return `• [ID: ${j.jobID}] ${j.description} — None assigned`;
            const assignedStr = j.assignees.map(u => `<@${u}>`).join(', ');
            return `• [ID: ${j.jobID}] ${j.description} — ${assignedStr}`;
          });
          return message.reply(`🛠️ **Jobs List:**\n${lines.join('\n')}`);
        } catch (err) {
          return message.reply(`🚫 Joblist error: ${err}`);
        }
      }

      case 'work': {
        try {
          const job = await db.assignRandomJob(userID);
          if (!job) {
            return message.reply('🚫 No job available or you are on all of them.');
          }
          return message.reply(`🛠️ Assigned to job ID ${job.jobID}: "${job.description}"`);
        } catch (err) {
          return message.reply(`🚫 Work failed: ${err}`);
        }
      }

      /**
       * COMPLETE-JOB (Per-User)
       */
      case 'complete-job': {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('🚫 Only admins can complete jobs.');
        }
        const targetUser = message.mentions.users.first();
        if (!targetUser || args.length < 3) {
          return message.reply('Usage: `$complete-job <@user> <jobID> <reward>`');
        }
        const jobID = parseInt(args[1], 10);
        const reward = parseInt(args[2], 10);
        if (isNaN(jobID) || isNaN(reward)) {
          return message.reply('Job ID and reward must be numbers.');
        }
        try {
          const result = await db.completeJob(jobID, targetUser.id, reward);
          if (!result) {
            return message.reply(`🚫 Job ${jobID} does not exist.`);
          }
          if (result.notAssigned) {
            return message.reply(`🚫 <@${targetUser.id}> is not assigned to job ${jobID}.`);
          }
          return message.reply(
            `✅ Completed job ${jobID} for <@${targetUser.id}> with reward **${reward}** 🍕!`
          );
        } catch (err) {
          return message.reply(`🚫 Complete job failed: ${err}`);
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
            return message.reply('🚫 No admins added yet.');
          }
          const list = admins.map(a => `<@${a}>`).join(', ');
          return message.reply(`👮 **Bot Admins:** ${list}`);
        } catch (err) {
          return message.reply(`🚫 Failed to list admins: ${err}`);
        }
      }

      default:
        // Unknown command
        break;
    }
  } catch (error) {
    console.error('Error handling command:', error);
    return message.reply('🚫 An error occurred while processing your command.');
  }
});

client.login(process.env.TOKEN);

