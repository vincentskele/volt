const fs = require('fs');
const os = require('os');
const path = require('path');
const SQLite = require('sqlite3').verbose();
const dbHelpers = require('../db');
const { stableStringify } = require('../ledgerService');

function openDatabase(dbPath) {
  const db = new SQLite.Database(dbPath);
  db.configure('busyTimeout', 5000);
  return db;
}

function createSqlHelpers(database) {
  return {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.run(sql, params, function onRun(error) {
          if (error) return reject(error);
          resolve({ changes: this.changes ?? 0, lastID: this.lastID ?? null });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => {
          if (error) return reject(error);
          resolve(row || null);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        database.close((error) => {
          if (error) return reject(error);
          resolve();
        });
      });
    },
  };
}

function buildDiffSummary(canonicalSnapshot, tamperedSnapshot) {
  const tableNames = Object.keys(canonicalSnapshot || {});
  const diffs = [];

  for (const tableName of tableNames) {
    const canonicalRows = Array.isArray(canonicalSnapshot[tableName]) ? canonicalSnapshot[tableName] : [];
    const tamperedRows = Array.isArray(tamperedSnapshot?.[tableName]) ? tamperedSnapshot[tableName] : [];

    const canonicalMap = new Map(canonicalRows.map((row) => [stableStringify(row), row]));
    const tamperedMap = new Map(tamperedRows.map((row) => [stableStringify(row), row]));

    const onlyCanonical = [];
    const onlyTampered = [];

    for (const [key, row] of canonicalMap.entries()) {
      if (!tamperedMap.has(key)) onlyCanonical.push(row);
    }
    for (const [key, row] of tamperedMap.entries()) {
      if (!canonicalMap.has(key)) onlyTampered.push(row);
    }

    if (onlyCanonical.length || onlyTampered.length) {
      diffs.push({
        table: tableName,
        canonicalCount: canonicalRows.length,
        tamperedCount: tamperedRows.length,
        onlyCanonicalCount: onlyCanonical.length,
        onlyTamperedCount: onlyTampered.length,
        sampleCanonical: onlyCanonical[0] || null,
        sampleTampered: onlyTampered[0] || null,
      });
    }
  }

  return diffs;
}

async function withTamperedCopy(label, mutate) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `volt-tamper-${label}-`));
  const dbPath = path.join(tempDir, 'points.db');
  await fs.promises.copyFile(path.join(process.cwd(), 'points.db'), dbPath);

  const database = openDatabase(dbPath);
  const sql = createSqlHelpers(database);

  try {
    await sql.run('PRAGMA foreign_keys = ON');
    await mutate(sql);
    const projection = await dbHelpers.getProjectionFingerprint(database);
    return { tempDir, dbPath, projection };
  } finally {
    await sql.close();
  }
}

async function main() {
  await dbHelpers.initializeDatabase();
  await dbHelpers.ensureRecoverableProjectionMaintenance();

  const canonical = await dbHelpers.getProjectionFingerprint();

  const scenarios = [
    {
      name: 'wallet-balance-edit',
      description: 'Directly edits a user wallet balance in SQL.',
      mutate: async (sql) => {
        const row = await sql.get(
          `SELECT userID FROM economy WHERE TRIM(COALESCE(userID, '')) != '' ORDER BY userID ASC LIMIT 1`
        );
        await sql.run(`UPDATE economy SET wallet = wallet + 777 WHERE userID = ?`, [row.userID]);
      },
    },
    {
      name: 'inventory-edit',
      description: 'Directly edits an inventory quantity in SQL.',
      mutate: async (sql) => {
        const row = await sql.get(`SELECT userID, itemID FROM inventory ORDER BY userID ASC, itemID ASC LIMIT 1`);
        await sql.run(`UPDATE inventory SET quantity = quantity + 3 WHERE userID = ? AND itemID = ?`, [row.userID, row.itemID]);
      },
    },
    {
      name: 'shop-item-edit',
      description: 'Directly edits a shop item quantity in SQL.',
      mutate: async (sql) => {
        const row = await sql.get(`SELECT itemID FROM items ORDER BY itemID ASC LIMIT 1`);
        await sql.run(`UPDATE items SET quantity = quantity + 5 WHERE itemID = ?`, [row.itemID]);
      },
    },
    {
      name: 'raffle-edit',
      description: 'Directly edits an active raffle prize in SQL.',
      mutate: async (sql) => {
        const row = await sql.get(`SELECT id FROM raffles ORDER BY id ASC LIMIT 1`);
        await sql.run(`UPDATE raffles SET prize = ? WHERE id = ?`, ['tampered-prize', row.id]);
      },
    },
    {
      name: 'giveaway-insert',
      description: 'Directly inserts a synthetic giveaway and entry in SQL.',
      mutate: async (sql) => {
        const giveawayIdRow = await sql.get(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM giveaways`);
        const userRow = await sql.get(
          `SELECT userID FROM economy WHERE TRIM(COALESCE(userID, '')) != '' ORDER BY userID ASC LIMIT 1`
        );
        await sql.run(
          `INSERT INTO giveaways (id, message_id, channel_id, end_time, prize, winners, giveaway_name, repeat, is_completed)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
          [giveawayIdRow.id, `tampered-${giveawayIdRow.id}`, 'tampered-channel', Math.floor(Date.now() / 1000) + 3600, 'tampered-giveaway', 1, 'tampered-giveaway']
        );
        await sql.run(
          `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)`,
          [giveawayIdRow.id, userRow.userID]
        );
      },
    },
    {
      name: 'profile-edit',
      description: 'Directly edits a protected profile field in SQL.',
      mutate: async (sql) => {
        const row = await sql.get(
          `SELECT userID FROM economy
           WHERE TRIM(COALESCE(userID, '')) != ''
             AND profile_location IS NOT NULL
             AND TRIM(COALESCE(profile_location, '')) != ''
           ORDER BY userID ASC LIMIT 1`
        );
        await sql.run(`UPDATE economy SET profile_location = ? WHERE userID = ?`, ['tampered-location', row.userID]);
      },
    },
  ];

  let failures = 0;
  console.log(`Canonical projection fingerprint: ${canonical.fingerprint}`);

  for (const scenario of scenarios) {
    const { projection } = await withTamperedCopy(scenario.name, scenario.mutate);
    const detected = projection.fingerprint !== canonical.fingerprint;
    const diffs = buildDiffSummary(canonical.snapshot, projection.snapshot);

    if (!detected) {
      failures += 1;
    }

    console.log('');
    console.log(`[${detected ? 'PASS' : 'FAIL'}] ${scenario.name}`);
    console.log(`  ${scenario.description}`);
    console.log(`  canonical=${canonical.fingerprint.slice(0, 16)} tampered=${projection.fingerprint.slice(0, 16)}`);
    if (diffs.length) {
      for (const diff of diffs) {
        console.log(
          `  table=${diff.table} canonical=${diff.canonicalCount} tampered=${diff.tamperedCount} ` +
          `onlyCanonical=${diff.onlyCanonicalCount} onlyTampered=${diff.onlyTamperedCount}`
        );
      }
    } else {
      console.log('  no table diff summary was produced');
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`Tamper detection failed for ${failures} scenario(s).`);
    process.exit(1);
  }

  console.log(`All ${scenarios.length} tamper scenarios were detected by the consensus projection check.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
