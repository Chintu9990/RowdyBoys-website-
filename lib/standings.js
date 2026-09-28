const db = require('../database/db');

function getScoringRules(tournamentId) {
  let r = db.prepare('SELECT * FROM scoring_rules WHERE tournament_id=?').get(tournamentId);
  if (!r) {
    r = {
      tournament_id: tournamentId,
      win_points: 3, draw_points: 1, loss_points: 0, kill_points: 0,
      rank_order: '["points","wins","rd","kills"]'
    };
  }
  try { r.rank_order = JSON.parse(r.rank_order); }
  catch { r.rank_order = ['points', 'wins', 'rd', 'kills']; }
  return r;
}

/**
 * Compute standings from SCRATCH every time from stored COMPLETED matches.
 * This guarantees that editing an old result never duplicates points.
 */
function computeStandings(tournamentId) {
  const rules = getScoringRules(tournamentId);
  const teams = db.prepare(
    "SELECT * FROM teams WHERE tournament_id=? AND status='approved'"
  ).all(tournamentId);

  const map = new Map();
  for (const t of teams) {
    map.set(t.id, {
      team_id: t.id, name: t.name, logo: t.logo, type: t.type,
      played: 0, wins: 0, losses: 0, draws: 0,
      kills: 0, rounds_won: 0, rounds_lost: 0, rd: 0, points: 0, rank: 0
    });
  }

  const matches = db.prepare(
    "SELECT * FROM matches WHERE tournament_id=? AND status='COMPLETED'"
  ).all(tournamentId);

  const getKills = db.prepare(
    'SELECT COALESCE(SUM(kills),0) k FROM player_match_stats WHERE match_id=? AND team_id=?'
  );

  for (const m of matches) {
    const res = db.prepare('SELECT * FROM match_results WHERE match_id=?').get(m.id);
    if (!res) continue;
    const A = map.get(m.team_a_id);
    const B = map.get(m.team_b_id);
    if (!A || !B) continue;

    const kA = getKills.get(m.id, m.team_a_id).k;
    const kB = getKills.get(m.id, m.team_b_id).k;

    A.played++; B.played++;
    A.kills += kA; B.kills += kB;
    A.rounds_won  += res.team_a_rounds; A.rounds_lost += res.team_b_rounds;
    B.rounds_won  += res.team_b_rounds; B.rounds_lost += res.team_a_rounds;

    if (res.winner_id === m.team_a_id) {
      A.wins++; B.losses++;
      A.points += rules.win_points  + kA * rules.kill_points;
      B.points += rules.loss_points + kB * rules.kill_points;
    } else if (res.winner_id === m.team_b_id) {
      B.wins++; A.losses++;
      B.points += rules.win_points  + kB * rules.kill_points;
      A.points += rules.loss_points + kA * rules.kill_points;
    } else {
      A.draws++; B.draws++;
      A.points += rules.draw_points + kA * rules.kill_points;
      B.points += rules.draw_points + kB * rules.kill_points;
    }
  }

  const arr = [...map.values()];
  arr.forEach(s => { s.rd = s.rounds_won - s.rounds_lost; });

  const keyMap = { points:'points', wins:'wins', rd:'rd', kills:'kills', losses:'losses', played:'played' };
  const order = (rules.rank_order || []).map(k => keyMap[k] || k);

  arr.sort((a, b) => {
    for (const k of order) {
      const dir = k === 'losses' ? 1 : -1;   // losses: lower is better
      const diff = (a[k] || 0) - (b[k] || 0);
      if (diff !== 0) return diff * dir;
    }
    return a.name.localeCompare(b.name);
  });
  arr.forEach((s, i) => { s.rank = i + 1; });
  return arr;
}

module.exports = { computeStandings, getScoringRules };