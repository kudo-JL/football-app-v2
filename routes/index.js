const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');

// Public landing page.
// Strategy:
//   - "My leagues" section: only the current user's own leagues (if logged in).
//   - "Featured" section: only leagues owned by the system ADMIN and marked is_featured=1.
//     This guarantees visitors never see leagues created by other random users on the home page.
//   - Visitors who are not logged in see only the featured section.

router.get('/', auth.optionalAuth, (req, res) => {
  const user = req.user || null;

  // Owned leagues (if logged in)
  let myLeagues = [];
  if (user) {
    myLeagues = db
      .prepare(
        `SELECT *, (SELECT COUNT(*) FROM sections WHERE league_id = leagues.id) AS section_count
         FROM leagues WHERE owner_id = ? ORDER BY created_at DESC`
      )
      .all(user.id);
  }

  // Featured leagues — only those owned by a system ADMIN.
  // Falls back to any featured if no admin exists yet (very rare).
  const featuredLeagues = db
    .prepare(
      `SELECT l.*, u.name AS owner_name,
              (SELECT COUNT(*) FROM sections WHERE league_id = l.id) AS section_count,
              (SELECT COUNT(*) FROM teams t JOIN sections s ON s.id = t.section_id WHERE s.league_id = l.id) AS team_count
       FROM leagues l
       LEFT JOIN users u ON u.id = l.owner_id
       WHERE l.is_featured = 1
         AND l.is_public = 1
         AND (u.role = 'ADMIN' OR u.id IS NULL)
       ORDER BY l.created_at DESC`
    )
    .all();

  res.render('home', {
    title: 'الرئيسية',
    user,
    publicLeagues: featuredLeagues,
    myLeagues,
    isAdmin: user && user.role === 'ADMIN',
  });
});

module.exports = router;
