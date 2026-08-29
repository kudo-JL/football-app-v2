const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');

// "New" form — owner-only
router.get('/new', auth.requireAuth, (req, res) => {
  res.render('leagues/new', { title: 'دوري جديد', error: null, form: {} });
});

router.post('/new', auth.requireAuth, (req, res) => {
  const { name, description, season, country, promoted, relegated, isPublic } = req.body || {};
  if (!name || !season) {
    return res.render('leagues/new', {
      title: 'دوري جديد',
      error: 'الاسم والموسم مطلوبان',
      form: req.body,
    });
  }
  const id = auth.newId();
  db.prepare(
    `INSERT INTO leagues (id, name, description, season, country, promoted_teams_count, relegated_teams_count, owner_id, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    description || '',
    season,
    country || '',
    parseInt(promoted) || 0,
    parseInt(relegated) || 0,
    req.user.id,
    isPublic === 'on' || isPublic === '1' || isPublic === true ? 1 : 0
  );
  res.redirect(`/leagues/${id}`);
});

// Public list — but if logged in, also show private leagues you own
router.get('/', auth.optionalAuth, (req, res) => {
  let leagues;
  if (req.user) {
    leagues = db
      .prepare(
        `SELECT l.*, (SELECT COUNT(*) FROM sections WHERE league_id = l.id) AS section_count
         FROM leagues l
         WHERE l.is_public = 1 OR l.owner_id = ?
         ORDER BY l.is_public DESC, l.created_at DESC`
      )
      .all(req.user.id);
  } else {
    leagues = db
      .prepare(
        `SELECT l.*, (SELECT COUNT(*) FROM sections WHERE league_id = l.id) AS section_count
         FROM leagues l
         WHERE l.is_public = 1
         ORDER BY l.created_at DESC`
      )
      .all();
  }
  res.render('leagues/index', { title: 'الدوريات', leagues, user: req.user || null });
});

// Public view (if league is public OR user owns it OR is admin)
router.get('/:id', auth.optionalAuth, (req, res) => {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).send('الدوري غير موجود');

  const canView = league.is_public || auth.canEditLeague(req.user, league);
  if (!canView) return res.status(404).send('الدوري غير موجود');

  const sections = db
    .prepare('SELECT *, (SELECT COUNT(*) FROM teams WHERE section_id = sections.id) AS team_count FROM sections WHERE league_id = ? ORDER BY "order"')
    .all(league.id);

  const canEdit = auth.canEditLeague(req.user, league);
  res.render('leagues/show', {
    title: league.name,
    league,
    sections,
    canEdit,
    user: req.user || null,
  });
});

// Edit — owner or admin only
router.get('/:id/edit', auth.requireAuth, (req, res) => {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!auth.canEditLeague(req.user, league)) return res.status(403).send('forbidden');
  res.render('leagues/edit', { title: 'تعديل ' + league.name, league, error: null });
});

router.post('/:id/edit', auth.requireAuth, (req, res) => {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!auth.canEditLeague(req.user, league)) return res.status(403).send('forbidden');

  const { name, description, season, country, status, promoted, relegated, isPublic } = req.body || {};
  const isPublicVal = isPublic === 'on' || isPublic === '1' || isPublic === true ? 1 : 0;
  db.prepare(
    `UPDATE leagues SET name=?, description=?, season=?, country=?, status=?, promoted_teams_count=?, relegated_teams_count=?, is_public=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    name,
    description || '',
    season,
    country || '',
    status || league.status,
    parseInt(promoted) || 0,
    parseInt(relegated) || 0,
    isPublicVal,
    league.id
  );
  res.redirect(`/leagues/${league.id}`);
});

// Delete — owner or admin only
router.post('/:id/delete', auth.requireAuth, (req, res) => {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!auth.canEditLeague(req.user, league)) return res.status(403).send('forbidden');
  db.prepare('DELETE FROM leagues WHERE id = ?').run(req.params.id);
  res.redirect('/leagues');
});

module.exports = router;
