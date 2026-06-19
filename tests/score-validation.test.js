const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreVerdict, LIMITS } = require('../lib/score-validation');

const ok = (over = {}) => ({ score: 10, level: 2, coins: 5, hasSession: true, sessionUsed: false, elapsedMs: 10000, ...over });

test('accepts a legitimate score with a fresh session', () => {
  const v = scoreVerdict(ok());
  assert.equal(v.valid, true);
  assert.equal(v.level, 2);
  assert.equal(v.coins, 5);
});

test('clamps a fabricated level to what the score could earn (anti fake MAX LEVEL)', () => {
  // score 1 can only legitimately be ~level 1; a claimed level 1000 is clamped.
  assert.equal(scoreVerdict(ok({ score: 1, level: 1000, elapsedMs: 60000 })).level, 1);
  // a level legitimately consistent with the score is preserved.
  assert.equal(scoreVerdict(ok({ score: 100, level: 11, elapsedMs: 60000 })).level, 11);
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

test('clamps absurd coins instead of rejecting the score (coins are cosmetic)', () => {
  const v = scoreVerdict(ok({ score: 100, coins: 2000000000, elapsedMs: 60000 }));
  assert.equal(v.valid, true);
  assert.ok(v.coins < 2000000000 && v.coins > 0, 'clamped to the generous ceiling');
});

test('legit coins (incl. quadratic combo earnings) pass through unclamped', () => {
  // a clean ~score-100 run can earn ~1300 coins (combo bonus is quadratic) —
  // must NOT be rejected and must keep its real coins.
  const v = scoreVerdict(ok({ score: 100, coins: 1300, elapsedMs: 60000 }));
  assert.equal(v.valid, true);
  assert.equal(v.coins, 1300);
});

test('coins default to 0 when absent / negative / non-integer', () => {
  assert.equal(scoreVerdict(ok({ coins: undefined })).coins, 0);
  assert.equal(scoreVerdict(ok({ coins: -5 })).coins, 0);
  assert.equal(scoreVerdict(ok({ coins: 1.5 })).coins, 0);
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
  // a 2-point score within 1s is under both the too_fast trigger and the 5/s ceiling
  assert.equal(scoreVerdict(ok({ elapsedMs: 1000, score: 2 })).valid, true);
});

test('score_exceeds_time uses the base 5/s rate and ignores body multiplier inflation', () => {
  // 10s elapsed -> max ceil(10*5)=50 (5/s covers legit 2x on 120/144Hz displays)
  assert.equal(scoreVerdict(ok({ elapsedMs: 10000, score: 50 })).valid, true);
  assert.equal(scoreVerdict(ok({ elapsedMs: 10000, score: 51 })).reason, 'score_exceeds_time');
});

test('reaching the 500 cap requires a real ~100s wait (no instant forge)', () => {
  // an aged session is still required; the old 67s multiplier shortcut is rejected
  assert.equal(scoreVerdict(ok({ elapsedMs: 67000, score: 500 })).reason, 'score_exceeds_time');
  // 100s: ceil(100*5)=500 -> exactly admissible
  assert.equal(scoreVerdict(ok({ elapsedMs: 100000, score: 500 })).valid, true);
});

test('LIMITS exposes the hardened constants', () => {
  assert.equal(LIMITS.MAX_ABSOLUTE_SCORE, 500);
  assert.equal(LIMITS.MAX_SCORE_PER_SECOND, 5);
});
