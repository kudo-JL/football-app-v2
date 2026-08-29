/**
 * Standings — advanced view: overall, first leg, return leg, form, home/away splits.
 *
 * First leg: matches in matchdays 1..N/2 (where N = total rounds)
 * Return leg: matches in matchdays N/2+1..N
 * Form: last N finished matches per team (configurable, default 5)
 * Home/Away: separate W/D/L splits for home and away matches
 */
const db = require('./db');

/**
 * Compute standings for a given set of matches.
 * matches: array of { home_team_id, away_team_id, home_score, away_score, status }
 * Returns Map(teamId -> stats with home_/away_ splits)
 */
function computeStats(matches) {
  const stats = new Map();
  const ensure = (id) => {
    if (!stats.has(id)) {
      stats.set(id, {
        played: 0, won: 0, drawn: 0, lost: 0,
        gf: 0, ga: 0, points: 0,
        point_deduction: 0,
        home: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 },
        away: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 },
      });
    }
    return stats.get(id);
  };
  for (const m of matches) {
    if (m.status !== 'FINISHED') continue;
    const home = ensure(m.home_team_id);
    const away = ensure(m.away_team_id);
    // Overall
    home.played += 1;
    away.played += 1;
    home.gf += m.home_score;
    home.ga += m.away_score;
    away.gf += m.away_score;
    away.ga += m.home_score;
    // Home split
    home.home.played += 1;
    home.home.gf += m.home_score;
    home.home.ga += m.away_score;
    // Away split
    away.away.played += 1;
    away.away.gf += m.away_score;
    away.away.ga += m.home_score;
    // Results
    if (m.home_score > m.away_score) {
      home.won += 1;
      home.points += 3;
      home.home.won += 1;
      home.home.points += 3;
      away.lost += 1;
      away.away.lost += 1;
    } else if (m.home_score < m.away_score) {
      away.won += 1;
      away.points += 3;
      away.away.won += 1;
      away.away.points += 3;
      home.lost += 1;
      home.home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
      home.home.drawn += 1;
      home.home.points += 1;
      away.away.drawn += 1;
      away.away.points += 1;
    }
  }
  return stats;
}

/**
 * Build a sorted standings array for a section, given a stats map and team list.
 */
function buildTable(teams, stats, pointDeductions) {
  return teams
    .map((t) => {
      const s = stats.get(t.id) || { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
      const deduction = (pointDeductions && pointDeductions.get(t.id)) || 0;
      return {
        id: t.id,
        name: t.name,
        short_name: t.short_name,
        color: t.color,
        logo: t.logo,
        ...s,
        goal_diff: s.gf - s.ga,
        point_deduction: deduction,
        effective_points: s.points - deduction,
      };
    })
    .sort((a, b) => {
      if (b.effective_points !== a.effective_points) return b.effective_points - a.effective_points;
      if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return (a.name || '').localeCompare(b.name || '');
    });
}

/**
 * Get the form (last N match results) for each team in a section.
 * Returns Map(teamId -> array of 'W'|'D'|'L' for each match, oldest first)
 */
function getForm(sectionId, n = 5) {
  const matches = db
    .prepare(
      `SELECT m.*, md.section_id, md."order" AS md_order
       FROM matches m
       JOIN matchdays md ON md.id = m.matchday_id
       WHERE md.section_id = ? AND m.status = 'FINISHED'
       ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC, m.id DESC`
    )
    .all(sectionId);

  const form = new Map();
  // For each team, take first N matches
  for (const m of matches) {
    for (const teamId of [m.home_team_id, m.away_team_id]) {
      if (!form.has(teamId)) form.set(teamId, []);
      if (form.get(teamId).length < n) {
        let result = 'D';
        if (m.home_score > m.away_score) result = m.home_team_id === teamId ? 'W' : 'L';
        else if (m.home_score < m.away_score) result = m.away_team_id === teamId ? 'W' : 'L';
        else result = 'D';
        form.get(teamId).push(result);
      }
    }
  }
  // Reverse to show oldest first
  for (const [id, arr] of form.entries()) {
    form.set(id, arr.reverse());
  }
  return form;
}

/**
 * Advanced standings for a section: overall, first leg, return leg.
 * Returns { overall, firstLeg, returnLeg, teams, form }
 */
function getAdvancedStandings(sectionId, formN = 5) {
  // Load all teams in section
  const teams = db
    .prepare('SELECT id, name, short_name, color, logo, point_deduction, deduction_reason FROM teams WHERE section_id = ?')
    .all(sectionId);

  // Load all matchdays in section, ordered
  const matchdays = db
    .prepare('SELECT id, "order" FROM matchdays WHERE section_id = ? ORDER BY "order"')
    .all(sectionId);
  const totalRounds = matchdays.length;
  const halfRounds = Math.floor(totalRounds / 2);

  // All matches in section
  const allMatches = db
    .prepare(
      `SELECT m.*, md."order" AS md_order
       FROM matches m
       JOIN matchdays md ON md.id = m.matchday_id
       WHERE md.section_id = ?`
    )
    .all(sectionId);

  // Split by leg
  const overall = allMatches;
  const firstLeg = allMatches.filter((m) => m.md_order <= halfRounds);
  const returnLeg = allMatches.filter((m) => m.md_order > halfRounds);

  // Point deductions map
  const pointDeductions = new Map(teams.map((t) => [t.id, t.point_deduction || 0]));

  // Compute stats
  const overallStats = computeStats(overall);
  const firstStats = computeStats(firstLeg);
  const returnStats = computeStats(returnLeg);

  // Build tables
  const overallTable = buildTable(teams, overallStats, pointDeductions);
  const firstTable = buildTable(teams, firstStats, pointDeductions);
  const returnTable = buildTable(teams, returnStats, pointDeductions);

  // Form
  const form = getForm(sectionId, formN);

  // Attach rank
  const addRank = (arr) => arr.map((t, i) => ({ ...t, rank: i + 1 }));
  const attachForm = (arr) =>
    arr.map((t) => ({ ...t, form: form.get(t.id) || [] }));

  return {
    teams,
    overall: attachForm(addRank(overallTable)),
    firstLeg: attachForm(addRank(firstTable)),
    returnLeg: attachForm(addRank(returnTable)),
    totalRounds,
    halfRounds,
    formN,
  };
}

/**
 * Compute ranking evolution over matchdays (for Chart.js).
 * For each matchday, calculate the standings based on FINISHED matches in
 * that matchday and earlier, then track each team's position.
 * Returns:
 *   { matchdays: [{id, name, order}], teams: [team], ranks: Map(teamId -> [rank per matchday]) }
 */
function getRankingEvolution(sectionId) {
  const teams = db
    .prepare('SELECT id, name, short_name, color, logo FROM teams WHERE section_id = ? ORDER BY name')
    .all(sectionId);
  if (teams.length === 0) return { matchdays: [], teams: [], ranks: new Map() };

  const matchdays = db
    .prepare('SELECT id, name, "order" FROM matchdays WHERE section_id = ? ORDER BY "order"')
    .all(sectionId);

  // All matches joined with matchday order, sorted
  const allMatches = db
    .prepare(
      `SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.status, m.matchday_id,
              md."order" AS md_order
       FROM matches m
       JOIN matchdays md ON md.id = m.matchday_id
       WHERE md.section_id = ?
       ORDER BY md."order" ASC`
    )
    .all(sectionId);

  const pointDeductions = new Map(
    db
      .prepare('SELECT id, point_deduction FROM teams WHERE section_id = ?')
      .all(sectionId)
      .map((t) => [t.id, t.point_deduction || 0])
  );

  // For each matchday, compute standings using only matches in that matchday + earlier FINISHED matches
  const ranks = new Map();
  teams.forEach((t) => ranks.set(t.id, []));

  let cumulativeMatches = [];
  const matchesByMatchday = new Map();
  for (const m of allMatches) {
    if (!matchesByMatchday.has(m.matchday_id)) matchesByMatchday.set(m.matchday_id, []);
    matchesByMatchday.get(m.matchday_id).push(m);
  }

  for (const md of matchdays) {
    // Add this matchday's matches to cumulative list
    const mdMatches = matchesByMatchday.get(md.id) || [];
    const hasFinishedThisRound = mdMatches.some((m) => m.status === 'FINISHED');
    for (const m of mdMatches) {
      if (m.status === 'FINISHED') cumulativeMatches.push(m);
    }
    // Only record a rank if this round had finished matches
    if (!hasFinishedThisRound) {
      // Push null so the line breaks here (no straight-line extension)
      teams.forEach((t) => {
        const rankList = ranks.get(t.id);
        if (rankList) rankList.push(null);
      });
      continue;
    }
    // Compute standings from cumulative matches
    const stats = computeStats(cumulativeMatches);
    const table = buildTable(teams, stats, pointDeductions);
    table.forEach((t, i) => {
      const rankList = ranks.get(t.id);
      if (rankList) rankList.push(i + 1);
    });
  }

  return { matchdays, teams, ranks };
}

module.exports = { getAdvancedStandings, getForm, computeStats, buildTable, getRankingEvolution };
