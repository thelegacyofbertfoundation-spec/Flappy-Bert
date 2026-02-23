// db.js — SQLite database for Flappy Bert leaderboard
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use persistent disk if available (Render), otherwise local directory
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const DB_PATH = path.join(DATA_DIR, 'flappy_bert.db');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archives');
let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

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
  const stmt = db.prepare(`
    INSERT INTO players (telegram_id, first_name, username)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      first_name = excluded.first_name,
      username   = excluded.username
  `);
  stmt.run(telegramId, firstName || 'Player', username || null);
}

function getPlayer(telegramId) {
  return db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(telegramId);
}

function addCoins(telegramId, amount) {
  db.prepare('UPDATE players SET coins = coins + ? WHERE telegram_id = ?')
    .run(amount, telegramId);
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
  return db.prepare(`
    SELECT
      p.telegram_id,
      p.first_name,
      p.username,
      p.skin,
      MAX(s.score) AS best_score,
      COUNT(s.id)  AS games_played,
      MAX(s.level) AS max_level
    FROM scores s
    JOIN players p ON p.telegram_id = s.telegram_id
    WHERE s.week_start = ?
    GROUP BY s.telegram_id
    ORDER BY best_score DESC
    LIMIT ?
  `).all(week, limit);
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
  const leaderboard = getWeeklyLeaderboard(1000);
  const idx = leaderboard.findIndex(e => e.telegram_id === telegramId);
  return idx >= 0 ? idx + 1 : null;
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

function getTournamentLeaderboard(tournamentId, limit = 50) {
  return db.prepare(`
    SELECT
      p.telegram_id,
      p.first_name,
      p.username,
      p.skin,
      MAX(ts.score) AS best_score,
      COUNT(ts.id)  AS games_played,
      MAX(ts.level) AS max_level
    FROM tournament_scores ts
    JOIN players p ON p.telegram_id = ts.telegram_id
    WHERE ts.tournament_id = ?
    GROUP BY ts.telegram_id
    ORDER BY best_score DESC
    LIMIT ?
  `).all(tournamentId, limit);
}

function getTournamentPlayerRank(tournamentId, telegramId) {
  const lb = getTournamentLeaderboard(tournamentId, 1000);
  const idx = lb.findIndex(e => e.telegram_id === telegramId);
  return idx >= 0 ? idx + 1 : null;
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
      SUM(s.coins_earned) AS total_coins
    FROM scores s
    JOIN players p ON p.telegram_id = s.telegram_id
    WHERE s.week_start = ?
    GROUP BY s.telegram_id
    ORDER BY best_score DESC
  `).all(week);

  if (entries.length === 0) return null;

  // Build CSV
  const header = 'rank,telegram_id,player_name,username,best_score,games_played,max_level,total_coins,skin';
  const rows = entries.map((e, i) => {
    const name = (e.first_name || '').replace(/,/g, '');
    const uname = e.username || '';
    return `${i + 1},${e.telegram_id},${name},${uname},${e.best_score},${e.games_played},${e.max_level},${e.total_coins || 0},${e.skin || 'default'}`;
  });

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
  banPlayer,
  unbanPlayer,
  isBanned,
  archiveWeek,
  getArchiveList,
  getArchivePath,
  ARCHIVE_DIR,
};
