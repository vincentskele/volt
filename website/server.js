const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3003;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Default route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ensure the database file is read from the parent directory (../economy.db)
const dbPath = path.join(__dirname, '..', 'economy.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log(`Connected to economy.db at ${dbPath}`);
    }
});

// API endpoint: Get leaderboard data from the economy table
app.get('/api/leaderboard', (req, res) => {
    const query = `
        SELECT userID, wallet, bank, (wallet + bank) AS totalBalance
        FROM economy
        ORDER BY totalBalance DESC
        LIMIT 10
    `;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching leaderboard:', err.message);
            res.status(500).json({ error: 'Failed to fetch leaderboard' });
        } else {
            res.json(rows);
        }
    });
});

// API endpoint: Get admin list from the admins table
app.get('/api/admins', (req, res) => {
    db.all('SELECT * FROM admins', [], (err, rows) => {
        if (err) {
            console.error('Error fetching admins:', err.message);
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// API endpoint: Get shop items from the items table
app.get('/api/shop', (req, res) => {
    db.all('SELECT * FROM items', [], (err, rows) => {
        if (err) {
            console.error('Error fetching shop items:', err.message);
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// API endpoint: Get job list from the joblist table
app.get('/api/jobs', (req, res) => {
    db.all('SELECT * FROM joblist', [], (err, rows) => {
        if (err) {
            console.error('Error fetching jobs:', err.message);
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// API endpoint: Get giveaway list from the giveaways table
app.get('/api/giveaways', (req, res) => {
    db.all('SELECT * FROM giveaways', [], (err, rows) => {
        if (err) {
            console.error('Error fetching giveaways:', err.message);
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Database file used: ${dbPath}`);
});
