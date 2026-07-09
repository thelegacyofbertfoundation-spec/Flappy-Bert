// FIX 3 — /resettournament guard. The command hard-DELETEs a tournament's scores;
// mid a LIVE cash-prize race an admin typo must not destroy it. New syntax:
//   /resettournament <tournament_id> CONFIRM
// parseResetCommand is the pure decision: (arg string + known ids) →
//   { action:'reset', id } | { action:'reject', reason }.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseResetCommand } = require('../lib/reset-tournament-guard');

const KNOWN = ['the-summer-session', 'may-the-flap-2026'];

test('reject: no argument at all', () => {
  assert.deepEqual(parseResetCommand(undefined, KNOWN), { action: 'reject', reason: 'missing_args' });
  assert.deepEqual(parseResetCommand('', KNOWN), { action: 'reject', reason: 'missing_args' });
  assert.deepEqual(parseResetCommand('   ', KNOWN), { action: 'reject', reason: 'missing_args' });
});

test('reject: unknown / mistyped tournament id', () => {
  const r = parseResetCommand('summer-typo CONFIRM', KNOWN);
  assert.equal(r.action, 'reject');
  assert.equal(r.reason, 'unknown_id');
  assert.equal(r.id, 'summer-typo');
});

test('reject: valid id but CONFIRM missing', () => {
  assert.deepEqual(parseResetCommand('the-summer-session', KNOWN),
    { action: 'reject', reason: 'missing_confirm', id: 'the-summer-session' });
});

test('reject: CONFIRM must be EXACT uppercase', () => {
  for (const c of ['confirm', 'Confirm', 'CONFIRM!', 'yes']) {
    const r = parseResetCommand(`the-summer-session ${c}`, KNOWN);
    assert.equal(r.action, 'reject', `"${c}" must not confirm`);
  }
});

test('reject: extra trailing arguments', () => {
  const r = parseResetCommand('the-summer-session CONFIRM now', KNOWN);
  assert.equal(r.action, 'reject');
  assert.equal(r.reason, 'extra_args');
});

test('reset: valid id + exact CONFIRM', () => {
  assert.deepEqual(parseResetCommand('the-summer-session CONFIRM', KNOWN),
    { action: 'reset', id: 'the-summer-session' });
});

test('reset: tolerant of surrounding / internal extra whitespace', () => {
  assert.deepEqual(parseResetCommand('  may-the-flap-2026   CONFIRM  ', KNOWN),
    { action: 'reset', id: 'may-the-flap-2026' });
});

test('reject: id that only differs by case is NOT a match', () => {
  const r = parseResetCommand('The-Summer-Session CONFIRM', KNOWN);
  assert.equal(r.action, 'reject');
  assert.equal(r.reason, 'unknown_id');
});
