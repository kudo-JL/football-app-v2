/**
 * Admin — super admin dashboard for managing all users and public content.
 * Only users with role = 'ADMIN' can access.
 *
 * Destructive actions (delete user, manual verify) require is_super_admin=1
 * (the FIRST registered user). Other admins can only view + change roles
 * + change visibility / featured flags.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const auth = require('../lib/auth');

router.use(auth.requireAdmin);

router.get('/', (req, res) => {
  const users = db
    .prepare(
      `SELECT id, email, name, role, is_verified, is_super_admin, created_at
       FROM users ORDER BY created_at ASC`
    )
    .all();
  // For each user, get their owned league count (for impact preview on delete)
  const leagueCounts = {};
  db.prepare('SELECT owner_id, COUNT(*) AS n FROM leagues GROUP BY owner_id').all().forEach((r) => {
    leagueCounts[r.owner_id] = r.n;
  });
  const usersWithStats = users.map((u) => ({ ...u, league_count: leagueCounts[u.id] || 0 }));
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
    verified: users.filter((u) => u.is_verified).length,
    unverified: users.filter((u) => !u.is_verified).length,
    leagues: leagues.length,
    publicLeagues: leagues.filter((l) => l.is_public).length,
    cups: cups.length,
  };
  res.render('admin/index', { title: 'لوحة الأدمن', users: usersWithStats, leagues, cups, stats, user: req.user });
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

// =====================================================================
// SUPER ADMIN ONLY — Manual email verification
// Use when a user lost access to their email and can't verify themselves.
// =====================================================================
router.post('/users/:id/verify', auth.requireSuperAdmin, (req, res) => {
  const targetId = req.params.id;
  const target = db.prepare('SELECT id, email, name, is_verified FROM users WHERE id = ?').get(targetId);
  if (!target) return res.redirect('/admin?error=user_not_found');
  if (target.is_verified) return res.redirect('/admin?error=already_verified');
  db.prepare(
    `UPDATE users SET is_verified = 1, verification_token = NULL, verification_expires_at = NULL WHERE id = ?`
  ).run(targetId);
  res.redirect('/admin?msg=verified&target=' + encodeURIComponent(target.email));
});

// =====================================================================
// SUPER ADMIN ONLY — Delete user (with cascade: leagues → sections → matchdays
// → teams → players → matches, plus cups → cup_matches, plus logo files).
// =====================================================================
router.get('/users/:id/delete', auth.requireSuperAdmin, (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.id) {
    return res.redirect('/admin?error=cannot_delete_self');
  }
  const target = db.prepare(
    'SELECT id, email, name, role, is_verified, created_at FROM users WHERE id = ?'
  ).get(targetId);
  if (!target) return res.redirect('/admin?error=user_not_found');

  const impact = {
    leagues: db.prepare('SELECT COUNT(*) AS n FROM leagues WHERE owner_id = ?').get(targetId).n,
    sections: db.prepare(
      `SELECT COUNT(*) AS n FROM sections WHERE league_id IN (SELECT id FROM leagues WHERE owner_id = ?)`
    ).get(targetId).n,
    teams: db.prepare(
      `SELECT COUNT(*) AS n FROM teams WHERE section_id IN (
         SELECT id FROM sections WHERE league_id IN (SELECT id FROM leagues WHERE owner_id = ?)
       )`
    ).get(targetId).n,
    players: db.prepare(
      `SELECT COUNT(*) AS n FROM players WHERE team_id IN (
         SELECT id FROM teams WHERE section_id IN (
           SELECT id FROM sections WHERE league_id IN (SELECT id FROM leagues WHERE owner_id = ?)
         )
       )`
    ).get(targetId).n,
    matches: db.prepare(
      `SELECT COUNT(*) AS n FROM matches WHERE home_team_id IN (
         SELECT id FROM teams WHERE section_id IN (
           SELECT id FROM sections WHERE league_id IN (SELECT id FROM leagues WHERE owner_id = ?)
         )
       )`
    ).get(targetId).n,
    cups: db.prepare(
      'SELECT COUNT(*) AS n FROM cups WHERE league_id IN (SELECT id FROM leagues WHERE owner_id = ?)'
    ).get(targetId).n,
  };
  res.render('admin/delete-user', { title: 'تأكيد حذف مستخدم', user: req.user, target, impact });
});

router.post('/users/:id/delete', auth.requireSuperAdmin, (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.id) {
    return res.redirect('/admin?error=cannot_delete_self');
  }
  const target = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(targetId);
  if (!target) return res.redirect('/admin?error=user_not_found');

  // Collect all team logos owned by this user, so we can clean up files on disk
  const logos = db
    .prepare(
      `SELECT t.logo FROM teams t
       WHERE t.section_id IN (
         SELECT id FROM sections WHERE league_id IN (SELECT id FROM leagues WHERE owner_id = ?)
       ) AND t.logo != ''`
    )
    .all(targetId);

  // Use a transaction so the delete is atomic
  const deleteTx = db.transaction(() => {
    // FK ON DELETE CASCADE handles leagues → sections → matchdays → teams → players → matches
    // and cups → cup_matches. So deleting the user cascades all related rows.
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  });
  deleteTx();

  // Clean up logo files from disk (best effort — don't fail if a file is missing)
  logos.forEach((row) => {
    if (!row.logo) return;
    const filePath = path.join(__dirname, '..', 'public', row.logo);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error('[admin/delete] Could not remove logo:', filePath, e.message);
    }
  });

  res.redirect('/admin?msg=user_deleted&target=' + encodeURIComponent(target.email));
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
