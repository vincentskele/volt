// server.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs'); // Needed to read the console.json file
const multer = require("multer");



// Import your Discord bot client so we can fetch usernames
// Make sure ../bot exports something like: module.exports = { client }
const { client } = require('../info-bot'); 

const app = express();
const PORT = Number(process.env.SERVER_PORT) || 3000;


// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static files from "public"
app.use(express.static(path.join(__dirname, 'public')));

// Connect to SQLite database (adjust path as needed)
const dbPath = path.join(__dirname, '..', 'points.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite DB:', err.message);
  } else {
    console.log(`Connected to SQLite database at ${dbPath}`);
  }
});

// ✅ Admin/Quest submissions table (for pending review)
db.run(
  `CREATE TABLE IF NOT EXISTS job_submissions (
    submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
    userID TEXT NOT NULL,
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

const ROBO_CHECK_HOLDERS_PATH =
  process.env.ROBO_CHECK_HOLDERS_PATH ||
  path.resolve(__dirname, '..', '..', 'robo-check', 'src', 'data', 'holders.json');

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



/**
 * Adds a user to a giveaway.
 * Ensures there are no duplicate entries.
 */
async function addGiveawayEntry(giveawayId, userId) {
  try {
    // Check if the user is already entered
    const existingEntry = await dbGet(
      `SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?`,
      [giveawayId, userId]
    );

    if (existingEntry) {
      console.log(`⚠️ User ${userId} already entered in giveaway ${giveawayId}. Skipping duplicate.`);
      return;
    }

    // Insert entry into giveaway_entries
    await dbRun(`INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)`, [giveawayId, userId]);
    console.log(`✅ Added new giveaway entry for user ${userId} in giveaway ${giveawayId}`);
  } catch (error) {
    console.error(`❌ Error adding giveaway entry:`, error);
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
 * GET /api/leaderboard
 * Return top 10 by total (wallet + bank), plus userTag in place of userID.
 */
app.get('/api/leaderboard', async (req, res) => {
  try {
    // Query database for top 10 users by total balance
    db.all(
      `SELECT userID, wallet, bank, (wallet + bank) AS totalBalance
       FROM economy
       ORDER BY totalBalance DESC
       LIMIT 10`,
      [],
      async (err, rows) => {
        if (err) {
          console.error('Error fetching leaderboard:', err);
          return res.status(500).json({ error: 'Failed to fetch leaderboard' });
        }

        try {
          // Resolve Discord tags for each user
          const withTags = await Promise.all(
            rows.map(async (row) => {
              const userTag = await resolveUsername(row.userID);
              return {
                userID: row.userID, // Include userID for link generation
                userTag,
                wallet: row.wallet,
                bank: row.bank,
                totalBalance: row.totalBalance,
              };
            })
          );

          // Send leaderboard data as response
          res.json(withTags);
        } catch (tagError) {
          console.error('Error resolving usernames:', tagError);
          res.status(500).json({ error: 'Failed to resolve usernames' });
        }
      }
    );
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
 * GET /api/admin/users
 * Returns all users (admin only).
 */
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT userID, username
       FROM economy
       WHERE username IS NOT NULL AND username != ''
       ORDER BY LOWER(username) ASC`
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('Error in /api/admin/users:', err);
    return res.status(500).json({ message: 'Failed to load users.' });
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

    await dbRun(
      `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
      [rewardAmount, submission.userID]
    );

    await dbRun(
      `UPDATE job_submissions
       SET status = 'completed', reward_amount = ?, completed_at = strftime('%s', 'now')
       WHERE submission_id = ?`,
      [rewardAmount, submissionId]
    );

    await dbRun(
      `DELETE FROM job_assignees WHERE userID = ?`,
      [submission.userID]
    );

    try {
      const channelId = process.env.SUBMISSION_CHANNEL_ID;
      if (channelId) {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
          const userTag = await resolveUsername(submission.userID);
          const adminTag = await resolveUsername(req.user.userId);
          const messageLines = [
            '✅ Quest marked complete!',
            `User: ${userTag}`,
            `Marked by: ${adminTag}`,
            `Volts awarded: ${rewardAmount}`,
            `Title: ${submission.title}`,
            `Description: ${submission.description}`,
          ];
          if (submission.image_url) {
            messageLines.push(`Image: ${submission.image_url}`);
          }
          await channel.send(messageLines.join('\n'));
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
 * GET /api/shop
 */
app.get('/api/shop', (req, res) => {
  db.all(
    `SELECT itemID AS id, name, price, description, quantity 
     FROM items
     WHERE isAvailable=1`,
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
 * GET /api/jobs
 * Return a list of jobs with user mappings resolved,
 * including assignee links to their Discord profiles.
 */
app.get('/api/jobs', async (req, res) => {
  try {
    db.all(
      `
      SELECT j.jobID, j.description, GROUP_CONCAT(ja.userID) as assignees
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
app.get('/api/resolveUser/:userId', async (req, res) => {
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
app.get('/api/holder/:discordId', (req, res) => {
  const { discordId } = req.params;
  const holders = readRoboCheckHolders();
  const holder = holders.find((entry) => String(entry.discordId) === String(discordId));
  res.json(holder || null);
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
      function (err) {
        if (err) {
          console.error("Error registering user:", err.message);
          return res.status(500).json({ message: "Username already exists." });
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

    const user = await dbGet(
      `SELECT userID, username FROM economy WHERE userID = ?`,
      [userId]
    );

    if (!user) {
      return res
        .status(401)
        .send("Discord account is not linked to an economy profile.");
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
    const user = await dbGet(
      `SELECT wallet, bank FROM economy WHERE userID = ?`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const { wallet, bank } = user;
    const totalBalance = wallet + bank;

    res.json({ wallet, bank, totalBalance });
  } catch (error) {
    console.error("❌ Error fetching Volt balance:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

app.get('/api/inventory', authenticateToken, (req, res) => {
  const userId = req.user.userId; // Get user ID from JWT

  db.all(
    `SELECT i.itemID, i.name, i.description, inv.quantity
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

// Public endpoint for user inventory (no authentication)
app.get('/api/public-inventory/:userId', (req, res) => {
  const userId = req.params.userId;

  db.all(
    `SELECT i.itemID, i.name, i.description, inv.quantity
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
    db.get(`SELECT * FROM items WHERE name = ? AND isAvailable = 1`, [itemName], (err, item) => {
      if (err) {
        console.error('Error fetching shop item:', err);
        return res.status(500).json({ error: 'Database error. Please try again later.' });
      }
      if (!item) {
        return res.status(404).json({ error: 'Item not found or unavailable.' });
      }
      if (item.quantity < qty) {
        return res.status(400).json({ error: `⚠️ Not enough stock. Only ${item.quantity} available.` });
      }

      const totalCost = item.price * qty;

      db.get(`SELECT wallet FROM economy WHERE userID = ?`, [userId], (err, user) => {
        if (err) {
          console.error('Error fetching user balance:', err);
          return res.status(500).json({ error: 'Database error. Please try again later.' });
        }
        if (!user || user.wallet < totalCost) {
          return res.status(400).json({ error: `⚠️ You don't have enough funds. Total cost: ⚡${totalCost}` });
        }

        db.serialize(() => {
          db.run('BEGIN TRANSACTION');

          db.run(`UPDATE economy SET wallet = wallet - ? WHERE userID = ?`, [totalCost, userId], (err) => {
            if (err) {
              db.run('ROLLBACK');
              console.error('Error deducting balance:', err);
              return res.status(500).json({ error: 'Failed to process payment.' });
            }

            db.run(`UPDATE items SET quantity = quantity - ? WHERE name = ?`, [qty, itemName], (err) => {
              if (err) {
                db.run('ROLLBACK');
                console.error('Error updating item quantity:', err);
                return res.status(500).json({ error: 'Failed to update shop stock.' });
              }

              db.run(
                `INSERT INTO inventory (userID, itemID, quantity) 
                 VALUES (?, ?, ?) 
                 ON CONFLICT(userID, itemID) DO UPDATE SET quantity = quantity + ?`,
                [userId, item.itemID, qty, qty],
                (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    console.error('Error adding item to inventory:', err);
                    return res.status(500).json({ error: 'Failed to add item to inventory.' });
                  }

                  db.run('COMMIT');
                  console.log(`✅ User ${userId} bought ${qty} x "${itemName}"`);
                  return res.json({ message: `✅ You bought ${qty} "${itemName}" ticket(s) for ⚡${totalCost}.` });
                }
              );
            });
          });
        });
      });
    });
  } catch (error) {
    console.error('❌ Error in /api/buy route:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      await db.run(`DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?`, [giveawayId, userId]);
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


const { assignJobById, getActiveJob } = require('../db'); // Ensure correct path


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
    return res.status(400).json({ error: 'Invalid job ID' });
  }

  try {
    const activeJob = await getActiveJob(userID);
    if (activeJob) {
      console.warn(`[WARN] User ${userID} already has job ${activeJob.jobID}`);
      return res.status(400).json({ error: 'You already have an assigned job.' });
    }

    const job = await assignJobById(userID, jobID);
    console.log(`[SUCCESS] Job assigned to user ${userID}:`, job);
    return res.json({ success: true, job });

  } catch (error) {
    console.error(`[ERROR] Job assignment failed:`, error);
    return res.status(500).json({ error: 'Failed to assign job' });
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
    const activeJob = await dbGet(`SELECT jobID FROM job_assignees WHERE userID = ?`, [userID]);

    if (!activeJob) {
      console.warn(`[WARN] User ${userID} has no active job.`);
      return res.status(400).json({ error: 'You have no active job to quit.' });
    }

    console.log(`[INFO] Removing job ${activeJob.jobID} for user ${userID}`);
    
    await dbRun(`DELETE FROM job_assignees WHERE userID = ?`, [userID]);

    console.log(`[SUCCESS] User ${userID} quit their job.`);
    return res.json({ success: true, message: 'You have quit your job.' });

  } catch (error) {
    console.error(`[ERROR] Job quitting failed:`, error);
    return res.status(500).json({ error: 'Failed to quit job' });
  }
});



const SUBMISSION_CHANNEL_ID = process.env.SUBMISSION_CHANNEL_ID;

const { EmbedBuilder } = require("discord.js");



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

  const { title, description } = req.body;
  if (!title || !description) return res.status(400).json({ error: "Title and description are required." });

  try {
    const channel = await client.channels.fetch(process.env.SUBMISSION_CHANNEL_ID);
    if (!channel) return res.status(500).json({ error: "Submission channel not found." });

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
      .setColor("#0099ff")
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

    await dbRun(
      `INSERT INTO job_submissions (userID, title, description, image_url) VALUES (?, ?, ?, ?)`,
      [userID, title, description, imageUrl]
    );

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

        res.json(rows);
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
    // 1) Get the cheapest SELL listing only
    db.get(`
      SELECT listing_id, seller_id, quantity, price_per_unit, type
      FROM robot_oil_market
      WHERE type IS NULL OR type = 'sale'
      ORDER BY price_per_unit ASC, created_at ASC
      LIMIT 1
    `, async (err, listing) => {
      if (err) {
        console.error('Error fetching cheapest sell listing:', err);
        return res.status(500).json({ error: 'Database error.' });
      }
      if (!listing) return res.status(404).json({ error: 'No oil available for sale.' });

      if (listing.seller_id === buyerId) {
        return res.status(400).json({ error: 'You cannot buy your own listing.' });
      }

      const price = listing.price_per_unit;

      // 2) Check buyer wallet
      const buyer = await dbGet(`SELECT wallet FROM economy WHERE userID = ?`, [buyerId]);
      if (!buyer) return res.status(400).json({ error: 'Buyer not found in economy.' });
      if ((buyer.wallet ?? 0) < price) {
        return res.status(400).json({ error: 'Not enough ⚡ to buy 1 barrel.' });
      }

      db.serialize(() => {
        // BEGIN IMMEDIATE to avoid race on the same listing
        db.run('BEGIN IMMEDIATE');

        // 3) Debit buyer
        db.run(
          `UPDATE economy SET wallet = wallet - ? WHERE userID = ?`,
          [price, buyerId],
          function (e1) {
            if (e1) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Failed to debit wallet.' }); }
            if (this.changes !== 1) { db.run('ROLLBACK'); return res.status(400).json({ error: 'Wallet debit failed (user not found).' }); }

            // 4) Credit seller
            db.run(
              `UPDATE economy SET wallet = wallet + ? WHERE userID = ?`,
              [price, listing.seller_id],
              function (e2) {
                if (e2) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Failed to credit seller.' }); }
                if (this.changes !== 1) { db.run('ROLLBACK'); return res.status(400).json({ error: 'Seller not found for credit.' }); }

                // 5) Give buyer 1 oil
                db.run(`
                  INSERT INTO inventory (userID, itemID, quantity)
                  VALUES (?, ?, 1)
                  ON CONFLICT(userID, itemID) DO UPDATE SET quantity = quantity + 1
                `, [buyerId, ROBOT_OIL_ITEM_ID], function (e3) {
                  if (e3) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Failed to add oil to inventory.' }); }

                  // 6) Reduce or delete the listing (consume 1 unit)
                  if (listing.quantity > 1) {
                    db.run(
                      `UPDATE robot_oil_market SET quantity = quantity - 1 WHERE listing_id = ?`,
                      [listing.listing_id],
                      function (e4) {
                        if (e4) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Failed to decrement listing.' }); }
                        finalize();
                      }
                    );
                  } else {
                    db.run(
                      `DELETE FROM robot_oil_market WHERE listing_id = ?`,
                      [listing.listing_id],
                      function (e4) {
                        if (e4) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Failed to delete listing.' }); }
                        finalize();
                      }
                    );
                  }

                  function finalize() {
                    // 7) History
                    db.run(`
                      INSERT INTO robot_oil_history (event_type, buyer_id, seller_id, quantity, price_per_unit, total_price)
                      VALUES ('market_buy', ?, ?, 1, ?, ?)
                    `, [buyerId, listing.seller_id, price, price], async function (e5) {
                      if (e5) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Failed to log history.' }); }

                      db.run('COMMIT', async (e6) => {
                        if (e6) { return res.status(500).json({ error: 'Commit failed.' }); }

                        // Return fresh balances so the client can reflect immediately
                        const after = await dbGet(`SELECT wallet FROM economy WHERE userID = ?`, [buyerId]);
                        const inv = await dbGet(`SELECT quantity FROM inventory WHERE userID = ? AND itemID = ?`, [buyerId, ROBOT_OIL_ITEM_ID]);

                        res.json({
                          success: true,
                          message: `✅ Bought 1 barrel for ⚡${price}.`,
                          wallet: after?.wallet ?? null,
                          oilQuantity: inv?.quantity ?? 0,
                        });
                      });
                    });
                  }
                });
              }
            );
          }
        );
      });
    });
  } catch (error) {
    console.error('Error in /api/oil/market-buy:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});


app.post('/api/oil/offer-sale', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { quantity, price_per_unit } = req.body;

  if (!quantity || !price_per_unit || quantity <= 0 || price_per_unit <= 0) {
    return res.status(400).json({ error: 'Invalid quantity or price.' });
  }

  try {
    // 1. Check if user has enough Robot Oil
    const robotOil = await dbGet(`SELECT quantity FROM inventory WHERE userID = ? AND itemID = 88`, [userId]);

    if (!robotOil || robotOil.quantity < quantity) {
      return res.status(400).json({ error: 'Not enough Robot Oil in inventory.' });
    }

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // 2. Subtract Robot Oil from inventory
      db.run(`UPDATE inventory SET quantity = quantity - ? WHERE userID = ? AND itemID = 88`, [quantity, userId]);

      // 3. Remove rows where quantity hits 0
      db.run(`DELETE FROM inventory WHERE userID = ? AND itemID = 88 AND quantity <= 0`, [userId]);

      // 4. Insert listing into market
      db.run(`
        INSERT INTO robot_oil_market (seller_id, quantity, price_per_unit)
        VALUES (?, ?, ?)
      `, [userId, quantity, price_per_unit]);

      db.run('COMMIT');

      res.json({ success: true, message: `Listed ${quantity} Robot Oil for ⚡${price_per_unit} each!` });
    });

  } catch (error) {
    console.error('Error in /api/oil/offer-sale:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/api/oil/cancel', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { listing_id, type } = req.body;

  if (!listing_id || !type) {
    return res.status(400).json({ error: 'Listing ID and type are required.' });
  }

  try {
    // Fetch the listing
    db.get(`
      SELECT * FROM robot_oil_market WHERE listing_id = ?
    `, [listing_id], (err, listing) => {
      if (err) {
        console.error('Database error fetching listing:', err);
        return res.status(500).json({ error: 'Database error.' });
      }

      if (!listing) {
        return res.status(404).json({ error: 'Listing not found.' });
      }

      if (listing.seller_id !== userId) {
        return res.status(403).json({ error: 'You do not own this listing.' });
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        if (type === 'sale') {
          // Return oil to user
          db.run(`
            INSERT INTO inventory (userID, itemID, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(userID, itemID) DO UPDATE SET quantity = quantity + excluded.quantity
          `, [userId, 88, listing.quantity]);
        } else if (type === 'purchase') {
          // Refund Volts
          const refundAmount = listing.quantity * listing.price_per_unit;

          db.run(`
            UPDATE economy SET wallet = wallet + ? WHERE userID = ?
          `, [refundAmount, userId]);
        } else {
          db.run('ROLLBACK');
          return res.status(400).json({ error: 'Invalid listing type.' });
        }

        // Delete the listing
        db.run(`
          DELETE FROM robot_oil_market WHERE listing_id = ?
        `, [listing_id]);

        // Log to history
        db.run(`
          INSERT INTO robot_oil_history (event_type, buyer_id, seller_id, quantity, price_per_unit, total_price)
          VALUES ('cancel', ?, ?, ?, ?, ?)
        `, [userId, userId, listing.quantity, listing.price_per_unit, listing.quantity * listing.price_per_unit]);

        db.run('COMMIT');
        res.json({ success: true, message: `✅ Listing canceled and refund issued.` });
      });
    });

  } catch (error) {
    console.error('Error canceling listing:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/api/oil/offer-buy', authenticateToken, (req, res) => {
  const buyerId = req.user.userId;
  const { quantity, price_per_unit } = req.body;

  if (!quantity || !price_per_unit || quantity <= 0 || price_per_unit <= 0) {
    return res.status(400).json({ error: 'Invalid quantity or price.' });
  }

  const totalCost = quantity * price_per_unit;

  db.serialize(() => {
    db.get(`SELECT wallet FROM economy WHERE userID = ?`, [buyerId], (err, user) => {
      if (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({ error: 'Database error.' });
      }

      if (!user || user.wallet < totalCost) {
        return res.status(400).json({ error: 'Not enough ⚡ to create purchase offer.' });
      }

      db.run('BEGIN TRANSACTION');

      db.run(`UPDATE economy SET wallet = wallet - ? WHERE userID = ?`, [totalCost, buyerId]);

      db.run(`
        INSERT INTO robot_oil_market (seller_id, quantity, price_per_unit, type)
        VALUES (?, ?, ?, 'purchase')
      `, [buyerId, quantity, price_per_unit], function (insertErr) {
        if (insertErr) {
          console.error('❌ Failed to insert purchase offer:', insertErr);
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to insert offer.' });
        }

        db.run('COMMIT');
        res.json({ success: true, message: `✅ Bid placed for ⚡${price_per_unit} x ${quantity}` });
      });
    });
  });
});

app.post('/api/oil/market-sell', authenticateToken, async (req, res) => {
  const sellerId = req.user.userId;

  try {
    // 1. Find the highest buy offer
    db.get(`
      SELECT * FROM robot_oil_market 
      WHERE type = 'purchase' 
      ORDER BY price_per_unit DESC 
      LIMIT 1
    `, async (err, offer) => {
      if (err) {
        console.error('Error fetching highest buy offer:', err);
        return res.status(500).json({ error: 'Database error.' });
      }

      if (!offer) {
        return res.status(404).json({ error: 'No buy offers available.' });
      }

      const buyerId = offer.seller_id;
      const price = offer.price_per_unit;
      const availableQuantity = offer.quantity;

      // 2. Check seller inventory
      const robotOil = await dbGet(`SELECT quantity FROM inventory WHERE userID = ? AND itemID = 88`, [sellerId]);
      if (!robotOil || robotOil.quantity < 1) {
        return res.status(400).json({ error: 'Not enough Robot Oil to sell.' });
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // 3. Transfer 1 Robot Oil from seller
        db.run(`UPDATE inventory SET quantity = quantity - 1 WHERE userID = ? AND itemID = 88`, [sellerId]);
        db.run(`DELETE FROM inventory WHERE userID = ? AND itemID = 88 AND quantity <= 0`, [sellerId]);

        // 4. Transfer 1 Robot Oil to buyer
        db.run(`
          INSERT INTO inventory (userID, itemID, quantity)
          VALUES (?, 88, 1)
          ON CONFLICT(userID, itemID) DO UPDATE SET quantity = quantity + 1
        `, [buyerId]);

        // 5. Pay seller
        db.run(`UPDATE economy SET wallet = wallet + ? WHERE userID = ?`, [price, sellerId]);

        // 6. Update or remove the buy listing
        if (availableQuantity > 1) {
          db.run(`UPDATE robot_oil_market SET quantity = quantity - 1 WHERE listing_id = ?`, [offer.listing_id]);
        } else {
          db.run(`DELETE FROM robot_oil_market WHERE listing_id = ?`, [offer.listing_id]);
        }

        // 7. Log it
        db.run(`
          INSERT INTO robot_oil_history (event_type, buyer_id, seller_id, quantity, price_per_unit, total_price)
          VALUES ('market_sell', ?, ?, 1, ?, ?)
        `, [buyerId, sellerId, price, price]);

        db.run('COMMIT');
        res.json({ success: true, message: `✅ Sold 1 barrel for ⚡${price}.` });
      });
    });
  } catch (error) {
    console.error('Error in /api/oil/market-sell:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});



// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
