const test = require('node:test');
const assert = require('node:assert/strict');
const { isoToSqliteUTC, effectiveResetSince } = require('../lib/tournament-reset');

const RESET = '2026-06-22T00:00:00Z';
const SQL = '2026-06-22 00:00:00';

test('isoToSqliteUTC converts ISO to SQLite UTC datetime', () => {
  assert.equal(isoToSqliteUTC(RESET), SQL);
  assert.equal(isoToSqliteUTC('2026-06-22T00:00:00.000Z'), SQL);
  assert.equal(isoToSqliteUTC('2026-06-22T05:30:00+05:30'), SQL); // normalized to UTC
});

test('effectiveResetSince returns null before the boundary', () => {
  const before = Date.parse('2026-06-21T23:59:59Z');
  assert.equal(effectiveResetSince(RESET, before), null);
});

test('effectiveResetSince returns the boundary at/after it', () => {
  assert.equal(effectiveResetSince(RESET, Date.parse('2026-06-22T00:00:00Z')), SQL);
  assert.equal(effectiveResetSince(RESET, Date.parse('2026-07-01T12:00:00Z')), SQL);
});

test('effectiveResetSince returns null for missing/invalid config', () => {
  assert.equal(effectiveResetSince(undefined, Date.now()), null);
  assert.equal(effectiveResetSince(null, Date.now()), null);
  assert.equal(effectiveResetSince('not-a-date', Date.now()), null);
});
