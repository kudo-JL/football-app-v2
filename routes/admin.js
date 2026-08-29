/**
 * Admin — super admin dashboard for managing all users and public content.
 * Only users with role = 'ADMIN' can access.
 */
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');

router.use(auth.requireAdmin);

router.get('/', (req, res) => {
  const users = db
    .prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC')
    .all();
  const leagues = db
    .prepare(
      `SELECT l.*, u.name AS owner_name, u.email AS owner_email,
              (SELECT COUNT(*) FROM sections WHERE league_id = l.id) AS section_count
       FROM leagues l
       LEFT JOIN users u ON u.id = l.owner_id
       ORDER BY l.created_at DESC`
    )
    .all();
  const cups = db
    .prepare(
      `SELECT c.*, l.name AS league_name, u.name AS owner_name
       FROM cups c
       LEFT JOIN leagues l ON l.id = c.league_id
       LEFT JOIN users u ON u.id = l.owner_id
       ORDER BY c.created_at DESC`
    )
    .all();
  const stats = {
    users: users.length,
    admins: users.filter((u) => u.role === 'ADMIN').length,
    leagues: leagues.length,
    publicLeagues: leagues.filter((l) => l.is_public).length,
    cups: cups.length,
  };
  res.render('admin/index', { title: 'لوحة الأدمن', users, leagues, cups, stats, user: req.user });
});

router.post('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['user', 'ADMIN'].includes(role)) {
    return res.redirect('/admin?error=invalid_role');
  }
  // Prevent admin from demoting themselves
  if (req.params.id === req.user.id && role !== 'ADMIN') {
    return res.redirect('/admin?error=cannot_demote_self');
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.redirect('/admin?msg=role_updated');
});

router.post('/leagues/:id/visibility', (req, res) => {
  const { isPublic } = req.body;
  const val = isPublic === 'on' || isPublic === '1' || isPublic === true ? 1 : 0;
  db.prepare("UPDATE leagues SET is_public = ?, updated_at = datetime('now') WHERE id = ?").run(val, req.params.id);
  res.redirect('/admin?msg=visibility_updated');
});

// Toggle the "featured" flag on a league. Admin only — but the home page
// ALSO enforces that only admin-owned leagues can be featured (so other users'
// leagues will never appear in the home page featured section even if this
// endpoint were reachable for them).
router.post('/leagues/:id/featured', (req, res) => {
  const { featured } = req.body;
  const target = req.params.id;
  // File-based logging so we can verify even when the user isn't watching the terminal
  const fs = require('fs');
  const logPath = require('path').join(__dirname, '..', 'data', 'admin-debug.log');
  const logLine = `[${new Date().toISOString()}] featured: target=${target} featured=${JSON.stringify(featured)} user=${req.user.id}\n`;
  try { fs.appendFileSync(logPath, logLine); } catch (e) {}
  console.log(logLine.trim());

  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(target);
  if (!league) {
    const msg = `League not found for id=${target}`;
    try { fs.appendFileSync(logPath, `  -> ${msg}\n`); } catch (e) {}
    return res.redirect('/admin?error=league_not_found&target=' + encodeURIComponent(target));
  }
  if (league.owner_id !== req.user.id) {
    const msg = `Not owner. league.owner_id=${league.owner_id} user.id=${req.user.id}`;
    try { fs.appendFileSync(logPath, `  -> ${msg}\n`); } catch (e) {}
    return res.redirect('/admin?error=cannot_feature_others');
  }
  const val = featured === 'on' || featured === '1' || featured === true ? 1 : 0;
  db.prepare("UPDATE leagues SET is_featured = ?, updated_at = datetime('now') WHERE id = ?").run(val, target);
  const msg = `OK. league=${league.name} is_featured=${val}`;
  try { fs.appendFileSync(logPath, `  -> ${msg}\n`); } catch (e) {}
  console.log('  ->', msg);
  res.redirect('/admin?msg=featured_updated');
});

module.exports = router;
