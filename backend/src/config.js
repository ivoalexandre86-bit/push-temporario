// Central runtime configuration read from environment variables.
//
// Values are read on every call (not cached at require time) so tests can
// toggle NODE_ENV / flags per scenario. In production, required secrets
// must come from the environment - there are no insecure fallbacks.

const DEV_JWT_SECRET = 'dev-insecure-secret-change-me';
const DEV_DEMO_PASSWORD = 'Mudar@123';
const MIN_SECRET_LENGTH = 32;

// Placeholder values shipped in .env.example / older docs. Never accepted
// as a real secret in production.
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  DEV_JWT_SECRET,
  'change-me-to-a-long-random-string',
]);

/** Accounts created by `npm run seed` (src/db/seed.js) for local demo/testing. */
const DEMO_ACCOUNTS = [
  { name: 'Administrador do Sistema', email: 'admin@projetos.local', role: 'ADMIN' },
  { name: 'Gerente de Projetos', email: 'gerente@projetos.local', role: 'PROJECT_MANAGER' },
  { name: 'Colaborador Demo', email: 'colaborador@projetos.local', role: 'CONTRIBUTOR' },
  { name: 'Visualizador Demo', email: 'visualizador@projetos.local', role: 'VIEWER' },
  { name: 'Auditor Demo', email: 'auditor@projetos.local', role: 'AUDITOR' },
];
const DEMO_EMAILS = new Set(DEMO_ACCOUNTS.map((a) => a.email));

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function isDemoEmail(email) {
  return DEMO_EMAILS.has(String(email || '').trim().toLowerCase());
}

/**
 * Demo/seed accounts may sign in everywhere except production. In
 * production they are blocked unless ALLOW_DEMO_LOGIN=true is set
 * explicitly (e.g. temporarily, while real accounts are being created).
 */
function demoLoginAllowed() {
  return !isProduction() || process.env.ALLOW_DEMO_LOGIN === 'true';
}

/** Whether the seed may create the demo accounts in the current environment. */
function demoAccountsSeedAllowed() {
  return !isProduction() || process.env.ALLOW_DEMO_ACCOUNTS === 'true';
}

/** Password for seeded demo accounts. No default in production. */
function demoPassword() {
  if (process.env.SEED_DEMO_PASSWORD) return process.env.SEED_DEMO_PASSWORD;
  return isProduction() ? null : DEV_DEMO_PASSWORD;
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProduction()) {
    throw new Error('JWT_SECRET não definido. Configure a variável de ambiente antes de iniciar em produção.');
  }
  return DEV_JWT_SECRET;
}

/**
 * Validates the configuration required to run in production. Returns the
 * list of problems (empty when everything is fine). Never includes secret
 * values in the messages.
 */
function productionConfigProblems(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];
  const problems = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL não definido.');
  if (!env.JWT_SECRET) {
    problems.push('JWT_SECRET não definido.');
  } else if (env.JWT_SECRET.length < MIN_SECRET_LENGTH || KNOWN_PLACEHOLDER_SECRETS.has(env.JWT_SECRET)) {
    problems.push(`JWT_SECRET inseguro: use um valor aleatório com ao menos ${MIN_SECRET_LENGTH} caracteres.`);
  }
  if (env.ADMIN_MIGRATE_TOKEN && env.ADMIN_MIGRATE_TOKEN.length < MIN_SECRET_LENGTH) {
    problems.push(`ADMIN_MIGRATE_TOKEN muito curto: use ao menos ${MIN_SECRET_LENGTH} caracteres ou remova a variável.`);
  }
  return problems;
}

/** Throws (failing startup) when production configuration is incomplete. */
function assertProductionConfig(env = process.env) {
  const problems = productionConfigProblems(env);
  if (problems.length) {
    throw new Error(`Configuração de produção inválida:\n - ${problems.join('\n - ')}`);
  }
}

module.exports = {
  DEMO_ACCOUNTS,
  DEV_DEMO_PASSWORD,
  MIN_SECRET_LENGTH,
  isProduction,
  isDemoEmail,
  demoLoginAllowed,
  demoAccountsSeedAllowed,
  demoPassword,
  jwtSecret,
  productionConfigProblems,
  assertProductionConfig,
};
