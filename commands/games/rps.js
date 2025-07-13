// commands/games/rps.js
const { SlashCommandBuilder } = require('discord.js');
const { updateWallet, getBalances } = require('../../db');
const { loadGames, saveGames } = require('../../utils/persistRPS');
const fs = require('fs');
const path = require('path');

// === RPS DAILY WIN BONUS TRACKER ===
const RPS_WIN_TRACKER_PATH = path.join(__dirname, '../../rpsWinTracker.json');
let rpsWinTracker = new Map();

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
  const est = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return est.toISOString().split('T')[0];
}

async function awardRPSBonus(userId) {
  const today = getTodayDate();
  const entry = rpsWinTracker.get(userId) || { date: today, wins: 0 };

  if (entry.date !== today) {
    entry.date = today;
    entry.wins = 0;
  }

  entry.wins++;
  if (entry.wins <= 3) {
    await updateWallet(userId, 8);
    console.log(`🎉 Bonus: +8 volts for user ${userId} (daily win #${entry.wins}).`);
  }

  rpsWinTracker.set(userId, entry);
  saveRPSWinTracker();
  return entry.wins;
}

function scheduleRPSReset() {
  const now = new Date();
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

scheduleRPSReset();

// === RPS GAME LOGIC ===
const GAME_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const activeRPSGames = loadGames();

for (const [gameId, game] of activeRPSGames.entries()) {
  game.timeout = setTimeout(() => {
    activeRPSGames.delete(gameId);
    saveGames(activeRPSGames);
  }, GAME_TIMEOUT_MS);
}

function findSingleOpponent(me) {
  const games = [];
  for (const g of activeRPSGames.values()) {
    if (g.challengerId === me || g.opponentId === me) games.push(g);
  }
  if (games.length === 1) {
    const g = games[0];
    return g.challengerId === me ? g.opponentId : g.challengerId;
  }
  return games.length === 0 ? 'none' : 'multiple';
}

function getReservedVolts(userId) {
  let reserved = 0;
  for (const g of activeRPSGames.values()) {
    if (g.challengerId === userId) reserved += g.wager;
  }
  return reserved;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Rock Paper Scissors for volts.')
    .addSubcommand(sc =>
      sc.setName('challenge')
        .setDescription('Start a new RPS game (lock in your first move).')
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
            ))
        .addUserOption(o =>
          o.setName('opponent')
            .setDescription('Who challenged you (optional if only one active game)')
            .setRequired(false)))
    .addSubcommand(sc =>
      sc.setName('cancel')
        .setDescription('Cancel your active RPS game.')
        .addUserOption(o =>
          o.setName('opponent')
            .setDescription('Which opponent’s game to cancel (optional if only one active game)')
            .setRequired(false))),

  async execute(interaction) {
    const me = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    function resolveOpponent() {
      const opt = interaction.options.getUser('opponent');
      if (opt) return opt.id;
      const res = findSingleOpponent(me);
      if (res === 'none') return null;
      if (res === 'multiple') return 'many';
      return res;
    }

    if (sub === 'cancel') {
      const opp = resolveOpponent();
      if (!opp) return interaction.reply({ content: '⚠️ You have no active RPS games.', ephemeral: true });
      if (opp === 'many') return interaction.reply({ content: '⚠️ You have multiple active games; please specify an opponent.', ephemeral: true });

      const [A, B] = [me, opp].sort();
      const gameId = `${A}:${B}`;
      const g = activeRPSGames.get(gameId);
      if (!g) return interaction.reply({ content: '⚠️ No active game with that user.', ephemeral: true });

      clearTimeout(g.timeout);
      activeRPSGames.delete(gameId);
      saveGames(activeRPSGames);
      return interaction.reply({ content: '❌ Your RPS game has been cancelled.', ephemeral: true });
    }

    if (sub === 'respond') {
      const choice = interaction.options.getString('choice');
      const opp = resolveOpponent();
      if (!opp) return interaction.reply({ content: '⚠️ You have no active RPS games.', ephemeral: true });
      if (opp === 'many') return interaction.reply({ content: '⚠️ You have multiple active games; please specify an opponent.', ephemeral: true });

      const [A, B] = [me, opp].sort();
      const gameId = `${A}:${B}`;
      const g = activeRPSGames.get(gameId);
      if (!g) return interaction.reply({ content: '⚠️ No active game found with that user.', ephemeral: true });
      if (me !== g.opponentId) return interaction.reply({ content: '🚫 You weren’t challenged to respond.', ephemeral: true });
      if (g.choices[me]) return interaction.reply({ content: '⚠️ You already submitted your move.', ephemeral: true });

      g.choices[me] = choice;
      await interaction.reply({ content: `✅ You chose **${choice}**.`, ephemeral: true });

      clearTimeout(g.timeout);
      const c = g.choices[g.challengerId];
      const o = g.choices[g.opponentId];
      let result = 0;
      if (c === o) result = 0;
      else if ((c === 'rock' && o === 'scissors') || (c === 'paper' && o === 'rock') || (c === 'scissors' && o === 'paper')) result = 1;
      else result = 2;

      let summary;
      if (result === 0) {
        summary = `🤝 It's a draw! No volts exchanged.`;
      } else {
        const winner = result === 1 ? g.challengerId : g.opponentId;
        const loser = result === 1 ? g.opponentId : g.challengerId;
        await updateWallet(winner, g.wager);
        await updateWallet(loser, -g.wager);
        const bonusCount = await awardRPSBonus(winner);
        summary = `🎉 <@${winner}> wins **${g.wager}** volts! (<@${loser}> loses ${g.wager})`;
        if (bonusCount <= 3) summary += `\n🏅 Bonus win (+8 Volts) ${bonusCount}/3 today!`;
      }

      const chan = await interaction.client.channels.fetch(g.channelId).catch(() => null);
      if (chan) chan.send(
        `🪨📄✂️ **RPS result** between <@${g.challengerId}> and <@${g.opponentId}>:\n` +
        `• <@${g.challengerId}> chose **${c}**\n` +
        `• <@${g.opponentId}> chose **${o}**\n\n` + summary
      ).catch(() => {});

      activeRPSGames.delete(gameId);
      saveGames(activeRPSGames);
      return;
    }

    // CHALLENGE
    const opponentUser = interaction.options.getUser('opponent');
    const wager = interaction.options.getInteger('wager');
    const choice = interaction.options.getString('choice');
    const them = opponentUser.id;

    if (me === them) return interaction.reply({ content: '🚫 You cannot challenge yourself.', ephemeral: true });
    if (wager <= 0) return interaction.reply({ content: '🚫 Wager must be positive.', ephemeral: true });

    const [A, B] = [me, them].sort();
    const gameId = `${A}:${B}`;
    if (activeRPSGames.has(gameId))
      return interaction.reply({ content: '⚠️ You already have an active game against that user.', ephemeral: true });

    const b1 = await getBalances(me);
    const b2 = await getBalances(them);
    const reserved = getReservedVolts(me);
    const available = b1.wallet - reserved;

    if (available < wager)
      return interaction.reply({ content: `🚫 You need at least ${wager} available volts (after ${reserved} reserved) to challenge.`, ephemeral: true });
    if (b2.wallet < wager)
      return interaction.reply({ content: `🚫 <@${them}> does not have enough volts.`, ephemeral: true });

    const g = { challengerId: me, opponentId: them, channelId: interaction.channel.id, wager, choices: { [me]: choice }, timeout: null };
    g.timeout = setTimeout(() => {
      activeRPSGames.delete(gameId);
      saveGames(activeRPSGames);
      interaction.channel.send(`⏰ RPS between <@${me}> and <@${them}> expired.`);
    }, GAME_TIMEOUT_MS);

    activeRPSGames.set(gameId, g);
    saveGames(activeRPSGames);

    await interaction.reply({ content: `✅ Challenged <@${them}> for **${wager}** volts (you chose **${choice}**).`, ephemeral: true });
    interaction.channel.send(`🎮 <@${me}> challenged <@${them}> for **${wager}** volts — first move locked in!`).catch(() => {});
  }
};