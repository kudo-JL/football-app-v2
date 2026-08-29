/**
 * Stats — recalculate standings based on FINISHED matches in a section.
 * Pure function over the DB.
 */
const db = require('./db');

function recalcTeam(teamId) {
  const matches = db
    .prepare(
      `SELECT home_team_id, away_team_id, home_score, away_score, status
       FROM matches
       WHERE status = 'FINISHED' AND (home_team_id = ? OR away_team_id = ?)`
    )
    .all(teamId, teamId);

  let played = 0,
    won = 0,
    drawn = 0,
    lost = 0,
    gf = 0,
    ga = 0,
    points = 0;

  for (const m of matches) {
    played += 1;
    const isHome = m.home_team_id === teamId;
    const myScore = isHome ? m.home_score : m.away_score;
    const theirScore = isHome ? m.away_score : m.home_score;
    gf += myScore;
    ga += theirScore;

    if (myScore > theirScore) {
      won += 1;
      points += 3;
    } else if (myScore === theirScore) {
      drawn += 1;
      points += 1;
    } else {
      lost += 1;
    }
  }

  db.prepare(
    `UPDATE teams SET played=?, won=?, drawn=?, lost=?, goals_for=?, goals_against=?, points=?, updated_at=datetime('now') WHERE id=?`
  ).run(played, won, drawn, lost, gf, ga, points, teamId);
}

function recalcSection(sectionId) {
  const teamIds = db
    .prepare('SELECT id FROM teams WHERE section_id = ?')
    .all(sectionId)
    .map((r) => r.id);
  for (const id of teamIds) recalcTeam(id);
}

function standings(sectionId, promotedCount = 0, relegatedCount = 0) {
  const teams = db
    .prepare(
      `SELECT id, name, short_name, color, logo, played, won, drawn, lost,
              goals_for, goals_against, points, point_deduction, deduction_reason, status
       FROM teams
       WHERE section_id = ?
       ORDER BY (points - point_deduction) DESC,
                (goals_for - goals_against) DESC,
                goals_for DESC,
                name ASC`
    )
    .all(sectionId);

  return teams.map((t, idx) => ({
    ...t,
    rank: idx + 1,
    effective_points: t.points - (t.point_deduction || 0),
    goal_diff: t.goals_for - t.goals_against,
    is_promoted: idx < promotedCount,
    is_relegated: idx >= teams.length - relegatedCount && relegatedCount > 0,
  }));
}

/**
 * Compute additional stats per team:
 *  - biggest_win:    { diff, score, against_name } (best victory)
 *  - biggest_loss:   { diff, score, against_name } (worst defeat)
 *  - clean_sheets:   number of matches with GA=0
 *  - failed_to_score: number of matches with GF=0
 *  - current_streak: { type: 'W'|'D'|'L'|null, count: N }
 *  - longest_win_streak: number (longest run of consecutive wins)
 *  - longest_unbeaten: number (longest run of W or D)
 *  - form_string: e.g. "WWDLLW" (last 5 results)
 */
function getAdditionalStats(sectionId) {
  const teams = db
    .prepare('SELECT id, name, short_name, color, logo FROM teams WHERE section_id = ? ORDER BY name')
    .all(sectionId);

  // All FINISHED matches, ordered chronologically (oldest first)
  const matches = db
    .prepare(
      `SELECT m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score,
              m.matchday_id, md."order" AS md_order
       FROM matches m
       JOIN matchdays md ON md.id = m.matchday_id
       WHERE md.section_id = ? AND m.status = 'FINISHED'
       ORDER BY md."order" ASC, m.created_at ASC`
    )
    .all(sectionId);

  const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || '?';

  const result = {};
  teams.forEach((t) => {
    const myMatches = matches
      .filter((m) => m.home_team_id === t.id || m.away_team_id === t.id)
      .sort((a, b) => a.md_order - b.md_order);

    let biggestWin = null; // { diff, score, against }
    let biggestLoss = null;
    let cleanSheets = 0;
    let failedToScore = 0;
    const results = []; // 'W'|'D'|'L'

    for (const m of myMatches) {
      const isHome = m.home_team_id === t.id;
      const myScore = isHome ? m.home_score : m.away_score;
      const oppScore = isHome ? m.away_score : m.home_score;
      const oppId = isHome ? m.away_team_id : m.home_team_id;
      const diff = myScore - oppScore;

      if (oppScore === 0) cleanSheets += 1;
      if (myScore === 0) failedToScore += 1;

      if (diff > 0) {
        results.push('W');
        if (!biggestWin || diff > biggestWin.diff) {
          biggestWin = { diff, score: `${myScore}-${oppScore}`, against: teamName(oppId) };
        }
      } else if (diff < 0) {
        results.push('L');
        if (!biggestLoss || -diff > biggestLoss.diff) {
          biggestLoss = { diff: -diff, score: `${myScore}-${oppScore}`, against: teamName(oppId) };
        }
      } else {
        results.push('D');
      }
    }

    // Current streak (from the end)
    let currentStreak = { type: null, count: 0 };
    if (results.length > 0) {
      const last = results[results.length - 1];
      let count = 0;
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i] === last) count++;
        else break;
      }
      currentStreak = { type: last, count };
    }

    // Longest winning streak
    let longestWinStreak = 0;
    let currentRun = 0;
    for (const r of results) {
      if (r === 'W') {
        currentRun += 1;
        if (currentRun > longestWinStreak) longestWinStreak = currentRun;
      } else {
        currentRun = 0;
      }
    }

    // Longest unbeaten streak (W or D)
    let longestUnbeaten = 0;
    let unbeatenRun = 0;
    for (const r of results) {
      if (r === 'W' || r === 'D') {
        unbeatenRun += 1;
        if (unbeatenRun > longestUnbeaten) longestUnbeaten = unbeatenRun;
      } else {
        unbeatenRun = 0;
      }
    }

    // Form string (last 5 results, oldest to newest)
    const formString = results.slice(-5).join('');

    result[t.id] = {
      team: t,
      biggestWin,
      biggestLoss,
      cleanSheets,
      failedToScore,
      currentStreak,
      longestWinStreak,
      longestUnbeaten,
      formString,
      totalMatches: myMatches.length,
    };
  });

  return result;
}

module.exports = { recalcTeam, recalcSection, standings, getAdditionalStats };
