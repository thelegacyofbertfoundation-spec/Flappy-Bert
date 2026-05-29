const test = require('node:test');
const assert = require('node:assert/strict');
const { createFrenzyState, frenzyActivate, frenzyTick, FRENZY_DURATION_FRAMES } = require('./lib/frenzy-timer');

test('frenzyActivate sets mult=2, active, expiresAt, saves prev', () => {
  const G = createFrenzyState(); G.scoreMultiplier = 1.5;
  frenzyActivate(G, 100);
  assert.equal(G.scoreMultiplier, 2);
  assert.equal(G.powerups.frenzy.active, true);
  assert.equal(G.powerups.frenzy.expiresAt, 100 + FRENZY_DURATION_FRAMES);
  assert.equal(G._frenzyPrevMult, 1.5);
});

test('frenzyTick before expiry keeps mult=2', () => {
  const G = createFrenzyState(); frenzyActivate(G, 0);
  assert.equal(frenzyTick(G, FRENZY_DURATION_FRAMES - 1), false);
  assert.equal(G.scoreMultiplier, 2);
});

test('frenzyTick at expiry restores prev mult and clears active', () => {
  const G = createFrenzyState(); G.scoreMultiplier = 1.5; frenzyActivate(G, 0);
  assert.equal(frenzyTick(G, FRENZY_DURATION_FRAMES), true);
  assert.equal(G.powerups.frenzy.active, false);
  assert.equal(G.scoreMultiplier, 1.5);
});

test('re-activate while active keeps original prev (no stacking the prev)', () => {
  const G = createFrenzyState(); G.scoreMultiplier = 1; frenzyActivate(G, 0);
  frenzyActivate(G, 60); // refresh; prev must stay 1, not become 2
  assert.equal(G._frenzyPrevMult, 1);
  assert.equal(G.powerups.frenzy.expiresAt, 60 + FRENZY_DURATION_FRAMES);
});

test('invalid prev mult restores to 1', () => {
  const G = createFrenzyState(); G.scoreMultiplier = 1; frenzyActivate(G, 0);
  G._frenzyPrevMult = 99; // tampered / invalid
  frenzyTick(G, FRENZY_DURATION_FRAMES);
  assert.equal(G.scoreMultiplier, 1);
});
