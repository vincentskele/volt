process.env.VOLT_SKIP_DB_AUTO_INIT = '1';

const path = require('path');
const dbHelpers = require('../db');

async function main() {
  const [, , command, arg] = process.argv;

  if (!command) {
    throw new Error('Usage: node scripts/ledger-cli.js <verify|verify-events|snapshot-events|export|export-events|import|migrate|replay|rebuild-state|projection-fingerprint> [path]');
  }

  switch (command) {
    case 'verify': {
      const result = await dbHelpers.verifyLedgerIntegrity();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'verify-events': {
      const result = await dbHelpers.verifySystemEventIntegrity();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'snapshot-events': {
      const result = await dbHelpers.snapshotSystemEventState();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'export': {
      const outputPath = path.resolve(arg || path.join(process.cwd(), 'ledger-export.json'));
      const result = await dbHelpers.exportLedger({ outputPath });
      console.log(`Exported ${result.transactions.length} transaction(s) to ${outputPath}`);
      break;
    }
    case 'export-events': {
      const outputPath = path.resolve(arg || path.join(process.cwd(), 'system-events-export.json'));
      const result = await dbHelpers.exportSystemEvents({ outputPath });
      console.log(`Exported ${result.events.length} system event(s) to ${outputPath}`);
      break;
    }
    case 'import': {
      if (!arg) {
        throw new Error('Import requires a file path.');
      }
      const result = await dbHelpers.importLedger(path.resolve(arg));
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'migrate': {
      const result = await dbHelpers.migrateEconomyToLedger();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'replay': {
      const result = await dbHelpers.replayLedger();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'projection-fingerprint': {
      const result = await dbHelpers.getProjectionFingerprint();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'rebuild-state': {
      const outputPath = path.resolve(arg || path.join(process.cwd(), 'points.rebuilt.db'));
      const result = await dbHelpers.rebuildStateMirror(outputPath, { overwrite: true });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    dbHelpers.db.close(() => {});
  });
