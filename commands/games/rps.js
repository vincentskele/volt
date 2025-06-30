// commands/games/rps.js
const { SlashCommandBuilder } = require('discord.js');
const { updateWallet, getBalances } = require('../../db');
const { loadGames, saveGames } = require('../../utils/persistRPS');
const fs = require('fs');
const path = require('path');

// === RPS DAILY WIN BONUS TRACKER ===
const RPS_WIN_TRACKER_PATH = path.join(__dirname, '../../rpsWinTracker.json');
let rpsWinTracker = new Map();

// Load existing tracker from file
try {
  if (fs.existsSync(RPS_WIN_TRACKER_PATH)) {
    const raw = fs.readFileSync(RPS_WIN_TRACKER_PATH, 'utf8');
    rpsWinTracker = new Map(JSON.parse(raw));
    console.log('✅ Loaded RPS win tracker.');
  }
} catch (err) {
  console.error('⚠️ Error loading RPS win tracker:', err);
}

function saveRPSWinTracker() {
  fs.writeFileSync(RPS_WIN_TRACKER_PATH, JSON.stringify([...rpsWinTracker]), 'utf8');
}

function getTodayDate() {
  const now = new Date();
  // crude EST (UTC-5)
  const est = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return est.toISOString().split('T')[0];
}

/**
 * Awards the daily RPS bonus and returns the current win count for today.
 * @param {string} userId
 * @returns {Promise<number>} win count for today
 */
async function awardRPSBonus(userId) {
  const today = getTodayDate();
  const entry = rpsWinTracker.get(userId) || { date: today, wins: 0 };

  if (entry.date !== today) {
    entry.date = today;
    entry.wins = 0;
  }

  entry.wins++;
  const winNumber = entry.wins;
  if (winNumber <= 3) {
    // First three wins each day get +8 volts
    await updateWallet(userId, 8);
    console.log(`🎉 Bonus: +8 volts for user ${userId} (daily win #${winNumber}).`);
  }

  rpsWinTracker.set(userId, entry);
  saveRPSWinTracker();
  return winNumber;
}

// === DAILY RESET FOR RPS BONUS TRACKER ===
function scheduleRPSReset() {
  const now = new Date();
  // EST midnight is 05:00 UTC
  const estMidnight = new Date(now.toISOString().split('T')[0] + 'T05:00:00.000Z');
  let delay = estMidnight.getTime() - now.getTime();
  if (delay < 0) delay += 24 * 60 * 60 * 1000;

  setTimeout(() => {
    rpsWinTracker.clear();
    saveRPSWinTracker();
    console.log('🔄 RPS win tracker cleared for new day.');
    scheduleRPSReset();
  }, delay);
}

// Start daily reset scheduler
scheduleRPSReset();

// === RPS GAME LOGIC ===
const GAME_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2h
const activeRPSGames = loadGames();
const userToGame = new Map();

// Rehydrate on startup
for (const [gameId, game] of activeRPSGames.entries()) {
  userToGame.set(game.challengerId, gameId);
  userToGame.set(game.opponentId, gameId);
  game.timeout = setTimeout(() => {
    activeRPSGames.delete(gameId);
    userToGame.delete(game.challengerId);
    userToGame.delete(game.opponentId);
    saveGames(activeRPSGames);
  }, GAME_TIMEOUT_MS);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Rock Paper Scissors for volts.')
    .addSubcommand(sc =>
      sc.setName('challenge')
        .setDescription('Start a new RPS game (and lock in your first move).')
        .addUserOption(o =>
          o.setName('opponent')
            .setDescription('Who you want to challenge')
            .setRequired(true))
        .addIntegerOption(o =>
          o.setName('wager')
            .setDescription('Volts to wager')
            .setRequired(true))
        .addStringOption(o =>
          o.setName('choice')
            .setDescription('Your first move')
            .setRequired(true)
            .addChoices(
              { name: 'Rock', value: 'rock' },
              { name: 'Paper', value: 'paper' },
              { name: 'Scissors', value: 'scissors' }
            )))
    .addSubcommand(sc =>
      sc.setName('respond')
        .setDescription('Submit your move for an active RPS game.')
        .addStringOption(o =>
          o.setName('choice')
            .setDescription('rock / paper / scissors')
            .setRequired(true)
            .addChoices(
              { name: 'Rock', value: 'rock' },
              { name: 'Paper', value: 'paper' },
              { name: 'Scissors', value: 'scissors' }
            )) )
    .addSubcommand(sc =>
      sc.setName('cancel')
        .setDescription('Cancel your active RPS game.')),

  async execute(interaction) {
    const me = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    // ── CANCEL ─────
    if (sub === 'cancel') {
      const gameId = userToGame.get(me);
      if (!gameId) return interaction.reply({ content: '⚠️ You have no active RPS game.', ephemeral: true });
      const g = activeRPSGames.get(gameId);
      clearTimeout(g.timeout);
      activeRPSGames.delete(gameId);
      userToGame.delete(g.challengerId);
      userToGame.delete(g.opponentId);
      saveGames(activeRPSGames);
      return interaction.reply({ content: '❌ Your RPS game has been cancelled.', ephemeral: true });
    }

    // ── RESPOND ─────
    if (sub === 'respond') {
      const choice = interaction.options.getString('choice');
      const gameId = userToGame.get(me);
      if (!gameId) return interaction.reply({ content: '⚠️ You have no active RPS game.', ephemeral: true });
      const g = activeRPSGames.get(gameId);
      if (me !== g.opponentId) return interaction.reply({ content: '🚫 You weren’t challenged to respond.', ephemeral: true });
      if (g.choices[me]) return interaction.reply({ content: '⚠️ You already submitted your move.', ephemeral: true });

      g.choices[me] = choice;
      await interaction.reply({ content: `✅ You chose **${choice}**.`, ephemeral: true });

      clearTimeout(g.timeout);
      const c = g.choices[g.challengerId];
      const o = g.choices[g.opponentId];
      let result = 0;
      if (c === o) result = 0;
      else if ((c==='rock' && o==='scissors') || (c==='paper' && o==='rock') || (c==='scissors' && o==='paper')) result = 1;
      else result = 2;

      let summary;
      if (result === 0) {
        summary = `🤝 It's a draw! No volts exchanged.`;
      } else {
        const winner = result === 1 ? g.challengerId : g.opponentId;
        const loser  = result === 1 ? g.opponentId : g.challengerId;
        await updateWallet(winner, g.wager);
        await updateWallet(loser, -g.wager);
        const bonusCount = await awardRPSBonus(winner);
        summary = `🎉 <@${winner}> wins **${g.wager}** volts! (<@${loser}> loses ${g.wager})`;
        if (bonusCount <= 3) summary += `\n🏅 Bonus win (+8 Volts) ${bonusCount}/3 today!`;
      }

      const chan = await interaction.client.channels.fetch(g.channelId).catch(() => null);
      if (chan) {
        chan.send(
          `🪨📄✂️ **RPS result** between <@${g.challengerId}> and <@${g.opponentId}>:\n` +
          `• <@${g.challengerId}> chose **${c}**\n` +
          `• <@${g.opponentId}> chose **${o}**\n\n` + summary
        ).catch(() => {});
      }

      activeRPSGames.delete(gameId);
      userToGame.delete(g.challengerId);
      userToGame.delete(g.opponentId);
      saveGames(activeRPSGames);
      return;
    }

    // ── CHALLENGE ─────
    const opponent = interaction.options.getUser('opponent');
    const them     = opponent.id;
    const wager    = interaction.options.getInteger('wager');
    const choice   = interaction.options.getString('choice');

    if (me === them) return interaction.reply({ content: '🚫 You cannot challenge yourself.', ephemeral: true });
    if (wager <= 0) return interaction.reply({ content: '🚫 Wager must be positive.', ephemeral: true });
    if (userToGame.has(me) || userToGame.has(them)) return interaction.reply({ content: '⚠️ One of you is already in an RPS game.', ephemeral: true });

    const b1 = await getBalances(me);
    const b2 = await getBalances(them);
    if (b1.wallet < wager || b2.wallet < wager) return interaction.reply({ content: '🚫 Both users must have enough volts.', ephemeral: true });

    const [A, B] = [me, them].sort();
    const gameId = `${A}:${B}`;
    const g = {
      challengerId: me,
      opponentId:   them,
      channelId:    interaction.channel.id,
      wager,
      choices:      { [me]: choice },
      timeout:      null
    };
    g.timeout = setTimeout(() => {
      activeRPSGames.delete(gameId);
      userToGame.delete(me);
      userToGame.delete(them);
      saveGames(activeRPSGames);
      interaction.channel.send(`⏰ RPS between <@${me}> and <@${them}> expired.`);
    }, GAME_TIMEOUT_MS);

    activeRPSGames.set(gameId, g);
    userToGame.set(me,    gameId);
    userToGame.set(them,  gameId);
    saveGames(activeRPSGames);

    await interaction.reply({ content: `✅ Challenged <@${them}> for **${wager}** volts (you chose **${choice}**).`, ephemeral: true });
    interaction.channel.send(`🎮 <@${me}> challenged <@${them}> for **${wager}** volts — first move locked in!`).catch(() => {});
  },

  activeRPSGames,
  userToGame
};
