const express = require('express');
const db = require('../database/db');
const { requireAdmin } = require('../lib/helpers');
const { computeStandings } = require('../lib/standings');
const router = express.Router();

/* ---------- HOMEPAGE DATA ---------- */
router.get('/home', (req, res) => {
  const current = db.prepare(`
    SELECT * FROM tournaments
    ORDER BY CASE status
      WHEN 'started' THEN 0
      WHEN 'registration_open' THEN 1
      WHEN 'registration_closed' THEN 2
      WHEN 'completed' THEN 4
      ELSE 3 END, id DESC LIMIT 1
  `).get();

  if (!current) {
    return res.json({ tournament: null, live: null, next: null, top_teams: [], top_players: [], recent: [] });
  }

  const teamCount = db.prepare("SELECT COUNT(*) c FROM teams WHERE tournament_id=? AND status='approved'").get(current.id).c;

  const live = db.prepare(`
    SELECT m.*, ta.name team_a_name, ta.logo team_a_logo, tb.name team_b_name, tb.logo team_b_logo,
      r.team_a_rounds, r.team_b_rounds
    FROM matches m LEFT JOIN teams ta ON ta.id=m.team_a_id LEFT JOIN teams tb ON tb.id=m.team_b_id
    LEFT JOIN match_results r ON r.match_id=m.id
    WHERE m.tournament_id=? AND m.status='LIVE' LIMIT 1
  `).get(current.id);

  const next = db.prepare(`
    SELECT m.*, ta.name team_a_name, ta.logo team_a_logo, tb.name team_b_name, tb.logo team_b_logo
    FROM matches m LEFT JOIN teams ta ON ta.id=m.team_a_id LEFT JOIN teams tb ON tb.id=m.team_b_id
    WHERE m.tournament_id=? AND m.status='UPCOMING'
    ORDER BY m.match_date ASC, m.match_time ASC, m.id ASC LIMIT 1
  `).get(current.id);

  const standings = computeStandings(current.id);
  const top_teams = standings.slice(0, 5);

  const top_players = db.prepare(`
    SELECT p.id, p.name, p.uid, t.name team_name, t.logo team_logo,
      COUNT(DISTINCT pms.match_id) matches, SUM(pms.kills) kills
    FROM player_match_stats pms
    JOIN players p ON p.id=pms.player_id
    JOIN teams t ON t.id=pms.team_id
    JOIN matches m ON m.id=pms.match_id
    WHERE m.tournament_id=? AND m.status='COMPLETED'
    GROUP BY p.id ORDER BY kills DESC LIMIT 5
  `).all(current.id);

  const recent = db.prepare(`
    SELECT m.id, m.match_date, m.match_time, m.status,
      ta.name team_a_name, ta.logo team_a_logo, tb.name team_b_name, tb.logo team_b_logo,
      r.team_a_rounds, r.team_b_rounds, r.winner_id
    FROM matches m
    LEFT JOIN teams ta ON ta.id=m.team_a_id
    LEFT JOIN teams tb ON tb.id=m.team_b_id
    LEFT JOIN match_results r ON r.match_id=m.id
    WHERE m.tournament_id=? AND m.status='COMPLETED'
    ORDER BY r.updated_at DESC LIMIT 5
  `).all(current.id);

  res.json({
    tournament: { ...current, team_count: teamCount, is_full: teamCount >= current.max_teams },
    live: live || null,
    next: next || null,
    top_teams,
    top_players,
    recent
  });
});

/* ---------- PLAYERS LIST ---------- */
router.get('/players', (req, res) => {
  const { q, tournament_id, page = 1, limit = 60 } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(p.name LIKE ? OR p.uid LIKE ?)'); params.push('%'+q+'%', '%'+q+'%'); }
  if (tournament_id) { where.push('t.tournament_id=?'); params.push(tournament_id); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`
    SELECT COUNT(*) c FROM players p
    JOIN teams t ON t.id=p.team_id
    ${w}
  `).get(...params).c;

  const lim = Math.min(parseInt(limit) || 60, 200);
  const off = (Math.max(1, parseInt(page) || 1) - 1) * lim;

  const rows = db.prepare(`
    SELECT p.id, p.name, p.uid, p.slot, t.id team_id, t.name team_name, t.logo team_logo,
      tr.id tournament_id, tr.name tournament_name,
      (SELECT COALESCE(SUM(kills),0) FROM player_match_stats WHERE player_id=p.id) kills,
      (SELECT COUNT(DISTINCT match_id) FROM player_match_stats WHERE player_id=p.id) matches
    FROM players p
    JOIN teams t ON t.id=p.team_id
    LEFT JOIN tournaments tr ON tr.id=t.tournament_id
    ${w}
    ORDER BY p.id DESC LIMIT ? OFFSET ?
  `).all(...params, lim, off);

  res.json({ total, page: parseInt(page), limit: lim, players: rows });
});

/* ---------- PLAYER PROFILE ---------- */
router.get('/players/:id', (req, res) => {
  const p = db.prepare(`
    SELECT p.*, t.name team_name, t.logo team_logo, t.type team_type,
      tr.id tournament_id, tr.name tournament_name
    FROM players p
    JOIN teams t ON t.id=p.team_id
    LEFT JOIN tournaments tr ON tr.id=t.tournament_id
    WHERE p.id=?
  `).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Player not found' });

  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT pms.match_id) matches,
      COALESCE(SUM(pms.kills),0) kills,
      COALESCE(SUM(pms.deaths),0) deaths,
      COALESCE(SUM(pms.rounds_played),0) rounds_played,
      COALESCE(AVG(pms.kills),0) avg_kills
    FROM player_match_stats pms WHERE pms.player_id=?
  `).get(p.id);

  const wins = db.prepare(`
    SELECT COUNT(*) c FROM match_results r
    JOIN matches m ON m.id=r.match_id
    WHERE r.winner_id = (SELECT team_id FROM players WHERE id=?)
      AND m.status='COMPLETED'
  `).get(p.id).c;

  const recent = db.prepare(`
    SELECT pms.*, m.match_date, m.match_time, m.status,
      ta.name team_a_name, tb.name team_b_name,
      r.winner_id, r.team_a_rounds, r.team_b_rounds
    FROM player_match_stats pms
    JOIN matches m ON m.id=pms.match_id
    LEFT JOIN teams ta ON ta.id=m.team_a_id
    LEFT JOIN teams tb ON tb.id=m.team_b_id
    LEFT JOIN match_results r ON r.match_id=m.id
    WHERE pms.player_id=?
    ORDER BY m.id DESC LIMIT 20
  `).all(p.id);

  res.json({ ...p, stats: { ...stats, wins } , recent });
});

/* ---------- ADMIN: AUDIT LOGS ---------- */
router.get('/admin/logs', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT l.*, a.username admin_name FROM audit_logs l
    LEFT JOIN admins a ON a.id=l.admin_id
    ORDER BY l.id DESC LIMIT 200
  `).all());
});

/* ---------- ADMIN: OVERVIEW ---------- */
router.get('/admin/overview', requireAdmin, (req, res) => {
  res.json({
    tournaments: db.prepare('SELECT COUNT(*) c FROM tournaments').get().c,
    teams: db.prepare('SELECT COUNT(*) c FROM teams').get().c,
    players: db.prepare('SELECT COUNT(*) c FROM players').get().c,
    matches: db.prepare('SELECT COUNT(*) c FROM matches').get().c,
    pending_teams: db.prepare("SELECT COUNT(*) c FROM teams WHERE status='pending'").get().c,
    live_matches: db.prepare("SELECT COUNT(*) c FROM matches WHERE status='LIVE'").get().c
  });
});

module.exports = router;