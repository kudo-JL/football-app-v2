-- Football League Manager - SQLite Schema
-- All-in-one schema; SQLite is enough for this use case.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'USER',  -- USER | ADMIN
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leagues (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  description           TEXT DEFAULT '',
  logo                  TEXT DEFAULT '',
  season                TEXT NOT NULL,
  country               TEXT DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'UPCOMING', -- UPCOMING | ACTIVE | FINISHED | ARCHIVED
  promoted_teams_count  INTEGER NOT NULL DEFAULT 0,
  relegated_teams_count INTEGER NOT NULL DEFAULT 0,
  owner_id              TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_leagues_owner ON leagues(owner_id);

CREATE TABLE IF NOT EXISTS sections (
  id                    TEXT PRIMARY KEY,
  league_id             TEXT NOT NULL,
  name                  TEXT NOT NULL,
  "order"               INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT DEFAULT '',
  promoted_teams_count  INTEGER NOT NULL DEFAULT 0,
  relegated_teams_count INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sections_league ON sections(league_id);

CREATE TABLE IF NOT EXISTS matchdays (
  id           TEXT PRIMARY KEY,
  section_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  "order"      INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_matchdays_section ON matchdays(section_id);

CREATE TABLE IF NOT EXISTS teams (
  id               TEXT PRIMARY KEY,
  section_id       TEXT NOT NULL,
  name             TEXT NOT NULL,
  short_name       TEXT DEFAULT '',
  logo             TEXT DEFAULT '',
  color            TEXT DEFAULT '',
  founded          INTEGER,
  status           TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | PROMOTED | RELEGATED
  played           INTEGER NOT NULL DEFAULT 0,
  won              INTEGER NOT NULL DEFAULT 0,
  drawn            INTEGER NOT NULL DEFAULT 0,
  lost             INTEGER NOT NULL DEFAULT 0,
  goals_for        INTEGER NOT NULL DEFAULT 0,
  goals_against    INTEGER NOT NULL DEFAULT 0,
  points           INTEGER NOT NULL DEFAULT 0,
  point_deduction  INTEGER NOT NULL DEFAULT 0,
  deduction_reason TEXT DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_teams_section ON teams(section_id);

CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  jersey_number INTEGER,
  birth_date    TEXT,
  position      TEXT DEFAULT 'MID',  -- GK | DEF | MID | FWD
  photo         TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);

CREATE TABLE IF NOT EXISTS matches (
  id            TEXT PRIMARY KEY,
  home_team_id  TEXT NOT NULL,
  away_team_id  TEXT NOT NULL,
  matchday_id   TEXT,
  scheduled_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED | LIVE | FINISHED | POSTPONED | CANCELLED
  venue         TEXT DEFAULT '',
  home_score    INTEGER NOT NULL DEFAULT 0,
  away_score    INTEGER NOT NULL DEFAULT 0,
  minute        INTEGER,
  stream_url    TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (matchday_id)  REFERENCES matchdays(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_home ON matches(home_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_away ON matches(away_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_matchday ON matches(matchday_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('app_name', 'Football League Manager'),
  ('default_promoted', '2'),
  ('default_relegated', '2'),
  ('theme', 'light');

-- ============================================================
-- CUPS (Knockout / Double elimination tournaments)
-- ============================================================

CREATE TABLE IF NOT EXISTS cups (
  id            TEXT PRIMARY KEY,
  league_id     TEXT,                          -- NULL for independent
  section_id    TEXT,                          -- if team_source = SECTION
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'KNOCKOUT',  -- KNOCKOUT | DOUBLE_ELIMINATION
  pairing_mode  TEXT NOT NULL DEFAULT 'RANDOM',   -- RANDOM | SEEDED
  team_source   TEXT NOT NULL DEFAULT 'MANUAL',   -- MANUAL | SECTION
  status        TEXT NOT NULL DEFAULT 'DRAFT',    -- DRAFT | IN_PROGRESS | FINISHED
  current_round INTEGER NOT NULL DEFAULT 1,
  bracket_size  INTEGER NOT NULL DEFAULT 4,    -- padded size (next power of 2) for round naming
  winner_team_id TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (league_id)  REFERENCES leagues(id)  ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cups_league ON cups(league_id);

CREATE TABLE IF NOT EXISTS cup_matches (
  id            TEXT PRIMARY KEY,
  cup_id        TEXT NOT NULL,
  bracket       TEXT NOT NULL DEFAULT 'MAIN',   -- MAIN | LOSERS
  round         INTEGER NOT NULL,               -- 1 = first round
  round_name    TEXT NOT NULL,                  -- "دور الـ 16", "ربع النهائي", ...
  position      INTEGER NOT NULL DEFAULT 0,     -- 0..n within round
  home_team_id  TEXT,
  away_team_id  TEXT,
  home_score    INTEGER,                        -- 90-min (full time) result
  away_score    INTEGER,                        -- 90-min (full time) result
  home_score_et INTEGER,                        -- after extra time (if played)
  away_score_et INTEGER,                        -- after extra time (if played)
  home_penalties INTEGER,                       -- penalty shootout home
  away_penalties INTEGER,                       -- penalty shootout away
  decided_by    TEXT NOT NULL DEFAULT 'NORMAL', -- NORMAL | EXTRA_TIME | PENALTIES
  winner_team_id TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SCHEDULED | FINISHED | BYE
  scheduled_at  TEXT,
  next_match_id TEXT,                           -- for advancement
  next_bracket  TEXT,                           -- MAIN or LOSERS
  next_position INTEGER,                        -- target position in next round
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cup_id)        REFERENCES cups(id)        ON DELETE CASCADE,
  FOREIGN KEY (home_team_id)  REFERENCES teams(id)       ON DELETE SET NULL,
  FOREIGN KEY (away_team_id)  REFERENCES teams(id)       ON DELETE SET NULL,
  FOREIGN KEY (winner_team_id) REFERENCES teams(id)      ON DELETE SET NULL,
  FOREIGN KEY (next_match_id) REFERENCES cup_matches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cup_matches_cup ON cup_matches(cup_id);
CREATE INDEX IF NOT EXISTS idx_cup_matches_round ON cup_matches(cup_id, round, bracket);
