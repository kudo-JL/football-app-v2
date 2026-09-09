/**
 * SQLite database connection (Node 22+ built-in `node:sqlite`).
 * No native dependencies, no compile, no Python needed.
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'football.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH);

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(schema);

// In-place migrations: add new columns to existing databases (idempotent).
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('cups', 'current_round', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('cups', 'bracket_size', 'INTEGER NOT NULL DEFAULT 4');
ensureColumn('cup_matches', 'home_score_et', 'INTEGER');
ensureColumn('cup_matches', 'away_score_et', 'INTEGER');
ensureColumn('cup_matches', 'home_penalties', 'INTEGER');
ensureColumn('cup_matches', 'away_penalties', 'INTEGER');
ensureColumn('cup_matches', 'decided_by', "TEXT NOT NULL DEFAULT 'NORMAL'");
ensureColumn('leagues', 'is_public', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('leagues', 'is_featured', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
ensureColumn('users', 'is_verified', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'verification_token', 'TEXT');
ensureColumn('users', 'verification_expires_at', 'TEXT');
ensureColumn('users', 'is_super_admin', 'INTEGER NOT NULL DEFAULT 0');  // Only the first user gets this — gates /admin/users/:id/delete and manual verify

// Migration: auto-verify users who registered BEFORE email verification feature
// (they have no verification_token). New users after this point will start
// with is_verified=0 and need to verify via email.
db.exec(`UPDATE users SET is_verified = 1 WHERE verification_token IS NULL`);

// SECURITY: Demote the two well-known seed test accounts (admin@a.com, a@a.com)
// in case an older version of this app auto-promoted them to ADMIN. They have
// weak passwords and known emails, so they should NOT be system admins.
// If you previously relied on these as admin, you can re-promote with
// `node scripts/make-admin.js <email>` after creating your own secure account.
db.exec(`UPDATE users SET role = 'user' WHERE email IN ('admin@a.com', 'a@a.com') AND role = 'ADMIN'`);

// SECURITY NOTE: We intentionally do NOT auto-promote any new account to ADMIN.
// The owner of the system should manually run `node scripts/make-admin.js <email>`
// to promote their own account.

// Ensure players table exists (CREATE IF NOT EXISTS handles this, but
// be defensive in case the user is on an old DB that pre-dated this table)
const playersTableExists = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='players'")
  .get();
if (!playersTableExists) {
  db.exec(`
    CREATE TABLE players (
      id            TEXT PRIMARY KEY,
      team_id       TEXT NOT NULL,
      name          TEXT NOT NULL,
      jersey_number INTEGER,
      birth_date    TEXT,
      position      TEXT DEFAULT 'MID',
      photo         TEXT DEFAULT '',
      notes         TEXT DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_players_team ON players(team_id);
  `);
}

if (process.env.NODE_ENV !== 'test') {
  process.stderr.write('[db] Connected: ' + DB_PATH + '\n');
}

module.exports = db;
