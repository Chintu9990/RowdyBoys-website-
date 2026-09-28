require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const db = require('./database/db');
const authRoutes = require('./routes/auth');
const tournamentRoutes = require('./routes/tournaments');
const teamRoutes = require('./routes/teams');
const matchRoutes = require('./routes/matches');
const miscRoutes = require('./routes/misc');

const app = express();
const PORT = process.env.PORT || 3000;

// ensure uploads dir exists
fs.mkdirSync(path.join(__dirname, 'public', 'uploads', 'logos'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public', 'uploads', 'payments'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public', 'uploads', 'qr'), { recursive: true });

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-please-change',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

// rate limit all API
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 240 }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api', miscRoutes);

// static
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// Serve uploaded files from persistent disk in production
if (process.env.NODE_ENV === 'production') {
  const BASE = '/opt/render/project/src/storage/uploads';
  app.use('/uploads/logos',    express.static(path.join(BASE, 'logos')));
  app.use('/uploads/payments', express.static(path.join(BASE, 'payments')));
  app.use('/uploads/qr',       express.static(path.join(BASE, 'qr')));
}

// dynamic path fallbacks (serve the right HTML shell; JS reads the id from URL)
const shells = {
  '/tournament': 'tournament.html',
  '/team': 'team.html',
  '/match': 'match.html',
  '/player': 'player.html'
};
Object.entries(shells).forEach(([prefix, file]) => {
  app.get(prefix + '/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
  app.get(prefix + '/:id/:tab', (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
});

// error handler
app.use((err, req, res, next) => {
  console.error('[ERR]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 2MB)' });
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`\n  ⚡ ROWDY BOYS running → http://localhost:${PORT}\n  Admin: /admin\n`);
});
