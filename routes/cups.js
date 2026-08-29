/**
 * Cups — knockout / double elimination tournament routes.
 */
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');
const cup = require('../lib/cup');

// Helper: load a cup
function getCup(cupId) {
  return db
    .prepare(
      `SELECT c.*, l.owner_id AS oid, l.name AS league_name, l.is_public AS league_public,
              (SELECT COUNT(*) FROM cup_matches WHERE cup_id = c.id) AS match_count,
              wt.name AS winner_name
       FROM cups c
       LEFT JOIN leagues l ON l.id = c.league_id
       LEFT JOIN teams wt ON wt.id = c.winner_team_id
       WHERE c.id = ?`
    )
    .get(cupId);
}

// True if the user can edit this cup (owner, admin, or creator of any team in it)
function canEditCup(c, user) {
  if (!c) return false;
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (c.league_id != null) {
    return c.oid === user.id;
  }
  // Independent cup — fall back to team ownership check
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cup_matches cm
       JOIN teams t ON (t.id = cm.home_team_id OR t.id = cm.away_team_id)
       JOIN sections s ON s.id = t.section_id
       JOIN leagues l ON l.id = s.league_id
       WHERE cm.cup_id = ? AND l.owner_id = ?`
    )
    .get(c.id, user.id);
  return r.n > 0;
}

// True if the user can VIEW this cup (public league, or owner/admin)
function canViewCup(c, user) {
  if (!c) return false;
  if (canEditCup(c, user)) return true;
  if (c.league_id != null && c.league_public) return true;
  return false;
}

// List all cups — public cups + user's own
router.get('/', auth.optionalAuth, (req, res) => {
  let cups;
  if (req.user) {
    cups = db
      .prepare(
        `SELECT c.*, l.name AS league_name,
                (SELECT COUNT(*) FROM cup_matches WHERE cup_id = c.id) AS match_count,
                (SELECT name FROM teams WHERE id = c.winner_team_id) AS winner_name
         FROM cups c
         LEFT JOIN leagues l ON l.id = c.league_id
         WHERE (l.is_public = 1) OR (l.owner_id = ?) OR c.league_id IS NULL
         ORDER BY c.created_at DESC`
      )
      .all(req.user.id);
  } else {
    cups = db
      .prepare(
        `SELECT c.*, l.name AS league_name,
                (SELECT COUNT(*) FROM cup_matches WHERE cup_id = c.id) AS match_count,
                (SELECT name FROM teams WHERE id = c.winner_team_id) AS winner_name
         FROM cups c
         LEFT JOIN leagues l ON l.id = c.league_id
         WHERE l.is_public = 1
         ORDER BY c.created_at DESC`
      )
      .all();
  }
  res.render('cups/index', { title: 'الكؤوس', cups, user: req.user || null });
});

// New cup form
router.get('/new', auth.requireAuth, (req, res) => {
  const leagues = db
    .prepare('SELECT id, name FROM leagues WHERE owner_id = ? OR ? = 1 ORDER BY name')
    .all(req.user.id, req.user.role === 'ADMIN' ? 1 : 0);
  const sections = db
    .prepare(
      `SELECT s.id, s.name, l.name AS league_name
       FROM sections s
       JOIN leagues l ON l.id = s.league_id
       WHERE l.owner_id = ? OR ? = 1
       ORDER BY l.name, s."order"`
    )
    .all(req.user.id, req.user.role === 'ADMIN' ? 1 : 0);
  const teams = db
    .prepare(
      `SELECT t.id, t.name, s.name AS section_name, l.name AS league_name
       FROM teams t
       JOIN sections s ON s.id = t.section_id
       JOIN leagues l ON l.id = s.league_id
       WHERE l.owner_id = ? OR ? = 1
       ORDER BY l.name, s.name, t.name`
    )
    .all(req.user.id, req.user.role === 'ADMIN' ? 1 : 0);
  res.render('cups/new', { title: 'كأس جديد', leagues, sections, teams, error: null, form: {}, user: req.user });
});

router.post('/new', auth.requireAuth, (req, res) => {
  const { name, league_id, section_id, type, pairing_mode, team_source, team_ids } = req.body || {};
  if (!name) {
    return res.redirect('/cups/new?error=الاسم+مطلوب');
  }
  const result = cup.createCup({
    ownerId: req.user.id,
    name,
    leagueId: league_id || null,
    sectionId: section_id || null,
    type: type || 'KNOCKOUT',
    pairingMode: pairing_mode || 'RANDOM',
    teamSource: team_source || 'MANUAL',
    teamIds: Array.isArray(team_ids) ? team_ids : (team_ids ? [team_ids] : []),
  });
  if (!result.ok) {
    return res.redirect('/cups/new?error=' + encodeURIComponent(result.error));
  }
  res.redirect('/cups/' + result.cupId);
});

// View cup + bracket (public if cup's league is public)
router.get('/:id', auth.optionalAuth, (req, res) => {
  const c = getCup(req.params.id);
  if (!canViewCup(c, req.user)) return res.status(404).send('الكأس غير موجود');

  const matches = db
    .prepare(
      `SELECT cm.*,
              ht.name AS home_name, ht.short_name AS home_short, ht.color AS home_color, ht.logo AS home_logo,
              at.name AS away_name, at.short_name AS away_short, at.color AS away_color, at.logo AS away_logo,
              wt.name AS winner_name, wt.short_name AS winner_short
       FROM cup_matches cm
       LEFT JOIN teams ht ON ht.id = cm.home_team_id
       LEFT JOIN teams at ON at.id = cm.away_team_id
       LEFT JOIN teams wt ON wt.id = cm.winner_team_id
       WHERE cm.cup_id = ?
       ORDER BY cm.bracket, cm.round, cm.position`
    )
    .all(c.id);

  const rounds = {};
  matches.forEach((m) => {
    const key = `${m.bracket}|${m.round}`;
    if (!rounds[key]) rounds[key] = { bracket: m.bracket, round: m.round, round_name: m.round_name, matches: [] };
    rounds[key].matches.push(m);
  });

  const canAdvance = c.status !== 'FINISHED' && matches
    .filter((m) => m.bracket === 'MAIN' && m.round === c.current_round)
    .every((m) => m.status === 'FINISHED' || m.status === 'BYE');

  const canEdit = canEditCup(c, req.user);
  res.render('cups/show', {
    title: c.name,
    cup: c,
    rounds: Object.values(rounds).sort((a, b) => a.round - b.round),
    canAdvance,
    canEdit,
    user: req.user || null,
  });
});

// Edit a single cup match (record result) — owner/admin only
router.get('/:id/matches/:matchId', auth.requireAuth, (req, res) => {
  const c = getCup(req.params.id);
  if (!canEditCup(c, req.user)) return res.status(404).send('الكأس غير موجود');
  const m = db
    .prepare(
      `SELECT cm.*,
              ht.name AS home_name, ht.short_name AS home_short, ht.color AS home_color, ht.logo AS home_logo,
              at.name AS away_name, at.short_name AS away_short, at.color AS away_color, at.logo AS away_logo
       FROM cup_matches cm
       LEFT JOIN teams ht ON ht.id = cm.home_team_id
       LEFT JOIN teams at ON at.id = cm.away_team_id
       WHERE cm.id = ? AND cm.cup_id = ?`
    )
    .get(req.params.matchId, c.id);
  if (!m) return res.status(404).send('المباراة غير موجودة');
  res.render('cups/match', { title: 'تسجيل نتيجة', cup: c, match: m, error: req.query.error || null, saved: req.query.saved || null });
});

router.post('/:id/matches/:matchId', auth.requireAuth, (req, res) => {
  const c = getCup(req.params.id);
  if (!canEditCup(c, req.user)) return res.status(404).send('الكأس غير موجود');
  const homeScore = parseInt(req.body.homeScore) || 0;
  const awayScore = parseInt(req.body.awayScore) || 0;
  const homeScoreET = req.body.homeScoreET !== undefined && req.body.homeScoreET !== '' ? parseInt(req.body.homeScoreET) : null;
  const awayScoreET = req.body.awayScoreET !== undefined && req.body.awayScoreET !== '' ? parseInt(req.body.awayScoreET) : null;
  const homePenalties = req.body.homePenalties !== undefined && req.body.homePenalties !== '' ? parseInt(req.body.homePenalties) : null;
  const awayPenalties = req.body.awayPenalties !== undefined && req.body.awayPenalties !== '' ? parseInt(req.body.awayPenalties) : null;
  const winnerExplicit = req.body.winnerExplicit || null;

  const extra = { homeScoreET, awayScoreET, homePenalties, awayPenalties };

  if (winnerExplicit || homeScoreET != null || homePenalties != null) {
    const winner = winnerExplicit || (
      homePenalties != null && awayPenalties != null && homePenalties !== awayPenalties
        ? (homePenalties > awayPenalties ? '__home__' : '__away__')
        : (homeScoreET != null && awayScoreET != null && homeScoreET !== awayScoreET
            ? (homeScoreET > awayScoreET ? '__home__' : '__away__')
            : null)
    );
    if (winner) {
      const cm = db.prepare('SELECT home_team_id, away_team_id FROM cup_matches WHERE id = ?').get(req.params.matchId);
      const actualWinner = winner === '__home__' ? cm.home_team_id : (winner === '__away__' ? cm.away_team_id : winner);
      const result = cup.setWinnerExplicit(req.params.matchId, req.user.id, actualWinner, extra);
      if (!result.ok) {
        return res.redirect(`/cups/${c.id}/matches/${req.params.matchId}?error=${encodeURIComponent(result.error)}`);
      }
      return res.redirect(`/cups/${c.id}/matches/${req.params.matchId}?saved=1`);
    }
  }

  if (homeScore === awayScore) {
    return res.redirect(`/cups/${c.id}/matches/${req.params.matchId}?error=${encodeURIComponent('الكأس لا يقبل التعادل. أدخل نتيجة الأشواط أو ركلات الترجيح.')}&draw=1`);
  }
  const result = cup.recordMatchResult(req.params.matchId, req.user.id, homeScore, awayScore, 'NORMAL');
  if (!result.ok) {
    return res.redirect(`/cups/${c.id}/matches/${req.params.matchId}?error=${encodeURIComponent(result.error)}`);
  }
  res.redirect(`/cups/${c.id}/matches/${req.params.matchId}?saved=1`);
});

router.post('/:id/advance', auth.requireAuth, (req, res) => {
  const c = getCup(req.params.id);
  if (!canEditCup(c, req.user)) return res.status(404).send('الكأس غير موجود');
  const result = cup.advanceNextRound(c.id, req.user.id);
  if (!result.ok) {
    return res.redirect(`/cups/${c.id}?error=${encodeURIComponent(result.error)}`);
  }
  res.redirect(`/cups/${c.id}?advanced=${result.newMatches}`);
});

router.post('/:id/delete', auth.requireAuth, (req, res) => {
  const c = getCup(req.params.id);
  if (!canEditCup(c, req.user)) return res.status(404).send('الكأس غير موجود');
  db.prepare('DELETE FROM cups WHERE id = ?').run(c.id);
  res.redirect('/cups');
});

module.exports = router;
