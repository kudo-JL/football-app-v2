/**
 * Fixtures — round-robin tournament generator.
 * Circle method (a.k.a. "round-robin tournament" or "polygon method").
 *
 * Algorithm:
 *  1. If odd number of teams, add a "bye" (null) so total is even.
 *  2. Fix team[0], rotate the rest clockwise each round.
 *  3. Each round: pair (i, N-1-i). Top half is "home", bottom half is "away".
 *     Alternate which half is home each round to balance home/away.
 *  4. If `includeReturn` is true, append a second pass where home/away is swapped.
 *  5. Byes (null matches) are skipped when storing.
 *
 * Returns:
 *  - matchdays: [{ name, matches: [{ homeId, awayId }] }]
 *  - summary: { rounds, matches, byes, error? }
 */
function generateFixture(teamIds, options = {}) {
  const includeReturn = options.includeReturn !== false; // default true
  const startDate = options.startDate ? new Date(options.startDate) : null;
  const daysBetween = options.daysBetween || 7; // one week apart by default
  const teams = teamIds.slice();
  if (teams.length < 2) {
    return {
      matchdays: [],
      summary: { rounds: 0, matches: 0, byes: 0, error: 'تحتاج فريقين على الأقل' },
    };
  }

  // Pad with null for odd number of teams (bye)
  const byes = teams.length % 2 === 1 ? 1 : 0;
  if (byes) teams.push(null);

  const N = teams.length;
  const rounds = N - 1;
  const half = N / 2;

  // Generate single round-robin
  const fixedTeam = teams[0];
  const rotating = teams.slice(1); // length N-1
  const pairs = []; // pairs[roundIndex] = [[home, away], ...]

  for (let r = 0; r < rounds; r++) {
    const arr = [fixedTeam, ...rotating];
    const roundPairs = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[N - 1 - i];
      // Alternate home/away per round to balance
      const isEvenRound = r % 2 === 0;
      const home = isEvenRound ? a : b;
      const away = isEvenRound ? b : a;
      roundPairs.push([home, away]);
    }
    pairs.push(roundPairs);
    // Rotate: move last element to front (clockwise)
    rotating.unshift(rotating.pop());
  }

  // Build matchdays
  const matchdays = pairs.map((roundPairs, idx) => {
    const realPairs = roundPairs.filter((p) => p[0] != null && p[1] != null);
    const scheduled = startDate
      ? new Date(startDate.getTime() + idx * daysBetween * 24 * 60 * 60 * 1000)
      : null;
    return {
      name: `الجولة ${idx + 1}`,
      scheduled_at: scheduled ? scheduled.toISOString() : null,
      matches: realPairs.map(([home, away]) => ({ home_team_id: home, away_team_id: away })),
    };
  });

  let summary = {
    rounds: matchdays.length,
    matches: matchdays.reduce((s, m) => s + m.matches.length, 0),
    byes: byes ? rounds : 0,
  };

  // Return leg: mirror home/away
  if (includeReturn) {
    const baseLen = matchdays.length;
    pairs.forEach((roundPairs, idx) => {
      const realPairs = roundPairs.filter((p) => p[0] != null && p[1] != null);
      const scheduled = startDate
        ? new Date(startDate.getTime() + (baseLen + idx) * daysBetween * 24 * 60 * 60 * 1000)
        : null;
      matchdays.push({
        name: `الجولة ${baseLen + idx + 1} (إياب)`,
        scheduled_at: scheduled ? scheduled.toISOString() : null,
        matches: realPairs.map(([home, away]) => ({ home_team_id: away, away_team_id: home })),
      });
    });
    summary.rounds = matchdays.length;
    summary.matches = matchdays.reduce((s, m) => s + m.matches.length, 0);
  }

  return { matchdays, summary };
}

/**
 * Persist generated fixture into DB. Wraps in a transaction.
 * Replaces any existing matchdays + matches for the section.
 */
const db = require('./db');
const auth = require('./auth');

function persistFixture(sectionId, ownerId, options = {}) {
  // Verify ownership
  const section = db
    .prepare(
      `SELECT s.* FROM sections s
       JOIN leagues l ON l.id = s.league_id
       WHERE s.id = ? AND l.owner_id = ?`
    )
    .get(sectionId, ownerId);
  if (!section) {
    return { ok: false, error: 'القسم غير موجود' };
  }

  const teams = db
    .prepare('SELECT id, name FROM teams WHERE section_id = ? ORDER BY name')
    .all(sectionId);
  if (teams.length < 2) {
    return { ok: false, error: 'تحتاج فريقين على الأقل' };
  }

  const { matchdays, summary } = generateFixture(
    teams.map((t) => t.id),
    options
  );

  // Wipe existing matchdays (cascades to matches via FK)
  db.prepare('DELETE FROM matchdays WHERE section_id = ?').run(sectionId);

  const insertMatchday = db.prepare(
    'INSERT INTO matchdays (id, section_id, name, "order", scheduled_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertMatch = db.prepare(
    'INSERT INTO matches (id, home_team_id, away_team_id, matchday_id, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?)'
  );

  // Use explicit transaction (node:sqlite has no db.transaction)
  db.exec('BEGIN');
  try {
    matchdays.forEach((md, idx) => {
      const mdId = auth.newId();
      insertMatchday.run(mdId, sectionId, md.name, idx + 1, md.scheduled_at);
      md.matches.forEach((m) => {
        insertMatch.run(auth.newId(), m.home_team_id, m.away_team_id, mdId, md.scheduled_at, 'SCHEDULED');
      });
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true, ...summary };
}

module.exports = { generateFixture, persistFixture };
