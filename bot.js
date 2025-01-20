require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const GamesModule = require('./commands/games');
const ShopModule = require('./commands/shop');
const PetsModule = require('./commands/pets');
const JobsModule = require('./commands/jobs');
const EconomyModule = require('./commands/economy');
const HelpModule = require('./commands/help');

const { currency } = require('./currency');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = process.env.PREFIX || '$';

// Command mapping for easy routing
const commandModules = {
  // Games commands
  blackjack: GamesModule,
  hit: GamesModule,
  stand: GamesModule,

  // Shop commands
  shop: ShopModule,
  buy: ShopModule,
  inventory: ShopModule,
  inv: ShopModule,
  'add-item': ShopModule,
  'remove-item': ShopModule,

  // Pet commands
  'create-pet': PetsModule,
  pets: PetsModule,
  battle: PetsModule,

  // Job commands
  'add-job': JobsModule,
  joblist: JobsModule,
  work: JobsModule,
  'complete-job': JobsModule,

  // Economy commands
  balance: EconomyModule,
  deposit: EconomyModule,
  withdraw: EconomyModule,
  rob: EconomyModule,
  bake: EconomyModule,
  'give-money': EconomyModule,
  'give-item': EconomyModule,
  redeem: EconomyModule,
  leaderboard: EconomyModule,
  'add-admin': EconomyModule,
  'remove-admin': EconomyModule,
  'list-admins': EconomyModule,

  // Help command (dynamic)
  [currency.helpCommand]: HelpModule,
};

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is ready to use commands with prefix "${PREFIX}".`);
});

client.on('messageCreate', async (message) => {
  // Only check for prefix now, allowing all bot messages
  if (!message.content.startsWith(PREFIX)) return;

  const [command, ...args] = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = command.toLowerCase();

  try {
    // Execute the command if it exists in the mapping
    const module = commandModules[commandName];
    if (module) {
      await module.execute(commandName, message, args);
    } else {
      console.log(`Unknown command: ${commandName}`);
    }
  } catch (error) {
    console.error('Error handling command:', error);
    await message.reply('🚫 An error occurred while processing your command.');
  }
});

// Login the bot using the token from the .env file
client.login(process.env.TOKEN);