const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const db = require('../database/db');
const { requireAdmin, logAction } = require('../lib/helpers');
const { computeStandings } = require('../lib/standings');

const router = express.Router();

/* ---------- SECURE UPLOAD ---------- */
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'logos');
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = ALLOWED_EXT.includes(ext) ? ext : '.png';
    cb(null, crypto.randomBytes(14).toString('hex') + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) return cb(new Error('Only JPG/PNG/WEBP/GIF images allowed'));
    cb(null, true);
  }
});

/* ---------- PUBLIC REGISTER ---------- */
router.post('/register', upload.single('logo'), (req, res) => {
  try {
    const { tournament_id, name, type, contact } = req.body;
    let players = [];
    try { players = JSON.parse(req.body.players || '[]'); } catch {}

    if (!tournament_id || !name || !type) return res.status(400).json({ error: 'Missing required fields' });
    if (!['solo', 'duo', 'squad'].includes(type)) return res.status(400).json({ error: 'Invalid team type' });

    const required = { solo: 1, duo: 2, squad: 4 }[type];
    if (!Array.isArray(players) || players.length !== required) {
      return res.status(400).json({ error: `This type requires exactly ${required} player(s)` });
    }
    for (const p of players) {
      if (!p.name || !p.uid) return res.status(400).json({ error: 'Every player needs name and UID' });
    }

    const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(tournament_id);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (t.status !== 'registration_open') return res.status(400).json({ error: 'Registration is closed' });

    if (t.mode && t.mode !== 'any' && t.mode !== type) {
      return res.status(400).json({ error: `This tournament only accepts ${t.mode} teams` });
    }

    const count = db.prepare("SELECT COUNT(*) c FROM teams WHERE tournament_id=? AND status IN ('approved','pending')").get(tournament_id).c;
    if (count >= t.max_teams) return res.status(400).json({ error: 'Tournament is full' });

    const dup = db.prepare('SELECT id FROM teams WHERE tournament_id=? AND LOWER(name)=LOWER(?)').get(tournament_id, name.trim());
    if (dup) return res.status(400).json({ error: 'Team name already registered in this tournament' });

    const logo = req.file ? '/uploads/logos/' + req.file.filename : null;

    const ins = db.transaction(() => {
      const r = db.prepare(
        'INSERT INTO teams (tournament_id, name, type, contact, logo, status) VALUES (?,?,?,?,?,?)'
      ).run(tournament_id, name.trim().slice(0, 80), type, (contact || '').trim().slice(0, 40), logo, 'pending');
      const teamId = r.lastInsertRowid;
      const insP = db.prepare('INSERT INTO players (team_id, name, uid, slot) VALUES (?,?,?,?)');
      players.forEach((p, i) => insP.run(teamId, String(p.name).trim().slice(0, 50), String(p.uid).trim().slice(0, 40), i + 1));
      return teamId;
    });
    const teamId = ins();
    logAction(null, 'TEAM_REGISTERED', `Team #${teamId} ${name} for T#${tournament_id}`);
    res.json({ ok: true, team_id: teamId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---------- PUBLIC LIST ---------- */
router.get('/', (req, res) => {
  const { q, tournament_id, type, status, page = 1, limit = 60 } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('t.name LIKE ?'); params.push('%' + q + '%'); }
  if (tournament_id) { where.push('t.tournament_id=?'); params.push(tournament_id); }
  if (type) { where.push('t.type=?'); params.push(type); }
  if (status) { where.push('t.status=?'); params.push(status); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) c FROM teams t ${w}`).get(...params).c;
  const lim = Math.min(parseInt(limit) || 60, 200);
  const off = (Math.max(1, parseInt(page) || 1) - 1) * lim;

  const rows = db.prepare(`
    SELECT t.*, tr.name tournament_name, tr.mode tournament_mode
    FROM teams t LEFT JOIN tournaments tr ON tr.id=t.tournament_id
    ${w} ORDER BY t.id DESC LIMIT ? OFFSET ?
  `).all(...params, lim, off);

  const pStmt = db.prepare('SELECT * FROM players WHERE team_id=? ORDER BY slot');
  rows.forEach(r => r.players = pStmt.all(r.id));

  res.json({ total, page: parseInt(page), limit: lim, teams: rows });
});

/* ---------- SINGLE TEAM ---------- */
router.get('/:id', (req, res) => {
  const team = db.prepare(`
    SELECT t.*, tr.name tournament_name, tr.mode tournament_mode, tr.id tournament_id
    FROM teams t LEFT JOIN tournaments tr ON tr.id=t.tournament_id WHERE t.id=?
  `).get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  team.players = db.prepare('SELECT * FROM players WHERE team_id=? ORDER BY slot').all(team.id);

  const standings = computeStandings(team.tournament_id);
  const row = standings.find(s => s.team_id === team.id) || null;
  team.stats = row;

  team.matches = db.prepare(`
    SELECT m.*, ta.name team_a_name, tb.name team_b_name,
      r.team_a_rounds, r.team_b_rounds, r.winner_id
    FROM matches m
    LEFT JOIN teams ta ON ta.id=m.team_a_id
    LEFT JOIN teams tb ON tb.id=m.team_b_id
    LEFT JOIN match_results r ON r.match_id=m.id
    WHERE m.tournament_id=? AND (m.team_a_id=? OR m.team_b_id=?)
    ORDER BY m.id DESC LIMIT 30
  `).all(team.tournament_id, team.id, team.id);

  res.json(team);
});

/* ---------- ADMIN: APPROVE / REJECT / EDIT / DELETE ---------- */
router.put('/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['pending','approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE teams SET status=? WHERE id=?').run(status, req.params.id);
  logAction(req.session.adminId, 'TEAM_STATUS', `Team ${req.params.id} → ${status}`);
  res.json({ ok: true });
});

router.put('/:id', requireAdmin, (req, res) => {
  const { name, contact, type } = req.body;
  db.prepare('UPDATE teams SET name=COALESCE(?,name), contact=COALESCE(?,contact), type=COALESCE(?,type) WHERE id=?')
    .run(name ?? null, contact ?? null, type ?? null, req.params.id);
  logAction(req.session.adminId, 'TEAM_UPDATE', `Team ${req.params.id}`);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM teams WHERE id=?').run(req.params.id);
  logAction(req.session.adminId, 'TEAM_DELETE', `Team ${req.params.id}`);
  res.json({ ok: true });
});

module.exports = router;