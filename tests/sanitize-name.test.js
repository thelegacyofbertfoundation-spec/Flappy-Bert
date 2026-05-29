const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeName } = require('../lib/sanitize-name');

test('passes a normal name through', () => {
  assert.equal(sanitizeName('Alice'), 'Alice');
});

test('strips control chars incl. CR/LF/TAB/NUL', () => {
  assert.equal(sanitizeName('a\nb\tc\x00d'), 'a b c d');
  assert.equal(sanitizeName('row1\r\nrow2'), 'row1 row2');
});

test('collapses runs of whitespace and trims', () => {
  assert.equal(sanitizeName('   spaced    out   '), 'spaced out');
});

test('length-clamps to the max (default 32)', () => {
  assert.equal(sanitizeName('x'.repeat(100)).length, 32);
});

test('falls back to Player when empty/whitespace/null', () => {
  assert.equal(sanitizeName(''), 'Player');
  assert.equal(sanitizeName('   '), 'Player');
  assert.equal(sanitizeName(null), 'Player');
});

test('keeps emoji / unicode display names', () => {
  assert.equal(sanitizeName('🐕 Bert'), '🐕 Bert');
});
