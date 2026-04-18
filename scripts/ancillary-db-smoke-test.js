const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volt-ancillary-smoke-'));
  const tempDbPath = path.join(tempDir, 'points.db');

  process.env.VOLT_DB_PATH = tempDbPath;
  process.env.VOLT_TEST_MODE = '1';
  process.env.VOLT_SKIP_DB_AUTO_INIT = '1';

  const db = require('../db');
  const rpsCommand = require('../commands/games/rps');

  await db.initializeDatabase();

  const today = db.getCurrentESTDateString();

  const freshActivity = await db.getDailyUserActivitySnapshot('alice', today);
  assert.equal(freshActivity.count, 0);
  assert.equal(freshActivity.rpsWins, 0);

  await db.upsertDailyUserActivity('alice', today, {
    count: 2,
    reacted: true,
    firstMessageBonusGiven: true,
    rpsWins: 1,
  }, { reason: 'smoke_seed' });

  const updatedActivity = await db.getDailyUserActivitySnapshot('alice', today);
  assert.equal(updatedActivity.count, 2);
  assert.equal(updatedActivity.reacted, true);
  assert.equal(updatedActivity.firstMessageBonusGiven, true);
  assert.equal(updatedActivity.rpsWins, 1);

  await db.initUserEconomy('alice');
  await db.initUserEconomy('bob');
  await db.updateWallet('alice', 50, { type: 'smoke_seed', source: 'smoke' });
  await db.updateWallet('bob', 50, { type: 'smoke_seed', source: 'smoke' });

  const sentMessages = [];
  const stubChannel = {
    id: 'channel-1',
    send(message) {
      sentMessages.push(message);
      return Promise.resolve();
    },
  };
  const stubClient = {
    channels: {
      fetch: async () => stubChannel,
    },
  };

  function createInteraction({ userId, username, subcommand, opponentId, wager, choice }) {
    const replies = [];
    return {
      user: { id: userId, username },
      client: stubClient,
      channel: stubChannel,
      replies,
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => subcommand,
        getUser: (name) => {
          if (name !== 'opponent' || !opponentId) return null;
          return { id: opponentId };
        },
        getInteger: (name) => (name === 'wager' ? wager : null),
        getString: (name) => (name === 'choice' ? choice : null),
      },
      reply(payload) {
        replies.push(payload);
        this.replied = true;
        return Promise.resolve();
      },
    };
  }

  await rpsCommand.execute(createInteraction({
    userId: 'alice',
    username: 'alice',
    subcommand: 'challenge',
    opponentId: 'bob',
    wager: 10,
    choice: 'rock',
  }));

  let activeGames = await db.listActiveRpsGames();
  assert.equal(activeGames.length, 1);
  assert.equal(activeGames[0].challengerId, 'alice');
  assert.equal(activeGames[0].choices.alice, 'rock');

  await rpsCommand.execute(createInteraction({
    userId: 'bob',
    username: 'bob',
    subcommand: 'respond',
    opponentId: 'alice',
    choice: 'scissors',
  }));

  activeGames = await db.listActiveRpsGames();
  assert.equal(activeGames.length, 0);

  const aliceBalances = await db.getBalances('alice');
  const bobBalances = await db.getBalances('bob');
  assert.equal(aliceBalances.balance, 68);
  assert.equal(aliceBalances.bank, 0);
  assert.equal(bobBalances.balance, 40);
  assert.equal(bobBalances.bank, 0);

  const aliceActivity = await db.getDailyUserActivitySnapshot('alice', today);
  assert.equal(aliceActivity.rpsWins, 2);

  const projection = await db.getProjectionFingerprint();
  assert.ok(projection.counts.dailyUserActivity >= 1);
  assert.equal(projection.counts.rpsGames, 0);

  assert.ok(sentMessages.some((message) => String(message).includes('RPS result')));

  console.log(`Ancillary DB smoke test passed against ${tempDbPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
