// db.js — SQLite database for Flappy Bert leaderboard
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { csvCell } = require('./lib/csv-cell');
const { sanitizeName } = require('./lib/sanitize-name');

// Use persistent disk if available (Render), otherwise local directory.
// FLAPPY_DATA_DIR overrides both (used by tests to point at an isolated temp dir
// so they can NEVER touch the real ./flappy_bert.db; unset in prod → prior behavior).
const DATA_DIR = process.env.FLAPPY_DATA_DIR || (fs.existsSync('/data') ? '/data' : __dirname);
const DB_PATH = path.join(DATA_DIR, 'flappy_bert.db');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archives');
let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Ensure archives directory exists
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      telegram_id   INTEGER PRIMARY KEY,
      username      TEXT,
      first_name    TEXT NOT NULL DEFAULT 'Player',
      skin          TEXT DEFAULT 'default',
      coins         INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scores (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id   INTEGER NOT NULL,
      score         INTEGER NOT NULL,
      level         INTEGER DEFAULT 1,
      coins_earned  INTEGER DEFAULT 0,
      week_start    TEXT NOT NULL,
      played_at     TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (telegram_id) REFERENCES players(telegram_id)
    );

    CREATE INDEX IF NOT EXISTS idx_scores_week
      ON scores(week_start, score DESC);

    CREATE INDEX IF NOT EXISTS idx_scores_player
      ON scores(telegram_id, week_start);

    CREATE TABLE IF NOT EXISTS tournaments (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      sponsor       TEXT,
      start_time    TEXT NOT NULL,
      end_time      TEXT NOT NULL,
      status        TEXT DEFAULT 'scheduled',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tournament_scores (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id   TEXT NOT NULL,
      telegram_id     INTEGER NOT NULL,
      score           INTEGER NOT NULL,
      level           INTEGER DEFAULT 1,
      coins_earned    INTEGER DEFAULT 0,
      played_at       TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
      FOREIGN KEY (telegram_id) REFERENCES players(telegram_id)
    );

    CREATE TABLE IF NOT EXISTS banned_players (
      telegram_id   INTEGER PRIMARY KEY,
      reason        TEXT,
      banned_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tscore_tournament
      ON tournament_scores(tournament_id, score DESC);
  `);

  // Phase 1: badges column
  try { db.exec("ALTER TABLE players ADD COLUMN badges TEXT DEFAULT '[]'"); } catch(e) {}

  return db;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getWeekStart(date = new Date()) {
  const utc = new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()
  ));
  const day = utc.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  utc.setUTCDate(utc.getUTCDate() - diff);
  utc.setUTCHours(0, 0, 0, 0);
  return utc.toISOString().slice(0, 10); // "2026-02-09"
}

function getNextMondayUTC() {
  const now = new Date();
  const utc = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()
  ));
  const day = utc.getUTCDay();
  const daysUntilMon = day === 0 ? 1 : (8 - day);
  utc.setUTCDate(utc.getUTCDate() + daysUntilMon);
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

// ── Player CRUD ─────────────────────────────────────────────────────

function upsertPlayer(telegramId, firstName, username) {
  // Sanitise display fields at the storage boundary (strip control chars, collapse
  // whitespace, clamp length) so they can't corrupt the CSV archive or cards.
  const name = sanitizeName(firstName);
  const trimmedU = username == null ? '' : String(username).trim();
  const uname = trimmedU === '' ? null : sanitizeName(username, 32);
  const stmt = db.prepare(`
    INSERT INTO players (telegram_id, first_name, username)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      first_name = excluded.first_name,
      username   = excluded.username
  `);
  stmt.run(telegramId, name, uname);
}

function getPlayer(telegramId) {
  return db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(telegramId);
}

function addCoins(telegramId, amount) {
  // Backstop: ignore non-positive / absurd deltas (validateScore already bounds
  // coins_earned per submission; this guards any other caller from corrupting it).
  const delta = Number(amount);
  if (!Number.isInteger(delta) || delta <= 0 || delta > 100000) return;
  db.prepare('UPDATE players SET coins = coins + ? WHERE telegram_id = ?')
    .run(delta, telegramId);
}

// ── Score submission ────────────────────────────────────────────────

function submitScore(telegramId, score, level, coinsEarned) {
  const week = getWeekStart();
  db.prepare(`
    INSERT INTO scores (telegram_id, score, level, coins_earned, week_start)
    VALUES (?, ?, ?, ?, ?)
  `).run(telegramId, score, level, coinsEarned, week);

  if (coinsEarned > 0) {
    addCoins(telegramId, coinsEarned);
  }
}

// ── Leaderboard queries ─────────────────────────────────────────────

function getWeeklyLeaderboard(limit = 20) {
  const week = getWeekStart();
  // Tiebreak: among equal best_score, whoever REACHED that score earliest wins —
  // best_at = MIN(played_at) over the player's rows equal to their best score (b.best).
  return db.prepare(`
    SELECT
      p.telegram_id,
      p.first_name,
      p.username,
      p.skin,
      p.badges,
      MAX(s.score) AS best_score,
      COUNT(s.id)  AS games_played,
      MAX(s.level) AS max_level,
      MIN(CASE WHEN s.score = b.best THEN s.played_at END) AS best_at
    FROM scores s
    JOIN players p ON p.telegram_id = s.telegram_id
    JOIN (SELECT telegram_id, MAX(score) AS best FROM scores WHERE week_start = ? GROUP BY telegram_id) b
      ON b.telegram_id = s.telegram_id
    WHERE s.week_start = ?
    GROUP BY s.telegram_id
    ORDER BY best_score DESC, best_at ASC
    LIMIT ?
  `).all(week, week, limit);
}

function getPlayerWeeklyBest(telegramId) {
  const week = getWeekStart();
  return db.prepare(`
    SELECT MAX(score) AS best_score, COUNT(*) AS games_played, MAX(level) AS max_level
    FROM scores
    WHERE telegram_id = ? AND week_start = ?
  `).get(telegramId, week);
}

function getPlayerRank(telegramId) {
  const week = getWeekStart();
  // Same composite ordering as getWeeklyLeaderboard so the caption rank can never
  // disagree with the card's row order (best_score DESC, earliest-time-at-best ASC).
  const row = db.prepare(`
    SELECT rank FROM (
      SELECT s.telegram_id AS telegram_id,
        RANK() OVER (ORDER BY MAX(s.score) DESC,
                     MIN(CASE WHEN s.score = b.best THEN s.played_at END) ASC) as rank
      FROM scores s
      JOIN (SELECT telegram_id, MAX(score) AS best FROM scores WHERE week_start = ? GROUP BY telegram_id) b
        ON b.telegram_id = s.telegram_id
      WHERE s.week_start = ?
      GROUP BY s.telegram_id
    ) WHERE telegram_id = ?
  `).get(week, week, telegramId);
  return row ? row.rank : null;
}

function getAllTimeStats(telegramId) {
  return db.prepare(`
    SELECT
      MAX(score)   AS all_time_best,
      COUNT(*)     AS total_games,
      SUM(coins_earned) AS total_coins_earned,
      MAX(level)   AS max_level_ever
    FROM scores
    WHERE telegram_id = ?
  `).get(telegramId);
}

// ── Tournaments ──────────────────────────────────────────────────────

function createTournament(id, name, sponsor, startTime, endTime) {
  db.prepare(`
    INSERT OR IGNORE INTO tournaments (id, name, sponsor, start_time, end_time)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, sponsor, startTime, endTime);
}

function getTournament(id) {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
}

function getActiveTournaments() {
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM tournaments
    WHERE start_time <= ? AND end_time >= ?
  `).all(now, now);
}

function getAllTournaments() {
  return db.prepare('SELECT * FROM tournaments ORDER BY start_time DESC').all();
}

function submitTournamentScore(tournamentId, telegramId, score, level, coinsEarned) {
  db.prepare(`
    INSERT INTO tournament_scores (tournament_id, telegram_id, score, level, coins_earned)
    VALUES (?, ?, ?, ?, ?)
  `).run(tournamentId, telegramId, score, level, coinsEarned);
}

function getTournamentLeaderboard(tournamentId, limit = 50, since = null) {
  // The `since` boundary (from lib/tournament-reset) must apply IDENTICALLY to the
  // tiebreak subquery and the outer filter, so a pre-boundary achievement can never
  // win a post-boundary tie. best_at = earliest played_at at the (post-boundary) best.
  const subWhere = since ? 'WHERE tournament_id = ? AND played_at >= ?' : 'WHERE tournament_id = ?';
  const where = since ? 'WHERE ts.tournament_id = ? AND ts.played_at >= ?' : 'WHERE ts.tournament_id = ?';
  const params = since
    ? [tournamentId, since, tournamentId, since, limit]
    : [tournamentId, tournamentId, limit];
  return db.prepare(`
    SELECT
      p.telegram_id, p.first_name, p.username, p.skin,
      MAX(ts.score) AS best_score,
      COUNT(ts.id)  AS games_played,
      MAX(ts.level) AS max_level,
      MIN(CASE WHEN ts.score = b.best THEN ts.played_at END) AS best_at
    FROM tournament_scores ts
    JOIN players p ON p.telegram_id = ts.telegram_id
    JOIN (SELECT telegram_id, MAX(score) AS best FROM tournament_scores ${subWhere} GROUP BY telegram_id) b
      ON b.telegram_id = ts.telegram_id
    ${where}
    GROUP BY ts.telegram_id
    ORDER BY best_score DESC, best_at ASC
    LIMIT ?
  `).all(...params);
}

function getTournamentPlayerRank(tournamentId, telegramId, since = null) {
  // Composite ordering identical to getTournamentLeaderboard (incl. the `since`
  // boundary on the tiebreak) so the rank caption matches the card row order.
  const subWhere = since ? 'WHERE tournament_id = ? AND played_at >= ?' : 'WHERE tournament_id = ?';
  const where = since ? 'WHERE ts.tournament_id = ? AND ts.played_at >= ?' : 'WHERE ts.tournament_id = ?';
  const params = since
    ? [tournamentId, since, tournamentId, since, telegramId]
    : [tournamentId, tournamentId, telegramId];
  const row = db.prepare(`
    SELECT rank FROM (
      SELECT ts.telegram_id AS telegram_id,
        RANK() OVER (ORDER BY MAX(ts.score) DESC,
                     MIN(CASE WHEN ts.score = b.best THEN ts.played_at END) ASC) as rank
      FROM tournament_scores ts
      JOIN (SELECT telegram_id, MAX(score) AS best FROM tournament_scores ${subWhere} GROUP BY telegram_id) b
        ON b.telegram_id = ts.telegram_id
      ${where}
      GROUP BY ts.telegram_id
    ) WHERE telegram_id = ?
  `).get(...params);
  return row ? row.rank : null;
}

// ── Admin: score removal ─────────────────────────────────────────────

function removePlayerWeekScores(telegramId, weekStart) {
  db.prepare('DELETE FROM scores WHERE telegram_id = ? AND week_start = ?')
    .run(telegramId, weekStart);
}

function removeAllPlayerScores(telegramId) {
  db.prepare('DELETE FROM scores WHERE telegram_id = ?').run(telegramId);
}

function removeTournamentScores(telegramId, tournamentId) {
  db.prepare('DELETE FROM tournament_scores WHERE telegram_id = ? AND tournament_id = ?')
    .run(telegramId, tournamentId);
}

function resetTournamentScores(tournamentId) {
  db.prepare('DELETE FROM tournament_scores WHERE tournament_id = ?').run(tournamentId);
}

// Count of score rows for a tournament — used by the /resettournament guard to
// show the admin exactly what a reset would destroy before they confirm.
function countTournamentScores(tournamentId) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM tournament_scores WHERE tournament_id = ?').get(tournamentId);
  return row ? row.n : 0;
}

// Remove a tournament row entirely (used for ops cleanup of duplicate/orphan
// tournaments). foreign_keys is ON with no ON DELETE CASCADE, so the child
// score rows MUST be deleted first — wrapped in a transaction so it's atomic.
// Returns { scores, tournament } = rows deleted from each table.
function deleteTournament(id) {
  const tx = db.transaction((tid) => {
    const scores = db.prepare('DELETE FROM tournament_scores WHERE tournament_id = ?').run(tid).changes;
    const tournament = db.prepare('DELETE FROM tournaments WHERE id = ?').run(tid).changes;
    return { scores, tournament };
  });
  return tx(id);
}

function banPlayer(telegramId, reason) {
  db.prepare('INSERT OR REPLACE INTO banned_players (telegram_id, reason) VALUES (?, ?)')
    .run(telegramId, reason || 'cheating');
}

function unbanPlayer(telegramId) {
  db.prepare('DELETE FROM banned_players WHERE telegram_id = ?').run(telegramId);
}

function isBanned(telegramId) {
  return !!db.prepare('SELECT 1 FROM banned_players WHERE telegram_id = ?').get(telegramId);
}

function updatePlayerBadges(telegramId, badges) {
  // Defensive backstop (callers already allowlist): only short string ids,
  // hard-capped, so a malformed/oversized array can never bloat the row or the
  // per-render JSON.parse on the public leaderboard cards.
  const clean = (Array.isArray(badges) ? badges : [])
    .filter((b) => typeof b === 'string' && b.length <= 32)
    .slice(0, 16);
  db.prepare('UPDATE players SET badges = ? WHERE telegram_id = ?')
    .run(JSON.stringify(clean), telegramId);
}

// ── Weekly CSV Archive ────────────────────────────────────────────────

function archiveWeek(weekStart) {
  const week = weekStart || getWeekStart();
  const filename = `leaderboard-${week}.csv`;
  const filepath = path.join(ARCHIVE_DIR, filename);

  // Don't overwrite if already archived
  if (fs.existsSync(filepath)) return { filepath, filename, alreadyExists: true };

  const entries = db.prepare(`
    SELECT
      p.telegram_id,
      p.first_name,
      p.username,
      p.skin,
      MAX(s.score) AS best_score,
      COUNT(s.id)  AS games_played,
      MAX(s.level) AS max_level,
      SUM(s.coins_earned) AS total_coins,
      MIN(CASE WHEN s.score = b.best THEN s.played_at END) AS best_at
    FROM scores s
    JOIN players p ON p.telegram_id = s.telegram_id
    JOIN (SELECT telegram_id, MAX(score) AS best FROM scores WHERE week_start = ? GROUP BY telegram_id) b
      ON b.telegram_id = s.telegram_id
    WHERE s.week_start = ?
    GROUP BY s.telegram_id
    ORDER BY best_score DESC, best_at ASC
  `).all(week, week);

  if (entries.length === 0) return null;

  // Build CSV
  const header = 'rank,telegram_id,player_name,username,best_score,games_played,max_level,total_coins,skin';
  const rows = entries.map((e, i) => [
    i + 1, e.telegram_id, e.first_name, e.username || '',
    e.best_score, e.games_played, e.max_level, e.total_coins || 0, e.skin || 'default',
  ].map(csvCell).join(','));

  const csv = [header, ...rows].join('\n');
  fs.writeFileSync(filepath, csv, 'utf8');
  console.log(`📄 Archived week ${week}: ${entries.length} players → ${filename}`);

  return { filepath, filename, playerCount: entries.length };
}

function getArchiveList() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs.readdirSync(ARCHIVE_DIR)
    .filter(f => f.endsWith('.csv'))
    .sort()
    .reverse()
    .map(f => {
      const week = f.replace('leaderboard-', '').replace('.csv', '');
      const stats = fs.statSync(path.join(ARCHIVE_DIR, f));
      return { filename: f, week, size: stats.size, created: stats.mtime };
    });
}

function getArchivePath(week) {
  const filepath = path.join(ARCHIVE_DIR, `leaderboard-${week}.csv`);
  return fs.existsSync(filepath) ? filepath : null;
}

module.exports = {
  init,
  getWeekStart,
  getNextMondayUTC,
  upsertPlayer,
  getPlayer,
  addCoins,
  submitScore,
  getWeeklyLeaderboard,
  getPlayerWeeklyBest,
  getPlayerRank,
  getAllTimeStats,
  createTournament,
  getTournament,
  getActiveTournaments,
  getAllTournaments,
  submitTournamentScore,
  getTournamentLeaderboard,
  getTournamentPlayerRank,
  removePlayerWeekScores,
  removeAllPlayerScores,
  removeTournamentScores,
  resetTournamentScores,
  countTournamentScores,
  deleteTournament,
  banPlayer,
  unbanPlayer,
  isBanned,
  updatePlayerBadges,
  archiveWeek,
  getArchiveList,
  getArchivePath,
  ARCHIVE_DIR,
};
