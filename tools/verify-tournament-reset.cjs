// Proves the time-boundary filter: scores before the boundary are excluded once
// `since` is applied; all scores count when `since` is null. In-memory, FK-on.
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE players (telegram_id INTEGER PRIMARY KEY, first_name TEXT, username TEXT, skin TEXT);
  CREATE TABLE tournament_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id TEXT, telegram_id INTEGER, score INTEGER, level INTEGER, played_at TEXT,
    FOREIGN KEY (telegram_id) REFERENCES players(telegram_id));`);
db.prepare('INSERT INTO players VALUES (?,?,?,?)').run(1, 'Old', 'old', 'default');
db.prepare('INSERT INTO players VALUES (?,?,?,?)').run(2, 'New', 'new', 'default');
const ins = db.prepare('INSERT INTO tournament_scores (tournament_id,telegram_id,score,level,played_at) VALUES (?,?,?,?,?)');
ins.run('t', 1, 99, 9, '2026-06-20 12:00:00'); // before boundary
ins.run('t', 2, 40, 4, '2026-06-22 09:00:00'); // after boundary

const SINCE = '2026-06-22 00:00:00';
const lb = (since) => db.prepare(`
  SELECT p.telegram_id, MAX(ts.score) AS best_score FROM tournament_scores ts
  JOIN players p ON p.telegram_id = ts.telegram_id
  ${since ? 'WHERE ts.tournament_id = ? AND ts.played_at >= ?' : 'WHERE ts.tournament_id = ?'}
  GROUP BY ts.telegram_id ORDER BY best_score DESC LIMIT ?
`).all(...(since ? ['t', since, 50] : ['t', 50]));

const all = lb(null);
const reset = lb(SINCE);
const checks = {
  no_since_counts_all: all.length === 2 && all[0].best_score === 99,
  since_excludes_pre_boundary: reset.length === 1 && reset[0].telegram_id === 2 && reset[0].best_score === 40,
};
for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
const ok = Object.values(checks).every(Boolean);
console.log(ok ? '\n>>> PASS — boundary excludes pre-reset scores; null counts all' : '\n>>> FAIL');
process.exit(ok ? 0 : 1);
