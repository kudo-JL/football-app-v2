const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');
const { upload } = require('../lib/upload');
const { recalcTeam } = require('../lib/stats');

/**
 * Get a section in a league the user is allowed to edit.
 */
function getEditableSection(leagueId, sectionId, user) {
  const section = db
    .prepare(
      `SELECT s.*, l.owner_id AS league_owner_id, l.id AS league_id_check
       FROM sections s
       JOIN leagues l ON l.id = s.league_id
       WHERE s.id = ? AND s.league_id = ?`
    )
    .get(sectionId, leagueId);
  if (!section) return null;
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!auth.canEditLeague(user, league)) return null;
  return section;
}

const PRESET_COLORS = [
  '#dc2626', '#2563eb', '#16a34a', '#eab308', '#ea580c',
  '#9333ea', '#ec4899', '#0f172a', '#0891b2', '#65a30d',
];

router.get('/leagues/:leagueId/sections/:sectionId/teams/new', auth.requireAuth, (req, res) => {
  const section = getEditableSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  res.render('teams/new', { title: 'فريق جديد', leagueId: req.params.leagueId, section, error: null, form: {}, presetColors: PRESET_COLORS });
});

router.post('/leagues/:leagueId/sections/:sectionId/teams/new', auth.requireAuth, upload.single('logoFile'), (req, res) => {
  const section = getEditableSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const { name, shortName, logo, color, founded, status } = req.body || {};
  if (!name) {
    return res.render('teams/new', { title: 'فريق جديد', leagueId: req.params.leagueId, section, error: 'الاسم مطلوب', form: req.body, presetColors: PRESET_COLORS });
  }
  const id = auth.newId();
  const finalLogo = req.file ? `/uploads/teams/${req.file.filename}` : (logo || '');
  db.prepare(
    `INSERT INTO teams (id, section_id, name, short_name, logo, color, founded, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    section.id,
    name,
    shortName || '',
    finalLogo,
    color || '#2563eb',
    parseInt(founded) || null,
    status || 'ACTIVE'
  );
  res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}`);
});

router.get('/leagues/:leagueId/sections/:sectionId/teams/:id/edit', auth.requireAuth, (req, res) => {
  const section = getEditableSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const team = db
    .prepare('SELECT * FROM teams WHERE id = ? AND section_id = ?')
    .get(req.params.id, section.id);
  if (!team) return res.status(404).send('الفريق غير موجود');
  res.render('teams/edit', { title: 'تعديل ' + team.name, leagueId: req.params.leagueId, section, team, error: null, presetColors: PRESET_COLORS });
});

router.post('/leagues/:leagueId/sections/:sectionId/teams/:id/edit', auth.requireAuth, upload.single('logoFile'), (req, res) => {
  const section = getEditableSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  const { name, shortName, logo, color, founded, status, pointDeduction, deductionReason } = req.body || {};
  let finalLogo = req.file ? `/uploads/teams/${req.file.filename}` : (logo || '');
  const deduction = parseInt(pointDeduction) || 0;
  db.prepare(
    `UPDATE teams SET name=?, short_name=?, logo=?, color=?, founded=?, status=?, point_deduction=?, deduction_reason=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, shortName || '', finalLogo, color || '#2563eb', parseInt(founded) || null, status || 'ACTIVE', deduction, deductionReason || '', req.params.id);
  res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}`);
});

router.post('/leagues/:leagueId/sections/:sectionId/teams/:id/delete', auth.requireAuth, (req, res) => {
  const section = getEditableSection(req.params.leagueId, req.params.sectionId, req.user);
  if (!section) return res.status(404).send('القسم غير موجود');
  db.prepare('DELETE FROM teams WHERE id = ? AND section_id = ?').run(req.params.id, section.id);
  res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}`);
});

module.exports = router;
