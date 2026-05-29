const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreVerdict, LIMITS } = require('./lib/score-validation');

const ok = (over = {}) => ({ score: 10, level: 2, coins: 5, hasSession: true, sessionUsed: false, elapsedMs: 10000, ...over });

test('accepts a legitimate score with a fresh session', () => {
  const v = scoreVerdict(ok());
  assert.equal(v.valid, true);
  assert.equal(v.level, 2);
  assert.equal(v.coins, 5);
});

test('rejects non-integer / negative / NaN scores', () => {
  assert.equal(scoreVerdict(ok({ score: 'abc' })).reason, 'invalid_score');
  assert.equal(scoreVerdict(ok({ score: -1 })).reason, 'invalid_score');
  assert.equal(scoreVerdict(ok({ score: 1.5 })).reason, 'invalid_score');
});

test('rejects above the hard cap (500)', () => {
  assert.equal(scoreVerdict(ok({ score: 501, elapsedMs: 9e9 })).reason, 'exceeds_cap');
  assert.equal(scoreVerdict(ok({ score: 500, elapsedMs: 9e9 })).valid, true);
});

test('rejects absurd / non-integer level (closes 9.2e18 corruption)', () => {
  assert.equal(scoreVerdict(ok({ level: 9223372036854775807 })).reason, 'invalid_level');
  assert.equal(scoreVerdict(ok({ level: 0 })).reason, 'invalid_level');
  assert.equal(scoreVerdict(ok({ level: 1001 })).reason, 'invalid_level');
});

test('rejects coins exceeding the per-score ceiling (closes unbounded coin self-credit)', () => {
  assert.equal(scoreVerdict(ok({ score: 10, coins: 2000000000 })).reason, 'invalid_coins');
  // within ceiling: 10*10 + 50 = 150
  assert.equal(scoreVerdict(ok({ score: 10, coins: 150 })).valid, true);
  assert.equal(scoreVerdict(ok({ score: 10, coins: 151 })).reason, 'invalid_coins');
});

test('no_session is a HARD reject for any meaningful score (closes sessionless sybil)', () => {
  assert.equal(scoreVerdict(ok({ hasSession: false, score: 30 })).reason, 'no_session');
  assert.equal(scoreVerdict(ok({ hasSession: false, score: 1 })).reason, 'no_session');
});

test('session reuse is a HARD reject (closes replay)', () => {
  assert.equal(scoreVerdict(ok({ sessionUsed: true })).reason, 'session_reused');
});

test('too_fast is a HARD reject (n>5 under 2s)', () => {
  assert.equal(scoreVerdict(ok({ elapsedMs: 1000, score: 6 })).reason, 'too_fast');
  // a 2-point score within 1s is under both the too_fast trigger and the 2.5/s ceiling
  assert.equal(scoreVerdict(ok({ elapsedMs: 1000, score: 2 })).valid, true);
});

test('score_exceeds_time uses base 2.5/s and ignores body multiplier inflation', () => {
  // 10s elapsed -> max ceil(10*2.5)=25
  assert.equal(scoreVerdict(ok({ elapsedMs: 10000, score: 25 })).valid, true);
  assert.equal(scoreVerdict(ok({ elapsedMs: 10000, score: 26 })).reason, 'score_exceeds_time');
});

test('reaching the 500 cap requires a real ~200s wait at base rate (no shortcut)', () => {
  // 67s (the old multiplier+shield shortcut) is no longer enough
  assert.equal(scoreVerdict(ok({ elapsedMs: 67000, score: 500 })).reason, 'score_exceeds_time');
  // 200s: ceil(200*2.5)=500 -> exactly admissible
  assert.equal(scoreVerdict(ok({ elapsedMs: 200000, score: 500 })).valid, true);
});

test('LIMITS exposes the hardened constants', () => {
  assert.equal(LIMITS.MAX_ABSOLUTE_SCORE, 500);
  assert.equal(LIMITS.MAX_SCORE_PER_SECOND, 2.5);
});
