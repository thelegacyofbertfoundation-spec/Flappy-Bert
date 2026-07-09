// FIX 1 — Leaderboard tiebreak.
// Score is capped at 500; ties WILL happen. Among players with equal best_score,
// the one who REACHED that score EARLIEST (earliest played_at of the row(s) equal
// to their best score, within the same week/tournament/`since` filter) ranks
// higher. This suite drives the REAL db.js queries against an ISOLATED temp DB
// (FLAPPY_DATA_DIR) — it must never touch ./flappy_bert.db.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point db.js at a fresh temp dir BEFORE requiring it (module-load freezes DB_PATH).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flappy-tiebreak-'));
process.env.FLAPPY_DATA_DIR = TMP;

const db = require('../db');
const dbh = db.init(); // returns the real connection db.js queries through

// Safety net: the DB file must live in the temp dir, never the repo.
assert.ok(fs.existsSync(path.join(TMP, 'flappy_bert.db')), 'temp DB created in isolated dir');

const WEEK = db.getWeekStart(); // weekly queries filter on the CURRENT week

function insPlayer(id, name) {
  dbh.prepare('INSERT INTO players (telegram_id, first_name) VALUES (?, ?)').run(id, name);
}
function insScore(id, score, level, playedAt) {
  dbh.prepare('INSERT INTO scores (telegram_id, score, level, week_start, played_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, score, level, WEEK, playedAt);
}
function insTScore(tid, id, score, level, playedAt) {
  dbh.prepare('INSERT INTO tournament_scores (tournament_id, telegram_id, score, level, played_at) VALUES (?, ?, ?, ?, ?)')
    .run(tid, id, score, level, playedAt);
}

test('weekly leaderboard: equal scores broken by earliest achievement of the best', () => {
  // P4 highest score; P1/P2/P3 tie at 100; P5 lowest.
  insPlayer(1, 'P1'); insPlayer(2, 'P2'); insPlayer(3, 'P3');
  insPlayer(4, 'P4'); insPlayer(5, 'P5');

  insScore(1, 100, 10, '2026-07-06 09:00:00');                 // best 100 @ 09:00
  insScore(2, 50, 5, '2026-07-06 08:00:00');                   // low row EARLIER than its 100 …
  insScore(2, 100, 10, '2026-07-06 10:00:00');                 // … best 100 @ 10:00 (tiebreak must use 10:00, NOT 08:00)
  insScore(3, 100, 10, '2026-07-06 08:00:00');                 // best 100 @ 08:00 (earliest of the 100s)
  insScore(3, 100, 10, '2026-07-06 12:00:00');                 // duplicate max later — MIN must ignore it
  insScore(4, 200, 20, '2026-07-06 07:00:00');                 // top score
  insScore(5, 90, 9, '2026-07-06 06:00:00');                   // lowest

  const lb = db.getWeeklyLeaderboard(20);
  assert.deepEqual(lb.map(r => r.telegram_id), [4, 3, 1, 2, 5],
    'order = score DESC, then earliest time at best score ASC');

  // Rank caption must AGREE with the row order.
  assert.equal(db.getPlayerRank(4), 1);
  assert.equal(db.getPlayerRank(3), 2);
  assert.equal(db.getPlayerRank(1), 3);
  assert.equal(db.getPlayerRank(2), 4);
  assert.equal(db.getPlayerRank(5), 5);
});

test('weekly rank: fully-identical (score + best time) players share a rank', () => {
  // Two players, same best score reached at the exact same instant → equal RANK.
  insPlayer(20, 'T1'); insPlayer(21, 'T2'); insPlayer(22, 'T3');
  insScore(20, 300, 30, '2026-07-06 09:00:00');
  insScore(21, 300, 30, '2026-07-06 09:00:00'); // identical tie with 20
  insScore(22, 250, 25, '2026-07-06 09:00:00'); // strictly lower

  assert.equal(db.getPlayerRank(20), db.getPlayerRank(21), 'genuine ties share a rank');
  // RANK() skips: two at rank 1 → next is rank 3.
  assert.equal(db.getPlayerRank(22), 3);
});

test('tournament leaderboard + rank: tiebreak respects the `since` boundary', () => {
  const TID = 'summer';
  const SINCE = '2026-06-22 00:00:00';
  db.createTournament(TID, 'Summer', 'Sponsor', '2026-06-01T00:00:00Z', '2026-09-01T00:00:00Z');
  insPlayer(10, 'X'); insPlayer(11, 'Y');

  // X reached 100 PRE-boundary (06-20) AND again POST-boundary (06-23 10:00).
  insTScore(TID, 10, 100, 10, '2026-06-20 12:00:00'); // pre-boundary
  insTScore(TID, 10, 100, 10, '2026-06-23 10:00:00'); // post-boundary
  // Y reached 100 POST-boundary earlier than X's post-boundary (06-23 08:00).
  insTScore(TID, 11, 100, 10, '2026-06-23 08:00:00');

  // With `since`: X's tiebreak time is its POST-boundary 10:00 (pre-boundary 06-20
  // must NOT win the tie) → Y (08:00) ranks above X (10:00).
  const withSince = db.getTournamentLeaderboard(TID, 50, SINCE);
  assert.deepEqual(withSince.map(r => r.telegram_id), [11, 10],
    'post-boundary tiebreak: Y before X');
  assert.equal(db.getTournamentPlayerRank(TID, 11, SINCE), 1);
  assert.equal(db.getTournamentPlayerRank(TID, 10, SINCE), 2);

  // With no `since`: X's earliest max row (06-20) counts → X ranks above Y.
  const noSince = db.getTournamentLeaderboard(TID, 50, null);
  assert.deepEqual(noSince.map(r => r.telegram_id), [10, 11],
    'no boundary: X (06-20) before Y (06-23)');
  assert.equal(db.getTournamentPlayerRank(TID, 10, null), 1);
  assert.equal(db.getTournamentPlayerRank(TID, 11, null), 2);
});
