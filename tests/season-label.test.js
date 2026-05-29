const test = require('node:test');
const assert = require('node:assert/strict');
const { seasonLabel, SEASON4_START_MS } = require('./lib/season-label');

const ms = (iso) => Date.parse(iso);
const SUMMER = [{ id: 'summer-session-2026', startTime: '2026-06-01T00:00:00Z', endTime: '2026-09-01T00:00:00Z' }];

test('SEASON 3 one second before the Summer Session starts', () => {
  assert.equal(seasonLabel(ms('2026-05-31T23:59:59Z'), SUMMER), 'SEASON 3');
});

test('SEASON 4 exactly at the Summer Session start (Jun 1 00:00 UTC)', () => {
  assert.equal(seasonLabel(ms('2026-06-01T00:00:00Z'), SUMMER), 'SEASON 4');
});

test('still SEASON 4 after the tournament ends (counter does not revert)', () => {
  assert.equal(seasonLabel(ms('2026-09-15T00:00:00Z'), SUMMER), 'SEASON 4');
});

test('falls back to the constant when tournament data is unavailable', () => {
  assert.equal(seasonLabel(SEASON4_START_MS - 1, undefined), 'SEASON 3');
  assert.equal(seasonLabel(SEASON4_START_MS, []), 'SEASON 4');
});
