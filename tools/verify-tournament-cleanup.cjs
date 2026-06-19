// verify-tournament-cleanup.cjs — proves the april-flapoff-2026 cleanup is
// surgical and correct, in an in-memory DB mirroring the prod schema (FK ON).
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE tournaments (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE tournament_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id TEXT, telegram_id INTEGER, score INTEGER,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  );`);
db.prepare('INSERT INTO tournaments (id,name) VALUES (?,?)').run('april-flapoff-2026', 'April Flap-off 2026');
db.prepare('INSERT INTO tournaments (id,name) VALUES (?,?)').run('april-fools-flapoff-2026', 'April Fools Flap-off 2026');
db.prepare('INSERT INTO tournament_scores (tournament_id,telegram_id,score) VALUES (?,?,?)').run('april-flapoff-2026', 111, 30);
db.prepare('INSERT INTO tournament_scores (tournament_id,telegram_id,score) VALUES (?,?,?)').run('april-fools-flapoff-2026', 222, 40);

// 1) The naive single DELETE must FAIL under FK ON (this is why the cascade is needed).
let naiveBlocked = false;
try { db.prepare('DELETE FROM tournaments WHERE id=?').run('april-flapoff-2026'); }
catch (e) { naiveBlocked = /FOREIGN KEY/i.test(e.message); }

// 2) The exact deleteTournament logic from db.js.
const deleteTournament = (id) => {
  const tx = db.transaction((tid) => ({
    scores: db.prepare('DELETE FROM tournament_scores WHERE tournament_id = ?').run(tid).changes,
    tournament: db.prepare('DELETE FROM tournaments WHERE id = ?').run(tid).changes,
  }));
  return tx(id);
};
const res = deleteTournament('april-flapoff-2026');

const has = (t) => !!db.prepare('SELECT 1 FROM tournaments WHERE id=?').get(t);
const hasScore = (t) => !!db.prepare('SELECT 1 FROM tournament_scores WHERE tournament_id=?').get(t);
const checks = {
  naive_delete_blocked_by_FK: naiveBlocked,
  deleted_one_tournament: res.tournament === 1,
  deleted_one_orphan_score: res.scores === 1,
  orphan_row_gone: !has('april-flapoff-2026'),
  canonical_row_kept: has('april-fools-flapoff-2026'),
  canonical_score_kept: hasScore('april-fools-flapoff-2026'),
  idempotent_second_call_noop: deleteTournament('april-flapoff-2026').tournament === 0,
};
for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
const ok = Object.values(checks).every(Boolean);
console.log(ok ? '\n>>> ALL PASS — cleanup removes ONLY the orphan + its scores, keeps the canonical' : '\n>>> FAIL');
process.exit(ok ? 0 : 1);
