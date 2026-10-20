require('dotenv').config();
const { assertProductionConfig } = require('./config');
const { startLocalDb, prepareLocalDb } = require('./db/localDb');

// Fail fast (before opening the port) when required production secrets are
// missing or still set to development placeholders.
try {
  assertProductionConfig();
} catch (err) {
  console.error(`[server] ${err.message}`);
  process.exit(1);
}

const PORT = process.env.PORT || 4000;

async function main() {
  // Sem DATABASE_URL (uso local): sobe o banco embutido antes de carregar o
  // app, que abre a conexão ao ser importado. No Render nada muda.
  const localDb = await startLocalDb();
  if (localDb) await prepareLocalDb(localDb);

  const app = require('./app');
  app.listen(PORT, () => {
    console.log(`[server] Projetos API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('[server] falha ao iniciar:', err);
  process.exit(1);
});
