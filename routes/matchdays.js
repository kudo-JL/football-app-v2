const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');

function getEditableSection(leagueId, sectionId, user) {
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

function getViewableSection(leagueId, sectionId, user) {
  const section = db
    .prepare(
      `SELECT s.*, l.is_public AS league_public FROM sections s
       JOIN leagues l ON l.id = s.league_id
       WHERE s.id = ? AND s.league_id = ?`
    )
    .get(sectionId, leagueId);
  if (!section) return null;
  if (section.league_public) return section;
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (auth.canEditLeague(user, league)) return section;
  return null;
}

router.post('/leagues/:leagueId/sections/:sectionId/matchdays/new', auth.requireAuth, (req, res) => {
  const section = getEditableSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const { name } = req.body || {};
  if (!name) return res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}`);
  const max = db.prepare('SELECT COALESCE(MAX("order"), 0) AS m FROM matchdays WHERE section_id = ?').get(section.id);
  const id = auth.newId();
  db.prepare('INSERT INTO matchdays (id, section_id, name, "order") VALUES (?, ?, ?, ?)').run(id, section.id, name, max.m + 1);
  res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}/matchdays/${id}`);
});

router.get('/leagues/:leagueId/sections/:sectionId/matchdays/:id', auth.optionalAuth, (req, res) => {
  const section = getViewableSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('الجولة غير موجودة');
  const matchday = db
    .prepare('SELECT * FROM matchdays WHERE id = ? AND section_id = ?')
    .get(req.params.id, section.id);
  if (!matchday) return res.status(404).send('الجولة غير موجودة');
    const matches = db
    .prepare(
      `SELECT m.*, ht.name AS home_name, ht.short_name AS home_short, ht.color AS home_color, ht.logo AS home_logo,
              at.name AS away_name, at.short_name AS away_short, at.color AS away_color, at.logo AS away_logo
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.matchday_id = ?
       ORDER BY m.scheduled_at ASC, m.created_at ASC`
    )
    .all(matchday.id);
  const teams = db
    .prepare('SELECT id, name, short_name, color FROM teams WHERE section_id = ? ORDER BY name')
    .all(section.id);
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.leagueId);
  const canEdit = auth.canEditLeague(req.user, league);
  res.render('matchdays/show', { title: matchday.name, leagueId: req.params.leagueId, section, matchday, matches, teams, canEdit, user: req.user || null });
});

router.post('/leagues/:leagueId/sections/:sectionId/matchdays/:id/delete', auth.requireAuth, (req, res) => {
  const section = getEditableSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  db.prepare('DELETE FROM matchdays WHERE id = ? AND section_id = ?').run(req.params.id, section.id);
  res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}`);
});

module.exports = router;
