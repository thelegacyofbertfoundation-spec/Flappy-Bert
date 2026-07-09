const test = require('node:test');
const assert = require('node:assert/strict');
const { rankNudge } = require('./lib/rank-nudge');

// Leaderboards are DESC-sorted by score (highest first), as the game stores them.
const board = [
  { name: 'A', score: 100 },
  { name: 'B', score: 80 },
  { name: 'C', score: 60 },
  { name: 'D', score: 50 },
  { name: 'E', score: 50 },
  { name: 'F', score: 40 },
  { name: 'G', score: 30 },
  { name: 'H', score: 20 },
  { name: 'I', score: 10 },
  { name: 'J', score: 5 },
];

test('beats everyone -> rank #1', () => {
  assert.deepEqual(rankNudge(board, 200), { type: 'rank', rank: 1 });
});

test('ties mid-list -> rank of the tie (first matching position, 1-based)', () => {
  // score 50 matches D at index 3 -> rank 4
  assert.deepEqual(rankNudge(board, 50), { type: 'rank', rank: 4 });
});

test('below all 10 -> behind the NEAREST (#10, smallest gap), never the leader', () => {
  // score 3 is below J(5); nearest attainable is #10 with a 2-point gap.
  assert.deepEqual(rankNudge(board, 3), { type: 'behind', points: 2, rank: 10 });
});

test('below all -> gap is to the nearest above, not the leader', () => {
  const r = rankNudge(board, 1);
  assert.equal(r.type, 'behind');
  assert.equal(r.rank, 10);
  assert.equal(r.points, 4); // 5 - 1, NOT 100 - 1
});

test('empty list -> null', () => {
  assert.equal(rankNudge([], 50), null);
  assert.equal(rankNudge(null, 50), null);
});

test('score 0 -> null (a 0-score death should not chirp about rank)', () => {
  assert.equal(rankNudge(board, 0), null);
});

test('lands just outside top 10 on a longer board -> behind nearest above (rank 10)', () => {
  const long = board.concat([{ name: 'K', score: 4 }, { name: 'L', score: 2 }]);
  // score 3 sits between K(4) and L(2). Nearest above is K at index 10 -> rank 11.
  const r = rankNudge(long, 3);
  assert.equal(r.type, 'behind');
  assert.equal(r.points, 1); // 4 - 3
  assert.equal(r.rank, 11);
});
