// commands/games/rps.js
const { SlashCommandBuilder } = require('discord.js');
const { updateWallet, getBalances } = require('../../db');
const { loadGames, saveGames }   = require('../../utils/persistRPS');

const GAME_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2h
const activeRPSGames = loadGames();
const userToGame     = new Map();

// Rehydrate on startup
for (const [gameId, game] of activeRPSGames.entries()) {
  userToGame.set(game.challengerId, gameId);
  userToGame.set(game.opponentId,   gameId);
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
             { name: 'Rock',     value: 'rock' },
             { name: 'Paper',    value: 'paper' },
             { name: 'Scissors', value: 'scissors' },
           )))
    .addSubcommand(sc =>
      sc.setName('respond')
        .setDescription('Submit your move for an active RPS game.')
        .addStringOption(o =>
          o.setName('choice')
           .setDescription('rock / paper / scissors')
           .setRequired(true)
           .addChoices(
             { name: 'Rock',     value: 'rock' },
             { name: 'Paper',    value: 'paper' },
             { name: 'Scissors', value: 'scissors' },
           )))
    .addSubcommand(sc =>
      sc.setName('cancel')
        .setDescription('Cancel your active RPS game.'))
  ,

  async execute(interaction) {
    const me  = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    // ── CANCEL ─────────────────────────────────────────────────────────────
    if (sub === 'cancel') {
      const gameId = userToGame.get(me);
      if (!gameId) {
        return interaction.reply({ content: '⚠️ You have no active RPS game.', ephemeral: true });
      }
      const g = activeRPSGames.get(gameId);
      clearTimeout(g.timeout);
      activeRPSGames.delete(gameId);
      userToGame.delete(g.challengerId);
      userToGame.delete(g.opponentId);
      saveGames(activeRPSGames);

      return interaction.reply({ content: '❌ Your RPS game has been cancelled.', ephemeral: true });
    }

    // ── RESPOND ───────────────────────────────────────────────────────────
    if (sub === 'respond') {
      const choice = interaction.options.getString('choice');
      const gameId = userToGame.get(me);
      if (!gameId) {
        return interaction.reply({ content: '⚠️ You have no active RPS game.', ephemeral: true });
      }
      const g = activeRPSGames.get(gameId);
      if (me !== g.opponentId) {
        return interaction.reply({ content: '🚫 You weren’t challenged to respond.', ephemeral: true });
      }
      if (g.choices[me]) {
        return interaction.reply({ content: '⚠️ You already submitted your move.', ephemeral: true });
      }

      g.choices[me] = choice;
      await interaction.reply({ content: `✅ You chose **${choice}**.`, ephemeral: true });

      // resolve
      clearTimeout(g.timeout);
      const c = g.choices[g.challengerId], o = g.choices[g.opponentId];
      let result = 0;
      if (c === o) result = 0;
      else if (
        (c==='rock'     && o==='scissors') ||
        (c==='paper'    && o==='rock')     ||
        (c==='scissors' && o==='paper')
      ) result = 1;
      else result = 2;

      let summary;
      if (result === 0) {
        summary = `🤝 It's a draw! No volts exchanged.`;
      } else {
        const winner = result===1 ? g.challengerId : g.opponentId;
        const loser  = result===1 ? g.opponentId     : g.challengerId;
        await updateWallet(winner,  g.wager);
        await updateWallet(loser,  -g.wager);
        summary = `🎉 <@${winner}> wins **${g.wager}** volts! (<@${loser}> loses ${g.wager})`;
      }

      // public announce
      const chan = await interaction.client.channels.fetch(g.channelId).catch(()=>null);
      if (chan) {
        chan.send(
          `🪨📄✂️ **RPS result** between <@${g.challengerId}> and <@${g.opponentId}>:\n` +
          `• <@${g.challengerId}> chose **${c}**\n` +
          `• <@${g.opponentId}>   chose **${o}**\n\n` +
          summary
        ).catch(()=>{});
      }

      // cleanup
      activeRPSGames.delete(gameId);
      userToGame.delete(g.challengerId);
      userToGame.delete(g.opponentId);
      saveGames(activeRPSGames);
      return;
    }

    // ── CHALLENGE ──────────────────────────────────────────────────────────
    const opponent = interaction.options.getUser('opponent');
    const them     = opponent.id;
    const wager    = interaction.options.getInteger('wager');
    const choice   = interaction.options.getString('choice');

    if (me === them) {
      return interaction.reply({ content: '🚫 You cannot challenge yourself.', ephemeral: true });
    }
    if (wager <= 0) {
      return interaction.reply({ content: '🚫 Wager must be positive.', ephemeral: true });
    }
    if (userToGame.has(me) || userToGame.has(them)) {
      return interaction.reply({ content: '⚠️ One of you is already in an RPS game.', ephemeral: true });
    }

    const b1 = await getBalances(me);
    const b2 = await getBalances(them);
    if (b1.wallet < wager || b2.wallet < wager) {
      return interaction.reply({
        content: '🚫 Both users must have enough volts in their wallet.',
        ephemeral: true
      });
    }

    const [A,B]  = [me, them].sort();
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
    userToGame.set(me,  gameId);
    userToGame.set(them, gameId);
    saveGames(activeRPSGames);

    // ephemeral confirm
    await interaction.reply({
      content: `✅ You challenged <@${them}> for **${wager}** volts and chose **${choice}**.`,
      ephemeral: true
    });

    // public announce
    interaction.channel.send(
      `🎮 <@${me}> challenged <@${them}> for **${wager}** volts — first move locked in!`
    ).catch(()=>{});
  },

  activeRPSGames,
  userToGame
};
