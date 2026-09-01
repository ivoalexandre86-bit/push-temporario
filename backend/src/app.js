const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { apiLimiter } = require('./middleware/rateLimiters');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const projectRoutes = require('./routes/projects');
const areaRoutes = require('./routes/areas');
const actionRoutes = require('./routes/actions');
const timeEntryRoutes = require('./routes/timeEntries');
const dashboardRoutes = require('./routes/dashboard');
const reportRoutes = require('./routes/reports');
const auditRoutes = require('./routes/audit');
const peopleRoutes = require('./routes/people');
const savedViewRoutes = require('./routes/savedViews');
const meRoutes = require('./routes/me');

const app = express();

app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Lightweight CSRF protection: for cookie-authenticated, state-changing
// requests we require a custom header that a cross-site form post cannot
// set. Bearer-token API clients (no cookie) are exempt.
app.use((req, res, next) => {
  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const usesCookieAuth = !!req.cookies?.projetos_at;
  const isAuthLogin = req.path === '/api/auth/login';
  if (stateChanging && usesCookieAuth && !isAuthLogin) {
    if (req.get('X-Requested-With') !== 'ProjetosApp') {
      return res.status(403).json({ error: 'CSRF_CHECK_FAILED', message: 'Requisição bloqueada por proteção CSRF.' });
    }
  }
  next();
});

app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/areas', areaRoutes);
app.use('/api/actions', actionRoutes);
app.use('/api/time-entries', timeEntryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/people', peopleRoutes);
app.use('/api/saved-views', savedViewRoutes);

app.use('/api', notFoundHandler);

// Optional single-process deployment: if the frontend has been built
// (frontend/dist exists) and SERVE_FRONTEND isn't explicitly disabled,
// serve the SPA from this same Express server so the whole application
// can run behind one origin/port with no separate web server or CORS setup.
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (process.env.SERVE_FRONTEND !== 'false' && fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

app.use(errorHandler);

module.exports = app;
