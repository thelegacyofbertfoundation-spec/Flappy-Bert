const test = require('node:test');
const assert = require('node:assert/strict');
const { homingStep, MAX_TRACK } = require('./lib/homing-enemy');

test('homingStep eases toward a target above', () => {
  const next = homingStep(100, 200);
  assert.ok(next > 100 && next < 200, 'moves toward target without overshoot');
});

test('homingStep eases toward a target below (symmetric)', () => {
  const next = homingStep(200, 100);
  assert.ok(next < 200 && next > 100);
});

test('homingStep clamps to MAX_TRACK on a large gap', () => {
  const next = homingStep(0, 100000);
  assert.equal(next, MAX_TRACK);
});

test('homingStep converges to the target within 500 steps', () => {
  // Lazy tracking: ~310 frames at the 1.6 px/frame clamp to close the bulk of a
  // 550px gap, then an exponential ease (gain 0.03) — full convergence ~441 frames.
  // In-game the hunter is only on screen ~200 frames, so it only PARTIALLY tracks
  // (the intended dodgeable behavior); this just asserts it converges eventually.
  let y = 50; const target = 600;
  for (let i = 0; i < 500; i++) y = homingStep(y, target);
  assert.ok(Math.abs(y - target) < 1, `converged (got ${y})`);
});
