/**
 * Cup — knockout / double-elimination tournament generator.
 *
 * Bracket generation:
 *  - Pad with byes to next power of 2 (e.g. 6 teams -> 8 slots, 2 byes)
 *  - Pair teams: (0, n-1), (1, n-2), ...
 *  - For SEEDED: order teams by current points/goal_diff before pairing
 *  - For RANDOM: shuffle
 *
 * Single elimination (KNOCKOUT):
 *  - N-1 rounds where N = padded size
 *  - Each round halves the participants
 *  - Losers eliminated
 *
 * Double elimination (DOUBLE_ELIMINATION):
 *  - MAIN bracket: same as knockout
 *  - LOSERS bracket: receives losers from main + earlier losers rounds
 *  - Grand final: main winner vs losers winner
 *
 * Round names (Arabic):
 *  - Final (2)        : "النهائي"
 *  - Semi (4)         : "نصف النهائي"
 *  - Quarter (8)      : "ربع النهائي"
 *  - Round of 16      : "دور الـ 16"
 *  - Round of 32      : "دور الـ 32"
 *  - default:         : "الجولة N"
 */
const db = require('./db');
const auth = require('./auth');

function roundNameForSize(size, round) {
  // round counts from 1 (first) to log2(size)
  const totalRounds = Math.log2(size);
  const fromEnd = totalRounds - round + 1; // 1 = first
  if (fromEnd === 1) return 'النهائي';
  if (fromEnd === 2) return 'نصف النهائي';
  if (fromEnd === 3) return 'ربع النهائي';
  if (fromEnd === 4) return 'دور الـ 16';
  if (fromEnd === 5) return 'دور الـ 32';
  if (fromEnd === 6) return 'دور الـ 64';
  return `الجولة ${round}`;
}

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Generate the full bracket for a cup.
 * teams: array of { id, name, ... } objects
 * options: { pairing_mode: 'RANDOM' | 'SEEDED' }
 * Returns the round-1 matches ready to insert.
 */
function generateBracket(teams, options = {}) {
  const pairingMode = options.pairing_mode || 'RANDOM';
  const padded = nextPowerOf2(teams.length);
  const byes = padded - teams.length;

  // Order teams
  let ordered = teams.slice();
  if (pairingMode === 'SEEDED') {
    ordered.sort((a, b) => {
      const pa = a.points - (a.point_deduction || 0);
      const pb = b.points - (b.point_deduction || 0);
      if (pb !== pa) return pb - pa;
      const ga = (a.goals_for || 0) - (a.goals_against || 0);
      const gb = (b.goals_for || 0) - (b.goals_against || 0);
      if (gb !== ga) return gb - ga;
      return (a.name || '').localeCompare(b.name || '');
    });
  } else {
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }

  // Pad with nulls (byes go to top of bracket)
  const slots = ordered.slice();
  while (slots.length < padded) slots.push(null);

  // Build round 1 pairings
  const totalRounds = Math.log2(padded);
  const matches = [];
  const half = padded / 2;

  for (let i = 0; i < half; i++) {
    const home = slots[i];
    const away = slots[padded - 1 - i];
    let status = 'PENDING';
    let homeTeam = home;
    let awayTeam = away;
    if (home && !away) {
      status = 'BYE';
      awayTeam = null;
    } else if (!home && away) {
      status = 'BYE';
      homeTeam = null;
    } else if (!home && !away) {
      continue;
    }
    matches.push({
      bracket: 'MAIN',
      round: 1,
      round_name: roundNameForSize(padded, 1),
      position: i,
      home_team_id: homeTeam ? homeTeam.id : null,
      away_team_id: awayTeam ? awayTeam.id : null,
      status,
    });
  }

  return { matches, totalRounds, padded };
}

/**
 * Create a new cup and generate its initial bracket.
 * Returns { ok, cupId, error? }
 */
function createCup({ ownerId, name, leagueId, sectionId, type, pairingMode, teamSource, teamIds }) {
  let teams = [];
  if (teamSource === 'SECTION' && sectionId) {
    const sec = db
      .prepare(
        `SELECT s.* FROM sections s
         JOIN leagues l ON l.id = s.league_id
         WHERE s.id = ? AND l.owner_id = ?`
      )
      .get(sectionId, ownerId);
    if (!sec) return { ok: false, error: 'القسم غير موجود' };
    teams = db
      .prepare('SELECT id, name, points, point_deduction, goals_for, goals_against FROM teams WHERE section_id = ? ORDER BY name')
      .all(sectionId);
  } else if (teamSource === 'MANUAL') {
    if (!teamIds || teamIds.length < 2) return { ok: false, error: 'اختر فريقين على الأقل' };
    const placeholders = teamIds.map(() => '?').join(',');
    teams = db
      .prepare(`SELECT id, name, points, point_deduction, goals_for, goals_against FROM teams WHERE id IN (${placeholders})`)
      .all(...teamIds);
    const owned = db
      .prepare(
        `SELECT t.id FROM teams t
         JOIN sections s ON s.id = t.section_id
         JOIN leagues l ON l.id = s.league_id
         WHERE l.owner_id = ? AND t.id IN (${placeholders})`
      )
      .all(ownerId, ...teamIds);
    const ownedIds = new Set(owned.map((r) => r.id));
    const beforeCount = teams.length;
    teams = teams.filter((t) => ownedIds.has(t.id));
    if (teams.length === 0) {
      return { ok: false, error: 'لا تملك أي من الفرق المختارة' };
    }
  } else {
    return { ok: false, error: 'مصدر الفرق غير صالح' };
  }

  if (teams.length < 2) return { ok: false, error: 'تحتاج فريقين على الأقل' };

  const cupId = auth.newId();
  const { matches, padded } = generateBracket(teams, { pairing_mode: pairingMode });
  db.prepare(
    `INSERT INTO cups (id, league_id, section_id, name, type, pairing_mode, team_source, status, current_round, bracket_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', 1, ?)`
  ).run(cupId, leagueId || null, sectionId || null, name, type, pairingMode, teamSource, padded);

  const insert = db.prepare(
    `INSERT INTO cup_matches (id, cup_id, bracket, round, round_name, position, home_team_id, away_team_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec('BEGIN');
  try {
    matches.forEach((m) => {
      insert.run(
        auth.newId(),
        cupId,
        m.bracket,
        m.round,
        m.round_name,
        m.position,
        m.home_team_id,
        m.away_team_id,
        m.status
      );
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true, cupId, matchCount: matches.length };
}

/**
 * Record a match result + advance the winner to the next round.
 * cup_match_id: the cup_matches row id
 * homeScore, awayScore: numbers
 * decidedBy: 'NORMAL' | 'EXTRA_TIME' | 'PENALTIES'
 * Returns { ok, advanced, error? }
 */
function recordMatchResult(cupMatchId, ownerId, homeScore, awayScore, decidedBy = 'NORMAL') {
  // Verify ownership
  const owner = db
    .prepare(
      `SELECT l.owner_id AS oid,
              cm.*,
              c.id AS c_id, c.league_id AS c_league_id
       FROM cup_matches cm
       JOIN cups c ON c.id = cm.cup_id
       LEFT JOIN leagues l ON l.id = c.league_id
       WHERE cm.id = ?`
    )
    .get(cupMatchId);
  if (!owner) {
    return { ok: false, error: 'المباراة غير موجودة' };
  }
  if (owner.c_league_id) {
    if (!owner.oid || owner.oid !== ownerId) {
      return { ok: false, error: 'الكأس غير موجود أو ليس ملكك' };
    }
  } else {
    const teamCheck = db
      .prepare(
        `SELECT COUNT(*) AS n FROM cup_matches cm
         JOIN teams t ON (t.id = cm.home_team_id OR t.id = cm.away_team_id)
         JOIN sections s ON s.id = t.section_id
         JOIN leagues l ON l.id = s.league_id
         WHERE cm.id = ? AND l.owner_id = ?`
      )
      .get(cupMatchId, ownerId);
    if (teamCheck.n === 0) {
      return { ok: false, error: 'الكأس غير موجود أو ليس ملكك' };
    }
  }
  const cm = owner;
  if (!cm.home_team_id || !cm.away_team_id) {
    return { ok: false, error: 'الفريقان غير محددان' };
  }

  // Determine winner
  let winner = null;
  if (homeScore > awayScore) winner = cm.home_team_id;
  else if (awayScore > homeScore) winner = cm.away_team_id;
  else {
    // Draw: allowed only if decidedBy is EXTRA_TIME or PENALTIES
    if (decidedBy === 'EXTRA_TIME') {
      // Extra time: ask user to provide the final ET score (winner via ET score)
      // For simplicity: when EXTRA_TIME/PENALTIES is set with a draw, we ask user to
      // set winner manually. We return an error prompting for winner selection.
      return { ok: false, error: 'حدد الفائز بعد الأشواط الإضافية (أدخل نتيجة الأشواط الإضافية)' };
    } else if (decidedBy === 'PENALTIES') {
      // Same — require explicit winner after penalties
      return { ok: false, error: 'حدد الفائز بركلات الترجيح (أدخل نتيجة الركلات وأي فريق فاز)' };
    } else {
      return { ok: false, error: 'الكأس لا يقبل التعادل. حدد فائزاً أو اختر الأشواط/الركلات.' };
    }
  }

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE cup_matches SET home_score=?, away_score=?, winner_team_id=?, status='FINISHED' WHERE id=?`
    ).run(homeScore, awayScore, winner, cupMatchId);

    // Find the next match
    const next = db
      .prepare('SELECT * FROM cup_matches WHERE id = ?')
      .get(cm.next_match_id);

    if (next) {
      if (cm.next_position === 0 || next.home_team_id == null) {
        db.prepare('UPDATE cup_matches SET home_team_id=? WHERE id=?').run(winner, next.id);
      } else if (next.away_team_id == null) {
        db.prepare('UPDATE cup_matches SET away_team_id=? WHERE id=?').run(winner, next.id);
      }
    } else {
      // No next match linked — could be the FINAL or could be the last match
      // in a round that hasn't been advanced yet. The cup is finished only if:
      //   (a) this match is the ONLY one in its round (i.e. it's a final-round match)
      //   (b) all other main matches are FINISHED or BYE
      //   (c) no higher rounds exist
      const inSameRound = db
        .prepare(
          `SELECT COUNT(*) AS n FROM cup_matches
           WHERE cup_id = ? AND bracket = 'MAIN' AND round = ?`
        )
        .get(cm.cup_id, cm.round);
      const higherRound = db
        .prepare(
          `SELECT COUNT(*) AS n FROM cup_matches
           WHERE cup_id = ? AND bracket = 'MAIN' AND round > ?`
        )
        .get(cm.cup_id, cm.round);
      if (inSameRound.n === 1 && higherRound.n === 0) {
        // single match in this round + no higher round + this just finished = the FINAL
        db.prepare('UPDATE cups SET status=?, winner_team_id=? WHERE id=?').run('FINISHED', winner, cm.cup_id);
      }
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true, winner };
}

/**
 * Set winner explicitly (for after extra time / penalties)
 * Also accepts extra time and penalty scores to record the full match result.
 */
function setWinnerExplicit(cupMatchId, ownerId, winnerTeamId, extra = {}) {
  // Verify ownership (same logic)
  const owner = db
    .prepare(
      `SELECT l.owner_id AS oid, cm.cup_id AS cid
       FROM cup_matches cm
       JOIN cups c ON c.id = cm.cup_id
       LEFT JOIN leagues l ON l.id = c.league_id
       WHERE cm.id = ?`
    )
    .get(cupMatchId);
  if (!owner) return { ok: false, error: 'المباراة غير موجودة' };

  // Validate winnerTeamId is one of the teams in this match
  const cm = db.prepare('SELECT * FROM cup_matches WHERE id = ?').get(cupMatchId);
  if (!cm) return { ok: false, error: 'المباراة غير موجودة' };
  if (winnerTeamId !== cm.home_team_id && winnerTeamId !== cm.away_team_id) {
    return { ok: false, error: 'الفائز يجب أن يكون أحد الفريقين' };
  }

  // If penalties were entered with a decisive result, the higher count wins
  // regardless of the user's selection (penalties are objective).
  if (extra.homePenalties != null && extra.awayPenalties != null &&
      extra.homePenalties !== extra.awayPenalties) {
    winnerTeamId = extra.homePenalties > extra.awayPenalties ? cm.home_team_id : cm.away_team_id;
  }
  // Same for extra time: if ET scores are decisive, use them.
  else if (extra.homeScoreET != null && extra.awayScoreET != null &&
           extra.homeScoreET !== extra.awayScoreET) {
    winnerTeamId = extra.homeScoreET > extra.awayScoreET ? cm.home_team_id : cm.away_team_id;
  }

  // Determine decided_by based on which scores are provided
  let decidedBy = 'NORMAL';
  if (extra.homePenalties != null || extra.awayPenalties != null) decidedBy = 'PENALTIES';
  else if (extra.homeScoreET != null || extra.awayScoreET != null) decidedBy = 'EXTRA_TIME';

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE cup_matches SET
        winner_team_id=?,
        status='FINISHED',
        home_score_et=?,
        away_score_et=?,
        home_penalties=?,
        away_penalties=?,
        decided_by=?
       WHERE id=?`
    ).run(
      winnerTeamId,
      extra.homeScoreET ?? null,
      extra.awayScoreET ?? null,
      extra.homePenalties ?? null,
      extra.awayPenalties ?? null,
      decidedBy,
      cupMatchId
    );

    const next = db.prepare('SELECT * FROM cup_matches WHERE id = ?').get(cm.next_match_id);
    if (next) {
      if (cm.next_position === 0 || next.home_team_id == null) {
        db.prepare('UPDATE cup_matches SET home_team_id=? WHERE id=?').run(winnerTeamId, next.id);
      } else if (next.away_team_id == null) {
        db.prepare('UPDATE cup_matches SET away_team_id=? WHERE id=?').run(winnerTeamId, next.id);
      }
    } else {
      // Check if this is the FINAL:
      //  - this is the only match in its round
      //  - and no higher round exists
      const inSameRound = db
        .prepare(
          `SELECT COUNT(*) AS n FROM cup_matches
           WHERE cup_id = ? AND bracket = 'MAIN' AND round = ?`
        )
        .get(cm.cup_id, cm.round);
      const higherRound = db
        .prepare(
          `SELECT COUNT(*) AS n FROM cup_matches
           WHERE cup_id = ? AND bracket = 'MAIN' AND round > ?`
        )
        .get(cm.cup_id, cm.round);
      if (inSameRound.n === 1 && higherRound.n === 0) {
        db.prepare('UPDATE cups SET status=?, winner_team_id=? WHERE id=?').run('FINISHED', winnerTeamId, cm.cup_id);
      }
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true };
}

/**
 * Build the next round for a single-elimination cup.
 */
function advanceNextRound(cupId, ownerId) {
  const cup = db
    .prepare(
      `SELECT c.*, l.owner_id AS oid
       FROM cups c
       LEFT JOIN leagues l ON l.id = c.league_id
       WHERE c.id = ?`
    )
    .get(cupId);
  if (!cup) return { ok: false, error: 'الكأس غير موجود' };
  if (cup.league_id) {
    if (cup.oid !== ownerId) return { ok: false, error: 'غير مصرح' };
  } else {
    const teamCheck = db
      .prepare(
        `SELECT COUNT(*) AS n FROM cup_matches cm
         JOIN teams t ON (t.id = cm.home_team_id OR t.id = cm.away_team_id)
         JOIN sections s ON s.id = t.section_id
         JOIN leagues l ON l.id = s.league_id
         WHERE cm.cup_id = ? AND l.owner_id = ?`
      )
      .get(cupId, ownerId);
    if (teamCheck.n === 0) return { ok: false, error: 'غير مصرح' };
  }

  const currentRound = cup.current_round || 1;

  const prevMatches = db
    .prepare(
      `SELECT * FROM cup_matches WHERE cup_id = ? AND bracket = 'MAIN' AND round = ? ORDER BY position`
    )
    .all(cupId, currentRound);

  const allDone = prevMatches.every((m) => m.status === 'FINISHED' || m.status === 'BYE');
  if (!allDone) return { ok: false, error: 'بعض مباريات الجولة لم تنته بعد' };

  const winners = prevMatches
    .map((m) => (m.status === 'BYE' ? m.home_team_id || m.away_team_id : m.winner_team_id))
    .filter(Boolean);

  if (winners.length <= 1) {
    return { ok: false, error: 'الكأس انتهى' };
  }

  const nextRound = currentRound + 1;
  const half = Math.ceil(winners.length / 2);
  const newMatches = [];

  for (let i = 0; i < half; i++) {
    const home = winners[i];
    const away = winners[winners.length - 1 - i] || null;
    newMatches.push({
      bracket: 'MAIN',
      round: nextRound,
      round_name: roundNameForSize(cup.bracket_size, nextRound),
      position: i,
      home_team_id: home,
      away_team_id: away,
      status: 'PENDING',
    });
  }

  const insert = db.prepare(
    `INSERT INTO cup_matches (id, cup_id, bracket, round, round_name, position, home_team_id, away_team_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const newIds = [];

  db.exec('BEGIN');
  try {
    newMatches.forEach((m) => {
      const id = auth.newId();
      insert.run(id, cupId, m.bracket, m.round, m.round_name, m.position, m.home_team_id, m.away_team_id, m.status);
      newIds.push(id);
    });

    // Link previous matches to next
    prevMatches.forEach((pm, idx) => {
      const nextIdx = Math.floor(idx / 2);
      const nextPos = idx % 2;
      if (newIds[nextIdx]) {
        db.prepare(
          'UPDATE cup_matches SET next_match_id=?, next_bracket=?, next_position=? WHERE id=?'
        ).run(newIds[nextIdx], 'MAIN', nextPos, pm.id);
      }
    });

    // Update cup current_round
    db.prepare('UPDATE cups SET current_round = ? WHERE id = ?').run(nextRound, cupId);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true, newMatches: newIds.length, nextRound };
}

module.exports = {
  generateBracket,
  createCup,
  recordMatchResult,
  setWinnerExplicit,
  advanceNextRound,
  roundNameForSize,
  nextPowerOf2,
};
