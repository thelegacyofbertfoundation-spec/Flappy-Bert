const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedBadges, VALID_BADGES } = require('../lib/badge-allowlist');

test('drops unknown / forged badge ids', () => {
  const out = allowedBadges(['immortal', 'NOT_A_BADGE', '<script>'], 500, []);
  assert.deepEqual(out.sort(), ['immortal']);
});

test('score-gates score badges to the validated score', () => {
  // claims top-tier badges with score 0 -> none of the score-gated ones accepted
  const out = allowedBadges(['immortal', 'legend', 'sky_king', 'rookie'], 0, []);
  assert.deepEqual(out, []);
});

test('accepts score badges the score actually earns', () => {
  const out = allowedBadges(['rookie', 'sky_king', 'immortal'], 60, []).sort();
  assert.deepEqual(out, ['rookie', 'sky_king']); // 60 >= 10,50 but < 200
});

test('unions with existing badges so a low score never wipes earned ones', () => {
  const out = allowedBadges([], 5, ['immortal', 'legend']).sort();
  assert.deepEqual(out, ['immortal', 'legend']);
});

test('non-score badges pass the allowlist (not server-verifiable, cosmetic-only)', () => {
  const out = allowedBadges(['combo_king', 'shield_breaker'], 5, []).sort();
  assert.deepEqual(out, ['combo_king', 'shield_breaker']);
});

test('handles non-array inputs without throwing', () => {
  assert.deepEqual(allowedBadges(null, 100, undefined), []);
  assert.deepEqual(allowedBadges('immortal', 100, []), []); // string is not an array of ids
});

test('output never exceeds the allowlist size', () => {
  const huge = Array(100000).fill('rookie');
  assert.ok(allowedBadges(huge, 500, []).length <= VALID_BADGES.length);
});
