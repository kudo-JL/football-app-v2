const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');
const { recalcTeam } = require('../lib/stats');

// Auth applied per-route below

function getOwnedSection(leagueId, sectionId, user) {
  const section = db
    .prepare(
      `SELECT s.* FROM sections s
       JOIN leagues l ON l.id = s.league_id
       WHERE s.id = ? AND s.league_id = ?`
    )
    .get(sectionId, leagueId);
  if (!section) return null;
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!auth.canEditLeague(user, league)) return null;
  return section;
}

router.get('/leagues/:leagueId/sections/:sectionId/matches/new', auth.requireAuth, (req, res) => {
  const section = getOwnedSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const matchdayId = req.query.matchdayId || '';
  const matchday = matchdayId
    ? db.prepare('SELECT * FROM matchdays WHERE id = ? AND section_id = ?').get(matchdayId, section.id)
    : null;
  const matchdays = db
    .prepare('SELECT id, name FROM matchdays WHERE section_id = ? ORDER BY "order"')
    .all(section.id);
  const teams = db
    .prepare('SELECT id, name, short_name, color FROM teams WHERE section_id = ? ORDER BY name')
    .all(section.id);
  res.render('matches/new', {
    title: 'مباراة جديدة',
    leagueId: req.params.leagueId,
    section,
    matchday,
    matchdays,
    teams,
    error: null,
    form: { matchdayId },
  });
});

router.post('/leagues/:leagueId/sections/:sectionId/matches/new', auth.requireAuth, (req, res) => {
  const section = getOwnedSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const { homeTeamId, awayTeamId, matchdayId, scheduledAt, venue, status, homeScore, awayScore } = req.body || {};
  if (!homeTeamId || !awayTeamId) {
    return res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}/matches/new`);
  }
  if (homeTeamId === awayTeamId) {
    return res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}/matches/new`);
  }
  const id = auth.newId();
  const scheduledIso = scheduledAt ? new Date(scheduledAt).toISOString() : null;
  // Auto-mark as FINISHED if scores were submitted (including draws)
  let finalStatus = status || 'SCHEDULED';
  if (homeScore !== undefined && homeScore !== '' && awayScore !== undefined && awayScore !== '') {
    finalStatus = 'FINISHED';
  }
  db.prepare(
    `INSERT INTO matches (id, home_team_id, away_team_id, matchday_id, scheduled_at, venue, status, home_score, away_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    homeTeamId,
    awayTeamId,
    matchdayId || null,
    scheduledIso,
    venue || '',
    finalStatus,
    parseInt(homeScore) || 0,
    parseInt(awayScore) || 0
  );
  if (status === 'FINISHED') {
    recalcTeam(homeTeamId);
    recalcTeam(awayTeamId);
  }
  res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}/matchdays/${matchdayId || ''}`);
});

router.get('/leagues/:leagueId/sections/:sectionId/matches/:id/edit', auth.requireAuth, (req, res) => {
  const section = getOwnedSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const match = db
    .prepare('SELECT * FROM matches WHERE id = ? AND (home_team_id IN (SELECT id FROM teams WHERE section_id = ?))')
    .get(req.params.id, section.id);
  if (!match) return res.status(404).send('المباراة غير موجودة');
  const teams = db
    .prepare('SELECT id, name, short_name, color FROM teams WHERE section_id = ? ORDER BY name')
    .all(section.id);
  const matchdays = db
    .prepare('SELECT id, name FROM matchdays WHERE section_id = ? ORDER BY "order"')
    .all(section.id);
  const homeTeam = teams.find(t => t.id === match.home_team_id) || null;
  const awayTeam = teams.find(t => t.id === match.away_team_id) || null;
  res.render('matches/edit', {
    title: 'تعديل مباراة',
    leagueId: req.params.leagueId,
    section,
    match,
    matchdays,
    teams,
    homeTeam,
    awayTeam,
    error: null,
    saved: req.query.saved || null,
  });
});

router.post('/leagues/:leagueId/sections/:sectionId/matches/:id/edit', auth.requireAuth, (req, res) => {
  const section = getOwnedSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const { homeTeamId, awayTeamId, matchdayId, scheduledAt, venue, status, homeScore, awayScore, redirect } = req.body || {};
  if (!homeTeamId || !awayTeamId) {
    return res.status(400).send('الفريقان المضيف والضيف مطلوبان');
  }
  if (homeTeamId === awayTeamId) {
    return res.status(400).send('لا يمكن أن يلعب الفريق ضد نفسه');
  }
  const existing = db.prepare('SELECT home_team_id, away_team_id FROM matches WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).send('المباراة غير موجودة');
  const scheduledIso = scheduledAt ? new Date(scheduledAt).toISOString() : null;
  // Auto-mark as FINISHED if scores were submitted (including draws 0-0, 1-1, etc.)
  let finalStatus = status || 'SCHEDULED';
  if (homeScore !== undefined && homeScore !== '' && awayScore !== undefined && awayScore !== '') {
    finalStatus = 'FINISHED';
  }
  db.prepare(
    `UPDATE matches SET home_team_id=?, away_team_id=?, matchday_id=?, scheduled_at=?, venue=?, status=?, home_score=?, away_score=?, updated_at=datetime('now') WHERE id=?`
  ).run(homeTeamId, awayTeamId, matchdayId || null, scheduledIso, venue || '', finalStatus, parseInt(homeScore) || 0, parseInt(awayScore) || 0, req.params.id);
  recalcTeam(existing.home_team_id);
  recalcTeam(existing.away_team_id);
  if (homeTeamId !== existing.home_team_id) recalcTeam(homeTeamId);
  if (awayTeamId !== existing.away_team_id) recalcTeam(awayTeamId);

  // Redirect: form-provided `redirect` param wins, then Referer, then default (matchday or section)
  let target = redirect;
  if (!target) {
    const referer = req.headers.referer;
    if (referer && referer.includes('/matches/') && !referer.includes('/edit')) {
      target = referer;  // came from the matchday page
    }
  }
  if (!target) {
    target = matchdayId
      ? `/leagues/${req.params.leagueId}/sections/${section.id}/matchdays/${matchdayId}?saved=1`
      : `/leagues/${req.params.leagueId}/sections/${section.id}?saved=1`;
  }
  res.redirect(target);
});

router.post('/leagues/:leagueId/sections/:sectionId/matches/:id/delete', auth.requireAuth, (req, res) => {
  const section = getOwnedSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const m = db.prepare('SELECT home_team_id, away_team_id FROM matches WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM matches WHERE id = ?').run(req.params.id);
  if (m) {
    recalcTeam(m.home_team_id);
    recalcTeam(m.away_team_id);
  }
  res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}`);
});

// Clear the result of a match (keep the match, reset scores to 0 + status SCHEDULED)
router.post('/leagues/:leagueId/sections/:sectionId/matches/:id/clear', auth.requireAuth, (req, res) => {
  const section = getOwnedSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const m = db.prepare('SELECT home_team_id, away_team_id, matchday_id FROM matches WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).send('المباراة غير موجودة');
  db.prepare(`UPDATE matches SET home_score=0, away_score=0, status='SCHEDULED', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  recalcTeam(m.home_team_id);
  recalcTeam(m.away_team_id);
  // Redirect back to the matchday page (or section)
  const target = m.matchday_id
    ? `/leagues/${req.params.leagueId}/sections/${section.id}/matchdays/${m.matchday_id}`
    : `/leagues/${req.params.leagueId}/sections/${section.id}`;
  res.redirect(target);
});

module.exports = router;
