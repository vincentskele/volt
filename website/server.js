// server.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs'); // Needed to read the console.json file

// Import your Discord bot client so we can fetch usernames
// Make sure ../bot exports something like: module.exports = { client }
const { client } = require('../info-bot'); 

const app = express();
const PORT = process.env.SERVER_PORT || 3000;

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

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
