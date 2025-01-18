// commands/pets.js
const { PermissionsBitField } = require('discord.js');
const db = require('../db');

// ASCII art for different pet types
const PET_ART = {
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

class PetsModule {
  static async createPet(message, args) {
    if (args.length < 2) {
      return message.reply('Usage: `$create-pet <name> <type>`\nTypes: dragon, phoenix, griffin, unicorn');
    }

    const type = args.pop().toLowerCase();
    const name = args.join(' ');
    
    const validTypes = Object.keys(PET_ART);
    if (!validTypes.includes(type)) {
      return message.reply(`Invalid pet type. Choose from: ${validTypes.join(', ')}`);
    }
    
    try {
      await db.createPet(message.author.id, name, type);
      return message.reply(`🎉 Congratulations on your new ${type} named **${name}**!`);
    } catch (err) {
      if (err.toString().includes('UNIQUE')) {
        return message.reply('You already have a pet with that name!');
      }
      return message.reply(`🚫 Failed to create pet: ${err}`);
    }
  }

  static async listPets(message, args) {
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

  static async battlePets(message, args) {
    // Syntax: $battle <pet name> @user <their pet name> <bet>
    if (args.length < 4) {
      return message.reply('Usage: `$battle <your pet> @opponent <their pet> <bet>`');
    }
    
    const opponent = message.mentions.users.first();
    if (!opponent) {
      return message.reply('Please @mention your opponent.');
    }
    if (opponent.id === message.author.id) {
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
        db.getPet(message.author.id, pet1Name),
        db.getPet(opponent.id, pet2Name)
      ]);

      if (!pet1) {
        return message.reply(`You don't have a pet named "${pet1Name}"`);
      }
      if (!pet2) {
        return message.reply(`${opponent.username} doesn't have a pet named "${pet2Name}"`);
      }

      // Battle logic
      const result = await db.battlePets(pet1.petID, pet2.petID, bet);
      
      const winnerArt = PET_ART[result.winner.type];
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

  static async execute(command, message, args) {
    switch (command) {
      case 'create-pet':
        return this.createPet(message, args);
      case 'pets':
        return this.listPets(message, args);
      case 'battle':
        return this.battlePets(message, args);
      default:
        return null;
    }
  }
}

module.exports = PetsModule;
