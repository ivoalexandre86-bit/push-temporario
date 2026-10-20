#!/usr/bin/env node
// Inicia o sistema neste computador com um único comando (`npm start` na
// raiz, ou duplo clique em "Iniciar Sistema.bat").
//
// Não precisa de PostgreSQL instalado nem de .env: o backend usa um banco
// embutido gravado em %LOCALAPPDATA%\SistemaGestaoProjetos\banco-local
// (ver backend/src/db/localDb.js). Este script só:
//   1. instala as dependências quando o package-lock.json muda;
//   2. recompila a interface quando algum arquivo dela muda;
//   3. sobe o servidor em http://localhost:4000 e abre o navegador.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const PORT = process.env.PORT || 4000;
const URL = `http://localhost:${PORT}`;
const openBrowser = !process.argv.includes('--sem-navegador');

function fail(msg) {
  console.error(`\n[ERRO] ${msg}\n`);
  process.exit(1);
}

function step(n, total, msg) {
  console.log(`[${n}/${total}] ${msg}`);
}

function npm(args, cwd) {
  // Ferramentas de build (vite) e o banco embutido são devDependencies.
  const env = { ...process.env, NODE_ENV: 'development' };
  const res = spawnSync('npm', args, { cwd, stdio: 'inherit', shell: true, env });
  return res.status === 0;
}

function lockHash(dir) {
  const file = ['package-lock.json', 'package.json'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function ensureDeps(dir, label) {
  const stamp = path.join(dir, 'node_modules', '.instalado');
  const hash = lockHash(dir);
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === hash) {
    console.log(`      dependências ${label} já instaladas`);
    return;
  }
  console.log(`      instalando dependências ${label} (só demora na primeira vez)...`);
  if (!npm(['install', '--include=dev', '--no-audit', '--no-fund'], dir)) fail(`falha ao instalar as dependências ${label}.`);
  fs.writeFileSync(stamp, hash);
}

function newestMtime(p) {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return fs.readdirSync(p).reduce((max, f) => Math.max(max, newestMtime(path.join(p, f))), 0);
}

function ensureFrontendBuild() {
  const built = newestMtime(path.join(FRONTEND, 'dist', 'index.html'));
  const sources = ['src', 'public', 'index.html', 'vite.config.js', 'package-lock.json']
    .reduce((max, f) => Math.max(max, newestMtime(path.join(FRONTEND, f))), 0);
  if (built && built >= sources) {
    console.log('      interface já está atualizada');
    return;
  }
  console.log('      compilando a interface...');
  if (!npm(['run', 'build'], FRONTEND)) fail('falha ao compilar a interface.');
}

function guardAgainstProductionDb() {
  let url = process.env.DATABASE_URL || '';
  const envFile = path.join(BACKEND, '.env');
  if (!url && fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL=(.*)$/m);
    if (m) url = m[1];
  }
  if (/render\.com/.test(url)) {
    fail('DATABASE_URL aponta para o banco de PRODUÇÃO (Render). Remova a linha DATABASE_URL de backend/.env para usar o banco local.');
  }
}

function waitForHealth(timeoutMs, cb) {
  const started = Date.now();
  const tryOnce = () => {
    http.get(`${URL}/api/health`, (res) => {
      res.resume();
      if (res.statusCode === 200) return cb(true);
      retry();
    }).on('error', retry);
  };
  const retry = () => (Date.now() - started > timeoutMs ? cb(false) : setTimeout(tryOnce, 500));
  tryOnce();
}

function open(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  spawn(cmd, { shell: true, stdio: 'ignore', detached: true }).unref();
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) fail(`Node.js ${process.versions.node} é antigo demais. Instale a versão 20 ou superior em https://nodejs.org`);

console.log('============================================');
console.log('  Sistema de Gestão de Projetos e Ações');
console.log('  uso local (dados só neste computador)');
console.log('============================================\n');

guardAgainstProductionDb();
step(1, 3, 'Verificando dependências...');
ensureDeps(BACKEND, 'do servidor');
ensureDeps(FRONTEND, 'da interface');
step(2, 3, 'Verificando a interface...');
ensureFrontendBuild();
step(3, 3, `Iniciando em ${URL} (feche esta janela para encerrar)...\n`);

const server = spawn(process.execPath, ['src/server.js'], {
  cwd: BACKEND,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT) },
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));

waitForHealth(120000, (ok) => {
  if (!ok) return console.error(`[ERRO] o servidor não respondeu em ${URL}.`);
  console.log(`\nPronto! Acesse ${URL}  (login de teste: admin@projetos.local / Mudar@123)\n`);
  if (openBrowser) open(URL);
});
