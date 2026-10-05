require('dotenv').config();
const { assertProductionConfig } = require('./config');

// Fail fast (before opening the port) when required production secrets are
// missing or still set to development placeholders.
try {
  assertProductionConfig();
} catch (err) {
  console.error(`[server] ${err.message}`);
  process.exit(1);
}

const app = require('./app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`[server] Projetos API listening on http://localhost:${PORT}`);
});
