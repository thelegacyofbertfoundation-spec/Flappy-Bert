const test = require('node:test');
const assert = require('node:assert/strict');
const { createPowerups, magnetActivate, magnetTick, MAGNET_DURATION_FRAMES } = require('./lib/magnet-timer');

test('magnetActivate sets active and expiresAt', () => {
  const p = createPowerups();
  magnetActivate(p, 100);
  assert.equal(p.magnet.active, true);
  assert.equal(p.magnet.expiresAt, 100 + MAGNET_DURATION_FRAMES);
});

test('magnetTick keeps active before expiry', () => {
  const p = createPowerups();
  magnetActivate(p, 0);
  const expired = magnetTick(p, MAGNET_DURATION_FRAMES - 1);
  assert.equal(expired, false);
  assert.equal(p.magnet.active, true);
});

test('magnetTick expires at exact frame', () => {
  const p = createPowerups();
  magnetActivate(p, 0);
  const expired = magnetTick(p, MAGNET_DURATION_FRAMES);
  assert.equal(expired, true);
  assert.equal(p.magnet.active, false);
});

test('re-activate while active refreshes expiresAt (no stacking)', () => {
  const p = createPowerups();
  magnetActivate(p, 0);
  magnetActivate(p, 60);
  assert.equal(p.magnet.expiresAt, 60 + MAGNET_DURATION_FRAMES);
});
