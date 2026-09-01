// Simple, dependency-free migration runner.
// Applies every .sql file in ./migrations, in filename order, exactly once,
// tracked via the schema_migrations table.
const fs = require('fs');
const path = require('path');
const db = require('./connection');

async function ensureMigrationsTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);
}

async function run() {
  await ensureMigrationsTable();
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await db.all('SELECT id FROM schema_migrations')).map((r) => r.id));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skip (already applied): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`[migrate] applying: ${file}`);
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.run('INSERT INTO schema_migrations (id) VALUES (?) ON CONFLICT (id) DO NOTHING', file);
    });
  }
  console.log('[migrate] done.');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => { console.error('[migrate] failed:', err); process.exit(1); });
}

module.exports = { run };
