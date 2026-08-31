/**
 * Players — CRUD for team rosters.
 */
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');

// Auth applied per-route below

// Helper: ownership (owner or admin)
function getOwnedTeam(leagueId, sectionId, teamId, user) {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!auth.canEditLeague(user, league)) return null;
  const section = db
    .prepare('SELECT * FROM sections WHERE id = ? AND league_id = ?')
    .get(sectionId, league.id);
  if (!section) return null;
  const team = db
    .prepare('SELECT * FROM teams WHERE id = ? AND section_id = ?')
    .get(teamId, section.id);
  if (!team) return null;
  return { league, section, team };
}

// List players of a team
router.get('/leagues/:leagueId/sections/:sectionId/teams/:teamId/players', auth.requireAuth, (req, res) => {
  const ctx = getOwnedTeam(req.params.leagueId, req.params.sectionId, req.params.teamId, req.user);
  if (!ctx) return res.status(404).send('الفريق غير موجود');
  const players = db
    .prepare('SELECT * FROM players WHERE team_id = ? ORDER BY jersey_number IS NULL, jersey_number ASC, name ASC')
    .all(ctx.team.id);
  res.render('players/index', {
    title: 'لاعبو ' + ctx.team.name,
    leagueId: req.params.leagueId,
    section: ctx.section,
    team: ctx.team,
    players,
    error: null,
  });
});

// New player form
router.get('/leagues/:leagueId/sections/:sectionId/teams/:teamId/players/new', auth.requireAuth, (req, res) => {
  const ctx = getOwnedTeam(req.params.leagueId, req.params.sectionId, req.params.teamId, req.user);
  if (!ctx) return res.status(404).send('الفريق غير موجود');
  res.render('players/new', {
    title: 'لاعب جديد',
    leagueId: req.params.leagueId,
    section: ctx.section,
    team: ctx.team,
    error: null,
    form: {},
  });
});

// Create player
router.post('/leagues/:leagueId/sections/:sectionId/teams/:teamId/players/new', auth.requireAuth, (req, res) => {
  const ctx = getOwnedTeam(req.params.leagueId, req.params.sectionId, req.params.teamId, req.user);
  if (!ctx) return res.status(404).send('الفريق غير موجود');
  const { name, jerseyNumber, birthDate, position, photo, notes } = req.body || {};
  if (!name || !name.trim()) {
    return res.render('players/new', {
      title: 'لاعب جديد',
      leagueId: req.params.leagueId,
      section: ctx.section,
      team: ctx.team,
      error: 'الاسم مطلوب',
      form: req.body,
    });
  }
  const id = auth.newId();
  db.prepare(
    `INSERT INTO players (id, team_id, name, jersey_number, birth_date, position, photo, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    ctx.team.id,
    name.trim(),
    jerseyNumber ? parseInt(jerseyNumber) : null,
    birthDate || null,
    position || 'MID',
    photo || '',
    notes || ''
  );
  res.redirect(`/leagues/${req.params.leagueId}/sections/${ctx.section.id}/teams/${ctx.team.id}/players`);
});

// Edit player form
router.get('/leagues/:leagueId/sections/:sectionId/teams/:teamId/players/:id/edit', auth.requireAuth, (req, res) => {
  const ctx = getOwnedTeam(req.params.leagueId, req.params.sectionId, req.params.teamId, req.user);
  if (!ctx) return res.status(404).send('الفريق غير موجود');
  const player = db.prepare('SELECT * FROM players WHERE id = ? AND team_id = ?').get(req.params.id, ctx.team.id);
  if (!player) return res.status(404).send('اللاعب غير موجود');
  res.render('players/edit', {
    title: 'تعديل ' + player.name,
    leagueId: req.params.leagueId,
    section: ctx.section,
    team: ctx.team,
    player,
    error: null,
  });
});

// Update player
router.post('/leagues/:leagueId/sections/:sectionId/teams/:teamId/players/:id/edit', auth.requireAuth, (req, res) => {
  const ctx = getOwnedTeam(req.params.leagueId, req.params.sectionId, req.params.teamId, req.user);
  if (!ctx) return res.status(404).send('الفريق غير موجود');
  const player = db.prepare('SELECT * FROM players WHERE id = ? AND team_id = ?').get(req.params.id, ctx.team.id);
  if (!player) return res.status(404).send('اللاعب غير موجود');
  const { name, jerseyNumber, birthDate, position, photo, notes } = req.body || {};
  if (!name || !name.trim()) {
    return res.render('players/edit', {
      title: 'تعديل ' + player.name,
      leagueId: req.params.leagueId,
      section: ctx.section,
      team: ctx.team,
      player,
      error: 'الاسم مطلوب',
    });
  }
  db.prepare(
    `UPDATE players SET name=?, jersey_number=?, birth_date=?, position=?, photo=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    name.trim(),
    jerseyNumber ? parseInt(jerseyNumber) : null,
    birthDate || null,
    position || 'MID',
    photo || '',
    notes || '',
    player.id
  );
  res.redirect(`/leagues/${req.params.leagueId}/sections/${ctx.section.id}/teams/${ctx.team.id}/players`);
});

// Delete player
router.post('/leagues/:leagueId/sections/:sectionId/teams/:teamId/players/:id/delete', auth.requireAuth, (req, res) => {
  const ctx = getOwnedTeam(req.params.leagueId, req.params.sectionId, req.params.teamId, req.user);
  if (!ctx) return res.status(404).send('الفريق غير موجود');
  db.prepare('DELETE FROM players WHERE id = ? AND team_id = ?').run(req.params.id, ctx.team.id);
  res.redirect(`/leagues/${req.params.leagueId}/sections/${ctx.section.id}/teams/${ctx.team.id}/players`);
});

module.exports = router;
