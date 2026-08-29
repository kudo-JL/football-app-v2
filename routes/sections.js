const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../lib/db');
const auth = require('../lib/auth');
const { recalcSection, standings } = require('../lib/stats');

/**
 * Get a league the user is allowed to view. Returns null if not found or not viewable.
 * Public leagues are viewable by anyone. Private leagues require owner OR admin.
 */
function getViewableLeague(leagueId, user) {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!league) return null;
  if (league.is_public) return league;
  if (auth.canEditLeague(user, league)) return league;
  return null;
}

/**
 * Get a league the user is allowed to edit (owner or admin). Returns null otherwise.
 */
function getEditableLeague(leagueId, user) {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!auth.canEditLeague(user, league)) return null;
  return league;
}

function getSection(leagueId, sectionId) {
  return db
    .prepare('SELECT * FROM sections WHERE id = ? AND league_id = ?')
    .get(sectionId, leagueId);
}

// New section form — owner or admin
router.get('/leagues/:leagueId/sections/new', auth.requireAuth, (req, res) => {
  const league = getEditableLeague(req.params.leagueId, req.user);
  if (!league) return res.status(404).send('الدوري غير موجود');
  res.render('sections/new', { title: 'قسم جديد', league, error: null, form: {} });
});

router.post('/leagues/:leagueId/sections/new', auth.requireAuth, (req, res) => {
  const league = getEditableLeague(req.params.leagueId, req.user);
  if (!league) return res.status(404).send('الدوري غير موجود');
  const { name, notes, order, promoted, relegated } = req.body || {};
  if (!name) {
    return res.render('sections/new', { title: 'قسم جديد', league, error: 'الاسم مطلوب', form: req.body });
  }
  const id = auth.newId();
  db.prepare(
    `INSERT INTO sections (id, league_id, name, notes, "order", promoted_teams_count, relegated_teams_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, league.id, name, notes || '', parseInt(order) || 0, parseInt(promoted) || 0, parseInt(relegated) || 0
  );
  res.redirect(`/leagues/${league.id}/sections/${id}`);
});

// View section (public if league is public)
router.get('/leagues/:leagueId/sections/:id', auth.optionalAuth, (req, res) => {
  const league = getViewableLeague(req.params.leagueId, req.user);
  if (!league) return res.status(404).send('الدوري غير موجود');
  const section = getSection(league.id, req.params.id);
  if (!section) return res.status(404).send('القسم غير موجود');

  const teams = db
    .prepare('SELECT * FROM teams WHERE section_id = ? ORDER BY name')
    .all(section.id);
  const matchdays = db
    .prepare(
      `SELECT *,
              (SELECT COUNT(*) FROM matches WHERE matchday_id = matchdays.id) AS match_count,
              (SELECT COUNT(*) FROM matches WHERE matchday_id = matchdays.id AND status = 'FINISHED') AS finished_count
       FROM matchdays
       WHERE section_id = ?
       ORDER BY "order"`
    )
    .all(section.id);
  const promoted = section.promoted_teams_count || league.promoted_teams_count || 0;
  const relegated = section.relegated_teams_count || league.relegated_teams_count || 0;
  const error = req.query.error || null;
  const generated = req.query.generated || null;
  const canEdit = auth.canEditLeague(req.user, league);
  res.render('sections/show', {
    title: section.name,
    league, section, teams, matchdays, promotedCount: promoted, relegatedCount: relegated,
    error, generated, canEdit, user: req.user || null,
  });
});

// Standings (public if league is public)
router.get('/leagues/:leagueId/sections/:id/standings', auth.optionalAuth, (req, res) => {
  const league = getViewableLeague(req.params.leagueId, req.user);
  if (!league) return res.status(404).send('الدوري غير موجود');
  const section = getSection(league.id, req.params.id);
  if (!section) return res.status(404).send('القسم غير موجود');
  recalcSection(section.id);
  const promoted = section.promoted_teams_count || league.promoted_teams_count || 0;
  const relegated = section.relegated_teams_count || league.relegated_teams_count || 0;
  const formN = Math.max(1, Math.min(20, parseInt(req.query.formN) || 5));
  const { getAdvancedStandings, getRankingEvolution } = require('../lib/standings');
  const { getAdditionalStats } = require('../lib/stats');
  const data = getAdvancedStandings(section.id, formN);
  const evolution = getRankingEvolution(section.id);
  const additionalStats = getAdditionalStats(section.id);
  const markLeg = (arr) => arr.map((t, i) => ({
    ...t,
    is_promoted: i < promoted,
    is_relegated: i >= arr.length - relegated && relegated > 0,
  }));
  const canEdit = auth.canEditLeague(req.user, league);
  res.render('standings/index', {
    title: 'ترتيب ' + section.name,
    league,
    section,
    overall: markLeg(data.overall),
    firstLeg: markLeg(data.firstLeg),
    returnLeg: markLeg(data.returnLeg),
    totalRounds: data.totalRounds,
    halfRounds: data.halfRounds,
    formN: data.formN,
    promotedCount: promoted,
    relegatedCount: relegated,
    evolution: {
      matchdays: evolution.matchdays,
      teams: evolution.teams,
      ranks: Array.from(evolution.ranks.entries()),
    },
    additionalStats,
    canEdit,
    user: req.user || null,
  });
});

// H2H (public if league is public)
router.get('/leagues/:leagueId/sections/:id/h2h', auth.optionalAuth, (req, res) => {
  const league = getViewableLeague(req.params.leagueId, req.user);
  if (!league) return res.status(404).send('الدوري غير موجود');
  const section = getSection(league.id, req.params.id);
  if (!section) return res.status(404).send('القسم غير موجود');

  const teams = db
    .prepare('SELECT id, name, short_name, color, logo FROM teams WHERE section_id = ? ORDER BY name')
    .all(section.id);

  const matches = db
    .prepare(
      `SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score
       FROM matches m
       JOIN matchdays md ON md.id = m.matchday_id
       WHERE md.section_id = ? AND m.status = 'FINISHED'`
    )
    .all(section.id);

  const pairStats = new Map();
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  for (const m of matches) {
    const key = pairKey(m.home_team_id, m.away_team_id);
    if (!pairStats.has(key)) {
      pairStats.set(key, {
        teamA: m.home_team_id < m.away_team_id ? m.home_team_id : m.away_team_id,
        teamB: m.home_team_id < m.away_team_id ? m.away_team_id : m.home_team_id,
        matches: 0,
        aWins: 0, bWins: 0, draws: 0,
        aGoals: 0, bGoals: 0,
      });
    }
    const p = pairStats.get(key);
    p.matches += 1;
    const isHomeA = m.home_team_id === p.teamA;
    const aScore = isHomeA ? m.home_score : m.away_score;
    const bScore = isHomeA ? m.away_score : m.home_score;
    p.aGoals += aScore;
    p.bGoals += bScore;
    if (aScore > bScore) p.aWins += 1;
    else if (bScore > aScore) p.bWins += 1;
    else p.draws += 1;
  }

  const pairs = Array.from(pairStats.values())
    .map(p => ({
      ...p,
      teamA: teams.find(t => t.id === p.teamA),
      teamB: teams.find(t => t.id === p.teamB),
    }))
    .sort((a, b) => b.matches - a.matches || a.teamA.name.localeCompare(b.teamB.name));

  res.render('sections/h2h', { title: 'المواجهات المباشرة - ' + section.name, league, section, teams, pairs, canEdit: auth.canEditLeague(req.user, league), user: req.user || null });
});

// Edit — owner or admin
router.get('/leagues/:leagueId/sections/:id/edit', auth.requireAuth, (req, res) => {
  const league = getEditableLeague(req.params.leagueId, req.user);
  if (!league) return res.status(404).send('الدوري غير موجود');
  const section = getSection(league.id, req.params.id);
  if (!section) return res.status(404).send('القسم غير موجود');
  res.render('sections/edit', { title: 'تعديل ' + section.name, league, section, error: null });
});

router.post('/leagues/:leagueId/sections/:id/edit', auth.requireAuth, (req, res) => {
  const league = getEditableLeague(req.params.leagueId, req.user);
  if (!league) return res.status(404).send('الدوري غير موجود');
  const section = getSection(league.id, req.params.id);
  if (!section) return res.status(404).send('القسم غير موجود');
  const { name, notes, order, promoted, relegated } = req.body || {};
  db.prepare(
    `UPDATE sections SET name=?, notes=?, "order"=?, promoted_teams_count=?, relegated_teams_count=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, notes || '', parseInt(order) || 0, parseInt(promoted) || 0, parseInt(relegated) || 0, section.id);
  res.redirect(`/leagues/${league.id}/sections/${section.id}`);
});

router.post('/leagues/:leagueId/sections/:id/delete', auth.requireAuth, (req, res) => {
  const league = getEditableLeague(req.params.leagueId, req.user);
  if (!league) return res.status(404).send('الدوري غير موجود');
  db.prepare('DELETE FROM sections WHERE id = ? AND league_id = ?').run(req.params.id, league.id);
  res.redirect(`/leagues/${league.id}`);
});

// Bulk delete: all matchdays + matches + reset team stats
router.post('/leagues/:leagueId/sections/:id/reset-matches', auth.requireAuth, (req, res) => {
  const league = getEditableLeague(req.params.leagueId, req.user);
  if (!league) return res.status(404).send('الدوري غير موجود');
  const section = getSection(league.id, req.params.id);
  if (!section) return res.status(404).send('القسم غير موجود');

  const confirm = (req.body.confirm || '').toString().toUpperCase();
  if (confirm !== 'DELETE') {
    return res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}?error=${encodeURIComponent('اكتب DELETE للتأكيد')}`);
  }

  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM matches WHERE home_team_id IN (SELECT id FROM teams WHERE section_id = ?)`).run(section.id);
    db.prepare(`DELETE FROM matches WHERE away_team_id IN (SELECT id FROM teams WHERE section_id = ?)`).run(section.id);
    db.prepare(`DELETE FROM matchdays WHERE section_id = ?`).run(section.id);
    db.prepare(`UPDATE teams SET played=0, won=0, drawn=0, lost=0, goals_for=0, goals_against=0, points=0 WHERE section_id = ?`).run(section.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.redirect(`/leagues/${league.id}/sections/${section.id}?generated=reset`);
});

module.exports = router;
