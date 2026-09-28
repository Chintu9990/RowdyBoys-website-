const express = require('express');
const db = require('../database/db');
const { requireAdmin, logAction } = require('../lib/helpers');
const { computeStandings, getScoringRules } = require('../lib/standings');
const router = express.Router();

/* ---------- PUBLIC LIST ---------- */
router.get('/', (req, res) => {
  const { status, q } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('status=?'); params.push(status); }
  if (q) { where.push('(name LIKE ? OR game LIKE ?)'); params.push('%'+q+'%', '%'+q+'%'); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM tournaments ${w} ORDER BY id DESC`).all(...params);
  const countStmt = db.prepare("SELECT COUNT(*) c FROM teams WHERE tournament_id=? AND status='approved'");
  rows.forEach(r => r.team_count = countStmt.get(r.id).c);
  res.json(rows);
});

/* ---------- SINGLE ---------- */
router.get('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  t.team_count = db.prepare("SELECT COUNT(*) c FROM teams WHERE tournament_id=? AND status='approved'").get(t.id).c;
  t.pending_count = db.prepare("SELECT COUNT(*) c FROM teams WHERE tournament_id=? AND status='pending'").get(t.id).c;
  t.scoring = getScoringRules(t.id);
  res.json(t);
});

/* ---------- ADMIN: CREATE ---------- */
router.post('/', requireAdmin, (req, res) => {
  const { name, game, mode, format, entry_fee, prize_pool, start_date, reg_deadline, max_teams, status, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = db.prepare(`INSERT INTO tournaments
    (name, game, mode, format, entry_fee, prize_pool, start_date, reg_deadline, max_teams, status, description)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    name, game || 'Free Fire', mode || 'squad', format || 'league',
    entry_fee || 0, prize_pool || 0, start_date || null, reg_deadline || null,
    max_teams || 25, status || 'registration_open', description || ''
  );
  logAction(req.session.adminId, 'CREATE_TOURNAMENT', `#${r.lastInsertRowid} ${name}`);
  res.json({ ok: true, id: r.lastInsertRowid });
});

/* ---------- ADMIN: UPDATE ---------- */
router.put('/:id', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const fields = ['name','game','mode','format','entry_fee','prize_pool','start_date','reg_deadline','max_teams','status','description'];
  const updates = [];
  const params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(req.body[f]); }
  if (!updates.length) return res.json({ ok: true });
  params.push(t.id);
  db.prepare(`UPDATE tournaments SET ${updates.join(',')} WHERE id=?`).run(...params);
  logAction(req.session.adminId, 'UPDATE_TOURNAMENT', `#${t.id}`);
  res.json({ ok: true });
});

/* ---------- ADMIN: DELETE ---------- */
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tournaments WHERE id=?').run(req.params.id);
  logAction(req.session.adminId, 'DELETE_TOURNAMENT', `#${req.params.id}`);
  res.json({ ok: true });
});

/* ---------- STANDINGS ---------- */
router.get('/:id/standings', (req, res) => {
  res.json(computeStandings(parseInt(req.params.id)));
});

/* ---------- SCORING RULES ---------- */
router.get('/:id/scoring', (req, res) => res.json(getScoringRules(parseInt(req.params.id))));

router.put('/:id/scoring', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { win_points, draw_points, loss_points, kill_points, rank_order } = req.body;
  const orderJson = Array.isArray(rank_order) ? JSON.stringify(rank_order) : (rank_order || '["points","wins","rd","kills"]');
  const existing = db.prepare('SELECT id FROM scoring_rules WHERE tournament_id=?').get(id);
  if (existing) {
    db.prepare(`UPDATE scoring_rules SET win_points=?, draw_points=?, loss_points=?, kill_points=?, rank_order=? WHERE tournament_id=?`)
      .run(win_points, draw_points, loss_points, kill_points, orderJson, id);
  } else {
    db.prepare(`INSERT INTO scoring_rules (tournament_id, win_points, draw_points, loss_points, kill_points, rank_order) VALUES (?,?,?,?,?,?)`)
      .run(id, win_points, draw_points, loss_points, kill_points, orderJson);
  }
  logAction(req.session.adminId, 'UPDATE_SCORING', `Tournament ${id}`);
  res.json({ ok: true });
});

/* ---------- PRIZES ---------- */
router.get('/:id/prizes', (req, res) => {
  res.json(db.prepare('SELECT * FROM prizes WHERE tournament_id=? ORDER BY position').all(req.params.id));
});

router.post('/:id/prizes', requireAdmin, (req, res) => {
  const { position, reward, amount } = req.body;
  const r = db.prepare('INSERT INTO prizes (tournament_id, position, reward, amount) VALUES (?,?,?,?)')
    .run(req.params.id, position || 1, reward || '', amount || 0);
  logAction(req.session.adminId, 'ADD_PRIZE', `Tournament ${req.params.id} pos ${position}`);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.put('/:id/prizes/:prizeId', requireAdmin, (req, res) => {
  const { position, reward, amount, claimed } = req.body;
  db.prepare('UPDATE prizes SET position=?, reward=?, amount=?, claimed=? WHERE id=? AND tournament_id=?')
    .run(position, reward, amount, claimed ? 1 : 0, req.params.prizeId, req.params.id);
  logAction(req.session.adminId, 'UPDATE_PRIZE', `Prize ${req.params.prizeId}`);
  res.json({ ok: true });
});

router.delete('/:id/prizes/:prizeId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM prizes WHERE id=?').run(req.params.prizeId);
  logAction(req.session.adminId, 'DELETE_PRIZE', `Prize ${req.params.prizeId}`);
  res.json({ ok: true });
});

/* ---------- RULES ---------- */
router.get('/:id/rules', (req, res) => {
  res.json(db.prepare('SELECT * FROM tournament_rules WHERE tournament_id=? ORDER BY sort_order, id').all(req.params.id));
});

router.post('/:id/rules', requireAdmin, (req, res) => {
  const { rule_text, sort_order } = req.body;
  if (!rule_text) return res.status(400).json({ error: 'Rule text required' });
  const r = db.prepare('INSERT INTO tournament_rules (tournament_id, rule_text, sort_order) VALUES (?,?,?)')
    .run(req.params.id, rule_text, sort_order || 0);
  logAction(req.session.adminId, 'ADD_RULE', `Tournament ${req.params.id}`);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.delete('/:id/rules/:ruleId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tournament_rules WHERE id=?').run(req.params.ruleId);
  logAction(req.session.adminId, 'DELETE_RULE', `Rule ${req.params.ruleId}`);
  res.json({ ok: true });
});

/* ---------- BRACKET ---------- */
router.get('/:id/bracket', (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, 
      ta.name team_a_name, ta.logo team_a_logo,
      tb.name team_b_name, tb.logo team_b_logo,
      r.team_a_rounds, r.team_b_rounds, r.winner_id
    FROM matches m
    LEFT JOIN teams ta ON ta.id=m.team_a_id
    LEFT JOIN teams tb ON tb.id=m.team_b_id
    LEFT JOIN match_results r ON r.match_id=m.id
    WHERE m.tournament_id=? AND m.stage != 'League'
    ORDER BY m.id
  `).all(req.params.id);
  res.json(rows);
});

module.exports = router;