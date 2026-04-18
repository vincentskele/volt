#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volt-flow-smoke-'));
const dbPath = path.join(tempDir, 'points.db');
const serverPort = 3315;

process.env.VOLT_TEST_MODE = '1';
process.env.VOLT_DB_PATH = dbPath;
process.env.VOLT_INSTANCE_SECRET = 'volt-flow-test-instance-secret';
process.env.JWT_SECRET = 'volt-flow-test-jwt-secret';
process.env.SERVER_PORT = String(serverPort);
process.env.POINTS_NAME = process.env.POINTS_NAME || 'Volts';
process.env.POINTS_SYMBOL = process.env.POINTS_SYMBOL || '⚡';
process.env.SUBMISSION_CHANNEL_ID = 'test-admin-channel';
process.env.WEBUI_GIVEAWAY_CHANNELID = 'test-web-giveaway-channel';
process.env.WEBUI_RAFFLE_CHANNELID = 'test-web-raffle-channel';

const db = require('../db');
const bot = require('../bot');
const createGiveawayCommand = require('../commands/giveaway/create-giveaway');
const titleGiveawayCommand = require('../commands/giveaway/title-giveaway');
const raffleCommand = require('../commands/giveaway/raffle');

const ADMIN_ID = '900000000000000001';
const USER_CMD_GIVEAWAY = '900000000000000101';
const USER_CMD_TITLE = '900000000000000102';
const USER_CMD_RAFFLE_A = '900000000000000103';
const USER_CMD_RAFFLE_B = '900000000000000104';
const USER_WEB_GIVEAWAY_A = '900000000000000105';
const USER_WEB_GIVEAWAY_B = '900000000000000106';
const USER_WEB_TITLE = '900000000000000107';
const USER_WEB_RAFFLE_A = '900000000000000108';
const USER_WEB_RAFFLE_B = '900000000000000109';

const ANNOUNCEMENTS = [];
const WEBSITE_LOGS = {
  stdout: '',
  stderr: '',
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logPass(message) {
  console.log(`PASS ${message}`);
}

function createJwt(userId, username = `user-${userId}`) {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function rawGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row || null)));
  });
}

function rawAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows || [])));
  });
}

function lastAnnouncementText() {
  const last = ANNOUNCEMENTS[ANNOUNCEMENTS.length - 1];
  if (!last) return '';
  if (typeof last === 'string') return last;
  if (typeof last?.content === 'string') return last.content;
  if (last?.embeds?.[0]?.data?.description) return last.embeds[0].data.description;
  if (last?.embeds?.[0]?.description) return last.embeds[0].description;
  return JSON.stringify(last);
}

function createAnnouncementChannel(channelId) {
  return {
    id: channelId,
    async send(payload) {
      ANNOUNCEMENTS.push(payload);
      return {
        id: `${channelId}-message-${ANNOUNCEMENTS.length}`,
        channel: { id: channelId },
        react: async () => {},
      };
    },
  };
}

bot.client.channels.fetch = async (channelId) => createAnnouncementChannel(String(channelId));
bot.client.users.fetch = async (userId) => ({
  id: String(userId),
  tag: `TestUser#${String(userId).slice(-4).padStart(4, '0')}`,
});
raffleCommand.setClient(bot.client);

function makeDiscordInteraction({
  channelId,
  commandName,
  options,
}) {
  const replies = [];
  const channel = createAnnouncementChannel(channelId);
  return {
    channelId,
    channel,
    client: {
      channels: {
        async fetch() {
          return channel;
        },
      },
    },
    member: {
      permissions: {
        has() {
          return true;
        },
      },
    },
    options: {
      getString(name) {
        return options[name] ?? null;
      },
      getInteger(name) {
        const value = options[name];
        return typeof value === 'undefined' || value === null ? null : Number(value);
      },
      getFocused() {
        return '';
      },
    },
    commandName,
    replied: false,
    async reply(payload) {
      this.replied = true;
      replies.push(payload);
      return payload;
    },
    async followUp(payload) {
      replies.push(payload);
      return payload;
    },
    __replies: replies,
  };
}

async function withControlledTimers(run) {
  const originalDateNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let now = originalDateNow();
  let nextId = 1;
  const queue = [];

  Date.now = () => now;
  global.setTimeout = (callback, delay) => {
    const timer = { id: nextId += 1, callback, delay: Number(delay) || 0 };
    queue.push(timer);
    return timer.id;
  };
  global.clearTimeout = (id) => {
    const index = queue.findIndex((entry) => entry.id === id);
    if (index >= 0) queue.splice(index, 1);
  };

  const api = {
    setNow(value) {
      now = Number(value);
    },
    async flushAll(limit = 20) {
      let passes = 0;
      while (queue.length) {
        passes += 1;
        if (passes > limit) {
          throw new Error('Timer queue did not settle.');
        }
        const batch = queue.splice(0, queue.length);
        for (const timer of batch) {
          await timer.callback();
        }
      }
    },
  };

  try {
    return await run(api);
  } finally {
    Date.now = originalDateNow;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}

async function getInventoryQuantity(userId, itemName) {
  const row = await rawGet(
    `SELECT COALESCE(inv.quantity, 0) AS quantity
     FROM items i
     LEFT JOIN inventory inv
       ON inv.itemID = i.itemID
      AND inv.userID = ?
     WHERE i.name = ?`,
    [userId, itemName]
  );
  return row?.quantity || 0;
}

async function getBalanceTotal(userId) {
  const balance = await db.getBalances(userId);
  return Number((balance.balance ?? balance.totalBalance ?? balance.wallet) || 0);
}

async function seedUsersAndItems() {
  console.log('STEP seedUsersAndItems:start');
  await db.initializeDatabase();
  await db.ensureRecoverableProjectionMaintenance();
  console.log('STEP seedUsersAndItems:initialized');

  await db.registerUser(ADMIN_ID, 'admin-smoke', 'password123');
  console.log('STEP seedUsersAndItems:registered-admin');
  await db.addAdmin(ADMIN_ID, { actorUserId: ADMIN_ID });
  console.log('STEP seedUsersAndItems:added-admin');

  const userIds = [
    USER_CMD_GIVEAWAY,
    USER_CMD_TITLE,
    USER_CMD_RAFFLE_A,
    USER_CMD_RAFFLE_B,
    USER_WEB_GIVEAWAY_A,
    USER_WEB_GIVEAWAY_B,
    USER_WEB_TITLE,
    USER_WEB_RAFFLE_A,
    USER_WEB_RAFFLE_B,
  ];

  for (const [index, userId] of userIds.entries()) {
    await db.registerUser(userId, `smoke-user-${index + 1}`, 'password123');
    console.log(`STEP seedUsersAndItems:registered-user:${index + 1}`);
    await db.updateWallet(userId, 1_000, {
      type: 'seed_funds',
      source: 'flow_smoke_test',
    });
    console.log(`STEP seedUsersAndItems:funded-user:${index + 1}`);
  }

  await db.addShopItem(25, 'Prize Widget', 'Raffle prize item', 20, 0, 1, 1);
  console.log('STEP seedUsersAndItems:added-item:Prize Widget');
  await db.addShopItem(10, 'Title Trophy', 'Title giveaway item', 20, 0, 1, 1);
  console.log('STEP seedUsersAndItems:added-item:Title Trophy');
  await db.addShopItem(15, 'Web Gift', 'Website giveaway item', 20, 0, 1, 1);
  console.log('STEP seedUsersAndItems:added-item:Web Gift');
  await db.addShopItem(5, 'Robot Oil', 'Participation reward', 200, 0, 1, 1);
  console.log('STEP seedUsersAndItems:done');
}

async function testDiscordGiveawayCommand() {
  ANNOUNCEMENTS.length = 0;
  const beforeTotal = await getBalanceTotal(USER_CMD_GIVEAWAY);

  await withControlledTimers(async (clock) => {
    const interaction = makeDiscordInteraction({
      channelId: 'discord-giveaway-channel',
      commandName: 'create-giveaway',
      options: {
        name: 'Cmd Volt Giveaway',
        duration: 1,
        timeunit: 'minutes',
        winners: 1,
        prize: '250',
        repeat: 0,
      },
    });

    await createGiveawayCommand.execute(interaction);

    const giveaway = await rawGet(
      `SELECT * FROM giveaways WHERE giveaway_name = ? ORDER BY id DESC LIMIT 1`,
      ['Cmd Volt Giveaway']
    );
    assert(giveaway, 'Discord giveaway command did not create a giveaway row.');

    await db.addGiveawayEntry(giveaway.id, USER_CMD_GIVEAWAY);
    clock.setNow(giveaway.end_time + 1);
    await clock.flushAll();

    const afterTotal = await getBalanceTotal(USER_CMD_GIVEAWAY);
    assert.strictEqual(afterTotal - beforeTotal, 250, 'Discord giveaway command did not award the numeric prize.');

    const deleted = await rawGet(`SELECT * FROM giveaways WHERE id = ?`, [giveaway.id]);
    assert.strictEqual(deleted, null, 'Discord giveaway command did not delete the concluded giveaway.');
  });

  logPass('discord giveaway command create + conclude + numeric distribution');
}

async function testDiscordTitleGiveawayCommand() {
  ANNOUNCEMENTS.length = 0;
  const beforeQty = await getInventoryQuantity(USER_CMD_TITLE, 'Title Trophy');

  await withControlledTimers(async (clock) => {
    const interaction = makeDiscordInteraction({
      channelId: 'discord-title-channel',
      commandName: 'title-giveaway',
      options: {
        name: 'Cmd Title Giveaway',
        prize: 'Title Trophy',
        winners: 1,
        duration: 1,
        timeunit: 'minutes',
        repeat: 0,
      },
    });

    await titleGiveawayCommand.execute(interaction);

    const giveaway = await rawGet(
      `SELECT * FROM title_giveaways WHERE giveaway_name = ? ORDER BY id DESC LIMIT 1`,
      ['Cmd Title Giveaway']
    );
    assert(giveaway, 'Discord title giveaway command did not create a row.');

    await db.addTitleGiveawayEntry(giveaway.id, USER_CMD_TITLE);
    clock.setNow(giveaway.end_time + 1);
    await clock.flushAll();

    const afterQty = await getInventoryQuantity(USER_CMD_TITLE, 'Title Trophy');
    assert.strictEqual(afterQty - beforeQty, 1, 'Discord title giveaway command did not distribute the item prize.');

    const completed = await rawGet(`SELECT is_completed FROM title_giveaways WHERE id = ?`, [giveaway.id]);
    assert.strictEqual(completed?.is_completed, 1, 'Discord title giveaway command did not mark the giveaway completed.');
  });

  logPass('discord title giveaway command create + conclude + item distribution');
}

async function testDiscordRaffleCommand() {
  ANNOUNCEMENTS.length = 0;

  await withControlledTimers(async (clock) => {
    const interaction = makeDiscordInteraction({
      channelId: 'discord-raffle-channel',
      commandName: 'create-raffle',
      options: {
        name: 'Cmd Item Raffle',
        prize: 'Prize Widget',
        cost: 10,
        quantity: 5,
        winners: 1,
        duration: 1,
        timeunit: 'minutes',
      },
    });

    await raffleCommand.execute(interaction);

    const raffle = await rawGet(
      `SELECT * FROM raffles WHERE name = ? ORDER BY id DESC LIMIT 1`,
      ['Cmd Item Raffle']
    );
    assert(raffle, 'Discord raffle command did not create a raffle row.');

    await db.purchaseShopItem(USER_CMD_RAFFLE_A, 'Cmd Item Raffle Raffle Ticket', 1, {
      source: 'flow_smoke_test',
      metadata: { surface: 'discord_command' },
    });
    await db.purchaseShopItem(USER_CMD_RAFFLE_B, 'Cmd Item Raffle Raffle Ticket', 1, {
      source: 'flow_smoke_test',
      metadata: { surface: 'discord_command' },
    });

    const raffleEntries = await rawGet(
      `SELECT COUNT(*) AS count FROM raffle_entries WHERE raffle_id = ?`,
      [raffle.id]
    );
    assert.strictEqual(raffleEntries?.count, 2, 'Raffle ticket purchases did not create raffle entries.');

    const prizeBeforeA = await getInventoryQuantity(USER_CMD_RAFFLE_A, 'Prize Widget');
    const prizeBeforeB = await getInventoryQuantity(USER_CMD_RAFFLE_B, 'Prize Widget');
    const oilBeforeA = await getInventoryQuantity(USER_CMD_RAFFLE_A, 'Robot Oil');
    const oilBeforeB = await getInventoryQuantity(USER_CMD_RAFFLE_B, 'Robot Oil');

    clock.setNow(raffle.end_time + 1);
    await clock.flushAll();

    const prizeAfterA = await getInventoryQuantity(USER_CMD_RAFFLE_A, 'Prize Widget');
    const prizeAfterB = await getInventoryQuantity(USER_CMD_RAFFLE_B, 'Prize Widget');
    const oilAfterA = await getInventoryQuantity(USER_CMD_RAFFLE_A, 'Robot Oil');
    const oilAfterB = await getInventoryQuantity(USER_CMD_RAFFLE_B, 'Robot Oil');

    assert.strictEqual((prizeAfterA - prizeBeforeA) + (prizeAfterB - prizeBeforeB), 1, 'Discord raffle did not award exactly one prize item.');
    assert.strictEqual(oilAfterA - oilBeforeA, 1, 'Discord raffle did not award Robot Oil to participant A.');
    assert.strictEqual(oilAfterB - oilBeforeB, 1, 'Discord raffle did not award Robot Oil to participant B.');

    const ticketItem = await rawGet(`SELECT * FROM items WHERE name = ?`, ['Cmd Item Raffle Raffle Ticket']);
    assert.strictEqual(ticketItem, null, 'Discord raffle did not remove the raffle ticket item from the shop.');
  });

  logPass('discord raffle command create + ticket purchase + conclude + item distribution');
}

async function startWebsiteServer() {
  WEBSITE_LOGS.stdout = '';
  WEBSITE_LOGS.stderr = '';
  const serverEnv = {
    ...process.env,
    VOLT_TEST_MODE: '1',
    VOLT_DB_PATH: dbPath,
    VOLT_INSTANCE_SECRET: process.env.VOLT_INSTANCE_SECRET,
    JWT_SECRET: process.env.JWT_SECRET,
    SERVER_PORT: String(serverPort),
  };

  const server = spawn(process.execPath, ['website/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    WEBSITE_LOGS.stdout += text;
  });
  server.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    WEBSITE_LOGS.stderr += text;
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/api/shop`);
      if (response.ok && WEBSITE_LOGS.stdout.includes('Recoverable projection maintenance complete.')) {
        return { server, stdout, stderr };
      }
    } catch (_) {
      await wait(150);
    }
  }

  throw new Error(`Test web server did not start.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
}

async function stopWebsiteServer(server) {
  if (!server || server.killed) return;
  await new Promise((resolve) => {
    server.once('exit', () => resolve());
    server.kill('SIGINT');
    setTimeout(() => {
      if (!server.killed) {
        server.kill('SIGKILL');
      }
    }, 2_000);
  });
}

async function apiRequest(method, pathname, token, body) {
  const response = await fetch(`http://127.0.0.1:${serverPort}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Non-JSON response from ${pathname}: ${text}`);
  }

  if (!response.ok) {
    throw new Error(
      `${method} ${pathname} failed (${response.status}): ${JSON.stringify(json)}\n` +
      `WEBSITE STDOUT:\n${WEBSITE_LOGS.stdout}\nWEBSITE STDERR:\n${WEBSITE_LOGS.stderr}`
    );
  }

  return json;
}

async function testWebsiteGiveawayFlow(adminToken, userAToken, userBToken) {
  ANNOUNCEMENTS.length = 0;

  await apiRequest('POST', '/api/admin/giveaways/create', adminToken, {
    giveaway_name: 'Web Gift Giveaway',
    prize: 'Web Gift',
    winners: 2,
    end_time: Date.now() + 60_000,
    repeat: 0,
    channel_id: 'admin',
  });

  const giveaways = await apiRequest('GET', '/api/admin/giveaways', adminToken);
  const giveaway = giveaways.find((entry) => entry.giveaway_name === 'Web Gift Giveaway');
  assert(giveaway, 'Website giveaway create route did not create a giveaway.');

  await apiRequest('POST', `/api/admin/giveaways/${giveaway.id}/update`, adminToken, {
    giveaway_name: 'Web Gift Giveaway',
    prize: 'Web Gift',
    winners: 2,
    end_time: Date.now() + 120_000,
    repeat: 0,
  });
  await apiRequest('POST', `/api/admin/giveaways/${giveaway.id}/stop`, adminToken, {});
  await apiRequest('POST', `/api/admin/giveaways/${giveaway.id}/start`, adminToken, { durationHours: 1 });

  await apiRequest('POST', '/api/giveaways/enter', userAToken, { giveawayId: giveaway.id });
  await apiRequest('POST', '/api/giveaway/toggle', userAToken, { giveawayId: giveaway.id });
  await apiRequest('POST', '/api/giveaway/toggle', userAToken, { giveawayId: giveaway.id });
  await apiRequest('POST', '/api/giveaways/enter', userBToken, { giveawayId: giveaway.id });

  const entryCount = await apiRequest('GET', `/api/giveaways/${giveaway.id}/entries`, null);
  assert.strictEqual(entryCount.entryCount, 2, 'Website giveaway entry routes did not leave exactly two entries.');

  const beforeA = await getInventoryQuantity(USER_WEB_GIVEAWAY_A, 'Web Gift');
  const beforeB = await getInventoryQuantity(USER_WEB_GIVEAWAY_B, 'Web Gift');
  const pending = await rawGet(`SELECT * FROM giveaways WHERE id = ?`, [giveaway.id]);
  await bot.__testOnly.concludeGiveaway(pending);

  const afterA = await getInventoryQuantity(USER_WEB_GIVEAWAY_A, 'Web Gift');
  const afterB = await getInventoryQuantity(USER_WEB_GIVEAWAY_B, 'Web Gift');
  assert.strictEqual(afterA - beforeA, 1, 'Website giveaway did not distribute the item prize to entrant A.');
  assert.strictEqual(afterB - beforeB, 1, 'Website giveaway did not distribute the item prize to entrant B.');

  const deleted = await rawGet(`SELECT * FROM giveaways WHERE id = ?`, [giveaway.id]);
  assert.strictEqual(deleted, null, 'Website giveaway was not cleaned up after conclusion.');

  logPass('website giveaway admin + entry routes + bot conclusion + item distribution');
}

async function testWebsiteTitleGiveawayFlow(adminToken) {
  ANNOUNCEMENTS.length = 0;
  const beforeTotal = await getBalanceTotal(USER_WEB_TITLE);

  await apiRequest('POST', '/api/admin/title-giveaways/create', adminToken, {
    giveaway_name: 'Web Title Giveaway',
    prize: '75',
    winners: 1,
    end_time: Date.now() + 60_000,
    repeat: 0,
  });

  const titleGiveaways = await apiRequest('GET', '/api/admin/title-giveaways', adminToken);
  const giveaway = titleGiveaways.find((entry) => entry.giveaway_name === 'Web Title Giveaway');
  assert(giveaway, 'Website title giveaway create route did not create a row.');

  await apiRequest('POST', `/api/admin/title-giveaways/${giveaway.id}/update`, adminToken, {
    giveaway_name: 'Web Title Giveaway',
    prize: '75',
    winners: 1,
    end_time: Date.now() + 120_000,
    repeat: 0,
    is_completed: 0,
  });
  await apiRequest('POST', `/api/admin/title-giveaways/${giveaway.id}/stop`, adminToken, {});
  await apiRequest('POST', `/api/admin/title-giveaways/${giveaway.id}/start`, adminToken, { durationHours: 1 });

  await db.addTitleGiveawayEntry(giveaway.id, USER_WEB_TITLE);

  const pending = await rawGet(`SELECT * FROM title_giveaways WHERE id = ?`, [giveaway.id]);
  await bot.__testOnly.concludeTitleGiveaway(pending);

  const afterTotal = await getBalanceTotal(USER_WEB_TITLE);
  assert.strictEqual(afterTotal - beforeTotal, 75, 'Website title giveaway did not award the numeric prize.');

  const completed = await rawGet(`SELECT is_completed FROM title_giveaways WHERE id = ?`, [giveaway.id]);
  assert.strictEqual(completed?.is_completed, 1, 'Website title giveaway was not marked completed.');

  logPass('website title giveaway admin routes + bot conclusion + numeric distribution');
}

async function testWebsiteRaffleFlow(adminToken, userAToken, userBToken) {
  ANNOUNCEMENTS.length = 0;

  await apiRequest('POST', '/api/admin/raffles/create', adminToken, {
    name: 'Web Volt Raffle',
    prize: '55',
    cost: 10,
    quantity: 6,
    winners: 1,
    end_time: Date.now() + 60_000,
    channel_id: 'admin',
  });

  const raffles = await apiRequest('GET', '/api/admin/raffles', adminToken);
  const raffle = raffles.find((entry) => entry.name === 'Web Volt Raffle');
  assert(raffle, 'Website raffle create route did not create a raffle.');

  await apiRequest('POST', `/api/admin/raffles/${raffle.id}/update`, adminToken, {
    name: 'Web Volt Raffle',
    prize: '55',
    cost: raffle.cost,
    quantity: raffle.quantity,
    winners: raffle.winners,
    end_time: Date.now() + 120_000,
  });
  await apiRequest('POST', `/api/admin/raffles/${raffle.id}/stop`, adminToken, {});
  await apiRequest('POST', `/api/admin/raffles/${raffle.id}/start`, adminToken, { durationHours: 1 });

  const oilBeforeA = await getInventoryQuantity(USER_WEB_RAFFLE_A, 'Robot Oil');
  const oilBeforeB = await getInventoryQuantity(USER_WEB_RAFFLE_B, 'Robot Oil');

  await apiRequest('POST', '/api/buy', userAToken, { itemName: 'Web Volt Raffle Raffle Ticket', quantity: 1 });
  await apiRequest('POST', '/api/buy', userBToken, { itemName: 'Web Volt Raffle Raffle Ticket', quantity: 1 });

  const raffleEntries = await rawGet(`SELECT COUNT(*) AS count FROM raffle_entries WHERE raffle_id = ?`, [raffle.id]);
  assert.strictEqual(raffleEntries?.count, 2, 'Website raffle ticket purchases did not create raffle entries.');

  const totalsBeforeConclusion = (await getBalanceTotal(USER_WEB_RAFFLE_A)) + (await getBalanceTotal(USER_WEB_RAFFLE_B));
  const pending = await rawGet(`SELECT * FROM raffles WHERE id = ?`, [raffle.id]);
  await db.concludeRaffle(pending);

  const totalsAfterConclusion = (await getBalanceTotal(USER_WEB_RAFFLE_A)) + (await getBalanceTotal(USER_WEB_RAFFLE_B));
  const oilAfterA = await getInventoryQuantity(USER_WEB_RAFFLE_A, 'Robot Oil');
  const oilAfterB = await getInventoryQuantity(USER_WEB_RAFFLE_B, 'Robot Oil');

  assert.strictEqual(totalsAfterConclusion - totalsBeforeConclusion, 55, 'Website raffle did not award the numeric prize to exactly one winner.');
  assert.strictEqual(oilAfterA - oilBeforeA, 1, 'Website raffle did not award Robot Oil to participant A.');
  assert.strictEqual(oilAfterB - oilBeforeB, 1, 'Website raffle did not award Robot Oil to participant B.');

  const ticketItem = await rawGet(`SELECT * FROM items WHERE name = ?`, ['Web Volt Raffle Raffle Ticket']);
  assert.strictEqual(ticketItem, null, 'Website raffle did not remove the raffle ticket item after conclusion.');

  logPass('website raffle admin routes + buy route + conclusion + numeric distribution');
}

async function main() {
  let server;

  try {
    console.log('STEP main:seed');
    await seedUsersAndItems();

    console.log('STEP main:testDiscordGiveawayCommand');
    await testDiscordGiveawayCommand();
    console.log('STEP main:testDiscordTitleGiveawayCommand');
    await testDiscordTitleGiveawayCommand();
    console.log('STEP main:testDiscordRaffleCommand');
    await testDiscordRaffleCommand();

    const adminToken = createJwt(ADMIN_ID, 'admin-smoke');
    const webGiveawayAToken = createJwt(USER_WEB_GIVEAWAY_A, 'smoke-user-web-a');
    const webGiveawayBToken = createJwt(USER_WEB_GIVEAWAY_B, 'smoke-user-web-b');
    const webRaffleAToken = createJwt(USER_WEB_RAFFLE_A, 'smoke-user-web-ra-a');
    const webRaffleBToken = createJwt(USER_WEB_RAFFLE_B, 'smoke-user-web-ra-b');

    console.log('STEP main:startWebsiteServer');
    ({ server } = await startWebsiteServer());

    console.log('STEP main:testWebsiteGiveawayFlow');
    await testWebsiteGiveawayFlow(adminToken, webGiveawayAToken, webGiveawayBToken);
    console.log('STEP main:testWebsiteTitleGiveawayFlow');
    await testWebsiteTitleGiveawayFlow(adminToken);
    console.log('STEP main:testWebsiteRaffleFlow');
    await testWebsiteRaffleFlow(adminToken, webRaffleAToken, webRaffleBToken);

    console.log(`\nAll raffle/giveaway/title-giveaway smoke tests passed against ${dbPath}`);
  } finally {
    await stopWebsiteServer(server);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('\nFlow smoke test failed:', error);
    process.exit(1);
  });
