// Banco local embutido (modo "abre e usa", como o app de orçamento).
//
// Quando o sistema roda neste computador sem DATABASE_URL configurada, em
// vez de exigir um PostgreSQL instalado, sobe um Postgres embutido (PGlite,
// WASM, sem instalação) gravando os dados numa pasta local e o expõe numa
// porta TCP só em 127.0.0.1. O resto do backend continua falando com ele
// pelo driver `pg` normal, exatamente como fala com o Postgres do Render.
//
// Em produção (NODE_ENV=production) ou com DATABASE_URL definida, nada aqui
// é executado: o Render continua usando o banco gerenciado projetos-db.
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Pasta dos dados locais. Fica FORA da pasta do projeto (que está no
 * OneDrive) para a sincronização não corromper os arquivos do banco.
 */
function localDataDir() {
  if (process.env.LOCAL_DB_DIR) return process.env.LOCAL_DB_DIR;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'SistemaGestaoProjetos', 'banco-local');
}

function shouldUseLocalDb(env = process.env) {
  return !env.DATABASE_URL && env.NODE_ENV !== 'production';
}

/**
 * Sobe o banco embutido (se aplicável) e aponta DATABASE_URL para ele.
 * Deve ser chamado antes de qualquer require de './connection'.
 * Retorna { dataDir, created } ou null quando o banco local não é usado.
 */
async function startLocalDb() {
  if (!shouldUseLocalDb()) return null;

  let PGlite;
  let PGLiteSocketServer;
  try {
    ({ PGlite } = require('@electric-sql/pglite'));
    ({ PGLiteSocketServer } = require('@electric-sql/pglite-socket'));
  } catch (err) {
    throw new Error(
      'Banco local indisponível: rode "npm install" na pasta backend (sem NODE_ENV=production) ou defina DATABASE_URL.'
    );
  }

  const dataDir = localDataDir();
  const created = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  fs.mkdirSync(dataDir, { recursive: true });

  const pglite = new PGlite(dataDir);
  await pglite.waitReady;
  const socketServer = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await socketServer.start();
  const [host, port] = socketServer.getServerConn().split(':');

  process.env.DATABASE_URL = `postgres://postgres:postgres@${host}:${port}/postgres`;
  process.env.PGSSLMODE = 'disable';

  const shutdown = async () => {
    await socketServer.stop().catch(() => {});
    await pglite.close().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  console.log(`[db] banco local embutido em ${dataDir}${created ? ' (novo)' : ''}`);
  return { dataDir, created };
}

/**
 * Deixa o banco local pronto para uso: aplica as migrations e, na primeira
 * vez, cria papéis/usuários de demonstração e importa a planilha original
 * (backend/data/seed/PROJETOS.xlsx) como dados iniciais.
 */
async function prepareLocalDb({ created }) {
  await require('./migrate').run();
  await require('./seed').run();
  if (created) {
    const seedFile = path.join(__dirname, '..', '..', 'data', 'seed', 'PROJETOS.xlsx');
    if (fs.existsSync(seedFile)) await require('../../scripts/import-xlsx').run();
  }
}

module.exports = { localDataDir, shouldUseLocalDb, startLocalDb, prepareLocalDb };
