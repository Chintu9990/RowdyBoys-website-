const express = require('express');
const db = require('../database/db');
const { requireAdmin, logAction } = require('../lib/helpers');
const router = express.Router();

/* ---------- LIST ---------- */
router.get('/', (req, res) => {
  const { status, tournament_id, q, page = 1, limit = 60 } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('m.status=?'); params.push(status); }
  if (tournament_id) { where.push('m.tournament_id=?'); params.push(tournament_id); }
  if (q) { where.push('(ta.name LIKE ? OR tb.name LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`
    SELECT COUNT(*) c FROM matches m
    LEFT JOIN teams ta ON ta.id=m.team_a_id
    LEFT JOIN teams tb ON tb.id=m.team_b_id
    ${w}
  `).get(...params).c;

  const lim = Math.min(parseInt(limit) || 60, 200);
  const off = (Math.max(1, parseInt(page) || 1) - 1) * lim;

  const rows = db.prepare(`
    SELECT m.*,
      ta.name team_a_name, ta.logo team_a_logo,
      tb.name team_b_name, tb.logo team_b_logo,
      tr.name tournament_name,
      r.team_a_rounds, r.team_b_rounds, r.winner_id
    FROM matches m
    LEFT JOIN teams ta ON ta.id=m.team_a_id
    LEFT JOIN teams tb ON tb.id=m.team_b_id
    LEFT JOIN tournaments tr ON tr.id=m.tournament_id
    LEFT JOIN match_results r ON r.match_id=m.id
    ${w} ORDER BY
      CASE m.status WHEN 'LIVE' THEN 0 WHEN 'UPCOMING' THEN 1 WHEN 'POSTPONED' THEN 2 ELSE 3 END,
      m.match_date ASC, m.match_time ASC, m.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, lim, off);

  res.json({ total, page: parseInt(page), limit: lim, matches: rows });
});

/* ---------- SINGLE ---------- */
router.get('/:id', (req, res) => {
  const m = db.prepare(`
    SELECT m.*, 
      ta.name team_a_name, ta.logo team_a_logo, ta.id team_a_id_ref,
      tb.name team_b_name, tb.logo team_b_logo, tb.id team_b_id_ref,
      tr.name tournament_name, tr.mode tournament_mode,
      r.team_a_rounds, r.team_b_rounds, r.winner_id, r.loser_id, r.notes
    FROM matches m
    LEFT JOIN teams ta ON ta.id=m.team_a_id
    LEFT JOIN teams tb ON tb.id=m.team_b_id
    LEFT JOIN tournaments tr ON tr.id=m.tournament_id
    LEFT JOIN match_results r ON r.match_id=m.id
    WHERE m.id=?
  `).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Match not found' });

  m.player_stats = db.prepare(`
    SELECT pms.*, p.name player_name, p.uid player_uid, t.name team_name, t.logo team_logo
    FROM player_match_stats pms
    LEFT JOIN players p ON p.id=pms.player_id
    LEFT JOIN teams t ON t.id=pms.team_id
    WHERE pms.match_id=?
    ORDER BY pms.kills DESC
  `).all(m.id);

  res.json(m);
});

/* ---------- ADMIN CREATE ---------- */
router.post('/', requireAdmin, (req, res) => {
  const { tournament_id, team_a_id, team_b_id, match_date, match_time, match_type, rounds, stage, status } = req.body;
  if (!tournament_id || !team_a_id || !team_b_id) return res.status(400).json({ error: 'Missing fields' });
  const r = db.prepare(`
    INSERT INTO matches (tournament_id, team_a_id, team_b_id, match_date, match_time, match_type, rounds, stage, status)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    tournament_id, team_a_id, team_b_id,
    match_date || null, match_time || null,
    match_type || 'League', rounds || 6, stage || 'League', status || 'UPCOMING'
  );
  logAction(req.session.adminId, 'CREATE_MATCH', `#${r.lastInsertRowid}`);
  res.json({ ok: true, id: r.lastInsertRowid });
});

/* ---------- ADMIN UPDATE ---------- */
router.put('/:id', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const fields = ['team_a_id','team_b_id','match_date','match_time','match_type','rounds','stage','status','tournament_id'];
  const updates = []; const params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(req.body[f]); }
  if (!updates.length) return res.json({ ok: true });
  params.push(m.id);
  db.prepare(`UPDATE matches SET ${updates.join(',')} WHERE id=?`).run(...params);
  logAction(req.session.adminId, 'UPDATE_MATCH', `#${m.id}`);
  res.json({ ok: true });
});

/* ---------- ADMIN DELETE ---------- */
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM matches WHERE id=?').run(req.params.id);
  logAction(req.session.adminId, 'DELETE_MATCH', `#${req.params.id}`);
  res.json({ ok: true });
});

/* ---------- ADMIN SAVE RESULT (recalculated automatically) ---------- */
router.post('/:id/result', requireAdmin, (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const {
    team_a_rounds = 0, team_b_rounds = 0,
    winner_id = null, notes = '',
    player_stats = [], status
  } = req.body;

  const loser_id = winner_id === match.team_a_id ? match.team_b_id
                 : winner_id === match.team_b_id ? match.team_a_id : null;

  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM match_results WHERE match_id=?').get(match.id);
    if (existing) {
      db.prepare(`UPDATE match_results SET team_a_rounds=?, team_b_rounds=?, winner_id=?, loser_id=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE match_id=?`)
        .run(team_a_rounds, team_b_rounds, winner_id, loser_id, notes, match.id);
    } else {
      db.prepare(`INSERT INTO match_results (match_id, team_a_rounds, team_b_rounds, winner_id, loser_id, notes) VALUES (?,?,?,?,?,?)`)
        .run(match.id, team_a_rounds, team_b_rounds, winner_id, loser_id, notes);
    }

    // Re-insert stats from scratch (safe for edits)
    db.prepare('DELETE FROM player_match_stats WHERE match_id=?').run(match.id);
    const ins = db.prepare('INSERT INTO player_match_stats (match_id, player_id, team_id, kills, deaths, rounds_played) VALUES (?,?,?,?,?,?)');
    for (const s of player_stats) {
      if (!s.player_id || !s.team_id) continue;
      ins.run(match.id, s.player_id, s.team_id, s.kills | 0, s.deaths | 0, s.rounds_played | 0);
    }

    const newStatus = status || 'COMPLETED';
    db.prepare('UPDATE matches SET status=? WHERE id=?').run(newStatus, match.id);
  });
  tx();

  logAction(req.session.adminId, 'SAVE_RESULT', `Match #${match.id} → ${status || 'COMPLETED'}`);
  res.json({ ok: true });
});

module.exports = router;