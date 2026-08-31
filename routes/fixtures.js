/**
 * Fixtures — round-robin generation endpoints.
 */
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');
const { persistFixture } = require('../lib/fixtures');

// Auth applied per-route below

function getOwnedSection(leagueId, sectionId, userId) {
  return db
    .prepare(
      `SELECT s.* FROM sections s
       JOIN leagues l ON l.id = s.league_id
       WHERE s.id = ? AND s.league_id = ? AND l.owner_id = ?`
    )
    .get(sectionId, leagueId, userId);
}

// POST /leagues/:leagueId/sections/:sectionId/generate-fixture
router.post('/leagues/:leagueId/sections/:sectionId/generate-fixture', auth.requireAuth, (req, res) => {
  const section = getOwnedSection(req.params.leagueId, req.params.sectionId, req.user.id);
  if (!section) return res.status(404).send('القسم غير موجود');

  const includeReturn = req.body.includeReturn !== '0' && req.body.includeReturn !== 'false';
  const startDate = req.body.startDate || null;
  const daysBetween = parseInt(req.body.daysBetween) || 7;

  const result = persistFixture(section.id, req.user.id, {
    includeReturn,
    startDate,
    daysBetween,
  });

  if (!result.ok) {
    return res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}?error=${encodeURIComponent(result.error)}`);
  }

  res.redirect(`/leagues/${req.params.leagueId}/sections/${section.id}?generated=${result.matches}`);
});

module.exports = router;
