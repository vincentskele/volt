// commands/pets.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../db');
const { currency, formatCurrency } = require('../currency');

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

module.exports = {
  // Define all slash commands handled by this module
  data: [
    // Create Pet Command
    new SlashCommandBuilder()
      .setName('create-pet')
      .setDescription('Create a new pet.')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of your pet')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('type')
          .setDescription('The type of pet')
          .setRequired(true)
          .addChoices(
            { name: 'Dragon', value: 'dragon' },
            { name: 'Phoenix', value: 'phoenix' },
            { name: 'Griffin', value: 'griffin' },
            { name: 'Unicorn', value: 'unicorn' }
          )),
    
    // List Pets Command
    new SlashCommandBuilder()
      .setName('pets')
      .setDescription('View your or another user\'s pets.')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to view pets of')
          .setRequired(false)),
    
    // Battle Pets Command
    new SlashCommandBuilder()
      .setName('battle')
      .setDescription('Battle your pet against another user\'s pet.')
      .addStringOption(option =>
        option.setName('your_pet')
          .setDescription('Your pet\'s name')
          .setRequired(true))
      .addUserOption(option =>
        option.setName('opponent')
          .setDescription('The user you want to battle')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('their_pet')
          .setDescription('Opponent\'s pet\'s name')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('bet')
          .setDescription(`The amount of ${currency.symbol} to bet`)
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
    } else if (commandType === 'create-pet' || 
               commandType === 'pets' || 
               commandType === 'battle') {
      await this.handlePrefixCommand(commandType, messageOrInteraction, args);
    }
  },

  /**
   * Handle slash command interactions.
   * @param {CommandInteraction} interaction 
   */
  async handleSlashCommand(interaction) {
    const { commandName, options, user, member } = interaction;

    switch (commandName) {
      case 'create-pet':
        await this.createPetSlash(interaction, options, member);
        break;
      case 'pets':
        await this.listPetsSlash(interaction, options);
        break;
      case 'battle':
        await this.battlePetsSlash(interaction, options);
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
      case 'create-pet':
        await this.createPetPrefix(message, args);
        break;
      case 'pets':
        await this.listPetsPrefix(message, args);
        break;
      case 'battle':
        await this.battlePetsPrefix(message, args);
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
   * Handle the prefix `$create-pet` command.
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async createPetPrefix(message, args) {
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
      const embed = new EmbedBuilder()
        .setTitle(`🎉 Congratulations on your new ${type}!`)
        .setDescription(`**Name:** ${name}\n**Type:** ${type.charAt(0).toUpperCase() + type.slice(1)}`)
        .setThumbnail(`attachment://${type}.png`) // Assuming you have images named dragon.png, etc.
        .setColor(0x00AE86)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (err) {
      if (err.toString().includes('UNIQUE')) {
        return message.reply('🚫 You already have a pet with that name!');
      }
      console.error('Create Pet Prefix Error:', err);
      return message.reply(`🚫 Failed to create pet: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$pets` command.
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async listPetsPrefix(message, args) {
    const targetUser = message.mentions.users.first() || message.author;

    try {
      const pets = await db.getUserPets(targetUser.id);
      if (!pets.length) {
        return message.reply(`${targetUser.username} has no pets yet! Use \`$create-pet\` to get one.`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`🐾 ${targetUser.username}'s Pets`)
        .setColor(0x00AE86)
        .setTimestamp();

      pets.forEach(pet => {
        embed.addFields({
          name: `• ${pet.name} (${pet.type.charAt(0).toUpperCase() + pet.type.slice(1)})`,
          value: `Level: ${pet.level} | XP: ${pet.exp}/100\nRecord: ${pet.wins}W - ${pet.losses}L`,
          inline: false
        });
      });

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('List Pets Prefix Error:', err);
      return message.reply(`🚫 Failed to get pets: ${err.message || err}`);
    }
  },

  /**
   * Handle the prefix `$battle` command.
   * @param {Message} message 
   * @param {Array<string>} args 
   */
  async battlePetsPrefix(message, args) {
    // Syntax: $battle <pet name> @user <their pet name> <bet>
    if (args.length < 4) {
      return message.reply('Usage: `$battle <your pet> @opponent <their pet> <bet>`');
    }

    const opponent = message.mentions.users.first();
    if (!opponent) {
      return message.reply('🚫 Please @mention your opponent.');
    }
    if (opponent.id === message.author.id) {
      return message.reply('🚫 You cannot battle yourself!');
    }

    // Parse arguments
    const opponentMentionIndex = args.findIndex(arg => arg.startsWith('<@'));
    const pet1Name = args.slice(0, opponentMentionIndex).join(' ');
    const pet2Name = args.slice(opponentMentionIndex + 1, -1).join(' ');
    const bet = parseInt(args[args.length - 1], 10);

    if (isNaN(bet) || bet <= 0) {
      return message.reply('🚫 Please specify a valid bet amount.');
    }

    try {
      // Get both pets
      const [pet1, pet2] = await Promise.all([
        db.getPet(message.author.id, pet1Name),
        db.getPet(opponent.id, pet2Name)
      ]);

      if (!pet1) {
        return message.reply(`🚫 You don't have a pet named "${pet1Name}"`);
      }
      if (!pet2) {
        return message.reply(`🚫 ${opponent.username} doesn't have a pet named "${pet2Name}"`);
      }

      // Battle logic
      const result = await db.battlePets(pet1.petID, pet2.petID, bet);

      const winnerArt = PET_ART[result.winner.type] || '🎉';
      const response = [
        '⚔️ **BATTLE RESULTS** ⚔️',
        `\`\`\`${winnerArt}\`\`\``,
        `**${result.winner.name}** (Level ${result.winner.level}) is VICTORIOUS!`,
        `Power: ${Math.floor(result.winnerPower)} vs ${Math.floor(result.loserPower)}`,
        `\nWinner receives ${formatCurrency(bet * 2)}!`,
        `\n**New Record:**`,
        `${result.winner.name}: ${result.winner.wins + 1}W - ${result.winner.losses}L`,
        `${result.loser.name}: ${result.loser.wins}W - ${result.loser.losses + 1}L`
      ];

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Battle Results ⚔️')
        .setDescription(`**Winner:** ${result.winner.name} (${result.winner.type})\n` +
                       `**Loser:** ${result.loser.name} (${result.loser.type})\n\n` +
                       `**Power:** ${Math.floor(result.winnerPower)} vs ${Math.floor(result.loserPower)}\n` +
                       `**Reward:** ${formatCurrency(bet * 2)} 🍕`)
        .setColor(0xFF0000)
        .setThumbnail(`attachment://${result.winner.type}.png`) // Assuming images are available
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Battle Pets Prefix Error:', err);
      return message.reply(`🚫 Battle failed: ${err.message || err}`);
    }
  },

  // ===============================
  // Slash Command Handlers
  // ===============================

  /**
   * Handle the slash `/create-pet` command.
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   * @param {GuildMember} member 
   */
  async createPetSlash(interaction, options, member) {
    const name = options.getString('name');
    const type = options.getString('type').toLowerCase();

    const validTypes = Object.keys(PET_ART);
    if (!validTypes.includes(type)) {
      return interaction.reply({ content: `🚫 Invalid pet type. Choose from: ${validTypes.join(', ')}`, ephemeral: true });
    }

    try {
      await db.createPet(interaction.user.id, name, type);
      
      const embed = new EmbedBuilder()
        .setTitle(`🎉 Congratulations on your new ${type}!`)
        .setDescription(`**Name:** ${name}\n**Type:** ${type.charAt(0).toUpperCase() + type.slice(1)}`)
        .setColor(0x00AE86)
        .setTimestamp();

      // Optionally, add pet art as an image if available
      // .setImage(`attachment://${type}.png`)

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      if (err.toString().includes('UNIQUE')) {
        return interaction.reply({ content: '🚫 You already have a pet with that name!', ephemeral: true });
      }
      console.error('Create Pet Slash Error:', err);
      return interaction.reply({ content: `🚫 Failed to create pet: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/pets` command.
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   */
  async listPetsSlash(interaction, options) {
    const targetUser = options.getUser('user') || interaction.user;

    try {
      const pets = await db.getUserPets(targetUser.id);
      if (!pets.length) {
        return interaction.reply({ content: `${targetUser.username} has no pets yet! Use \`/create-pet\` to get one.`, ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🐾 ${targetUser.username}'s Pets`)
        .setColor(0x00AE86)
        .setTimestamp();

      pets.forEach(pet => {
        embed.addFields({
          name: `• ${pet.name} (${pet.type.charAt(0).toUpperCase() + pet.type.slice(1)})`,
          value: `Level: ${pet.level} | XP: ${pet.exp}/100\nRecord: ${pet.wins}W - ${pet.losses}L`,
          inline: false
        });
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('List Pets Slash Error:', err);
      return interaction.reply({ content: `🚫 Failed to get pets: ${err.message || err}`, ephemeral: true });
    }
  },

  /**
   * Handle the slash `/battle` command.
   * @param {CommandInteraction} interaction 
   * @param {CommandInteractionOptionResolver} options 
   */
  async battlePetsSlash(interaction, options) {
    const yourPetName = options.getString('your_pet');
    const opponent = options.getUser('opponent');
    const theirPetName = options.getString('their_pet');
    const bet = options.getInteger('bet');

    if (opponent.id === interaction.user.id) {
      return interaction.reply({ content: '🚫 You cannot battle yourself!', ephemeral: true });
    }

    if (bet <= 0) {
      return interaction.reply({ content: '🚫 Please specify a positive bet amount.', ephemeral: true });
    }

    try {
      // Get both pets
      const [pet1, pet2] = await Promise.all([
        db.getPet(interaction.user.id, yourPetName),
        db.getPet(opponent.id, theirPetName)
      ]);

      if (!pet1) {
        return interaction.reply({ content: `🚫 You don't have a pet named "${yourPetName}"`, ephemeral: true });
      }
      if (!pet2) {
        return interaction.reply({ content: `🚫 ${opponent.username} doesn't have a pet named "${theirPetName}"`, ephemeral: true });
      }

      // Battle logic
      const result = await db.battlePets(pet1.petID, pet2.petID, bet);

      // Determine winner and loser
      const winner = result.winner; // { petID, name, type, level, ... }
      const loser = result.loser;   // same structure
      const winnerPower = result.winnerPower;
      const loserPower = result.loserPower;

      const winnerArt = PET_ART[winner.type] || '🎉';
      
      const embed = new EmbedBuilder()
        .setTitle('⚔️ Battle Results ⚔️')
        .addFields(
          { name: '**Winner:**', value: `${winner.name} (${winner.type.charAt(0).toUpperCase() + winner.type.slice(1)})`, inline: true },
          { name: '**Loser:**', value: `${loser.name} (${loser.type.charAt(0).toUpperCase() + loser.type.slice(1)})`, inline: true },
          { name: '**Power:**', value: `${Math.floor(winnerPower)} vs ${Math.floor(loserPower)}`, inline: true },
          { name: '**Reward:**', value: `${formatCurrency(bet * 2)} 🍕`, inline: false },
          { name: '**New Record:**', value: 
            `${winner.name}: ${winner.wins + 1}W - ${winner.losses}L\n` +
            `${loser.name}: ${loser.wins}W - ${loser.losses + 1}L`, inline: false }
        )
        .setColor(0xFF0000)
        .setTimestamp();

      // Optionally, attach pet images if available
      // embed.setThumbnail(`attachment://${winner.type}.png`);

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Battle Pets Slash Error:', err);
      return interaction.reply({ content: `🚫 Battle failed: ${err.message || err}`, ephemeral: true });
    }
  },

  // ===============================
  // Utility Functions
  // ===============================

  /**
   * Format a single pet's ASCII art.
   * @param {string} type 
   * @returns {string}
   */
  formatPetArt(type) {
    return PET_ART[type] || '';
  },

  /**
   * Additional utility functions can be added here if needed.
   */
};
