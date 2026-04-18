// server.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs'); // Needed to read the console.json file
const multer = require("multer");
const { EmbedBuilder } = require("discord.js");
const { points, formatCurrency } = require("../points");
const dbHelpers = require("../db");
const { PRIMARY_BALANCE_ACCOUNT, normalizeLedgerAccount } = require("../ledgerService");
const roboCheckAccountStore = require(path.resolve(__dirname, '..', '..', 'robo-check', 'src', 'accountStore.js'));

const SUBMISSION_EMBED_COLORS = {
  jobSubmission: 0x3b82f6,
  questComplete: 0x22c55e,
  itemRedemption: 0x8b5cf6,
  adminChange: 0xf59e0b,
};

const QUEST_SUBMISSION_CHANNEL_ID = process.env.QUEST_SUBMISSION_CHANNEL_ID || process.env.SUBMISSION_CHANNEL_ID;
const WEB_ADMIN_EDITS_CHANNEL_ID = process.env.WEB_ADMIN_EDITS_CHANNEL_ID || process.env.SUBMISSION_CHANNEL_ID;
const ITEM_REDEMPTION_CHANNEL_ID = process.env.ITEM_REDEMPTION_CHANNEL_ID || process.env.SUBMISSION_CHANNEL_ID;
const TEST_MODE = process.env.VOLT_TEST_MODE === '1';
const VOLT_INSTANCE_SECRET = String(process.env.VOLT_INSTANCE_SECRET || '').trim();

function hasWalletVisibilityAccess() {
  return Boolean(VOLT_INSTANCE_SECRET);
}

function maskWalletAddress(walletAddress) {
  const value = String(walletAddress || '').trim();
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function redactWalletInCommandText(commandText) {
  const value = String(commandText || '').trim();
  if (!value) return value;
  return value
    .replace(/(wallet\s*=\s*")([^"]+)(")/gi, (_, prefix, wallet, suffix) => `${prefix}${maskWalletAddress(wallet)}${suffix}`)
    .replace(/(wallet_address\s*=\s*")([^"]+)(")/gi, (_, prefix, wallet, suffix) => `${prefix}${maskWalletAddress(wallet)}${suffix}`);
}

function redactWalletFields(value, { reveal = hasWalletVisibilityAccess() } = {}) {
  if (reveal || value === null || typeof value === 'undefined') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactWalletFields(entry, { reveal }));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        if (key === 'walletAddress' || key === 'wallet_address') {
          return [key, nestedValue ? maskWalletAddress(nestedValue) : nestedValue];
        }
        if (key === 'commandText' || key === 'command_text') {
          return [key, redactWalletInCommandText(nestedValue)];
        }
        return [key, redactWalletFields(nestedValue, { reveal })];
      })
    );
  }

  return value;
}

function getSolanaExplorerUrl(walletAddress) {
  if (!walletAddress) return null;
  return `https://solscan.io/account/${walletAddress}`;
}

function formatSolanaWalletMessage(walletAddress) {
  if (!walletAddress) return null;
  return `${walletAddress}`;
}

function createTestClient() {
  return {
    isReady() {
      return true;
    },
    once(event, handler) {
      if (event === 'ready' && typeof handler === 'function') {
        queueMicrotask(handler);
      }
    },
    users: {
      async fetch(userId) {
        return { id: String(userId), tag: `TestUser#${String(userId).slice(-4).padStart(4, '0')}` };
      },
    },
    channels: {
      async fetch() {
        return null;
      },
    },
    guilds: {
      cache: new Map(),
      async fetch() {
        return null;
      },
    },
  };
}

// Import the lightweight Discord client used for lookups from the web process.
const { client } = TEST_MODE
  ? { client: createTestClient() }
  : require('../info-bot');

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const VOLT_BOT_TOKEN = process.env.TOKEN;

async function sendVoltBotMessage(channelId, { content, embeds = [], files = [] } = {}) {
  if (!VOLT_BOT_TOKEN) {
    throw new Error('Missing TOKEN in .env file.');
  }

  const url = `${DISCORD_API_BASE}/channels/${channelId}/messages`;
  const payloadEmbeds = embeds.map((embed) => (typeof embed?.toJSON === 'function' ? embed.toJSON() : embed));

  if (!files.length) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${VOLT_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content, embeds: payloadEmbeds }),
    });

    if (!response.ok) {
      throw new Error(`Discord API message send failed (${response.status}): ${await response.text()}`);
    }

    return response.json();
  }

  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content, embeds: payloadEmbeds }));

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const buffer = await fs.promises.readFile(file.path);
    form.append(`files[${i}]`, new Blob([buffer]), file.name);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${VOLT_BOT_TOKEN}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Discord API message send failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

async function addVoltBotReaction(channelId, messageId, emoji) {
  if (!VOLT_BOT_TOKEN) {
    throw new Error('Missing TOKEN in .env file.');
  }

  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${VOLT_BOT_TOKEN}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Discord API reaction add failed (${response.status}): ${await response.text()}`);
  }
}

const app = express();
const PORT = Number(process.env.SERVER_PORT) || 3000;
const HOST = String(process.env.SERVER_HOST || '0.0.0.0').trim() || '0.0.0.0';


// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static files from "public"
app.use(express.static(path.join(__dirname, 'public')));

// Connect to SQLite database (adjust path as needed)
const dbPath = process.env.VOLT_DB_PATH
  ? path.resolve(process.env.VOLT_DB_PATH)
  : path.join(__dirname, '..', 'points.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite DB:', err.message);
  } else {
    console.log(`Connected to SQLite database at ${dbPath}`);
  }
});
db.configure('busyTimeout', 5000);
db.run('PRAGMA journal_mode = WAL', (err) => {
  if (err) {
    console.error('❌ Failed to enable SQLite WAL mode for web server:', err);
  }
});
db.run('PRAGMA foreign_keys = ON', (err) => {
  if (err) {
    console.error('❌ Failed to enable SQLite foreign keys for web server:', err);
  }
});

// ✅ Admin/Quest submissions table (for pending review)
db.run(
  `CREATE TABLE IF NOT EXISTS job_submissions (
    submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
    userID TEXT NOT NULL,
    jobID INTEGER,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`,
  (err) => {
    if (err) console.error('❌ Error creating job_submissions table:', err);
    else console.log('✅ Job submissions table is ready.');
  }
);

// ✅ Job system tables (used by admin + quest list)
db.run(
  `CREATE TABLE IF NOT EXISTS joblist (
    jobID INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    cooldown_value INTEGER,
    cooldown_unit TEXT
  )`,
  (err) => {
    if (err) console.error('❌ Error creating joblist table:', err);
    else console.log('✅ Joblist table is ready.');
  }
);

db.run(
  `CREATE TABLE IF NOT EXISTS job_assignees (
    jobID INTEGER,
    userID TEXT,
    PRIMARY KEY(jobID, userID)
  )`,
  (err) => {
    if (err) console.error('❌ Error creating job_assignees table:', err);
    else console.log('✅ Job assignees table is ready.');
  }
);

// ✅ Item redemptions audit log
db.run(
  `CREATE TABLE IF NOT EXISTS item_redemptions (
    redemption_id INTEGER PRIMARY KEY AUTOINCREMENT,
    userID TEXT NOT NULL,
    user_tag TEXT,
    item_name TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    source TEXT NOT NULL,
    channel_name TEXT,
    channel_id TEXT,
    message_link TEXT,
    command_text TEXT,
    inventory_before INTEGER,
    inventory_after INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`,
  (err) => {
    if (err) console.error('❌ Error creating item_redemptions table:', err);
    else console.log('✅ Item redemptions table is ready.');
  }
);

// ✅ Simple Chat Messages table
db.run(
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userID TEXT NOT NULL,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`,
  (err) => {
    if (err) console.error('❌ Error creating chat_messages table:', err);
    else console.log('✅ Chat messages table is ready.');
  }
);

// ✅ Chat presence table
db.run(
  `CREATE TABLE IF NOT EXISTS chat_presence (
    userID TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    last_seen INTEGER NOT NULL
  )`,
  (err) => {
    if (err) console.error('❌ Error creating chat_presence table:', err);
    else console.log('✅ Chat presence table is ready.');
  }
);

db.all(`PRAGMA table_info(items)`, (err, columns) => {
  if (err) {
    console.error('❌ Error checking items schema:', err);
    return;
  }
  if (!Array.isArray(columns) || columns.length === 0) return;
  const hasIsHidden = columns.some((col) => col.name === 'isHidden');
  if (!hasIsHidden) {
    console.log("➕ Adding missing 'isHidden' column to items table...");
    db.run("ALTER TABLE items ADD COLUMN isHidden BOOLEAN DEFAULT 0", (alterErr) => {
      if (alterErr) console.error("❌ Error adding 'isHidden' column:", alterErr);
      else console.log("✅ 'isHidden' column added successfully.");
    });
  }
  const hasIsRedeemable = columns.some((col) => col.name === 'isRedeemable');
  if (!hasIsRedeemable) {
    console.log("➕ Adding missing 'isRedeemable' column to items table...");
    db.run("ALTER TABLE items ADD COLUMN isRedeemable BOOLEAN DEFAULT 1", (alterErr) => {
      if (alterErr) console.error("❌ Error adding 'isRedeemable' column:", alterErr);
      else console.log("✅ 'isRedeemable' column added successfully.");
    });
  }
});

function ensureJobSubmissionColumn(columnName, ddl) {
  db.all(`PRAGMA table_info(job_submissions)`, (err, columns) => {
    if (err) {
      console.error('❌ Error checking job_submissions schema:', err);
      return;
    }
    const exists = columns.some((col) => col.name === columnName);
    if (!exists) {
      db.run(`ALTER TABLE job_submissions ADD COLUMN ${ddl}`, (alterErr) => {
        if (alterErr) {
          console.error(`❌ Failed adding ${columnName} to job_submissions:`, alterErr);
        } else {
          console.log(`✅ Added ${columnName} to job_submissions.`);
        }
      });
    }
  });
}

ensureJobSubmissionColumn('reward_amount', 'reward_amount INTEGER DEFAULT 0');
ensureJobSubmissionColumn('completed_at', 'completed_at INTEGER');
ensureJobSubmissionColumn('jobID', 'jobID INTEGER');

function ensureJoblistColumn(columnName, ddl) {
  db.all(`PRAGMA table_info(joblist)`, (err, columns) => {
    if (err) {
      console.error('❌ Error checking joblist schema:', err);
      return;
    }
    const exists = columns.some((col) => col.name === columnName);
    if (!exists) {
      db.run(`ALTER TABLE joblist ADD COLUMN ${ddl}`, (alterErr) => {
        if (alterErr) {
          console.error(`❌ Failed adding ${columnName} to joblist:`, alterErr);
        } else {
          console.log(`✅ Added ${columnName} to joblist.`);
        }
      });
    }
  });
}

ensureJoblistColumn('cooldown_value', 'cooldown_value INTEGER');
ensureJoblistColumn('cooldown_unit', 'cooldown_unit TEXT');

function normalizeCooldownInput(valueRaw, unitRaw) {
  const allowedUnits = new Set(['minute', 'hour', 'day', 'month']);
  const hasValue = valueRaw !== null && valueRaw !== undefined && valueRaw !== '';
  const hasUnit = unitRaw !== null && unitRaw !== undefined && String(unitRaw).trim() !== '';

  if (!hasValue && !hasUnit) {
    return { cooldownValue: null, cooldownUnit: null };
  }
  if (!hasValue) {
    throw new Error('Cooldown value is required when cooldown unit is set.');
  }
  const parsedValue = Number(valueRaw);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error('Cooldown value must be a positive number.');
  }
  if (!hasUnit) {
    throw new Error('Cooldown unit is required when cooldown value is set.');
  }
  const unit = String(unitRaw).trim().toLowerCase().replace(/s$/, '');
  if (!allowedUnits.has(unit)) {
    throw new Error('Cooldown unit must be minute, hour, day, or month.');
  }
  return { cooldownValue: Math.floor(parsedValue), cooldownUnit: unit };
}

const ROBO_CHECK_HOLDERS_PATH =
  process.env.ROBO_CHECK_HOLDERS_PATH ||
  path.resolve(__dirname, '..', '..', 'robo-check', 'src', 'data', 'holders.json');

const ROBO_CHECK_VERIFIED_PATH =
  process.env.ROBO_CHECK_VERIFIED_PATH ||
  path.resolve(__dirname, '..', '..', 'robo-check', 'src', 'data', 'verified.json');

function readRoboCheckHolders() {
  try {
    if (!fs.existsSync(ROBO_CHECK_HOLDERS_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(ROBO_CHECK_HOLDERS_PATH, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('❌ Error reading Robo-Check holders file:', error);
    return [];
  }
}

function readRoboCheckAccounts() {
  try {
    if (!fs.existsSync(ROBO_CHECK_VERIFIED_PATH)) {
      return new Map();
    }
    return roboCheckAccountStore.buildVerifiedAccountIndex(roboCheckAccountStore.readVerifiedEntries());
  } catch (error) {
    console.error('❌ Error reading Robo-Check verified file:', error);
    return new Map();
  }
}

function getPrimaryWalletAddressFromHolder(holder) {
  if (!holder) return null;
  const walletList = Array.isArray(holder.wallets) ? holder.wallets : [];
  const primaryWallet = walletList.find((wallet) => wallet?.isPrimary && wallet?.walletAddress);
  return primaryWallet?.walletAddress || holder.primaryWalletAddress || holder.walletAddress || null;
}

function buildResolvedRoboCheckHolder(holder, account = null, fallbackDiscordId = null) {
  const discordId = String(holder?.discordId || account?.discordId || fallbackDiscordId || '').trim();
  if (!discordId && !holder && !account) return null;

  const wallets = Array.isArray(account?.wallets) && account.wallets.length
    ? account.wallets
    : (Array.isArray(holder?.wallets) && holder.wallets.length
      ? holder.wallets
      : (getPrimaryWalletAddressFromHolder(holder)
        ? [{ walletAddress: getPrimaryWalletAddressFromHolder(holder), isPrimary: true }]
        : []));
  const walletAddress = account?.primaryWalletAddress || account?.walletAddress || getPrimaryWalletAddressFromHolder(holder);

  return {
    ...(holder || { discordId, tokens: [] }),
    discordId,
    walletAddress: walletAddress || null,
    primaryWalletAddress: walletAddress || null,
    wallets,
    walletCount: wallets.length,
    twitterHandle: account?.twitterHandle || holder?.twitterHandle || null,
  };
}

function buildRoboCheckHolderMap() {
  const holderMap = new Map();
  const accounts = readRoboCheckAccounts();
  readRoboCheckHolders().forEach((holder) => {
    const discordId = String(holder?.discordId || '').trim();
    if (!discordId) return;
    const resolvedHolder = buildResolvedRoboCheckHolder(holder, accounts.get(discordId), discordId);
    holderMap.set(discordId, resolvedHolder);
  });
  accounts.forEach((account, discordId) => {
    if (!holderMap.has(discordId)) {
      holderMap.set(discordId, buildResolvedRoboCheckHolder(null, account, discordId));
    }
  });
  return holderMap;
}

function normalizeWalletAddress(walletAddress) {
  return String(walletAddress || '').trim().toLowerCase();
}

function normalizeTwitterHandle(twitterHandle) {
  return String(twitterHandle || '').trim().replace(/^@+/, '').toLowerCase();
}

function normalizeProfileLookupValue(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getEditDistance(left, right, maxDistance = 3) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length];
}

function scoreProfileLookupCandidate(query, candidate) {
  const normalizedQuery = normalizeProfileLookupValue(query);
  const normalizedCandidate = normalizeProfileLookupValue(candidate);
  if (!normalizedQuery || !normalizedCandidate) return null;

  if (normalizedCandidate === normalizedQuery) return 0;
  if (normalizedCandidate.startsWith(normalizedQuery)) return 1;
  if (normalizedCandidate.includes(normalizedQuery)) return 2;
  if (normalizedQuery.includes(normalizedCandidate)) return 3;

  const distance = getEditDistance(normalizedQuery, normalizedCandidate, 2);
  if (distance <= 2) return 10 + distance;

  return null;
}

function findBestProfileLookupMatch(query, entries, getCandidateValue) {
  let bestEntry = null;
  let bestScore = null;
  let tied = false;

  (entries || []).forEach((entry) => {
    const score = scoreProfileLookupCandidate(query, getCandidateValue(entry));
    if (score === null) return;
    if (bestScore === null || score < bestScore) {
      bestEntry = entry;
      bestScore = score;
      tied = false;
      return;
    }
    if (score === bestScore) {
      tied = true;
    }
  });

  if (!bestEntry || tied) return null;
  return bestEntry;
}

function findHolderByDiscordId(discordId) {
  const normalizedDiscordId = String(discordId || '').trim();
  if (!normalizedDiscordId) return null;
  const holder = readRoboCheckHolders().find((entry) => String(entry?.discordId || '').trim() === normalizedDiscordId) || null;
  return buildResolvedRoboCheckHolder(holder, readRoboCheckAccounts().get(normalizedDiscordId), normalizedDiscordId);
}

function findHolderByWalletAddress(walletAddress) {
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  if (!normalizedWallet) return null;
  const accountEntry = roboCheckAccountStore.findAccountByWalletAddress(normalizedWallet, roboCheckAccountStore.readVerifiedEntries());
  if (accountEntry) {
    return findHolderByDiscordId(accountEntry.discordId);
  }

  const holder = readRoboCheckHolders().find((entry) => {
    if (normalizeWalletAddress(entry?.walletAddress) === normalizedWallet) return true;
    if (normalizeWalletAddress(entry?.primaryWalletAddress) === normalizedWallet) return true;
    return Array.isArray(entry?.wallets) && entry.wallets.some(
      (wallet) => normalizeWalletAddress(wallet?.walletAddress) === normalizedWallet
    );
  }) || null;
  return holder ? buildResolvedRoboCheckHolder(holder, null, holder.discordId) : null;
}

function findHolderByTwitterHandle(twitterHandle) {
  const normalizedHandle = normalizeProfileLookupValue(twitterHandle);
  if (!normalizedHandle) return null;
  return findBestProfileLookupMatch(
    normalizedHandle,
    [...buildRoboCheckHolderMap().values()],
    (entry) => entry?.twitterHandle
  );
}

async function findHolderByUsername(username) {
  const normalizedUsername = normalizeProfileLookupValue(username);
  if (!normalizedUsername) return null;

  const rows = await dbAll(
    `SELECT userID, username FROM economy WHERE username IS NOT NULL AND username != ''`
  );
  const userRow = findBestProfileLookupMatch(
    normalizedUsername,
    rows,
    (entry) => entry?.username
  );
  if (!userRow?.userID) return null;

  return findHolderByDiscordId(userRow.userID) || buildResolvedRoboCheckHolder(null, null, userRow.userID) || { discordId: userRow.userID, tokens: [] };
}

async function getEconomyProfileDetails(discordId) {
  const normalizedDiscordId = String(discordId || '').trim();
  if (!normalizedDiscordId) return null;

  try {
    return await dbHelpers.getReadableProfileDetails(normalizedDiscordId, { maskOnFailure: true });
  } catch (error) {
    console.error(`Error loading profile details for ${normalizedDiscordId}:`, error);
    return null;
  }
}

async function mergeHolderWithProfileDetails(holder, fallbackDiscordId = null) {
  const discordId = String(holder?.discordId || fallbackDiscordId || '').trim();
  if (!discordId) return holder || null;

  const profileDetails = await getEconomyProfileDetails(discordId);
  if (!holder && !profileDetails) return null;

  return {
    ...(buildResolvedRoboCheckHolder(holder, readRoboCheckAccounts().get(discordId), discordId) || { discordId, tokens: [] }),
    username: profileDetails?.username || holder?.username || null,
    aboutMe: profileDetails?.aboutMe || holder?.aboutMe || holder?.about || holder?.about_me || holder?.bio || holder?.description || null,
    specialties: profileDetails?.specialties || holder?.specialties || holder?.specialty || holder?.skills || holder?.interests || null,
    location: profileDetails?.location || holder?.location || holder?.city || holder?.country || holder?.region || null,
    twitterHandle: profileDetails?.twitterHandle || holder?.twitterHandle || null,
  };
}

function getHolderVotingPower(holder) {
  const votingPowerIndex = {
    commander: 0.13,
    spy: 0.032,
    pilot: 0.018,
    monitor: 0.014,
    prospector: 0.013,
    guard: 0.01,
    'squad leader': 0.0086,
    administrator: 0.0061,
    drone: 0.0039,
  };

  const tokens = Array.isArray(holder?.tokens) ? holder.tokens : [];
  return tokens.reduce((sum, token) => {
    const attributes = Array.isArray(token?.metadata?.attributes) ? token.metadata.attributes : [];
    const titleAttr = attributes.find((attr) => String(attr?.trait_type || '').trim().toLowerCase() === 'title');
    const titleValue = String(titleAttr?.value || '').trim().toLowerCase();
    return sum + Number(votingPowerIndex[titleValue] || 0);
  }, 0);
}

function formatPublicNodeOperatorName(holderProfile) {
  const username = String(holderProfile?.username || '').trim();
  if (username) return username;

  const twitterHandle = String(holderProfile?.twitterHandle || '').trim().replace(/^@+/, '');
  if (twitterHandle) return `@${twitterHandle}`;

  return holderProfile?.discordId ? 'Verified holder' : 'Unverified node';
}

async function resolveNodeOperator(operatorDiscordId) {
  const normalizedDiscordId = String(operatorDiscordId || '').trim();
  if (!normalizedDiscordId) return null;

  const holderProfile = await mergeHolderWithProfileDetails(
    findHolderByDiscordId(normalizedDiscordId),
    normalizedDiscordId
  );
  const votingPower = getHolderVotingPower(holderProfile);

  return {
    discordId: normalizedDiscordId,
    displayName: formatPublicNodeOperatorName(holderProfile),
    username: holderProfile?.username || null,
    twitterHandle: holderProfile?.twitterHandle || null,
    votingPower,
    holderCount: Array.isArray(holderProfile?.tokens) ? holderProfile.tokens.length : 0,
    verifiedHolder: Boolean(holderProfile && votingPower > 0),
    verifiedWalletLink: Boolean(holderProfile?.walletCount || holderProfile?.walletAddress),
  };
}

function normalizeVoltUsernameInput(value) {
  const normalizedValue = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalizedValue) {
    throw new Error('Display name is required.');
  }
  if (normalizedValue.length > 32) {
    throw new Error('Display name must be 32 characters or fewer.');
  }
  if (!/^[A-Za-z0-9._ -]+$/.test(normalizedValue)) {
    throw new Error('Display name can only use letters, numbers, spaces, periods, underscores, and hyphens.');
  }
  return normalizedValue;
}

function normalizeProfileDetailInput(value, maxLength) {
  const normalizedValue = String(value || '').trim().replace(/\s+/g, ' ');
  if (normalizedValue.length > maxLength) {
    throw new Error(`Profile field exceeds ${maxLength} characters.`);
  }
  return normalizedValue;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function createNodeOperatorKeyValue() {
  return `volt_node_${crypto.randomBytes(24).toString('base64url')}`;
}

async function getActiveNodeOperatorKeyByHash(keyHash) {
  if (!keyHash) return null;
  return dbGet(
    `SELECT id, discord_id, key_label, created_at, last_used_at
     FROM node_operator_keys
     WHERE key_hash = ?
       AND revoked_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [keyHash]
  );
}

async function getActiveNodeOperatorKeyForDiscordId(discordId) {
  const normalizedDiscordId = String(discordId || '').trim();
  if (!normalizedDiscordId) return null;
  return dbGet(
    `SELECT id, discord_id, key_label, created_at, last_used_at
     FROM node_operator_keys
     WHERE discord_id = ?
       AND revoked_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [normalizedDiscordId]
  );
}

async function issueNodeOperatorKey(discordId, keyLabel = null) {
  const normalizedDiscordId = String(discordId || '').trim();
  if (!normalizedDiscordId) {
    throw new Error('Discord ID is required to issue a node key.');
  }

  const now = Date.now();
  const plaintextKey = createNodeOperatorKeyValue();
  const keyHash = sha256Hex(plaintextKey);

  await dbRunWithMeta(
    `UPDATE node_operator_keys
        SET revoked_at = ?
      WHERE discord_id = ?
        AND revoked_at IS NULL`,
    [now, normalizedDiscordId]
  );

  await dbRunWithMeta(
    `INSERT INTO node_operator_keys (
       discord_id,
       key_hash,
       key_label,
       created_at,
       last_used_at,
       revoked_at
     ) VALUES (?, ?, ?, ?, NULL, NULL)`,
    [normalizedDiscordId, keyHash, keyLabel ? String(keyLabel).trim() : null, now]
  );

  return {
    key: plaintextKey,
    createdAt: now,
  };
}

async function markNodeOperatorKeyUsed(keyId) {
  if (!keyId) return;
  await dbRunWithMeta(
    `UPDATE node_operator_keys
        SET last_used_at = ?
      WHERE id = ?`,
    [Date.now(), keyId]
  );
}

async function assertNodeKeyEligible(discordId) {
  const operator = await resolveNodeOperator(discordId);
  if (!operator?.verifiedHolder || Number(operator.votingPower || 0) <= 0) {
    throw new Error('Node keys are only available to verified Robo-Check holder accounts.');
  }
  return operator;
}

async function authenticateNodeKey(req, res, next) {
  try {
    const providedKey = String(req.headers['x-volt-node-key'] || req.body?.nodeKey || '').trim();
    if (!providedKey) {
      return res.status(403).json({ error: 'Missing node key.' });
    }

    const record = await getActiveNodeOperatorKeyByHash(sha256Hex(providedKey));
    if (!record) {
      return res.status(403).json({ error: 'Invalid node key.' });
    }

    await markNodeOperatorKeyUsed(record.id).catch(() => {});
    req.nodeAuth = {
      keyId: record.id,
      discordId: String(record.discord_id || '').trim(),
      keyLabel: record.key_label || null,
      createdAt: record.created_at || null,
      lastUsedAt: record.last_used_at || null,
    };
    next();
  } catch (error) {
    console.error('Node key authentication failed:', error);
    return res.status(500).json({ error: 'Failed to verify node key.' });
  }
}

/**
 * Adds a user to a giveaway.
 * Ensures there are no duplicate entries.
 */
async function addGiveawayEntry(giveawayId, userId) {
  try {
    await dbHelpers.addGiveawayEntry(giveawayId, userId);
    console.log(`✅ Added new giveaway entry for user ${userId} in giveaway ${giveawayId}`);
  } catch (error) {
    console.error(`❌ Error adding giveaway entry:`, error);
    throw error;
  }
}

/**
 * Helper: fetch a user’s Discord tag from their user ID.
 * If it fails, return something like "UnknownUser(1234)".
 */
async function resolveUsername(userId) {
  try {
    const user = await client.users.fetch(userId);
    return user.tag; // e.g. 'Vincent#1234'
  } catch (err) {
    console.error(`Error fetching user for ID ${userId}: ${err.message}`);
    return `UnknownUser(${userId})`;
  }
}

/**
 * Helper: fetch Discord user info (username, tag, avatar URL).
 */
async function fetchDiscordUserInfo(userId) {
  try {
    const user = await client.users.fetch(userId);
    if (!user) return null;
    return {
      userId: user.id,
      username: user.username,
      tag: user.tag,
      avatarUrl: user.displayAvatarURL({ extension: 'png', size: 128 }),
    };
  } catch (err) {
    console.error(`Error fetching Discord user info for ID ${userId}: ${err.message}`);
    return null;
  }
}

/**
 * GET /api/leaderboard
 * Return top 10 by unified Volt balance, plus userTag in place of userID.
 */
app.get('/api/leaderboard', async (req, res) => {
  try {
    const rows = await dbHelpers.getLeaderboard(10);
    const withTags = await Promise.all(
      rows.map(async (row) => {
        const userTag = await resolveUsername(row.userID);
        const balance = Number((row.balance ?? row.totalBalance ?? row.wallet) || 0);
        return {
          userID: row.userID,
          userTag,
          balance,
          wallet: balance,
          bank: 0,
          totalBalance: balance,
        };
      })
    );

    res.json(withTags);
  } catch (err) {
    console.error('Error in /api/leaderboard route:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admins
 * Return a list of admins from 'admins' table, with userID and userTag resolved.
 */
app.get('/api/admins', async (req, res) => {
  try {
    db.all(`SELECT userID FROM admins`, [], async (err, rows) => {
      if (err) {
        console.error('Error fetching admins:', err);
        return res.status(500).json({ error: 'Failed to fetch admins' });
      }
      const adminData = await Promise.all(
        rows.map(async (row) => {
          const userTag = await resolveUsername(row.userID);
          return { userID: row.userID, userTag };
        })
      );
      res.json(adminData);
    });
  } catch (err) {
    console.error('Error in /api/admins route:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/check
 * Returns whether the current user is an admin.
 */
app.get('/api/admin/check', authenticateToken, async (req, res) => {
  try {
    const admin = await isAdmin(req.user?.userId);
    return res.json({ isAdmin: admin });
  } catch (err) {
    console.error('Error in /api/admin/check:', err);
    return res.status(500).json({ message: 'Failed to check admin.' });
  }
});

/**
 * GET /api/admin/submissions
 * Returns pending job submissions (admin only).
 */
app.get('/api/admin/submissions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT s.submission_id, s.userID, e.username, s.title, s.description, s.image_url, s.status, s.created_at
       FROM job_submissions s
       LEFT JOIN economy e ON e.userID = s.userID
       WHERE s.status = 'pending'
       ORDER BY s.created_at DESC`
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('Error in /api/admin/submissions:', err);
    return res.status(500).json({ message: 'Failed to load submissions.' });
  }
});

/**
 * GET /api/admin/redemptions
 * Returns item redemption logs (admin only).
 */
app.get('/api/admin/redemptions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT redemption_id, userID, user_tag, item_name, wallet_address, source,
              channel_name, channel_id, message_link, command_text,
              inventory_before, inventory_after, created_at
       FROM item_redemptions
       ORDER BY created_at DESC
       LIMIT 200`
    );
    const decodedRows = dbHelpers.decodeItemRedemptionRows(rows || []);
    const revealWallets = hasWalletVisibilityAccess();
    const safeRows = decodedRows.map((row) => ({
      ...row,
      wallet_address: revealWallets ? row.wallet_address : maskWalletAddress(row.wallet_address),
      command_text: revealWallets ? row.command_text : redactWalletInCommandText(row.command_text),
      wallet_visible: revealWallets,
      wallet_redacted: !revealWallets && Boolean(row.wallet_address),
    }));
    return res.json(safeRows);
  } catch (err) {
    console.error('Error in /api/admin/redemptions:', err);
    return res.status(500).json({ message: 'Failed to load redemptions.' });
  }
});

/**
 * GET /api/admin/call-attendance
 * Returns DAO call attendance records (admin only).
 */
app.get('/api/admin/call-attendance', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT d.attendance_id,
              d.userID,
              e.username,
              d.meeting_started_at,
              d.rewarded_at,
              d.minutes_attended,
              d.reward_amount
       FROM dao_call_attendance d
       LEFT JOIN economy e ON e.userID = d.userID
       ORDER BY d.rewarded_at DESC, d.attendance_id DESC
       LIMIT 500`
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('Error in /api/admin/call-attendance:', err);
    return res.status(500).json({ message: 'Failed to load call attendance.' });
  }
});

/**
 * GET /api/admin/users
 * Returns all users (admin only).
 */
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const holderMap = buildRoboCheckHolderMap();
    const rows = await dbAll(
      `SELECT userID, username
       FROM economy
       WHERE username IS NOT NULL AND username != ''
       ORDER BY LOWER(username) ASC`
    );
    const users = (rows || []).map((row) => {
      const holderInfo = holderMap.get(String(row.userID)) || {};
      return {
        ...row,
        userTag: row.username,
        walletAddress: holderInfo.walletAddress || null,
        primaryWalletAddress: holderInfo.primaryWalletAddress || holderInfo.walletAddress || null,
        wallets: holderInfo.wallets || [],
        twitterHandle: holderInfo.twitterHandle || null,
      };
    });
    return res.json(users);
  } catch (err) {
    console.error('Error in /api/admin/users:', err);
    return res.status(500).json({ message: 'Failed to load users.' });
  }
});

/**
 * GET /api/admin/giveaways
 */
app.get('/api/admin/giveaways', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, giveaway_name, prize, winners, end_time, repeat
       FROM giveaways
       ORDER BY id DESC`
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('Error in /api/admin/giveaways:', err);
    return res.status(500).json({ message: 'Failed to load giveaways.' });
  }
});

app.post('/api/admin/giveaways/create', authenticateToken, requireAdmin, async (req, res) => {
  const {
    giveaway_name,
    prize,
    winners,
    end_time,
    repeat,
    channel_id,
  } = req.body || {};

  const name = String(giveaway_name || '').trim();
  const finalPrize = String(prize || '').trim();
  const finalWinners = Number(winners) || 1;
  const finalEnd = Number(end_time) || (Date.now() + 24 * 60 * 60 * 1000);
  const finalRepeat = Number(repeat) || 0;
  const finalChannel = String(
    channel_id ||
    process.env.WEBUI_GIVEAWAY_CHANNELID ||
    process.env.SUBMISSION_CHANNEL_ID ||
    'admin'
  );

  if (!name || !finalPrize) {
    return res.status(400).json({ message: 'Name and prize are required.' });
  }

  try {
    // Match create-giveaway.js: if prize is not numeric, it must be a valid shop item.
    if (Number.isNaN(Number(finalPrize))) {
      const shopItem = await getAnyShopItemByName(finalPrize);
      if (!shopItem) {
        return res.status(400).json({ message: `Invalid prize. "${finalPrize}" is not a valid shop item.` });
      }
    }

    let messageId = `admin-${Date.now()}`;
    try {
      await waitForClientReady();
      const channel = await client.channels.fetch(finalChannel).catch(() => null);
      if (channel) {
        const remainingMs = Math.max(0, finalEnd - Date.now());
        const totalMinutes = Math.max(1, Math.round(remainingMs / 60000));
        let durationValue = totalMinutes;
        let timeUnit = 'minutes';
        if (totalMinutes % (60 * 24) === 0) {
          durationValue = totalMinutes / (60 * 24);
          timeUnit = 'days';
        } else if (totalMinutes % 60 === 0) {
          durationValue = totalMinutes / 60;
          timeUnit = 'hours';
        }

        const bannerPath = path.join(__dirname, '..', 'commands', 'banner.png');
        const files = [];
        const giveawayEmbed = new EmbedBuilder()
          .setTitle(`🎉 GIVEAWAY: ${name} 🎉`)
          .setDescription(
            `**Duration:** ${durationValue} ${timeUnit}\n` +
            `**Winners:** ${finalWinners}\n` +
            `**Prize:** ${finalPrize}\n\n` +
            `*React with 🎉 or use the online dashboard to enter!*`
          )
          .setColor(0xffa500);

        if (fs.existsSync(bannerPath)) {
          files.push({ path: bannerPath, name: 'banner.png' });
          giveawayEmbed.setImage('attachment://banner.png');
        } else {
          console.warn(`[WARN] banner.png not found at: ${bannerPath} (sending without image)`);
        }

        const adminTag = await resolveUsername(req.user.userId);
        const giveawayMessage = await sendVoltBotMessage(finalChannel, {
          content: `Started by ${adminTag} (<@${req.user.userId}>)`,
          embeds: [giveawayEmbed],
          files,
        });
        await addVoltBotReaction(finalChannel, giveawayMessage.id, '🎉');
        messageId = giveawayMessage.id;
      } else {
        console.warn(`[WARN] Giveaway channel ${finalChannel} not found. Proceeding without Discord announcement.`);
      }
    } catch (announceErr) {
      console.error('❌ Failed to announce giveaway in Discord:', announceErr);
    }

    await saveGiveaway(messageId, finalChannel, finalEnd, finalPrize, finalWinners, name, finalRepeat);
    await logAdminChange(req.user.userId, 'Giveaway created', [
      `Name: "${name}"`,
      `Prize: "${finalPrize}"`,
      `Winners: ${finalWinners}`,
      `End: ${finalEnd}`,
      `Repeat: ${finalRepeat}`,
    ]);
    return res.json({ message: 'Giveaway created.' });
  } catch (err) {
    console.error('Error creating giveaway:', err);
    return res.status(500).json({ message: 'Failed to create giveaway.' });
  }
});

/**
 * GET /api/admin/title-giveaways
 */
app.get('/api/admin/title-giveaways', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, giveaway_name, prize, winners, end_time, repeat, is_completed
       FROM title_giveaways
       ORDER BY id DESC`
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('Error in /api/admin/title-giveaways:', err);
    return res.status(500).json({ message: 'Failed to load title giveaways.' });
  }
});

/**
 * GET /api/admin/raffles
 */
app.get('/api/admin/raffles', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, name, prize, cost, quantity, winners, end_time
       FROM raffles
       ORDER BY id DESC`
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('Error in /api/admin/raffles:', err);
    return res.status(500).json({ message: 'Failed to load raffles.' });
  }
});

app.post('/api/admin/raffles/create', authenticateToken, requireAdmin, async (req, res) => {
  const { name, prize, cost, quantity, winners, end_time, channel_id } = req.body || {};

  const finalName = String(name || '').trim();
  const finalPrize = String(prize || '').trim();
  const finalCost = Number(cost) || 1;
  const finalQty = Number(quantity) || 1;
  const finalWinners = Number(winners) || 1;
  const finalEnd = Number(end_time) || (Date.now() + 24 * 60 * 60 * 1000);
  const finalChannel = String(
    channel_id ||
    process.env.WEBUI_RAFFLE_CHANNELID ||
    process.env.SUBMISSION_CHANNEL_ID ||
    'admin'
  );

  if (!finalName || !finalPrize) {
    return res.status(400).json({ message: 'Name and prize are required.' });
  }

  try {
    if (finalCost <= 0 || finalQty <= 0 || finalWinners <= 0 || finalEnd <= Date.now()) {
      return res.status(400).json({ message: 'Invalid values. Ensure all inputs are positive.' });
    }

    const activeRaffles = await getActiveRaffles();
    if (activeRaffles.some((raffle) => raffle.name === finalName)) {
      return res.status(400).json({ message: `A raffle named "${finalName}" is already running.` });
    }

    // Match create-raffle.js: if prize is not numeric, it must be a valid shop item.
    if (Number.isNaN(Number(finalPrize))) {
      const shopItem = await getAnyShopItemByName(finalPrize);
      if (!shopItem) {
        return res.status(400).json({ message: `Invalid prize. "${finalPrize}" is not a valid shop item.` });
      }
    }

    const raffleId = await createRaffle(finalChannel, finalName, finalPrize, finalCost, finalQty, finalWinners, finalEnd);
    try {
      await waitForClientReady();
      const channel = await client.channels.fetch(finalChannel).catch(() => null);
      if (channel) {
        const endDate = new Date(finalEnd);
        const formattedEndDate = endDate.toUTCString().replace(' GMT', ' UTC');
        const bannerPath = path.join(__dirname, '..', 'commands', 'banner_title.png');
        const files = [];
        const embed = new EmbedBuilder()
          .setTitle(`🎟️ Raffle Started: ${finalName}`)
          .setDescription(
            `Prize: **${finalPrize}**\n` +
            `Ticket Cost: **${formatCurrency(finalCost)}**\n` +
            `Total Tickets: **${finalQty}**\n` +
            `🎉 Ends at **${formattedEndDate}**\n` +
            `🏆 Winners: **${finalWinners}**`
          )
          .setColor(0xFFD700)
          .setTimestamp(endDate);

        if (fs.existsSync(bannerPath)) {
          files.push({ path: bannerPath, name: 'banner_title.png' });
          embed.setImage('attachment://banner_title.png');
        } else {
          console.warn(`[WARN] banner_title.png not found at: ${bannerPath} (sending without image)`);
        }

        const adminTag = await resolveUsername(req.user.userId);
        await sendVoltBotMessage(finalChannel, {
          content: `Started by ${adminTag} (<@${req.user.userId}>)`,
          embeds: [embed],
          files,
        });
      } else {
        console.warn(`[WARN] Raffle channel ${finalChannel} not found. Proceeding without Discord announcement.`);
      }
    } catch (announceErr) {
      console.error('❌ Failed to announce raffle in Discord:', announceErr);
    }

    await logAdminChange(req.user.userId, 'Raffle created', [
      `Name: "${finalName}"`,
      `Prize: "${finalPrize}"`,
      `Cost: ${finalCost}`,
      `Quantity: ${finalQty}`,
      `Winners: ${finalWinners}`,
      `End: ${finalEnd}`,
    ]);
    return res.json({ message: 'Raffle created.' });
  } catch (err) {
    console.error('Error creating raffle:', err);
    return res.status(500).json({ message: 'Failed to create raffle.' });
  }
});

/**
 * GET /api/admin/joblist
 */
app.get('/api/admin/joblist', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT jobID, description, cooldown_value, cooldown_unit
       FROM joblist
       ORDER BY jobID ASC`
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('Error in /api/admin/joblist:', err);
    return res.status(500).json({ message: 'Failed to load job list.' });
  }
});

app.get('/api/admin/shop-items', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT itemID, name, description, price, quantity, isAvailable,
              COALESCE(isHidden, 0) AS isHidden,
              COALESCE(isRedeemable, 1) AS isRedeemable
       FROM items
       ORDER BY name ASC`
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('Error in /api/admin/shop-items:', err);
    return res.status(500).json({ message: 'Failed to load shop items.' });
  }
});

app.post('/api/admin/shop-items/create', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rawName = String(req.body?.name || '').trim();
    const rawDescription = String(req.body?.description || '').trim();
    const price = Number(req.body?.price);
    const quantity = Number.isFinite(Number(req.body?.quantity)) ? Number(req.body?.quantity) : 1;
    const isHidden = req.body?.isHidden ? 1 : 0;
    const isRedeemable = req.body?.isRedeemable === false || req.body?.isRedeemable === 0 ? 0 : 1;
    const requestedAvailability = req.body?.isAvailable;
    const isAvailable = isHidden
      ? 0
      : (requestedAvailability === false || requestedAvailability === 0 ? 0 : 1);

    if (!rawName || !rawDescription || !Number.isFinite(price) || price <= 0 || quantity < 0) {
      return res.status(400).json({ message: 'Invalid item data.' });
    }

    await dbHelpers.addShopItem(price, rawName, rawDescription, quantity, isHidden, isRedeemable, isAvailable);

    await logAdminChange(req.user.userId, 'Shop item created', [
      `Name: "${rawName}"`,
      `Price: ${price}`,
      `Quantity: ${quantity}`,
      `Available: ${isAvailable ? 'Yes' : 'No'}`,
      `Hidden: ${isHidden ? 'Yes' : 'No'}`,
      `Redeemable: ${isRedeemable ? 'Yes' : 'No'}`,
    ]);

    return res.json({ message: 'Shop item created.' });
  } catch (err) {
    console.error('Error creating shop item:', err);
    const message = err?.message?.includes('UNIQUE')
      ? 'Item name already exists.'
      : 'Failed to create shop item.';
    return res.status(500).json({ message });
  }
});

app.post('/api/admin/shop-items/:id/update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId)) {
      return res.status(400).json({ message: 'Invalid item ID.' });
    }

    const existing = await dbGet(`SELECT * FROM items WHERE itemID = ?`, [itemId]);
    if (!existing) {
      return res.status(404).json({ message: 'Item not found.' });
    }

    const rawName = String(req.body?.name || '').trim();
    const rawDescription = String(req.body?.description || '').trim();
    const price = Number(req.body?.price);
    const quantity = Number.isFinite(Number(req.body?.quantity)) ? Number(req.body?.quantity) : existing.quantity;
    const isHidden = req.body?.isHidden ? 1 : 0;
    const isRedeemable = req.body?.isRedeemable === false || req.body?.isRedeemable === 0 ? 0 : 1;
    const requestedAvailability = req.body?.isAvailable;
    const isAvailable = isHidden
      ? 0
      : (requestedAvailability === false || requestedAvailability === 0 ? 0 : 1);

    if (!rawName || !rawDescription || !Number.isFinite(price) || price <= 0 || quantity < 0) {
      return res.status(400).json({ message: 'Invalid item data.' });
    }

    await dbHelpers.updateShopItemById(
      itemId,
      {
        name: rawName,
        description: rawDescription,
        price,
        quantity,
        isAvailable,
        isHidden,
        isRedeemable,
      },
      { actorUserId: req.user.userId }
    );

    const changes = [];
    if (existing.name !== rawName) changes.push(`Name: "${existing.name}" -> "${rawName}"`);
    if (existing.description !== rawDescription) changes.push('Description updated');
    if (Number(existing.price) !== price) changes.push(`Price: ${existing.price} -> ${price}`);
    if (Number(existing.quantity) !== quantity) changes.push(`Quantity: ${existing.quantity} -> ${quantity}`);
    if (Number(existing.isAvailable) !== isAvailable) changes.push(`Available: ${existing.isAvailable ? 'Yes' : 'No'} -> ${isAvailable ? 'Yes' : 'No'}`);
    if (Number(existing.isHidden || 0) !== isHidden) changes.push(`Hidden: ${existing.isHidden ? 'Yes' : 'No'} -> ${isHidden ? 'Yes' : 'No'}`);
    if (Number(existing.isRedeemable ?? 1) !== isRedeemable) changes.push(`Redeemable: ${existing.isRedeemable ? 'Yes' : 'No'} -> ${isRedeemable ? 'Yes' : 'No'}`);

    await logAdminChange(req.user.userId, `Shop item updated (#${itemId})`, changes);

    return res.json({ message: 'Shop item updated.' });
  } catch (err) {
    console.error('Error updating shop item:', err);
    const message = err?.message?.includes('UNIQUE')
      ? 'Item name already exists.'
      : 'Failed to update shop item.';
    return res.status(500).json({ message });
  }
});

app.post('/api/admin/shop-items/:id/delete', authenticateToken, requireAdmin, async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) {
    return res.status(400).json({ message: 'Invalid item ID.' });
  }

  try {
    const existing = await dbGet(`SELECT name FROM items WHERE itemID = ?`, [itemId]);
    if (!existing) {
      return res.status(404).json({ message: 'Item not found.' });
    }

    await dbHelpers.deleteShopItemById(itemId, { actorUserId: req.user.userId });

    await logAdminChange(req.user.userId, `Shop item deleted (#${itemId})`, [
      `Name: "${existing.name}"`,
    ]);

    return res.json({ message: 'Shop item deleted.' });
  } catch (err) {
    console.error('Error deleting shop item:', err);
    return res.status(500).json({ message: 'Failed to delete shop item.' });
  }
});

/**
 * GET /api/quest-status
 * Returns quest status for current user.
 */
app.get('/api/quest-status', authenticateToken, async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  try {
    const pending = await dbGet(
      `SELECT submission_id FROM job_submissions
       WHERE userID = ? AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (pending) {
      return res.json({ status: 'awaiting_submission' });
    }

    const activeJob = await dbGet(
      `SELECT jobID FROM job_assignees WHERE userID = ?`,
      [userId]
    );

    if (activeJob) {
      return res.json({ status: 'active_quest' });
    }

    return res.json({ status: 'no_quest' });
  } catch (err) {
    console.error('Error in /api/quest-status:', err);
    return res.status(500).json({ message: 'Failed to fetch quest status.' });
  }
});

/**
 * GET /api/chat/messages
 * Returns recent chat messages (authenticated).
 */
app.get('/api/chat/messages', authenticateToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const rows = await dbAll(
      `SELECT id, userID, username, message, is_admin, created_at
       FROM chat_messages
       ORDER BY id DESC
       LIMIT ?`,
      [limit]
    );
    const ordered = (rows || []).reverse();
    return res.json(ordered);
  } catch (err) {
    console.error('Error in /api/chat/messages:', err);
    return res.status(500).json({ message: 'Failed to load chat.' });
  }
});

/**
 * POST /api/chat/messages
 * Creates a chat message (authenticated).
 */
app.post('/api/chat/messages', authenticateToken, async (req, res) => {
  const userId = req.user?.userId;
  const username = req.user?.username || 'Unknown';
  const message = String(req.body?.message || '').trim();

  if (!userId) return res.status(401).json({ message: 'User not authenticated.' });
  if (!message) return res.status(400).json({ message: 'Message is required.' });
  if (message.length > 500) return res.status(400).json({ message: 'Message too long.' });

  try {
    const admin = await isAdmin(userId);
    await dbHelpers.createChatMessage({
      userID: userId,
      username,
      message,
      isAdmin: admin ? 1 : 0,
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/chat/messages:', err);
    return res.status(500).json({ message: 'Failed to send message.' });
  }
});

/**
 * POST /api/chat/ping
 * Updates chat presence (authenticated).
 */
app.post('/api/chat/ping', authenticateToken, async (req, res) => {
  const userId = req.user?.userId;
  const username = req.user?.username || 'Unknown';
  if (!userId) return res.status(401).json({ message: 'User not authenticated.' });

  try {
    await dbHelpers.touchChatPresence({
      userID: userId,
      username,
      lastSeen: Math.floor(Date.now() / 1000),
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/chat/ping:', err);
    return res.status(500).json({ message: 'Failed to update presence.' });
  }
});

/**
 * GET /api/chat/presence
 * Returns who is online now and who was seen in last 9 minutes.
 */
app.get('/api/chat/presence', authenticateToken, async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - 15;
    const rows = await dbAll(
      `SELECT userID, username, last_seen
       FROM chat_presence
       WHERE last_seen >= ?
       ORDER BY last_seen DESC`,
      [cutoff]
    );

    const online = (rows || []).map((row) => ({
      userID: row.userID,
      username: row.username,
    }));

    return res.json({ online });
  } catch (err) {
    console.error('Error in /api/chat/presence:', err);
    return res.status(500).json({ message: 'Failed to load presence.' });
  }
});

/**
 * POST /api/admin/submissions/:submissionId/complete
 * Marks a submission complete and rewards volts (admin only).
 */
app.post('/api/admin/submissions/:submissionId/complete', authenticateToken, requireAdmin, async (req, res) => {
  const { submissionId } = req.params;
  const rewardAmount = Number(req.body?.rewardAmount);

  if (!Number.isFinite(rewardAmount) || rewardAmount < 0) {
    return res.status(400).json({ message: 'Invalid reward amount.' });
  }

  try {
    const submission = await dbGet(
      `SELECT submission_id, userID, title, description, image_url, status
       FROM job_submissions
       WHERE submission_id = ?`,
      [submissionId]
    );

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found.' });
    }

    if (submission.status !== 'pending') {
      return res.status(400).json({ message: 'Submission already processed.' });
    }

    const completionResult = await dbHelpers.completePendingJobSubmissions(
      submission.userID,
      [submission.submission_id],
      rewardAmount
    );

    if (!completionResult.success) {
      return res.status(400).json({ message: 'Submission already processed.' });
    }

    try {
      const channelId = QUEST_SUBMISSION_CHANNEL_ID;
      if (channelId) {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
          const userTag = await resolveUsername(submission.userID);
          const adminTag = await resolveUsername(req.user.userId);
          const embed = new EmbedBuilder()
            .setTitle('✅ Quest Marked Complete')
            .setColor(SUBMISSION_EMBED_COLORS.questComplete)
            .addFields(
              { name: 'User', value: userTag, inline: true },
              { name: 'Marked By', value: adminTag, inline: true },
              { name: 'Volts Awarded', value: String(rewardAmount), inline: true },
              { name: 'Title', value: submission.title || '—', inline: false },
              { name: 'Description', value: submission.description || '—', inline: false }
            )
            .setTimestamp();
          if (submission.image_url) {
            embed.setImage(submission.image_url);
            embed.addFields({
              name: 'Image',
              value: `[View Image](${submission.image_url})`,
              inline: false,
            });
          }
          await channel.send({ embeds: [embed] });
        }
      }
    } catch (notifyErr) {
      console.error('❌ Failed to send completion message:', notifyErr);
    }

    return res.json({ message: 'Submission completed.', rewardAmount });
  } catch (err) {
    console.error('Error completing submission:', err);
    return res.status(500).json({ message: 'Failed to complete submission.' });
  }
});

/**
 * POST /api/admin/giveaways/:id/update
 */
app.post('/api/admin/giveaways/:id/update', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { giveaway_name, prize, winners, end_time, repeat } = req.body || {};

  try {
    const existing = await dbGet(`SELECT * FROM giveaways WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Giveaway not found.' });

    const updates = [];
    const params = [];
    const changes = [];

    if (giveaway_name !== undefined && giveaway_name !== existing.giveaway_name) {
      updates.push('giveaway_name = ?'); params.push(giveaway_name);
      changes.push(`Name: "${existing.giveaway_name}" -> "${giveaway_name}"`);
    }
    if (prize !== undefined && prize !== existing.prize) {
      updates.push('prize = ?'); params.push(prize);
      changes.push(`Prize: "${existing.prize}" -> "${prize}"`);
    }
    if (winners !== undefined && Number(winners) !== existing.winners) {
      updates.push('winners = ?'); params.push(Number(winners));
      changes.push(`Winners: ${existing.winners} -> ${Number(winners)}`);
    }
    if (end_time !== undefined && Number(end_time) !== existing.end_time) {
      updates.push('end_time = ?'); params.push(Number(end_time));
      changes.push(`End: ${existing.end_time} -> ${Number(end_time)}`);
    }
    if (repeat !== undefined && Number(repeat) !== existing.repeat) {
      updates.push('repeat = ?'); params.push(Number(repeat));
      changes.push(`Repeat: ${existing.repeat} -> ${Number(repeat)}`);
    }

    if (!updates.length) return res.json({ message: 'No changes.' });
    await dbHelpers.updateGiveawayById(id, {
      giveaway_name: giveaway_name !== undefined ? giveaway_name : existing.giveaway_name,
      prize: prize !== undefined ? prize : existing.prize,
      winners: winners !== undefined ? Number(winners) : existing.winners,
      end_time: end_time !== undefined ? Number(end_time) : existing.end_time,
      repeat: repeat !== undefined ? Number(repeat) : existing.repeat,
    }, {
      actorUserId: req.user.userId,
    });

    await logAdminChange(req.user.userId, `Giveaway #${id} updated`, changes);
    return res.json({ message: 'Giveaway updated.' });
  } catch (err) {
    console.error('Error updating giveaway:', err);
    return res.status(500).json({ message: 'Failed to update giveaway.' });
  }
});

app.post('/api/admin/giveaways/:id/stop', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet(`SELECT * FROM giveaways WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Giveaway not found.' });
    const now = Date.now();
    await dbHelpers.updateGiveawayById(id, { end_time: now }, { actorUserId: req.user.userId });
    await logAdminChange(req.user.userId, `Giveaway #${id} stopped`, [`End set to ${now}`]);
    return res.json({ message: 'Giveaway stopped.' });
  } catch (err) {
    console.error('Error stopping giveaway:', err);
    return res.status(500).json({ message: 'Failed to stop giveaway.' });
  }
});

app.post('/api/admin/giveaways/:id/start', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const durationHours = Number(req.body?.durationHours) || 24;
  try {
    const existing = await dbGet(`SELECT * FROM giveaways WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Giveaway not found.' });
    const end = Date.now() + durationHours * 60 * 60 * 1000;
    await dbHelpers.updateGiveawayById(id, { end_time: end }, { actorUserId: req.user.userId });
    await logAdminChange(req.user.userId, `Giveaway #${id} started`, [`End set to ${end}`]);
    return res.json({ message: 'Giveaway started.' });
  } catch (err) {
    console.error('Error starting giveaway:', err);
    return res.status(500).json({ message: 'Failed to start giveaway.' });
  }
});

/**
 * Title Giveaways admin
 */
app.post('/api/admin/title-giveaways/:id/update', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { giveaway_name, prize, winners, end_time, repeat, is_completed } = req.body || {};
  try {
    const existing = await dbGet(`SELECT * FROM title_giveaways WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Title giveaway not found.' });

    const updates = [];
    const params = [];
    const changes = [];

    if (giveaway_name !== undefined && giveaway_name !== existing.giveaway_name) {
      updates.push('giveaway_name = ?'); params.push(giveaway_name);
      changes.push(`Name: "${existing.giveaway_name}" -> "${giveaway_name}"`);
    }
    if (prize !== undefined && prize !== existing.prize) {
      updates.push('prize = ?'); params.push(prize);
      changes.push(`Prize: "${existing.prize}" -> "${prize}"`);
    }
    if (winners !== undefined && Number(winners) !== existing.winners) {
      updates.push('winners = ?'); params.push(Number(winners));
      changes.push(`Winners: ${existing.winners} -> ${Number(winners)}`);
    }
    if (end_time !== undefined && Number(end_time) !== existing.end_time) {
      updates.push('end_time = ?'); params.push(Number(end_time));
      changes.push(`End: ${existing.end_time} -> ${Number(end_time)}`);
    }
    if (repeat !== undefined && Number(repeat) !== existing.repeat) {
      updates.push('repeat = ?'); params.push(Number(repeat));
      changes.push(`Repeat: ${existing.repeat} -> ${Number(repeat)}`);
    }
    if (is_completed !== undefined && Number(is_completed) !== existing.is_completed) {
      updates.push('is_completed = ?'); params.push(Number(is_completed));
      changes.push(`Completed: ${existing.is_completed} -> ${Number(is_completed)}`);
    }

    if (!updates.length) return res.json({ message: 'No changes.' });
    await dbHelpers.updateTitleGiveawayById(id, {
      giveaway_name: giveaway_name !== undefined ? giveaway_name : existing.giveaway_name,
      prize: prize !== undefined ? prize : existing.prize,
      winners: winners !== undefined ? Number(winners) : existing.winners,
      end_time: end_time !== undefined ? Number(end_time) : existing.end_time,
      repeat: repeat !== undefined ? Number(repeat) : existing.repeat,
      is_completed: is_completed !== undefined ? Number(is_completed) : existing.is_completed,
    }, {
      actorUserId: req.user.userId,
    });

    await logAdminChange(req.user.userId, `Title Giveaway #${id} updated`, changes);
    return res.json({ message: 'Title giveaway updated.' });
  } catch (err) {
    console.error('Error updating title giveaway:', err);
    return res.status(500).json({ message: 'Failed to update title giveaway.' });
  }
});

app.post('/api/admin/title-giveaways/:id/stop', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet(`SELECT * FROM title_giveaways WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Title giveaway not found.' });
    await dbHelpers.updateTitleGiveawayById(id, { is_completed: 1 }, { actorUserId: req.user.userId });
    await logAdminChange(req.user.userId, `Title Giveaway #${id} stopped`, ['Completed set to 1']);
    return res.json({ message: 'Title giveaway stopped.' });
  } catch (err) {
    console.error('Error stopping title giveaway:', err);
    return res.status(500).json({ message: 'Failed to stop title giveaway.' });
  }
});

app.post('/api/admin/title-giveaways/:id/start', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const durationHours = Number(req.body?.durationHours) || 24;
  try {
    const existing = await dbGet(`SELECT * FROM title_giveaways WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Title giveaway not found.' });
    const end = Date.now() + durationHours * 60 * 60 * 1000;
    await dbHelpers.updateTitleGiveawayById(id, { is_completed: 0, end_time: end }, { actorUserId: req.user.userId });
    await logAdminChange(req.user.userId, `Title Giveaway #${id} started`, [`End set to ${end}`]);
    return res.json({ message: 'Title giveaway started.' });
  } catch (err) {
    console.error('Error starting title giveaway:', err);
    return res.status(500).json({ message: 'Failed to start title giveaway.' });
  }
});

/**
 * POST /api/admin/title-giveaways/create
 */
app.post('/api/admin/title-giveaways/create', authenticateToken, requireAdmin, async (req, res) => {
  const {
    giveaway_name,
    prize,
    winners,
    end_time,
    repeat,
  } = req.body || {};

  const name = String(giveaway_name || '').trim();
  const finalPrize = String(prize || '').trim();
  const finalWinners = Number(winners) || 1;
  const finalEnd = Number(end_time) || (Date.now() + 24 * 60 * 60 * 1000);
  const finalRepeat = Number(repeat) || 0;

  if (!name || !finalPrize) {
    return res.status(400).json({ message: 'Name and prize are required.' });
  }

  try {
    const messageId = `admin-${Date.now()}`;
    const channelId = process.env.SUBMISSION_CHANNEL_ID || 'admin';
    await dbHelpers.saveTitleGiveaway(messageId, channelId, finalEnd, finalPrize, finalWinners, name, finalRepeat);
    await logAdminChange(req.user.userId, 'Title Giveaway created', [
      `Name: "${name}"`,
      `Prize: "${finalPrize}"`,
      `Winners: ${finalWinners}`,
      `End: ${finalEnd}`,
      `Repeat: ${finalRepeat}`,
    ]);
    return res.json({ message: 'Title giveaway created.' });
  } catch (err) {
    console.error('Error creating title giveaway:', err);
    return res.status(500).json({ message: 'Failed to create title giveaway.' });
  }
});

/**
 * Raffles admin
 */
app.post('/api/admin/raffles/:id/update', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, prize, cost, quantity, winners, end_time } = req.body || {};
  try {
    const existing = await dbGet(`SELECT * FROM raffles WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Raffle not found.' });

    const updates = [];
    const params = [];
    const changes = [];

    if (name !== undefined && name !== existing.name) {
      updates.push('name = ?'); params.push(name);
      changes.push(`Name: "${existing.name}" -> "${name}"`);
    }
    if (prize !== undefined && prize !== existing.prize) {
      updates.push('prize = ?'); params.push(prize);
      changes.push(`Prize: "${existing.prize}" -> "${prize}"`);
    }
    if (cost !== undefined && Number(cost) !== existing.cost) {
      updates.push('cost = ?'); params.push(Number(cost));
      changes.push(`Cost: ${existing.cost} -> ${Number(cost)}`);
    }
    if (quantity !== undefined && Number(quantity) !== existing.quantity) {
      updates.push('quantity = ?'); params.push(Number(quantity));
      changes.push(`Quantity: ${existing.quantity} -> ${Number(quantity)}`);
    }
    if (winners !== undefined && Number(winners) !== existing.winners) {
      updates.push('winners = ?'); params.push(Number(winners));
      changes.push(`Winners: ${existing.winners} -> ${Number(winners)}`);
    }
    if (end_time !== undefined && Number(end_time) !== existing.end_time) {
      updates.push('end_time = ?'); params.push(Number(end_time));
      changes.push(`End: ${existing.end_time} -> ${Number(end_time)}`);
    }

    if (!updates.length) return res.json({ message: 'No changes.' });
    await dbHelpers.updateRaffleById(id, {
      name: name !== undefined ? name : existing.name,
      prize: prize !== undefined ? prize : existing.prize,
      cost: cost !== undefined ? Number(cost) : existing.cost,
      quantity: quantity !== undefined ? Number(quantity) : existing.quantity,
      winners: winners !== undefined ? Number(winners) : existing.winners,
      end_time: end_time !== undefined ? Number(end_time) : existing.end_time,
    }, {
      actorUserId: req.user.userId,
    });

    await logAdminChange(req.user.userId, `Raffle #${id} updated`, changes);
    return res.json({ message: 'Raffle updated.' });
  } catch (err) {
    console.error('Error updating raffle:', err);
    return res.status(500).json({ message: 'Failed to update raffle.' });
  }
});

app.post('/api/admin/raffles/:id/stop', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet(`SELECT * FROM raffles WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Raffle not found.' });
    const now = Date.now();
    await dbHelpers.updateRaffleById(id, { end_time: now }, { actorUserId: req.user.userId });
    await logAdminChange(req.user.userId, `Raffle #${id} stopped`, [`End set to ${now}`]);
    return res.json({ message: 'Raffle stopped.' });
  } catch (err) {
    console.error('Error stopping raffle:', err);
    return res.status(500).json({ message: 'Failed to stop raffle.' });
  }
});

app.post('/api/admin/raffles/:id/start', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const durationHours = Number(req.body?.durationHours) || 24;
  try {
    const existing = await dbGet(`SELECT * FROM raffles WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Raffle not found.' });
    const end = Date.now() + durationHours * 60 * 60 * 1000;
    await dbHelpers.restartRaffleById(id, end, { actorUserId: req.user.userId });
    await logAdminChange(req.user.userId, `Raffle #${id} started`, [`End set to ${end}`]);
    return res.json({ message: 'Raffle started.' });
  } catch (err) {
    console.error('Error starting raffle:', err);
    return res.status(500).json({ message: 'Failed to start raffle.' });
  }
});

/**
 * Job list admin
 */
app.post('/api/admin/joblist', authenticateToken, requireAdmin, async (req, res) => {
  const description = String(req.body?.description || '').trim();
  if (!description) return res.status(400).json({ message: 'Description required.' });
  try {
    const { cooldownValue, cooldownUnit } = normalizeCooldownInput(
      req.body?.cooldown_value,
      req.body?.cooldown_unit
    );
    await dbHelpers.addJob(description, cooldownValue, cooldownUnit);
    const cooldownLabel = cooldownValue && cooldownUnit ? ` (Cooldown: ${cooldownValue} ${cooldownUnit}${cooldownValue === 1 ? '' : 's'})` : '';
    await logAdminChange(req.user.userId, 'Job list updated', [`Added quest: "${description}"${cooldownLabel}`]);
    return res.json({ message: 'Job added.' });
  } catch (err) {
    console.error('Error adding job:', err);
    const status = err?.message && err.message.toLowerCase().includes('cooldown') ? 400 : 500;
    return res.status(status).json({ message: err?.message || 'Failed to add job.' });
  }
});

app.post('/api/admin/joblist/:id/update', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const description = String(req.body?.description || '').trim();
  if (!description) return res.status(400).json({ message: 'Description required.' });
  try {
    const existing = await dbGet(
      `SELECT description, cooldown_value, cooldown_unit FROM joblist WHERE jobID = ?`,
      [id]
    );
    if (!existing) return res.status(404).json({ message: 'Job not found.' });
    const { cooldownValue, cooldownUnit } = normalizeCooldownInput(
      req.body?.cooldown_value,
      req.body?.cooldown_unit
    );
    await dbHelpers.updateJobById(id, description, cooldownValue, cooldownUnit, {
      actorUserId: req.user.userId,
    });
    const beforeCooldown = existing.cooldown_value && existing.cooldown_unit
      ? `${existing.cooldown_value} ${existing.cooldown_unit}${existing.cooldown_value === 1 ? '' : 's'}`
      : 'None';
    const afterCooldown = cooldownValue && cooldownUnit
      ? `${cooldownValue} ${cooldownUnit}${cooldownValue === 1 ? '' : 's'}`
      : 'None';
    await logAdminChange(req.user.userId, 'Job list updated', [
      `Updated quest #${id}: "${existing.description}" -> "${description}"`,
      `Cooldown: ${beforeCooldown} -> ${afterCooldown}`,
    ]);
    return res.json({ message: 'Job updated.' });
  } catch (err) {
    console.error('Error updating job:', err);
    const status = err?.message && err.message.toLowerCase().includes('cooldown') ? 400 : 500;
    return res.status(status).json({ message: err?.message || 'Failed to update job.' });
  }
});

app.post('/api/admin/joblist/:id/delete', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet(`SELECT description FROM joblist WHERE jobID = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Job not found.' });
    await dbHelpers.deleteJobById(id, { actorUserId: req.user.userId });
    await logAdminChange(req.user.userId, 'Job list updated', [
      `Deleted quest #${id}: "${existing.description}"`,
    ]);
    return res.json({ message: 'Job deleted.' });
  } catch (err) {
    console.error('Error deleting job:', err);
    return res.status(500).json({ message: 'Failed to delete job.' });
  }
});

/**
 * GET /api/shop
 */
app.get('/api/shop', (req, res) => {
  db.all(
    `SELECT itemID AS id, name, price, description, quantity 
     FROM items
     WHERE isAvailable = 1
       AND quantity > 0
       AND COALESCE(isHidden, 0) = 0`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching shop items:', err);
        return res.status(500).json({ error: 'Failed to fetch shop items.' });
      }
      if (!rows || rows.length === 0) {
        return res.status(404).json({ message: 'No items found in the shop.' });
      }
      res.json(rows);
    }
  );
});

/**
 * GET /api/raffles/active
 * Returns active raffles (end_time > now) for client filtering.
 */
app.get('/api/raffles/active', async (req, res) => {
  try {
    const rows = await getActiveRaffles();
    return res.json(rows || []);
  } catch (err) {
    console.error('Error fetching active raffles:', err);
    return res.status(500).json({ message: 'Failed to fetch active raffles.' });
  }
});

/**
 * GET /api/jobs
 * Return a list of jobs with user mappings resolved,
 * including assignee links to their Discord profiles.
 */
app.get('/api/jobs', async (req, res) => {
  try {
    db.all(
      `
      SELECT j.jobID, j.description, j.cooldown_value, j.cooldown_unit, GROUP_CONCAT(ja.userID) as assignees
      FROM joblist j
      LEFT JOIN job_assignees ja ON j.jobID = ja.jobID
      GROUP BY j.jobID
      `,
      [],
      (err, rows) => {
        if (err) {
          console.error('Error fetching jobs:', err);
          return res.status(500).json({ error: 'Failed to fetch jobs.' });
        }

        const jobs = rows.map((job) => ({
          jobID: job.jobID,
          description: job.description,
          cooldown_value: job.cooldown_value ?? null,
          cooldown_unit: job.cooldown_unit ?? null,
          assignees: job.assignees ? job.assignees.split(',') : [],
        }));

        res.json(jobs);
      }
    );
  } catch (err) {
    console.error('Error in /api/jobs route:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/resolveUser/:userId
 * Resolve a user ID to a username.
 */
app.get('/api/resolveUser/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  try {
    const username = await resolveUsername(userId); // Your database or API logic here
    res.json({ username });
  } catch (error) {
    console.error(`Error resolving user ID ${userId}:`, error);
    res.json({ username: null });
  }
});

/**
 * GET /api/discord-user/:userId
 * Return Discord profile info, including avatar URL.
 */
app.get('/api/discord-user/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  try {
    const info = await fetchDiscordUserInfo(userId);
    if (!info) {
      return res.status(404).json({ message: 'Discord user not found.' });
    }
    return res.json(info);
  } catch (error) {
    console.error(`Error fetching Discord user info for ID ${userId}:`, error);
    return res.status(500).json({ message: 'Failed to fetch Discord user info.' });
  }
});

/**
 * GET /api/resolveChannel/:channelId
 * Resolve a channel ID to a channel name.
 */
app.get('/api/resolveChannel/:channelId', async (req, res) => {
  const { channelId } = req.params;
  try {
    const channelName = await resolveChannelName(channelId);
    res.json({ channelName });
  } catch (error) {
    console.error(`Error resolving channel ID ${channelId}:`, error);
    res.json({ channelName: `UnknownChannel (${channelId})` });
  }
});

/**
 * GET /api/holder/:discordId
 * Return a single holder profile from Robo-Check holders.json.
 */
app.get('/api/holder/wallet/:walletAddress', authenticateToken, async (req, res) => {
  const { walletAddress } = req.params;
  res.json(await mergeHolderWithProfileDetails(findHolderByWalletAddress(walletAddress)));
});

app.get('/api/holder/twitter/:twitterHandle', authenticateToken, async (req, res) => {
  const { twitterHandle } = req.params;
  res.json(await mergeHolderWithProfileDetails(findHolderByTwitterHandle(twitterHandle)));
});

app.get('/api/holder/username/:username', authenticateToken, async (req, res) => {
  try {
    const { username } = req.params;
    res.json(await mergeHolderWithProfileDetails(await findHolderByUsername(username)));
  } catch (error) {
    console.error('Error in /api/holder/username route:', error);
    res.status(500).json({ message: 'Failed to load holder profile.' });
  }
});

app.get('/api/holder/:discordId', authenticateToken, async (req, res) => {
  const { discordId } = req.params;
  res.json(await mergeHolderWithProfileDetails(findHolderByDiscordId(discordId), discordId));
});

/**
 * Example implementation of resolveChannelName.
 * Replace with your actual logic to resolve channel names.
 */
async function resolveChannelName(channelId) {
  const mockChannelMap = {
    '1027625627983028265': 'robo-culture',
    '1015078531526574141': 'robo-chat',
    '1336779333641179146': 'playground',
  };
  return mockChannelMap[channelId] || `UnknownChannel (${channelId})`;
}

/**
 * GET /api/giveaways
 * If you want *all* giveaways, do:
 */
app.get('/api/giveaways', (req, res) => {
  db.all(`SELECT * FROM giveaways`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching giveaways:', err);
      return res.status(500).json({ error: 'Failed to fetch giveaways.' });
    }
    res.json(rows);
  });
});

/**
 * GET /api/giveaways/active
 * Only return those that haven't ended yet (assuming end_time is a numeric ms timestamp).
 */
app.get('/api/giveaways/active', (req, res) => {
  const now = Date.now();
  db.all(`SELECT * FROM giveaways WHERE end_time > ?`, [now], (err, rows) => {
    if (err) {
      console.error('Error fetching active giveaways:', err);
      return res.status(500).json({ error: 'Failed to fetch active giveaways.' });
    }
    res.json(rows);
  });
});

/**
 * GET /api/console
 * Serve the last 16 log entries from console.json in a readable format.
 */
app.get('/api/console', (req, res) => {
  const consoleFilePath = path.join(__dirname, '..', 'console.json');

  fs.readFile(consoleFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading console.json:', err);
      return res.status(500).json({ error: 'Failed to read console logs.' });
    }

    try {
      let logs = JSON.parse(data);

      // Ensure logs is an array before processing
      if (!Array.isArray(logs)) {
        throw new Error('console.json does not contain an array.');
      }

      // Get the last 160 log entries
      const lastLogs = logs.slice(-160);

      res.setHeader('Content-Type', 'application/json');
      res.send(
        JSON.stringify(
          {
            logs: lastLogs,
            count: lastLogs.length,
            message: 'Last 160 log entries retrieved successfully',
          },
          null,
          2 // Indentation for readability
        )
      );
    } catch (parseErr) {
      console.error('Error parsing console.json:', parseErr);
      res.status(500).json({ error: 'Invalid JSON format in console.json.' });
    }
  });
});



// Default route → serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get(/^\/(?:inventory\/.+|wallet\/.+|twitter\/.+|username\/.+|[^/]+)$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

/**
 * Middleware to Verify JWT Token
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(403).json({ message: "Access denied. No token provided." });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(401).json({ message: "Invalid token." });
    }
    req.user = user;
    next();
  });
}


// Secret key for JWT authentication (Use an environment variable in production)
const SECRET_KEY = process.env.JWT_SECRET || "your-very-secure-secret";

const DISCORD_CLIENT_ID =
  process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID;
const DISCORD_CLIENT_SECRET =
  process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET;
const DISCORD_OAUTH_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
const DISCORD_OAUTH_TOKEN_URL = "https://discord.com/api/oauth2/token";
const GUILD_ID = process.env.GUILD_ID;

// 🚦 Allowed roles filter for Discord web login
// ALLOWED_ROLES should be a comma-separated list of role IDs.
const ALLOWED_ROLES = process.env.ALLOWED_ROLES
  ? process.env.ALLOWED_ROLES.split(',').map(role => role.trim()).filter(Boolean)
  : [];

async function waitForClientReady() {
  if (client?.isReady && client.isReady()) return;
  await new Promise(resolve => client.once('ready', resolve));
}

async function fetchGuild() {
  if (!GUILD_ID) return null;
  await waitForClientReady();
  let guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    try {
      guild = await client.guilds.fetch(GUILD_ID);
    } catch (err) {
      console.error(`❌ Failed to fetch guild ${GUILD_ID}:`, err);
      return null;
    }
  }
  return guild;
}

async function userHasAllowedRoleById(userId) {
  if (ALLOWED_ROLES.length === 0) return true;
  if (!GUILD_ID) {
    console.error("❌ ALLOWED_ROLES is set but GUILD_ID is missing.");
    return false;
  }

  const guild = await fetchGuild();
  if (!guild) return false;

  let member = guild.members.cache.get(userId);
  if (!member) {
    try {
      member = await guild.members.fetch(userId);
    } catch (err) {
      console.error(`❌ Failed to fetch member ${userId}:`, err);
      return false;
    }
  }

  return member.roles.cache.some(role => ALLOWED_ROLES.includes(role.id));
}

function getServerOrigin() {
  const raw = process.env.BASE_URL || `http://localhost:${PORT}`;
  try {
    const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
    if (!url.port && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      url.port = String(PORT);
    }
    return url.origin;
  } catch (error) {
    return `http://localhost:${PORT}`;
  }
}

function getDiscordRedirectUri() {
  return `${getServerOrigin()}/auth/discord/callback`;
}

// Ensure users table exists
db.run(
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`
);

// ------------------------------
// User Registration (Sign Up)
// ------------------------------
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }

  try {
    // Hash the password before storing
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user into database
    db.run(
      `INSERT INTO users (username, password) VALUES (?, ?)`,
      [username, hashedPassword],
      async function onRegister(err) {
        if (err) {
          console.error("Error registering user:", err.message);
          return res.status(500).json({ message: "Username already exists." });
        }
        try {
          await dbHelpers.appendSystemEvent({
            domain: 'web_auth',
            action: 'register_local_user',
            entityType: 'local_user',
            entityId: this.lastID,
            metadata: {
              localUserId: this.lastID,
              username,
            },
          });
        } catch (eventError) {
          console.error('Failed to log local user registration:', eventError);
        }
        res.json({ message: "Registration successful!" });
      }
    );
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

const util = require('util');
const dbRun = util.promisify(db.run).bind(db);
// Promisify the db.get method for easier async/await usage
const dbGet = util.promisify(db.get).bind(db);
const dbAll = util.promisify(db.all).bind(db);

function dbRunWithMeta(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ changes: this.changes ?? 0, lastID: this.lastID ?? null });
    });
  });
}

db.run(`
  CREATE TABLE IF NOT EXISTS node_operator_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_label TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
  )
`);

function getClientErrorStatus(message, { allowNotFound = true } = {}) {
  const normalized = String(message || '').toLowerCase();

  if (allowNotFound && (normalized.includes('not found') || normalized.includes('no oil available') || normalized.includes('no buy offers'))) {
    return 404;
  }

  if (
    normalized.startsWith('🚫') ||
    normalized.includes('insufficient') ||
    normalized.includes('not enough') ||
    normalized.includes('invalid') ||
    normalized.includes('cannot') ||
    normalized.includes('required') ||
    normalized.includes('mismatch') ||
    normalized.includes('not available') ||
    normalized.startsWith('only ')
  ) {
    return 400;
  }

  return 500;
}

function parseLedgerMetadata(rawMetadata) {
  if (!rawMetadata) return {};
  if (typeof rawMetadata === 'object') return rawMetadata;

  try {
    return JSON.parse(rawMetadata);
  } catch (error) {
    return {};
  }
}

function buildVoltScanLabel(userId, username, fallback = 'System') {
  if (!userId) return fallback;
  return username ? `${username}` : String(userId);
}

const NODE_HISTORY_WINDOW_MS = 48 * 60 * 60 * 1000;
const NODE_NETWORK_POLL_MS = Math.max(5000, Number(process.env.VOLT_NETWORK_POLL_MS || 5000));
const CANONICAL_EXPORT_REFRESH_MS = Math.max(15000, Number(process.env.VOLT_EXPORT_REFRESH_MS || 60000));
const NODE_STATUS_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.VOLT_NODE_STATUS_FETCH_TIMEOUT_MS || 4000));
const NODE_NETWORK_CACHE_PATH = path.join(__dirname, '..', 'data', 'node-network-cache.json');
const NODE_REGISTRY_PATH = path.join(__dirname, '..', 'data', 'node-registry.json');
const NODE_REGISTRY_TTL_MS = Math.max(60000, Number(process.env.VOLT_NODE_REGISTRY_TTL_MS || 10 * 60 * 1000));
const CONSENSUS_REPORTS_PATH = path.join(__dirname, '..', 'data', 'consensus-reports.json');
const CONSENSUS_REPORT_TTL_MS = Math.max(60000, Number(process.env.VOLT_CONSENSUS_REPORT_TTL_MS || 10 * 60 * 1000));
const CONSENSUS_UPDATE_GRACE_MS = Math.max(10000, Number(process.env.VOLT_CONSENSUS_UPDATE_GRACE_MS || 45000));
const VOLT_NODE_AUTH_KEY = String(process.env.VOLT_NODE_AUTH_KEY || '').trim();
const NODE_NETWORK_NODE_URLS = String(process.env.VOLT_NETWORK_NODE_URLS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const NODE_NETWORK_CANONICAL_ID = String(process.env.VOLT_NETWORK_CANONICAL_ID || 'volt-primary').trim();
const NODE_NETWORK_CANONICAL_NAME = String(process.env.VOLT_NETWORK_CANONICAL_NAME || 'Volt Primary').trim();
const CANONICAL_LEDGER_EXPORT_PATH = path.join(__dirname, '..', 'ledger-export.json');
const CANONICAL_SYSTEM_EVENTS_EXPORT_PATH = path.join(__dirname, '..', 'system-events-export.json');
const CANONICAL_ACTIVITY_EXPORT_PATH = path.join(__dirname, '..', 'activity-export.json');

function normalizeNodeStatusUrl(value) {
  const input = String(value || '').trim().replace(/\/+$/, '');
  if (!input) return null;
  return /\/node\/status$/i.test(input) ? input : `${input}/node/status`;
}

function normalizeNodeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '') || null;
}

function deriveCombinedHeadKey(payload) {
  const ledger = payload?.ledger || {};
  const systemEvents = payload?.systemEvents || {};
  if (!ledger.latestHash || !systemEvents.latestHash) return null;

  return [
    Number(ledger.transactionCount || 0),
    ledger.latestHash,
    Number(systemEvents.eventCount || 0),
    systemEvents.latestHash,
  ].join(':');
}

function classifyExecutionAgreement(execution, report) {
  const executionHeadKey = deriveCombinedHeadKey(execution);
  const consensusHeadKey = report?.consensus?.localHeadKey || deriveCombinedHeadKey(report);
  const executionProjection = String(execution?.projection?.fingerprint || '').trim() || null;
  const consensusProjection = String(report?.projection?.fingerprint || '').trim() || null;
  if (!consensusHeadKey || !executionHeadKey) {
    return 'unknown';
  }

  if (
    consensusHeadKey === executionHeadKey &&
    (!executionProjection || !consensusProjection || executionProjection === consensusProjection)
  ) {
    return 'agree';
  }

  const reportedAt = Date.parse(report?.reportedAt || report?.updatedAt || 0);
  const reportAgeMs = Number.isFinite(reportedAt) ? Math.max(0, Date.now() - reportedAt) : Number.POSITIVE_INFINITY;
  const executionLedgerCount = Number(execution?.ledger?.transactionCount || 0);
  const executionEventCount = Number(execution?.systemEvents?.eventCount || 0);
  const reportLedgerCount = Number(report?.ledger?.transactionCount || 0);
  const reportEventCount = Number(report?.systemEvents?.eventCount || 0);
  const behindExecution =
    reportLedgerCount <= executionLedgerCount &&
    reportEventCount <= executionEventCount &&
    (reportLedgerCount < executionLedgerCount || reportEventCount < executionEventCount);
  const nodeStatus = String(report?.status || '').toLowerCase();

  if (
    reportAgeMs <= CONSENSUS_UPDATE_GRACE_MS &&
    (nodeStatus === 'syncing' || nodeStatus === 'starting' || behindExecution)
  ) {
    return 'updating';
  }

  return 'disagree';
}

function buildExecutionLayerAgreement(canonical) {
  const ledgerValid = Boolean(canonical?.ledger?.valid);
  const systemEventsValid = Boolean(canonical?.systemEvents?.valid);
  const status = ledgerValid && systemEventsValid ? 'agree' : 'disagree';

  return {
    status,
    color: status === 'agree' ? 'green' : 'red',
    rails: {
      transactions: {
        valid: ledgerValid,
        latestHash: canonical?.ledger?.latestHash || null,
        count: Number(canonical?.ledger?.transactionCount || 0),
      },
      systemEvents: {
        valid: systemEventsValid,
        latestHash: canonical?.systemEvents?.latestHash || null,
        count: Number(canonical?.systemEvents?.eventCount || 0),
      },
    },
    projection: canonical?.projection || null,
    combinedHeadKey: deriveCombinedHeadKey(canonical),
  };
}

function pruneNodeObservations(observations) {
  const cutoff = Date.now() - NODE_HISTORY_WINDOW_MS;
  return (Array.isArray(observations) ? observations : []).filter((entry) => {
    const observedAt = Date.parse(entry?.observedAt || 0);
    return Number.isFinite(observedAt) && observedAt >= cutoff;
  });
}

function loadNodeNetworkCache() {
  if (!fs.existsSync(NODE_NETWORK_CACHE_PATH)) {
    return { updatedAt: null, nodes: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(NODE_NETWORK_CACHE_PATH, 'utf8'));
    return {
      updatedAt: parsed?.updatedAt || null,
      nodes: Object.fromEntries(
        Object.entries(parsed?.nodes || {}).map(([nodeUrl, node]) => [
          nodeUrl,
          {
            ...node,
            observations: pruneNodeObservations(node?.observations || []),
          },
        ])
      ),
    };
  } catch (error) {
    console.error('Failed to load node network cache:', error);
    return { updatedAt: null, nodes: {} };
  }
}

function loadNodeRegistry() {
  if (!fs.existsSync(NODE_REGISTRY_PATH)) {
    return { updatedAt: null, nodes: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(NODE_REGISTRY_PATH, 'utf8'));
    return {
      updatedAt: parsed?.updatedAt || null,
      nodes: parsed?.nodes || {},
    };
  } catch (error) {
    console.error('Failed to load node registry:', error);
    try {
      const corruptPath = `${NODE_REGISTRY_PATH}.corrupt-${Date.now()}`;
      fs.renameSync(NODE_REGISTRY_PATH, corruptPath);
      console.warn(`Moved invalid node registry to ${corruptPath}`);
    } catch (renameError) {
      console.error('Failed to quarantine invalid node registry:', renameError);
    }
    return { updatedAt: null, nodes: {} };
  }
}

function saveNodeRegistry(state) {
  fs.mkdirSync(path.dirname(NODE_REGISTRY_PATH), { recursive: true });
  const tempPath = `${NODE_REGISTRY_PATH}.tmp`;
  fs.writeFileSync(
    tempPath,
    JSON.stringify(
      {
        updatedAt: state?.updatedAt || new Date().toISOString(),
        nodes: state?.nodes || {},
      },
      null,
      2
    ),
    'utf8'
  );
  fs.renameSync(tempPath, NODE_REGISTRY_PATH);
}

function pruneNodeRegistry(state) {
  const now = Date.now();
  const nodes = Object.fromEntries(
    Object.entries(state?.nodes || {}).filter(([, node]) => {
      const lastSeenAt = Date.parse(node?.lastSeenAt || node?.updatedAt || node?.registeredAt || 0);
      return Number.isFinite(lastSeenAt) && (now - lastSeenAt) <= NODE_REGISTRY_TTL_MS;
    })
  );

  return {
    updatedAt: state?.updatedAt || null,
    nodes,
  };
}

function buildNodeRegistrySummary() {
  const pruned = pruneNodeRegistry(loadNodeRegistry());
  saveNodeRegistry({
    updatedAt: new Date().toISOString(),
    nodes: pruned.nodes,
  });

  const nodes = Object.entries(pruned.nodes || {}).map(([key, node]) => ({
    registryKey: key,
    nodeId: node?.nodeId || null,
    nodeName: node?.nodeName || node?.nodeId || key,
    nodeUrl: node?.nodeUrl || null,
    statusUrl: node?.statusUrl || null,
    role: node?.role || 'verifier',
    mode: node?.mode || 'parallel-consensus',
    status: node?.status || 'unknown',
    lastSeenAt: node?.lastSeenAt || null,
    firstSeenAt: node?.firstSeenAt || null,
    heartbeatCount: Number(node?.heartbeatCount || 0),
    softwareVersion: node?.softwareVersion || null,
    ledger: node?.ledger || null,
    systemEvents: node?.systemEvents || null,
    projection: node?.projection || null,
    consensus: node?.consensus || null,
  }));

  const seedNodes = Array.from(new Set(
    NODE_NETWORK_NODE_URLS
      .map((entry) => normalizeNodeStatusUrl(entry))
      .filter(Boolean)
  ));

  return {
    generatedAt: new Date().toISOString(),
    ttlMs: NODE_REGISTRY_TTL_MS,
    summary: {
      activeNodes: nodes.length,
      seedNodes: seedNodes.length,
    },
    seedStatusUrls: seedNodes,
    nodes,
  };
}

function getDiscoveryStatusUrls() {
  const registry = buildNodeRegistrySummary();
  const discovered = [
    ...NODE_NETWORK_NODE_URLS.map((entry) => normalizeNodeStatusUrl(entry)).filter(Boolean),
    ...registry.nodes.map((node) => normalizeNodeStatusUrl(node.statusUrl || node.nodeUrl || '')).filter(Boolean),
  ];
  return Array.from(new Set(discovered));
}

function saveNodeNetworkCache(cache) {
  fs.mkdirSync(path.dirname(NODE_NETWORK_CACHE_PATH), { recursive: true });
  fs.writeFileSync(
    NODE_NETWORK_CACHE_PATH,
    JSON.stringify(
      {
        updatedAt: cache?.updatedAt || new Date().toISOString(),
        nodes: Object.fromEntries(
          Object.entries(cache?.nodes || {}).map(([nodeUrl, node]) => [
            nodeUrl,
            {
              ...node,
              observations: pruneNodeObservations(node?.observations || []),
            },
          ])
        ),
      },
      null,
      2
    ),
    'utf8'
  );
}

function loadConsensusReports() {
  if (!fs.existsSync(CONSENSUS_REPORTS_PATH)) {
    return { updatedAt: null, reports: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CONSENSUS_REPORTS_PATH, 'utf8'));
    return {
      updatedAt: parsed?.updatedAt || null,
      reports: parsed?.reports || {},
    };
  } catch (error) {
    console.error('Failed to load consensus reports:', error);
    return { updatedAt: null, reports: {} };
  }
}

function saveConsensusReports(state) {
  fs.mkdirSync(path.dirname(CONSENSUS_REPORTS_PATH), { recursive: true });
  fs.writeFileSync(
    CONSENSUS_REPORTS_PATH,
    JSON.stringify(
      {
        updatedAt: state?.updatedAt || new Date().toISOString(),
        reports: state?.reports || {},
      },
      null,
      2
    ),
    'utf8'
  );
}

function pruneConsensusReports(state) {
  const now = Date.now();
  const reports = Object.fromEntries(
    Object.entries(state?.reports || {}).filter(([, report]) => {
      const reportedAt = Date.parse(report?.reportedAt || report?.updatedAt || 0);
      return Number.isFinite(reportedAt) && (now - reportedAt) <= CONSENSUS_REPORT_TTL_MS;
    })
  );

  return {
    updatedAt: state?.updatedAt || null,
    reports,
  };
}

const nodeNetworkState = {
  cache: loadNodeNetworkCache(),
  refreshPromise: null,
  lastRefreshAt: 0,
};

const canonicalExportState = {
  refreshPromise: null,
  lastRefreshAt: 0,
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshCanonicalExportFiles({ force = false } = {}) {
  const now = Date.now();
  if (!force && canonicalExportState.refreshPromise) {
    return canonicalExportState.refreshPromise;
  }
  if (!force && now - canonicalExportState.lastRefreshAt < CANONICAL_EXPORT_REFRESH_MS) {
    return null;
  }

  canonicalExportState.refreshPromise = (async () => {
    await Promise.all([
      dbHelpers.exportLedger({ outputPath: CANONICAL_LEDGER_EXPORT_PATH }),
      dbHelpers.exportSystemEvents({ outputPath: CANONICAL_SYSTEM_EVENTS_EXPORT_PATH }),
      dbHelpers.exportCombinedActivity({ outputPath: CANONICAL_ACTIVITY_EXPORT_PATH }),
    ]);
    canonicalExportState.lastRefreshAt = Date.now();
  })();

  try {
    return await canonicalExportState.refreshPromise;
  } finally {
    canonicalExportState.refreshPromise = null;
  }
}

async function getNodeNetworkSnapshot({ canonical = null, force = false, maxWaitMs = 1500 } = {}) {
  const resolvedCanonical = canonical || await getCanonicalNetworkHead();

  try {
    if (force) {
      return await refreshNodeNetworkCache({ force: true });
    }

    return await Promise.race([
      refreshNodeNetworkCache({ force }),
      wait(maxWaitMs).then(() => summarizeNodeNetwork(nodeNetworkState.cache, resolvedCanonical)),
    ]);
  } catch (error) {
    console.error('Failed to build node network snapshot:', error);
    return summarizeNodeNetwork(nodeNetworkState.cache, resolvedCanonical);
  }
}

async function getCanonicalNetworkHead() {
  const [ledgerHead, eventsHead] = await Promise.all([
    dbGet(`SELECT id, timestamp, hash FROM transactions ORDER BY id DESC LIMIT 1`),
    dbGet(`SELECT id, timestamp, hash FROM system_events ORDER BY id DESC LIMIT 1`),
  ]);
  const ledgerIntegrity = await dbHelpers.verifyLedgerIntegrity();
  const eventIntegrity = await dbHelpers.verifySystemEventIntegrity();
  const projection = await dbHelpers.getReplayedProjectionFingerprint();

  const canonical = {
    nodeId: NODE_NETWORK_CANONICAL_ID,
    nodeName: NODE_NETWORK_CANONICAL_NAME,
    role: 'canonical',
    status: ledgerIntegrity.valid && eventIntegrity.valid ? 'healthy' : 'attention',
    observedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    online: true,
    inSync: true,
    lastSeenAt: new Date().toISOString(),
    ledger: {
      transactionCount: Number(ledgerIntegrity.transactionCount || 0),
      latestHash: ledgerIntegrity.latestHash || ledgerHead?.hash || null,
      valid: Boolean(ledgerIntegrity.valid),
      latestTransactionId: Number(ledgerHead?.id || 0),
      latestTimestamp: Number(ledgerHead?.timestamp || 0),
    },
    systemEvents: {
      eventCount: Number(eventIntegrity.eventCount || 0),
      latestHash: eventIntegrity.latestHash || eventsHead?.hash || null,
      valid: Boolean(eventIntegrity.valid),
      latestEventId: Number(eventsHead?.id || 0),
      latestTimestamp: Number(eventsHead?.timestamp || 0),
    },
    projection,
  };

  canonical.executionLayerAgreement = buildExecutionLayerAgreement(canonical);
  return canonical;
}

async function getConsensusBridgeSummary(canonical = null) {
  const execution = canonical || await getCanonicalNetworkHead();
  const executionHeadKey = deriveCombinedHeadKey(execution);
  const prunedState = pruneConsensusReports(loadConsensusReports());
  saveConsensusReports({
    updatedAt: new Date().toISOString(),
    reports: prunedState.reports,
  });

  const reports = Object.values(prunedState.reports || {});
  const operatorIdentities = await Promise.all(
    reports.map((report) => resolveNodeOperator(report?.operatorDiscordId || report?.operator?.discordId || null))
  );

  const nodes = reports.map((report, index) => {
    const reportedAt = report?.reportedAt || report?.updatedAt || null;
    const reportTimestamp = Date.parse(reportedAt || 0);
    const fresh = Number.isFinite(reportTimestamp)
      ? (Date.now() - reportTimestamp) <= CONSENSUS_UPDATE_GRACE_MS
      : false;
    const executionAgreement = classifyExecutionAgreement(execution, report);
    const operator = operatorIdentities[index] || null;

    return {
      nodeId: report?.nodeId || null,
      nodeName: report?.nodeName || report?.nodeId || 'Unnamed consensus node',
      nodeUrl: report?.nodeUrl || null,
      statusUrl: report?.statusUrl || null,
      reportedAt,
      role: report?.role || 'consensus',
      status: report?.status || 'unknown',
      lastError: report?.lastError || null,
      conflicts: report?.conflicts || [],
      consensus: report?.consensus || null,
      ledger: report?.ledger || null,
      systemEvents: report?.systemEvents || null,
      projection: report?.projection || null,
      operator,
      fresh,
      executionAgreement,
    };
  });

  const freshNodes = nodes.filter((node) => node.fresh);
  const agreeCount = freshNodes.filter((node) => node.executionAgreement === 'agree').length;
  const updatingCount = freshNodes.filter((node) => node.executionAgreement === 'updating').length;
  const disagreeCount = freshNodes.filter((node) => node.executionAgreement === 'disagree').length;
  const unknownCount = freshNodes.filter((node) => node.executionAgreement === 'unknown').length;
  const agreeVotingPower = freshNodes
    .filter((node) => node.executionAgreement === 'agree')
    .reduce((sum, node) => sum + Number(node?.operator?.votingPower || 0), 0);
  const updatingVotingPower = freshNodes
    .filter((node) => node.executionAgreement === 'updating')
    .reduce((sum, node) => sum + Number(node?.operator?.votingPower || 0), 0);
  const disagreeVotingPower = freshNodes
    .filter((node) => node.executionAgreement === 'disagree')
    .reduce((sum, node) => sum + Number(node?.operator?.votingPower || 0), 0);
  const unknownVotingPower = freshNodes
    .filter((node) => node.executionAgreement === 'unknown')
    .reduce((sum, node) => sum + Number(node?.operator?.votingPower || 0), 0);
  const totalVotingPower = agreeVotingPower + updatingVotingPower + disagreeVotingPower + unknownVotingPower;
  const weightedAgreement = totalVotingPower > 0
    ? Number(((agreeVotingPower / totalVotingPower) * 100).toFixed(1))
    : null;
  const disagreeingOperators = nodes
    .filter((node) => node.executionAgreement === 'disagree' && node?.operator?.displayName)
    .map((node) => ({
      name: node.operator.displayName,
      votingPower: Number(node.operator.votingPower || 0),
      nodeName: node.nodeName,
    }))
    .sort((left, right) => right.votingPower - left.votingPower || left.name.localeCompare(right.name))
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    executionHeadKey,
    summary: {
      reportingNodes: nodes.length,
      freshReportingNodes: freshNodes.length,
      agreeCount,
      updatingCount,
      disagreeCount,
      unknownCount,
      agreeVotingPower,
      updatingVotingPower,
      disagreeVotingPower,
      unknownVotingPower,
      totalVotingPower,
      weightedAgreement,
      disagreeingOperators,
      status: freshNodes.length === 0
        ? 'unknown'
        : (disagreeCount > 0 ? 'disagree' : (agreeCount > 0 ? 'agree' : (updatingCount > 0 ? 'updating' : 'unknown'))),
    },
    nodes,
  };
}

async function fetchRemoteNodeStatus(nodeUrl) {
  const normalizedUrl = normalizeNodeStatusUrl(nodeUrl);
  const observedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NODE_STATUS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: VOLT_NODE_AUTH_KEY
        ? { 'x-volt-node-key': VOLT_NODE_AUTH_KEY }
        : undefined,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    return {
      nodeUrl: normalizedUrl,
      observedAt,
      online: true,
      payload,
    };
  } catch (error) {
    return {
      nodeUrl: normalizedUrl,
      observedAt,
      online: false,
      error: error?.name === 'AbortError'
        ? `Timed out after ${NODE_STATUS_FETCH_TIMEOUT_MS}ms`
        : (error.message || String(error)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeNodeNetwork(cache, canonical) {
  const nodeEntries = Object.values(cache?.nodes || {});
  const registrySummary = buildNodeRegistrySummary();
  const now = Date.now();
  const nodes = nodeEntries.map((node) => {
    const observations = pruneNodeObservations(node?.observations || []);
    const latestObservation = observations[observations.length - 1] || null;
    const onlineSamples48h = observations.filter((entry) => entry.online).length;
    const inSyncSamples48h = observations.filter((entry) => entry.inSync).length;
    const lastSeenAt = node.lastSeenAt || latestObservation?.lastSeenAt || null;
    const seenWithin48h = lastSeenAt ? now - Date.parse(lastSeenAt) <= NODE_HISTORY_WINDOW_MS : false;
    return {
      nodeUrl: node.nodeUrl,
      nodeId: node.nodeId || null,
      nodeName: node.nodeName || node.nodeId || node.nodeUrl,
      status: node.status || (node.online ? 'healthy' : 'offline'),
      online: Boolean(node.online),
      inSync: Boolean(node.inSync),
      lastSeenAt,
      observedAt: node.observedAt || null,
      lastError: node.lastError || null,
      conflicts: node.conflicts || [],
      ledger: node.ledger || null,
      systemEvents: node.systemEvents || null,
      history48h: {
        samples: observations.length,
        onlineSamples: onlineSamples48h,
        inSyncSamples: inSyncSamples48h,
        seenWithin48h,
      },
    };
  });

  for (const registryNode of registrySummary.nodes || []) {
    const key = registryNode.nodeId || registryNode.statusUrl || registryNode.nodeUrl || registryNode.registryKey;
    const existing = nodes.find((node) =>
      (node.nodeId && node.nodeId === registryNode.nodeId) ||
      (node.statusUrl && registryNode.statusUrl && node.statusUrl === registryNode.statusUrl) ||
      (node.nodeUrl && registryNode.nodeUrl && node.nodeUrl === registryNode.nodeUrl)
    );
    if (existing) {
      if (!existing.lastSeenAt && registryNode.lastSeenAt) existing.lastSeenAt = registryNode.lastSeenAt;
      continue;
    }

    const lastSeenAt = registryNode.lastSeenAt || registryNode.updatedAt || null;
    const seenWithin48h = lastSeenAt ? now - Date.parse(lastSeenAt) <= NODE_HISTORY_WINDOW_MS : false;
    const executionAgreement =
      registryNode.consensus?.healthy === true ? 'agree'
        : (registryNode.consensus ? 'unknown' : 'unknown');

    nodes.push({
      nodeUrl: registryNode.nodeUrl,
      statusUrl: registryNode.statusUrl,
      nodeId: registryNode.nodeId || null,
      nodeName: registryNode.nodeName || registryNode.nodeId || registryNode.nodeUrl || 'Unnamed node',
      status: registryNode.status || 'unknown',
      online: false,
      inSync: false,
      executionAgreement,
      lastSeenAt,
      observedAt: registryNode.lastSeenAt || null,
      lastError: null,
      conflicts: [],
      ledger: registryNode.ledger || null,
      systemEvents: registryNode.systemEvents || null,
      history48h: {
        samples: 0,
        onlineSamples: 0,
        inSyncSamples: 0,
        seenWithin48h,
      },
      discoverySource: 'registry',
      heartbeatCount: Number(registryNode.heartbeatCount || 0),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    pollIntervalMs: NODE_NETWORK_POLL_MS,
    canonical,
    nodeRegistry: registrySummary,
    summary: {
      configuredNodes: nodes.length,
      onlineNow: nodes.filter((node) => node.online).length,
      offlineNow: nodes.filter((node) => !node.online).length,
      inSyncNow: nodes.filter((node) => node.online && node.inSync).length,
      disagreeingNow: nodes.filter((node) => node.online && !node.inSync).length,
      seenLast48Hours: nodes.filter((node) => node.history48h.seenWithin48h).length,
      reportingLast48Hours: nodes.filter((node) => node.history48h.samples > 0).length,
    },
    nodes,
  };
}

async function refreshNodeNetworkCache({ force = false } = {}) {
  const now = Date.now();
  if (!force && nodeNetworkState.refreshPromise) {
    return nodeNetworkState.refreshPromise;
  }
  if (!force && now - nodeNetworkState.lastRefreshAt < 5000) {
    return summarizeNodeNetwork(nodeNetworkState.cache, await getCanonicalNetworkHead());
  }

  nodeNetworkState.refreshPromise = (async () => {
    const canonical = await getCanonicalNetworkHead();
    const cache = loadNodeNetworkCache();
    const peerUrls = getDiscoveryStatusUrls();
    const peerResults = await Promise.all(peerUrls.map((nodeUrl) => fetchRemoteNodeStatus(nodeUrl)));

    for (const result of peerResults) {
      const previousNode = cache.nodes[result.nodeUrl] || { nodeUrl: result.nodeUrl, observations: [] };
      const previousObservations = pruneNodeObservations(previousNode.observations || []);

      if (!result.online) {
        cache.nodes[result.nodeUrl] = {
          ...previousNode,
          nodeUrl: result.nodeUrl,
          online: false,
          inSync: false,
          status: 'offline',
          observedAt: result.observedAt,
          lastError: result.error,
          observations: pruneNodeObservations([
            ...previousObservations,
            {
              observedAt: result.observedAt,
              online: false,
              inSync: false,
              error: result.error,
            },
          ]),
        };
        continue;
      }

      const payload = result.payload || {};
      const ledgerMatch = canonical.ledger.latestHash && payload?.ledger?.latestHash
        ? canonical.ledger.latestHash === payload.ledger.latestHash
        : false;
      const eventsMatch = canonical.systemEvents.latestHash && payload?.systemEvents?.latestHash
        ? canonical.systemEvents.latestHash === payload.systemEvents.latestHash
        : false;
      const inSync = Boolean(payload?.ledger?.valid && payload?.systemEvents?.valid && ledgerMatch && eventsMatch);

      cache.nodes[result.nodeUrl] = {
        ...previousNode,
        nodeUrl: result.nodeUrl,
        nodeId: payload?.nodeId || previousNode.nodeId || null,
        nodeName: payload?.nodeName || previousNode.nodeName || payload?.nodeId || result.nodeUrl,
        online: true,
        inSync,
        status: payload?.status || 'healthy',
        observedAt: result.observedAt,
        lastSeenAt: payload?.updatedAt || result.observedAt,
        lastError: null,
        conflicts: payload?.conflicts || [],
        ledger: payload?.ledger || null,
        systemEvents: payload?.systemEvents || null,
        observations: pruneNodeObservations([
          ...previousObservations,
          {
            observedAt: result.observedAt,
            online: true,
            inSync,
            lastSeenAt: payload?.updatedAt || result.observedAt,
            ledgerHash: payload?.ledger?.latestHash || null,
            eventHash: payload?.systemEvents?.latestHash || null,
          },
        ]),
      };
    }

    cache.updatedAt = new Date().toISOString();
    nodeNetworkState.cache = cache;
    nodeNetworkState.lastRefreshAt = Date.now();
    saveNodeNetworkCache(cache);

    return summarizeNodeNetwork(cache, canonical);
  })();

  try {
    return await nodeNetworkState.refreshPromise;
  } finally {
    nodeNetworkState.refreshPromise = null;
  }
}

async function ensureEconomyProfileForDiscordUser(discordId) {
  const normalizedDiscordId = String(discordId || '').trim();
  if (!normalizedDiscordId) return null;

  const existingUser = await dbGet(
    `SELECT userID, username FROM economy WHERE userID = ?`,
    [normalizedDiscordId]
  );
  if (existingUser) return existingUser;

  const holder = findHolderByDiscordId(normalizedDiscordId);
  if (!holder) return null;

  await dbHelpers.initUserEconomy(normalizedDiscordId);

  return dbGet(
    `SELECT userID, username FROM economy WHERE userID = ?`,
    [normalizedDiscordId]
  );
}

async function isAdmin(userId) {
  if (!userId) return false;
  const row = await dbGet(`SELECT 1 FROM admins WHERE userID = ?`, [userId]);
  return !!row;
}

async function requireAdmin(req, res, next) {
  try {
    const admin = await isAdmin(req.user?.userId);
    if (!admin) {
      return res.status(403).json({ message: "Admin access required." });
    }
    return next();
  } catch (err) {
    console.error("❌ Admin check failed:", err);
    return res.status(500).json({ message: "Failed to verify admin." });
  }
}

async function logAdminChange(adminId, title, lines = []) {
  try {
    const channelId = WEB_ADMIN_EDITS_CHANNEL_ID;
    if (!channelId) return;
    if (channelId === ITEM_REDEMPTION_CHANNEL_ID) {
      console.warn('Skipping admin change log because WEB_ADMIN_EDITS_CHANNEL_ID matches ITEM_REDEMPTION_CHANNEL_ID.');
      return;
    }
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    const adminTag = await resolveUsername(adminId);
    const details = lines.length ? lines.join('\n') : 'No additional details.';
    const embed = new EmbedBuilder()
      .setTitle('🛠️ Admin Change')
      .setColor(SUBMISSION_EMBED_COLORS.adminChange)
      .setDescription(`**${title}**`)
      .addFields(
        { name: 'Admin', value: adminTag, inline: true },
        { name: 'Details', value: details, inline: false }
      )
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Failed to log admin change:', err);
  }
}

/**
 * POST /api/login
 * Handles user login, verifies credentials, and returns a JWT.
 */
app.post("/api/login", async (req, res) => {
  let { username, password } = req.body;

  // Ensure username is lowercase for case-insensitive matching
  username = username.trim().toLowerCase();

  // Check for missing credentials
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }

  try {
    // Query user from economy table with case-insensitive match
    const user = await dbGet(`SELECT userID, username, password FROM economy WHERE LOWER(username) = ? AND password IS NOT NULL`, [username]);

    // If user is not found, send an error
    if (!user) {
      console.warn(`⚠️ Login failed: Username '${username}' not found.`);
      return res.status(401).json({ message: "Invalid username or password." });
    }

    // Compare the provided password with the stored hashed password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn(`⚠️ Login failed: Incorrect password for '${username}'.`);
      return res.status(401).json({ message: "Invalid username or password." });
    }

    // Generate a JWT token for the authenticated user
    const token = jwt.sign(
      { userId: user.userID, username: user.username },
      SECRET_KEY,
      { expiresIn: "1y" }
    );

    console.log(`✅ Login successful for ${user.username}`);
    return res.json({
      message: "Login successful!",
      token,
      username: user.username,
      userId: user.userID 
    });
    
  } catch (error) {
    console.error("❌ Error during login:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

app.get("/auth/discord", (req, res) => {
  if (!DISCORD_CLIENT_ID) {
    return res.status(500).send("Discord client ID is not configured.");
  }

  const redirectUri = getDiscordRedirectUri();
  console.log("🔁 Discord OAuth redirect URI:", redirectUri);
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    prompt: "consent",
  });

  return res.redirect(`${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Missing Discord authorization code.");
  }

  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res
      .status(500)
      .send("Discord OAuth credentials are not configured.");
  }

  try {
    const redirectUri = getDiscordRedirectUri();

    const tokenResponse = await fetch(DISCORD_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error("❌ Discord token exchange failed:", errorBody);
      return res.status(500).send("Discord token exchange failed.");
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userResponse.ok) {
      const errorBody = await userResponse.text();
      console.error("❌ Failed to fetch Discord user:", errorBody);
      return res.status(500).send("Failed to fetch Discord user.");
    }

    const discordUser = await userResponse.json();
    const userId = discordUser.id;

    const hasAllowedRole = await userHasAllowedRoleById(userId);
    if (!hasAllowedRole) {
      console.warn(`🚫 Discord login blocked for ${userId}: missing allowed role.`);
      return res.status(403).send("NO SOLARIAN FOUND IN WALLET");
    }

    const user = await ensureEconomyProfileForDiscordUser(userId);

    if (!user) {
      return res
        .status(401)
        .send("Discord account is not linked to an economy profile or Robo-Check holder entry.");
    }

    const token = jwt.sign(
      { userId: user.userID, username: user.username || discordUser.username },
      SECRET_KEY,
      { expiresIn: "1y" }
    );

    const payload = {
      token,
      userId: user.userID,
      username: user.username || discordUser.username,
    };

    return res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Discord Login</title>
  </head>
  <body>
    <p>Signing you in with Discord...</p>
    <script>
      const payload = ${JSON.stringify(payload)};
      localStorage.setItem("token", payload.token);
      localStorage.setItem("discordUserID", payload.userId);
      localStorage.setItem("username", payload.username);
      window.location.replace("/");
    </script>
  </body>
</html>`);
  } catch (error) {
    console.error("❌ Discord OAuth error:", error);
    return res.status(500).send("Discord login failed.");
  }
});

/**
 * GET /api/volt-balance
 * Fetch the user's Volt balance from the economy table.
 */
app.get('/api/volt-balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId; // Get user ID from JWT
    const { balance } = await dbHelpers.getBalances(userId);

    res.json({ balance, wallet: balance, bank: 0, totalBalance: balance });
  } catch (error) {
    console.error("❌ Error fetching Volt balance:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

app.get('/api/node-key', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.user?.userId || '').trim();
    const operator = await assertNodeKeyEligible(userId);
    const activeKey = await getActiveNodeOperatorKeyForDiscordId(userId);
    return res.json({
      eligible: true,
      operator: {
        displayName: operator.displayName,
        votingPower: operator.votingPower,
        verifiedHolder: operator.verifiedHolder,
      },
      key: activeKey ? {
        createdAt: activeKey.created_at || null,
        lastUsedAt: activeKey.last_used_at || null,
        keyLabel: activeKey.key_label || null,
      } : null,
    });
  } catch (error) {
    return res.status(403).json({ error: error.message || 'Failed to load node key status.' });
  }
});

app.post('/api/node-key', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.user?.userId || '').trim();
    const operator = await assertNodeKeyEligible(userId);
    const issued = await issueNodeOperatorKey(userId, req.body?.label || null);
    return res.json({
      ok: true,
      key: issued.key,
      createdAt: issued.createdAt,
      operator: {
        displayName: operator.displayName,
        votingPower: operator.votingPower,
        verifiedHolder: operator.verifiedHolder,
      },
      message: 'Node key generated. Save it in your node environment now; it will only be shown once.',
    });
  } catch (error) {
    const message = error.message || 'Failed to generate node key.';
    return res.status(message.includes('only available') ? 403 : 500).json({ error: message });
  }
});

app.get('/node/status', authenticateNodeKey, async (req, res) => {
  try {
    const canonical = await getCanonicalNetworkHead();
    const network = await getNodeNetworkSnapshot({ canonical });
    const consensusBridge = await getConsensusBridgeSummary(canonical);
    const nodeRegistry = buildNodeRegistrySummary();
    const activity = await dbHelpers.getCombinedActivity({ limit: 20, offset: 0, order: 'desc' });
    return res.json({
      ...canonical,
      execution: canonical,
      activity: activity.summary,
      publicUrl: process.env.VOLT_PUBLIC_URL || null,
      statusUrl: process.env.VOLT_PUBLIC_URL ? `${String(process.env.VOLT_PUBLIC_URL).replace(/\/+$/, '')}/node/status` : null,
      peerNetwork: network.summary,
      nodeRegistry: nodeRegistry.summary,
      consensusBridge,
    });
  } catch (error) {
    console.error('Failed to build node status:', error);
    return res.status(500).json({ error: 'Failed to build node status.' });
  }
});

app.post('/api/consensus/report', authenticateNodeKey, async (req, res) => {
  try {
    const payload = {
      ...(req.body || {}),
      operatorDiscordId: req.nodeAuth?.discordId || null,
    };
    const nodeId = String(payload.nodeId || '').trim();
    const statusUrl = normalizeNodeStatusUrl(payload.statusUrl || payload.nodeUrl || '');
    if (!nodeId && !statusUrl) {
      return res.status(400).json({ error: 'Consensus report requires nodeId or statusUrl.' });
    }

    const key = nodeId || statusUrl;
    const state = pruneConsensusReports(loadConsensusReports());
    state.reports[key] = {
      nodeId: nodeId || null,
      nodeName: String(payload.nodeName || nodeId || statusUrl || 'Consensus Node').trim(),
      nodeUrl: String(payload.nodeUrl || '').trim() || null,
      statusUrl,
      operatorDiscordId: String(payload.operatorDiscordId || payload.operator?.discordId || '').trim() || null,
      role: 'consensus',
      reportedAt: new Date().toISOString(),
      updatedAt: payload.updatedAt || new Date().toISOString(),
      status: payload.status || 'healthy',
      lastError: payload.lastError || null,
      conflicts: Array.isArray(payload.conflicts) ? payload.conflicts.slice(-20) : [],
      consensus: payload.consensus || null,
      ledger: payload.ledger || null,
      systemEvents: payload.systemEvents || null,
      projection: payload.projection || null,
    };
    state.updatedAt = new Date().toISOString();
    saveConsensusReports(state);

    const operator = await resolveNodeOperator(state.reports[key].operatorDiscordId);

    return res.json({
      ok: true,
      storedAs: key,
      reportedAt: state.reports[key].reportedAt,
      operator: operator ? {
        displayName: operator.displayName,
        votingPower: operator.votingPower,
        verifiedHolder: operator.verifiedHolder,
      } : null,
    });
  } catch (error) {
    console.error('Failed to store consensus report:', error);
    return res.status(500).json({ error: 'Failed to store consensus report.' });
  }
});

async function upsertNodeRegistryEntry(payload, source = 'heartbeat') {
  const nodeId = String(payload.nodeId || '').trim() || null;
  const statusUrl = normalizeNodeStatusUrl(payload.statusUrl || payload.nodeUrl || '');
  const nodeUrl = normalizeNodeBaseUrl(payload.nodeUrl || '');
  const key = nodeId || statusUrl || nodeUrl;
  if (!key) {
    throw new Error('Node registration requires nodeId, nodeUrl, or statusUrl.');
  }

  const registry = pruneNodeRegistry(loadNodeRegistry());
  const existing = registry.nodes[key] || {};
  const now = new Date().toISOString();

  registry.nodes[key] = {
    ...existing,
    nodeId,
    nodeName: String(payload.nodeName || existing.nodeName || nodeId || statusUrl || nodeUrl || 'Volt Node').trim(),
    operatorDiscordId: String(payload.operatorDiscordId || existing.operatorDiscordId || '').trim() || null,
    nodeUrl: nodeUrl || existing.nodeUrl || null,
    statusUrl: statusUrl || existing.statusUrl || null,
    role: String(payload.role || existing.role || 'verifier').trim(),
    mode: String(payload.mode || existing.mode || 'parallel-consensus').trim(),
    softwareVersion: String(payload.softwareVersion || existing.softwareVersion || '').trim() || null,
    status: String(payload.status || existing.status || 'healthy').trim(),
    ledger: payload.ledger || existing.ledger || null,
    systemEvents: payload.systemEvents || existing.systemEvents || null,
    projection: payload.projection || existing.projection || null,
    consensus: payload.consensus || existing.consensus || null,
    firstSeenAt: existing.firstSeenAt || now,
    registeredAt: source === 'register' ? now : (existing.registeredAt || null),
    lastRegisterAt: source === 'register' ? now : (existing.lastRegisterAt || null),
    lastHeartbeatAt: source === 'heartbeat' ? now : (existing.lastHeartbeatAt || null),
    lastSeenAt: now,
    updatedAt: now,
    heartbeatCount: Number(existing.heartbeatCount || 0) + (source === 'heartbeat' ? 1 : 0),
  };

  registry.updatedAt = now;
  saveNodeRegistry(registry);
  return { key, entry: registry.nodes[key], operator: await resolveNodeOperator(registry.nodes[key].operatorDiscordId) };
}

app.post('/api/nodes/register', authenticateNodeKey, async (req, res) => {
  try {
    const result = await upsertNodeRegistryEntry({
      ...(req.body || {}),
      operatorDiscordId: req.nodeAuth?.discordId || null,
    }, 'register');
    return res.json({
      ok: true,
      registryKey: result.key,
      node: result.entry,
      operator: result.operator ? {
        displayName: result.operator.displayName,
        votingPower: result.operator.votingPower,
        verifiedHolder: result.operator.verifiedHolder,
      } : null,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || String(error) });
  }
});

app.post('/api/nodes/heartbeat', authenticateNodeKey, async (req, res) => {
  try {
    const result = await upsertNodeRegistryEntry({
      ...(req.body || {}),
      operatorDiscordId: req.nodeAuth?.discordId || null,
    }, 'heartbeat');
    return res.json({
      ok: true,
      registryKey: result.key,
      node: result.entry,
      operator: result.operator ? {
        displayName: result.operator.displayName,
        votingPower: result.operator.votingPower,
        verifiedHolder: result.operator.verifiedHolder,
      } : null,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || String(error) });
  }
});

app.get('/api/nodes', authenticateNodeKey, async (req, res) => {
  try {
    const registry = buildNodeRegistrySummary();
    return res.json(registry);
  } catch (error) {
    console.error('Failed to load node registry:', error);
    return res.status(500).json({ error: 'Failed to load node registry.' });
  }
});

app.get('/api/consensus/reports', authenticateNodeKey, async (req, res) => {
  try {
    const canonical = await getCanonicalNetworkHead();
    const consensusBridge = await getConsensusBridgeSummary(canonical);
    const nodeRegistry = buildNodeRegistrySummary();
    return res.json({
      ...consensusBridge,
      nodeRegistry,
    });
  } catch (error) {
    console.error('Failed to load consensus reports:', error);
    return res.status(500).json({ error: 'Failed to load consensus reports.' });
  }
});

app.get('/api/voltscan', authenticateToken, async (req, res) => {
  try {
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const rawOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(rawLimit, 100)) : 25;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
    const type = String(req.query.type || '').trim();
    const userId = String(req.query.userId || '').trim();
    const query = String(req.query.q || '').trim().toLowerCase();
    const includeIntegrity = req.query.integrity !== '0';

    const where = [];
    const params = [];

    if (type) {
      where.push(`LOWER(t.type) = LOWER(?)`);
      params.push(type);
    }

    if (userId) {
      where.push(`(t.from_user_id = ? OR t.to_user_id = ?)`);
      params.push(userId, userId);
    }

    if (query) {
      if (/^\d+$/.test(query)) {
        where.push(`(
          t.id = ?
          OR t.from_user_id LIKE ?
          OR t.to_user_id LIKE ?
          OR LOWER(t.type) LIKE ?
          OR LOWER(t.metadata) LIKE ?
        )`);
        params.push(Number(query), `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
      } else {
        where.push(`(
          LOWER(t.type) LIKE ?
          OR LOWER(COALESCE(t.from_user_id, '')) LIKE ?
          OR LOWER(COALESCE(t.to_user_id, '')) LIKE ?
          OR LOWER(t.metadata) LIKE ?
          OR LOWER(COALESCE(fu.username, '')) LIKE ?
          OR LOWER(COALESCE(tu.username, '')) LIKE ?
        )`);
        params.push(
          `%${query}%`,
          `%${query}%`,
          `%${query}%`,
          `%${query}%`,
          `%${query}%`,
          `%${query}%`
        );
      }
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await dbAll(
      `SELECT
         t.*,
         fu.username AS from_username,
         tu.username AS to_username
       FROM transactions t
       LEFT JOIN economy fu ON fu.userID = t.from_user_id
       LEFT JOIN economy tu ON tu.userID = t.to_user_id
       ${whereClause}
       ORDER BY t.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const countRow = await dbGet(
      `SELECT COUNT(*) AS transactionCount,
              COALESCE(SUM(t.amount), 0) AS totalVolume
       FROM transactions t
       LEFT JOIN economy fu ON fu.userID = t.from_user_id
       LEFT JOIN economy tu ON tu.userID = t.to_user_id
       ${whereClause}`,
      params
    );

    const headRow = await dbGet(
      `SELECT id, timestamp, hash
       FROM transactions
       ORDER BY id DESC
       LIMIT 1`
    );

    const uniqueUserRow = await dbGet(
      `SELECT COUNT(DISTINCT user_id) AS uniqueUsers
       FROM (
         SELECT from_user_id AS user_id FROM transactions WHERE from_user_id IS NOT NULL
         UNION
         SELECT to_user_id AS user_id FROM transactions WHERE to_user_id IS NOT NULL
       )`
    );

    const canonical = await getCanonicalNetworkHead();
    const [integrity, network, consensusBridge] = await Promise.all([
      includeIntegrity ? dbHelpers.verifyLedgerIntegrity() : Promise.resolve(null),
      getNodeNetworkSnapshot({ canonical, force: true, maxWaitMs: 2500 }).catch((error) => {
        console.error('Node network refresh failed:', error);
        return summarizeNodeNetwork(nodeNetworkState.cache, canonical);
      }),
      getConsensusBridgeSummary(canonical).catch((error) => {
        console.error('Consensus bridge refresh failed:', error);
        return null;
      }),
    ]);

    const transactions = (rows || []).map((row) => {
      const metadata = parseLedgerMetadata(row.metadata);
      const fromAccount = normalizeLedgerAccount(
        metadata.fromAccount,
        { defaultUserAccount: row.from_user_id ? PRIMARY_BALANCE_ACCOUNT : 'system' }
      );
      const toAccount = normalizeLedgerAccount(
        metadata.toAccount,
        { defaultUserAccount: row.to_user_id ? PRIMARY_BALANCE_ACCOUNT : 'system' }
      );
      const fromLabel = buildVoltScanLabel(row.from_user_id, row.from_username, 'System');
      const toLabel = buildVoltScanLabel(row.to_user_id, row.to_username, 'System');

      let direction = 'transfer';
      if (!row.from_user_id) direction = 'credit';
      else if (!row.to_user_id) direction = 'debit';
      else if (String(row.from_user_id) === String(row.to_user_id)) direction = 'internal';

      return {
        id: Number(row.id),
        timestamp: Number(row.timestamp),
        type: row.type,
        direction,
        from_user_id: row.from_user_id || null,
        to_user_id: row.to_user_id || null,
        from_username: row.from_username || null,
        to_username: row.to_username || null,
        from_label: fromLabel,
        to_label: toLabel,
        from_account: fromAccount,
        to_account: toAccount,
        amount: Number(row.amount),
        metadata,
        previous_hash: row.previous_hash,
        hash: row.hash,
      };
    });

    return res.json({
      summary: {
        transactionCount: Number(countRow?.transactionCount || 0),
        totalVolume: Number(countRow?.totalVolume || 0),
        uniqueUsers: Number(uniqueUserRow?.uniqueUsers || 0),
        latestTransactionId: Number(headRow?.id || 0),
        latestTimestamp: Number(headRow?.timestamp || 0),
        latestHash: headRow?.hash || null,
        genesisHash: dbHelpers.ledgerService?.GENESIS_HASH || 'VOLT_LEDGER_GENESIS_V1',
      },
      integrity,
      canonical,
      nodeRegistry: buildNodeRegistrySummary(),
      consensusBridge,
      network,
      pagination: {
        limit,
        offset,
        hasMore: offset + transactions.length < Number(countRow?.transactionCount || 0),
      },
      filters: {
        type: type || '',
        userId: userId || '',
        q: query || '',
      },
      transactions,
    });
  } catch (error) {
    console.error('❌ Error loading VoltScan data:', error);
    return res.status(500).json({ message: 'Failed to load VoltScan data.' });
  }
});

app.get('/api/voltscan/network', authenticateToken, async (req, res) => {
  try {
    const canonical = await getCanonicalNetworkHead();
    const [network, consensusBridge] = await Promise.all([
      getNodeNetworkSnapshot({ canonical, force: true, maxWaitMs: 2500 }),
      getConsensusBridgeSummary(canonical).catch((error) => {
        console.error('Consensus bridge refresh failed:', error);
        return null;
      }),
    ]);
    return res.json({
      ...network,
      canonical,
      nodeRegistry: buildNodeRegistrySummary(),
      consensusBridge,
    });
  } catch (error) {
    console.error('Failed to load Volt network status:', error);
    return res.status(500).json({ error: 'Failed to load Volt network status.' });
  }
});

app.get('/exports/ledger.json', authenticateNodeKey, async (req, res) => {
  try {
    const payload = await dbHelpers.exportLedger();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('Ledger export route failed:', error);
    res.status(500).json({ error: 'Failed to export ledger.' });
  }
});

app.get('/exports/system-events.json', authenticateNodeKey, async (req, res) => {
  try {
    const payload = await dbHelpers.exportSystemEvents();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('System events export route failed:', error);
    res.status(500).json({ error: 'Failed to export system events.' });
  }
});

app.get('/exports/activity.json', async (req, res) => {
  try {
    const payload = await dbHelpers.exportCombinedActivity();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('Combined activity export route failed:', error);
    res.status(500).json({ error: 'Failed to export combined activity.' });
  }
});

app.get('/api/voltscan/activity', authenticateToken, async (req, res) => {
  try {
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const rawOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(rawLimit, 200)) : 50;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
    const payload = await dbHelpers.getCombinedActivity({
      limit,
      offset,
      order: String(req.query.order || 'desc'),
      type: String(req.query.type || ''),
      userId: String(req.query.userId || ''),
      kind: String(req.query.kind || ''),
      domain: String(req.query.domain || ''),
      actorUserId: String(req.query.actorUserId || ''),
      q: String(req.query.q || ''),
    });

    return res.json(redactWalletFields(payload));
  } catch (error) {
    console.error('Failed to load combined Volt activity:', error);
    return res.status(500).json({ error: 'Failed to load combined Volt activity.' });
  }
});

app.get('/api/auto-quests/progress', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.user?.userId || '').trim();
    if (!userId) {
      return res.status(400).json({ message: 'No user found for this session.' });
    }

    const today = dbHelpers.getCurrentESTDateString();
    const activityData = await dbHelpers.getDailyUserActivitySnapshot(userId, today);
    const otherQuestData = await dbGet(
      `SELECT
         COALESCE(MAX(rtp.bonus_10_given), 0) AS raffleBonus10,
         COALESCE(MAX(rtp.bonus_25_given), 0) AS raffleBonus25,
         COALESCE(MAX(rtp.bonus_50_given), 0) AS raffleBonus50,
         e.last_dao_call_reward_at AS lastDaoCallRewardAt
       FROM economy e
       LEFT JOIN raffle_ticket_purchases rtp ON rtp.user_id = e.userID
       WHERE e.userID = ?
       GROUP BY e.userID`,
      [userId]
    );

    const messageRewardLimit = Number.parseInt(process.env.MESSAGE_REWARD_LIMIT, 10) || 16;
    const dailyRpsGoal = 3;
    const messageCount = Number(activityData?.count || 0);
    const rpsWins = Number(activityData?.rpsWins || 0);

    return res.json({
      firstMessage: {
        current: activityData?.firstMessageBonusGiven ? 1 : 0,
        goal: 1,
      },
      roboChatMessages: {
        current: Math.max(0, Math.min(messageCount, messageRewardLimit)),
        goal: messageRewardLimit,
      },
      announcementReaction: {
        current: activityData?.reacted ? 1 : 0,
        goal: 1,
      },
      rpsWins: {
        current: Math.max(0, Math.min(rpsWins, dailyRpsGoal)),
        goal: dailyRpsGoal,
      },
      otherAutoQuests: {
        weeklyDaoCallLastReceivedAt: otherQuestData?.lastDaoCallRewardAt || null,
        raffleBonus10Received: Boolean(otherQuestData?.raffleBonus10),
        raffleBonus25Received: Boolean(otherQuestData?.raffleBonus25),
        raffleBonus50Received: Boolean(otherQuestData?.raffleBonus50),
      },
      date: today,
    });
  } catch (error) {
    console.error('❌ Error loading auto quest progress:', error);
    return res.status(500).json({ message: 'Failed to load auto quest progress.' });
  }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(400).json({ message: 'No user found for this session.' });
    }

    const username = normalizeVoltUsernameInput(req.body?.username);
    const aboutMe = normalizeProfileDetailInput(req.body?.aboutMe, 500);
    const specialties = normalizeProfileDetailInput(req.body?.specialties, 250);
    const location = normalizeProfileDetailInput(req.body?.location, 100);
    const twitterHandleRaw = String(req.body?.twitterHandle || '').trim().replace(/^@+/, '');
    if (twitterHandleRaw && !/^[A-Za-z0-9_]{1,15}$/.test(twitterHandleRaw)) {
      return res.status(400).json({ message: 'X username must use only letters, numbers, and underscores (max 15).' });
    }
    const existingUser = await dbGet(
      `SELECT userID
       FROM economy
       WHERE LOWER(username) = LOWER(?)
         AND userID != ?`,
      [username, userId]
    );
    if (existingUser?.userID) {
      return res.status(409).json({ message: 'That display name is already in use.' });
    }

    await dbHelpers.updateUserProfile(userId, {
      username,
      aboutMe: aboutMe || null,
      specialties: specialties || null,
      location: location || null,
      twitterHandle: twitterHandleRaw || null,
    }, {
      actorUserId: userId,
      source: 'web_profile',
    });

    try {
      const roboCheckAccount = roboCheckAccountStore.getAccountByDiscordId(userId, roboCheckAccountStore.readVerifiedEntries());
      if (roboCheckAccount) {
        roboCheckAccountStore.updateTwitterHandle(userId, twitterHandleRaw || null);
      }
    } catch (roboCheckError) {
      console.error('❌ Error updating Robo-Check twitter handle from Volt profile:', roboCheckError);
    }

    const token = jwt.sign(
      { userId, username },
      SECRET_KEY,
      { expiresIn: '1y' }
    );

    return res.json({
      message: 'Profile updated successfully.',
      token,
      profile: {
        discordId: userId,
        username,
        aboutMe: aboutMe || null,
        specialties: specialties || null,
        location: location || null,
        twitterHandle: twitterHandleRaw || null,
      },
    });
  } catch (error) {
    console.error('❌ Error updating profile:', error);
    return res.status(400).json({ message: error.message || 'Failed to update profile.' });
  }
});

app.get('/api/profile-map', authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT userID
       FROM economy
       ORDER BY LOWER(COALESCE(username, userID)) ASC`
    );
    const decodedRows = (await Promise.all(
      (rows || []).map(async (row) => {
        const profile = await dbHelpers.getReadableProfileDetails(row.userID, { maskOnFailure: false });
        if (!profile?.location) {
          return null;
        }
        return {
          userID: row.userID,
          username: profile.username || row.userID,
          location: profile.location,
        };
      })
    )).filter(Boolean);

    return res.json(decodedRows);
  } catch (error) {
    console.error('❌ Error loading profile map data:', error);
    return res.status(500).json({ message: 'Failed to load profile map data.' });
  }
});

app.get('/api/inventory', authenticateToken, (req, res) => {
  const userId = req.user.userId; // Get user ID from JWT

  db.all(
    `SELECT i.itemID, i.name, i.description, inv.quantity, COALESCE(i.isRedeemable, 1) AS isRedeemable
     FROM inventory inv
     JOIN items i ON inv.itemID = i.itemID
     WHERE inv.userID = ?`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching inventory:', err);
        return res.status(500).json({ error: 'Failed to fetch inventory.' });
      }
      res.json(rows);
    }
  );
});

// Authenticated endpoint for viewing another user's inventory.
app.get('/api/public-inventory/:userId', authenticateToken, (req, res) => {
  const userId = req.params.userId;

  db.all(
    `SELECT i.itemID, i.name, i.description, inv.quantity, COALESCE(i.isRedeemable, 1) AS isRedeemable
     FROM inventory inv
     JOIN items i ON inv.itemID = i.itemID
     WHERE inv.userID = ?`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching inventory:', err);
        return res.status(500).json({ error: 'Failed to fetch inventory.' });
      }
      res.json(rows);
    }
  );
});

/**
 * POST /api/redeem
 * Redeem (use) an item from the user's inventory.
 */
app.post('/api/redeem', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { itemName, walletAddress } = req.body;

  if (!itemName) {
    return res.status(400).json({ error: 'Missing item name.' });
  }
  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing Solana wallet address.' });
  }

  try {
    const beforeRow = await dbGet(
      `SELECT inv.quantity
       FROM inventory inv
       JOIN items i ON inv.itemID = i.itemID
       WHERE inv.userID = ? AND i.name = ?`,
      [userId, itemName]
    );
    const beforeQty = beforeRow?.quantity ?? null;
    const resultMsg = await redeemItem(userId, itemName);
    const afterRow = await dbGet(
      `SELECT inv.quantity
       FROM inventory inv
       JOIN items i ON inv.itemID = i.itemID
       WHERE inv.userID = ? AND i.name = ?`,
      [userId, itemName]
    );
    const afterQty = afterRow?.quantity ?? 0;

    let userTag = null;
    try {
      userTag = await resolveUsername(userId);
    } catch (tagErr) {
      console.error('Failed to resolve username for redemption log:', tagErr);
    }
    if (!userTag) {
      userTag = `UnknownUser(${userId})`;
    }

    try {
      await dbHelpers.logItemRedemption({
        userID: userId,
        userTag,
        itemName,
        walletAddress,
        source: 'web',
        channelName: 'Web UI Inventory',
        channelId: null,
        messageLink: null,
        commandText: `WEB_UI redeem item="${itemName}" wallet="[redacted]"`,
        inventoryBefore: Number.isFinite(beforeQty) ? beforeQty : null,
        inventoryAfter: Number.isFinite(afterQty) ? afterQty : null,
      });
    } catch (insertErr) {
      console.error('Failed to store web redemption log:', insertErr);
    }

    const channelId = ITEM_REDEMPTION_CHANNEL_ID;
    if (channelId) {
      try {
        const now = new Date();
        const unix = Math.floor(now.getTime() / 1000);
        const channel = await client.channels.fetch(channelId);
        if (channel) {
          const fields = [
            { name: 'Who', value: `${userTag} (${userId})`, inline: true },
            { name: 'What', value: itemName, inline: true },
            { name: 'Where', value: 'Web UI Inventory', inline: true },
            {
              name: 'Inventory',
              value:
                beforeQty !== null
                  ? `${itemName} ${beforeQty} → ${afterQty}`
                  : `${itemName} → ${afterQty}`,
              inline: false,
            },
            { name: 'When', value: `<t:${unix}:F>`, inline: false },
          ];
          const embed = new EmbedBuilder()
            .setTitle('🧾 Item Redeemed')
            .setColor(SUBMISSION_EMBED_COLORS.itemRedemption)
            .addFields(fields)
            .setTimestamp(now);

          await channel.send({ embeds: [embed] });
          const walletMessage = formatSolanaWalletMessage(walletAddress);
          if (walletMessage) {
            await channel.send({ content: walletMessage });
          }
        }
      } catch (logErr) {
        console.error('Failed to log web redemption:', logErr);
      }
    }

    return res.json({ message: resultMsg });
  } catch (error) {
    console.error('Error redeeming item via web:', error);
    const message = error?.message || error?.toString() || 'Failed to redeem item.';
    const statusCode = String(message).startsWith('🚫') ? 400 : 500;
    return res.status(statusCode).json({ error: message });
  }
});


/**
 * POST /api/buy
 * Allows a user to buy one or more items from the shop.
 */
app.post('/api/buy', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { itemName, quantity } = req.body;
  const qty = parseInt(quantity) || 1;

  if (!itemName || qty < 1) {
    return res.status(400).json({ error: 'Missing item name or invalid quantity.' });
  }

  try {
    const purchaseResult = await dbHelpers.purchaseShopItem(userId, itemName, qty, {
      source: 'web',
      metadata: {
        route: '/api/buy',
      },
    });

    console.log(`✅ User ${userId} bought ${qty} x "${purchaseResult.item.name}"`);

    return res.json({
      message: `✅ You bought ${qty} "${purchaseResult.item.name}" ticket(s) for ⚡${purchaseResult.totalCost}.`,
      bonusTickets: purchaseResult.bonusInfo?.bonusTickets || 0,
      bonusMilestones: purchaseResult.bonusInfo?.milestones || [],
    });
  } catch (error) {
    console.error('❌ Error in /api/buy route:', error);
    const message = error?.message || 'Internal server error';
    const statusCode = getClientErrorStatus(message, { allowNotFound: false });
    res.status(statusCode).json({ error: message });
  }
});


app.get('/api/giveaways/:giveawayId/entries', async (req, res) => {
  const { giveawayId } = req.params;

  try {
    db.get(
      `SELECT COUNT(*) AS entryCount FROM giveaway_entries WHERE giveaway_id = ?`,
      [giveawayId],
      (err, row) => {
        if (err) {
          console.error(`❌ Error fetching giveaway entries for ${giveawayId}:`, err);
          return res.status(500).json({ error: 'Failed to fetch giveaway entries.' });
        }
        res.json({ giveawayId, entryCount: row.entryCount || 0 });
      }
    );
  } catch (error) {
    console.error('❌ Error in /api/giveaways/:giveawayId/entries:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});



app.post('/api/giveaway/toggle', authenticateToken, async (req, res) => {
  const { giveawayId } = req.body;
  const userId = req.user.userId;

  if (!giveawayId) {
    return res.status(400).json({ error: "Missing giveaway ID." });
  }

  try {
    // Check if the user is already entered
    const userEntry = await dbGet(
      `SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?`,
      [giveawayId, userId]
    );

    if (userEntry) {
      // User is entered → Remove them
      await dbHelpers.removeGiveawayEntry(giveawayId, userId);
      console.log(`🛑 User ${userId} left giveaway ${giveawayId}`);
      return res.json({ success: true, action: "left" });
    } else {
      // ✅ Use `addGiveawayEntry()` instead of direct DB insert
      await addGiveawayEntry(giveawayId, userId);
      console.log(`✅ User ${userId} successfully joined giveaway ${giveawayId} via API.`);
      return res.json({ success: true, action: "joined" });
    }
  } catch (error) {
    console.error("❌ Error toggling giveaway entry:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});


/**
 * POST /api/giveaways/enter
 * Allows a user to enter a giveaway (one-time entry).
 */
app.post('/api/giveaways/enter', authenticateToken, async (req, res) => {
  const { giveawayId } = req.body;
  const userId = req.user.userId;

  if (!giveawayId) {
    return res.status(400).json({ error: "Missing giveaway ID." });
  }

  try {
    const userEntry = await dbGet(
      `SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?`,
      [giveawayId, userId]
    );

    if (userEntry) {
      // 🚫 Do NOT remove entry – just inform the user they're already in
      console.log(`ℹ️ User ${userId} already entered giveaway ${giveawayId}`);
      return res.json({ success: true, alreadyEntered: true });
    }

    // ✅ Enter the user
    await addGiveawayEntry(giveawayId, userId);
    console.log(`✅ User ${userId} successfully entered giveaway ${giveawayId} via API.`);
    return res.json({ success: true, joined: true });

  } catch (error) {
    console.error("❌ Error entering giveaway:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});


const {
  assignJobById,
  getAssignedJob,
  getActiveRaffles,
  getShopItemByName,
  getAnyShopItemByName,
  redeemItem,
  renumberJobs,
  saveGiveaway,
  createRaffle,
} = require('../db'); // Ensure correct path


app.post('/api/assign-job', authenticateToken, async (req, res) => {
  const { jobID } = req.body;
  const userID = req.user?.userId;

  console.log(`[DEBUG] Received job assignment request:`, { userID, jobID });

  if (!userID) {
    console.error(`[ERROR] User not authenticated`);
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!jobID) {
    console.error(`[ERROR] Job ID missing in request`);
    return res.status(400).json({ error: 'Invalid quest selection' });
  }

  try {
    const activeJob = await getAssignedJob(userID);
    if (activeJob) {
      console.warn(`[WARN] User ${userID} already has job ${activeJob.jobID}`);
      return res.status(400).json({ error: 'You already have an assigned quest.' });
    }

    const job = await assignJobById(userID, jobID);
    console.log(`[SUCCESS] Job assigned to user ${userID}:`, job);
    return res.json({ success: true, job });

  } catch (error) {
    console.error(`[ERROR] Job assignment failed:`, error);
    const message = error?.message || String(error);
    const lower = message.toLowerCase();
    const isClientError = lower.includes('cooldown') || lower.includes('already has a job') || lower.includes('job not found');
    return res.status(isClientError ? 400 : 500).json({ error: isClientError ? message : 'Failed to assign quest' });
  }
});

app.post('/api/quit-job', authenticateToken, async (req, res) => {
  const userID = req.user?.userId; // Extract user ID from JWT

  console.log(`[DEBUG] Received quit job request from user: ${userID}`);

  if (!userID) {
    console.error(`[ERROR] User not authenticated`);
    return res.status(401).json({ error: 'User not authenticated' });
  }

  try {
    console.log(`[CHECK] Fetching active job for user ${userID}`);
    const result = await dbHelpers.quitAssignedJob(userID, {
      actorUserId: userID,
      source: 'web_quit_job',
    });

    if (!result.removed) {
      console.warn(`[WARN] User ${userID} has no active job.`);
      return res.status(400).json({ error: 'You have no active quest to quit.' });
    }

    console.log(`[INFO] Removing job ${result.jobID} for user ${userID}`);
    console.log(`[SUCCESS] User ${userID} quit their job.`);
    return res.json({ success: true, message: 'You have quit your quest.' });

  } catch (error) {
    console.error(`[ERROR] Job quitting failed:`, error);
    return res.status(500).json({ error: 'Failed to quit job' });
  }
});



const SUBMISSION_CHANNEL_ID = process.env.SUBMISSION_CHANNEL_ID;

// ✅ Ensure uploads directory exists
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ✅ Configure Multer for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// ✅ Serve uploaded images as static files
app.use("/uploads", express.static(uploadDir));

// ✅ Job Submission API
app.post("/api/submit-job", upload.single("image"), async (req, res) => {
  console.log("📥 Received job submission:", req.body, req.file);

  const userID = req.headers["x-user-id"];
  if (!userID) return res.status(400).json({ error: "User ID is missing. Please log in again." });

  const { title, description, jobID } = req.body;
  if (!title || !description) return res.status(400).json({ error: "Title and description are required." });
  if (!jobID) return res.status(400).json({ error: "Job ID is required." });

  try {
const channel = await client.channels.fetch(QUEST_SUBMISSION_CHANNEL_ID);
      if (!channel) return res.status(500).json({ error: "Quest submission channel not found." });

    // ✅ Try to resolve user tag
    let footerText = `Submitted by: <@${userID}>`; // fallback
    try {
      const user = await client.users.fetch(userID);
      footerText = `Submitted by: ${user.tag} (<@${user.id}>)`;
    } catch (err) {
      console.warn(`⚠️ Could not resolve user tag for ${userID}:`, err.message);
    }

    console.log("📤 Sending embed to Discord...");
    const embed = new EmbedBuilder()
      .setTitle("📢 New Job Submission!")
      .setColor(SUBMISSION_EMBED_COLORS.jobSubmission)
      .setDescription(`**Title:** ${title}\n**Description:** ${description}`)
      .setFooter({ text: footerText })
      .setTimestamp();

    // ✅ Attach image URL in embed as a field
    const imageUrl = req.file
      ? `https://volt.solarians.world/uploads/${encodeURIComponent(req.file.filename)}`
      : null;
    if (imageUrl) {
      console.log("🖼️ Image URL for embed:", imageUrl);
      embed.addFields({ name: "📷 Image URL", value: `[Click to View](${imageUrl})` });
    }

    await channel.send({ embeds: [embed] });

    await dbHelpers.submitJobSubmission({
      userID,
      jobID,
      title,
      description,
      imageUrl,
    }, {
      actorUserId: userID,
      source: 'web_submit_job',
    });

    console.log("✅ Job submitted successfully!");
    res.json({ message: "Job submitted successfully!" });
  } catch (error) {
    console.error("❌ ERROR DETAILS:", error);
    res.status(500).json({ error: `Failed to send job submission. Reason: ${error.message}` });
  }
});




// Robot Oil Price History API (dynamic from DB)
app.get('/api/oil-history', (req, res) => {
  db.all(
    `SELECT created_at, price_per_unit
     FROM robot_oil_history
     WHERE event_type IN ('purchase', 'market_buy')
     ORDER BY created_at ASC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching oil history:', err);
        return res.status(500).json({ error: 'Failed to fetch oil history.' });
      }

      const oilHistory = rows.map((row) => ({
        date: new Date(row.created_at * 1000).toISOString().split('T')[0], // Converts UNIX timestamp to YYYY-MM-DD
        price: row.price_per_unit,
      }));

      res.json(oilHistory);
    }
  );
});

/**
 * GET /api/oil-market
 * Fetch active oil listings from the robot_oil_market table
 */
app.get('/api/oil-market', async (req, res) => {
  try {
    db.all(
      `SELECT listing_id, seller_id, quantity, price_per_unit, created_at, type 
       FROM robot_oil_market 
       ORDER BY price_per_unit ASC, created_at ASC`, // Sort cheapest first
      [],
      async (err, rows) => {
        if (err) {
          console.error('Error fetching oil market listings:', err);
          return res.status(500).json({ error: 'Failed to fetch oil market listings.' });
        }

        const uniqueSellerIds = [...new Set(rows.map((row) => row.seller_id))];
        const sellerTags = {};
        await Promise.all(uniqueSellerIds.map(async (sellerId) => {
          try {
            sellerTags[sellerId] = await resolveUsername(sellerId);
          } catch (tagErr) {
            console.error(`Failed to resolve username for ${sellerId}:`, tagErr);
            sellerTags[sellerId] = `UnknownUser(${sellerId})`;
          }
        }));

        const withTags = rows.map((row) => ({
          ...row,
          seller_tag: sellerTags[row.seller_id] || `UnknownUser(${row.seller_id})`,
        }));

        res.json(withTags);
      }
    );
  } catch (error) {
    console.error('❌ Error in /api/oil-market route:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});


app.post('/api/oil/market-buy', authenticateToken, async (req, res) => {
  const buyerId = req.user.userId;
  const ROBOT_OIL_ITEM_ID = 88;

  try {
    const listing = await dbGet(
      `SELECT listing_id, seller_id, quantity, price_per_unit, type
       FROM robot_oil_market
       WHERE type IS NULL OR type = 'sale'
       ORDER BY price_per_unit ASC, created_at ASC
       LIMIT 1`
    );

    if (!listing) {
      return res.status(404).json({ error: 'No oil available for sale.' });
    }

    await dbHelpers.buyRobotOilFromMarket(buyerId, listing.listing_id, 1);

    const after = await dbHelpers.getBalances(buyerId);
    const inv = await dbGet(
      `SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`,
      [buyerId, ROBOT_OIL_ITEM_ID]
    );

    res.json({
      success: true,
      message: `✅ Bought 1 barrel for ⚡${listing.price_per_unit}.`,
      balance: after.balance,
      wallet: after.balance,
      oilQuantity: inv?.quantity ?? 0,
    });
  } catch (error) {
    console.error('Error in /api/oil/market-buy:', error);
    const message = error?.message || 'Internal server error.';
    const statusCode = getClientErrorStatus(message);
    res.status(statusCode).json({ error: message });
  }
});


app.post('/api/oil/offer-sale', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { quantity, price_per_unit } = req.body;

  if (!quantity || !price_per_unit || quantity <= 0 || price_per_unit <= 0) {
    return res.status(400).json({ error: 'Invalid quantity or price.' });
  }

  try {
    const message = await dbHelpers.listRobotOilForSale(userId, quantity, price_per_unit);
    res.json({ success: true, message });
  } catch (error) {
    console.error('Error in /api/oil/offer-sale:', error);
    const message = error?.message || 'Internal server error.';
    res.status(getClientErrorStatus(message, { allowNotFound: false })).json({ error: message });
  }
});

app.post('/api/oil/cancel', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { listing_id, type } = req.body;

  if (!listing_id || !type) {
    return res.status(400).json({ error: 'Listing ID and type are required.' });
  }

  try {
    const listing = await dbGet(`SELECT * FROM robot_oil_market WHERE listing_id = ?`, [listing_id]);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    if (listing.type !== type) {
      return res.status(400).json({ error: 'Listing type mismatch.' });
    }

    const message = await dbHelpers.cancelRobotOilListing(userId, listing_id);
    res.json({ success: true, message });
  } catch (error) {
    console.error('Error canceling listing:', error);
    const message = error?.message || 'Internal server error.';
    const statusCode = getClientErrorStatus(message);
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/oil/offer-buy', authenticateToken, async (req, res) => {
  const buyerId = req.user.userId;
  const { quantity, price_per_unit } = req.body;

  if (!quantity || !price_per_unit || quantity <= 0 || price_per_unit <= 0) {
    return res.status(400).json({ error: 'Invalid quantity or price.' });
  }

  try {
    const message = await dbHelpers.placeRobotOilBid(buyerId, quantity, price_per_unit);
    res.json({ success: true, message });
  } catch (error) {
    console.error('❌ Failed to create purchase offer:', error);
    const message = error?.message || 'Failed to insert offer.';
    res.status(getClientErrorStatus(message, { allowNotFound: false })).json({ error: message });
  }
});

app.post('/api/oil/market-sell', authenticateToken, async (req, res) => {
  const sellerId = req.user.userId;

  try {
    const offer = await dbGet(
      `SELECT * FROM robot_oil_market
       WHERE type = 'purchase'
       ORDER BY price_per_unit DESC, created_at ASC
       LIMIT 1`
    );

    if (!offer) {
      return res.status(404).json({ error: 'No buy offers available.' });
    }

    await dbHelpers.buyRobotOilFromMarket(sellerId, offer.listing_id, 1);
    res.json({ success: true, message: `✅ Sold 1 barrel for ⚡${offer.price_per_unit}.` });
  } catch (error) {
    console.error('Error in /api/oil/market-sell:', error);
    const message = error?.message || 'Internal server error.';
    const statusCode = getClientErrorStatus(message);
    res.status(statusCode).json({ error: message });
  }
});



if (!TEST_MODE) {
  setInterval(() => {
    refreshCanonicalExportFiles().catch((error) => {
      console.error('Background canonical export refresh failed:', error);
    });
  }, CANONICAL_EXPORT_REFRESH_MS);

  refreshCanonicalExportFiles({ force: true }).catch((error) => {
    console.error('Initial canonical export refresh failed:', error);
  });

  setInterval(() => {
    refreshNodeNetworkCache().catch((error) => {
      console.error('Background node network refresh failed:', error);
    });
  }, NODE_NETWORK_POLL_MS);

  refreshNodeNetworkCache().catch((error) => {
    console.error('Initial node network refresh failed:', error);
  });
}

dbHelpers.ensureRecoverableProjectionMaintenance().catch((error) => {
  console.error('Initial recoverable projection maintenance failed:', error);
});

// Start the server
app.listen(PORT, HOST, () => {
  const prettyHost = HOST === '0.0.0.0' ? '0.0.0.0 (LAN enabled)' : HOST;
  console.log(`Server running at http://${prettyHost}:${PORT}`);
});
