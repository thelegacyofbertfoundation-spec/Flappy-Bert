// db.js — SQLite database for Flappy Bert leaderboard
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'flappy_bert.db');
let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

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
};
