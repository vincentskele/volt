// commands/games/rps.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../db');

async function awardRPSBonus(userId) {
  const today = db.getCurrentESTDateString();
  const entry = await db.getDailyUserActivitySnapshot(userId, today);
  const nextWins = Number(entry?.rpsWins || 0) + 1;

  await db.upsertDailyUserActivity(userId, today, { rpsWins: nextWins }, {
    reason: 'rps_win_progress',
  });

  if (nextWins <= 3) {
    await db.updateWallet(userId, 8, {
      type: 'rps_bonus',
      source: 'rps',
      dailyWinNumber: nextWins,
    });
    console.log(`🎉 Bonus: +8 volts for user ${userId} (daily win #${nextWins}).`);
  }

  return nextWins;
}

// === RPS GAME LOGIC ===
const GAME_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const activeRPSGames = new Map();
let activeGamesLoadedPromise = null;

function scheduleGameExpiry(gameId, game) {
  const delay = Math.max(0, Number(game.expiresAt || Date.now()) - Date.now());
  game.timeout = setTimeout(async () => {
    activeRPSGames.delete(gameId);
    await db.deleteRpsGame(gameId, { reason: 'expired' }).catch((error) => {
      console.error('❌ Failed to delete expired RPS game:', error);
    });
    const chan = await game.client?.channels?.fetch?.(game.channelId).catch(() => null);
    if (chan) {
      chan.send(`⏰ RPS between <@${game.challengerId}> and <@${game.opponentId}> expired.`).catch(() => {});
    }
  }, delay);
}

async function ensureActiveGamesLoaded(client) {
  if (!activeGamesLoadedPromise) {
    activeGamesLoadedPromise = db.listActiveRpsGames()
      .then((games) => {
        activeRPSGames.clear();
        for (const game of games) {
          const hydrated = {
            ...game,
            client: client || null,
            timeout: null,
          };
          activeRPSGames.set(game.gameId, hydrated);
          scheduleGameExpiry(game.gameId, hydrated);
        }
      })
      .catch((error) => {
        activeGamesLoadedPromise = null;
        throw error;
      });
  }

  await activeGamesLoadedPromise;
  for (const game of activeRPSGames.values()) {
    if (!game.client && client) {
      game.client = client;
    }
  }
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
    await ensureActiveGamesLoaded(interaction.client);

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
      await db.deleteRpsGame(gameId, { reason: 'cancelled' });
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
      g.client = interaction.client;
      await db.saveRpsGame(gameId, g, { reason: 'respond' });
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
        await db.transferFromWallet(loser, winner, g.wager, {
          type: 'wager_rps',
          source: 'rps',
          challengerId: g.challengerId,
          opponentId: g.opponentId,
          channelId: g.channelId,
          wager: g.wager,
          winningChoice: result === 1 ? c : o,
        });
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
      await db.deleteRpsGame(gameId, { reason: 'resolved' });
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

    const b1 = await db.getBalances(me);
    const b2 = await db.getBalances(them);
    const reserved = getReservedVolts(me);
    const available = b1.balance - reserved;

    if (available < wager)
      return interaction.reply({ content: `🚫 You need at least ${wager} available volts (after ${reserved} reserved) to challenge.`, ephemeral: true });
    if (b2.balance < wager)
      return interaction.reply({ content: `🚫 <@${them}> does not have enough volts.`, ephemeral: true });

    const now = Date.now();
    const g = {
      challengerId: me,
      opponentId: them,
      channelId: interaction.channel.id,
      wager,
      choices: { [me]: choice },
      createdAt: now,
      expiresAt: now + GAME_TIMEOUT_MS,
      client: interaction.client,
      timeout: null,
    };

    activeRPSGames.set(gameId, g);
    scheduleGameExpiry(gameId, g);
    await db.saveRpsGame(gameId, g, { reason: 'challenge' });

    await interaction.reply({ content: `✅ Challenged <@${them}> for **${wager}** volts (you chose **${choice}**).`, ephemeral: true });
    interaction.channel.send(`🎮 <@${me}> challenged <@${them}> for **${wager}** volts — first move locked in!`).catch(() => {});
  }
};
