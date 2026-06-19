const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGhost, buildStartParam, formatChallengeMessage, MAX_SCORE } = require('../lib/ghost-challenge');

test('parses a valid ghost param', () => {
  assert.deepEqual(parseGhost('g_123456789_47'), { id: 123456789, score: 47 });
});
test('rejects malformed / out-of-range params', () => {
  assert.equal(parseGhost('g_1_501'), null);       // score over cap
  assert.equal(parseGhost('g_0_10'), null);        // id must be > 0
  assert.equal(parseGhost('g_abc_10'), null);      // non-numeric id
  assert.equal(parseGhost('x_1_10'), null);        // wrong prefix
  assert.equal(parseGhost('g_1_10_9'), null);      // extra segment
  assert.equal(parseGhost(''), null);
  assert.equal(parseGhost(null), null);
  assert.equal(parseGhost('g_1_-5'), null);        // negative
});
test('accepts the score boundaries 0 and 500', () => {
  assert.deepEqual(parseGhost('g_5_0'), { id: 5, score: 0 });
  assert.deepEqual(parseGhost('g_5_500'), { id: 5, score: 500 });
  assert.equal(MAX_SCORE, 500);
});
test('buildStartParam round-trips through parseGhost', () => {
  const p = buildStartParam(987654321, 88);
  assert.equal(p, 'g_987654321_88');
  assert.deepEqual(parseGhost(p), { id: 987654321, score: 88 });
});
test('formatChallengeMessage uses the name, falls back when missing', () => {
  assert.match(formatChallengeMessage('Sam', 47), /Sam/);
  assert.match(formatChallengeMessage('Sam', 47), /47/);
  assert.match(formatChallengeMessage(null, 12), /friend/i);
  assert.match(formatChallengeMessage('   ', 12), /friend/i);
});
