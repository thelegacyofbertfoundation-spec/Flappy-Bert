const test = require('node:test');
const assert = require('node:assert/strict');
const { stepAccumulator, STEP_MS, MAX_STEPS } = require('./lib/fixed-timestep');

// Helper: drive a whole timestamp sequence through the stepper, summing steps.
function run(timestamps, opts) {
  let state = { acc: 0, lastTs: null };
  let total = 0;
  const perFrame = [];
  for (const ts of timestamps) {
    const r = stepAccumulator(state, ts, opts);
    state = { acc: r.acc, lastTs: r.lastTs };
    total += r.steps;
    perFrame.push(r.steps);
  }
  return { total, perFrame, state };
}

test('first frame (undefined lastTs) yields exactly one step, no time consumed', () => {
  const r = stepAccumulator({ acc: 0, lastTs: null }, 12345, {});
  assert.equal(r.steps, 1);
  assert.equal(r.acc, 0);
  assert.equal(r.lastTs, 12345);
});

test('steady 60Hz: exactly 1 step every frame, no double-steps, no drift', () => {
  // Vsync-locked timestamps: evenly spaced at STEP_MS.
  const ts = [];
  for (let i = 0; i < 600; i++) ts.push(i * STEP_MS);
  const { total, perFrame } = run(ts);
  assert.equal(total, 600); // one step per frame over 600 frames
  // No frame ever fires 0 or 2+ steps at true 60Hz.
  assert.ok(perFrame.every(s => s === 1), 'every frame steps exactly once');
});

test('60Hz jittered (16/17ms integer timestamps) averages exactly 1 step/frame over N frames', () => {
  // Real rAF reports integer-ish ms; round(i*STEP_MS) gives a 16/17 jitter pattern.
  const N = 600;
  const ts = [];
  for (let i = 0; i < N; i++) ts.push(Math.round(i * STEP_MS));
  const { total } = run(ts);
  assert.equal(total, N); // no drift: N steps over N frames despite jitter
});

test('120Hz (8.33ms deltas) averages 0.5 steps/frame', () => {
  const N = 600;
  const ts = [];
  for (let i = 0; i < N; i++) ts.push(i * (STEP_MS / 2));
  const { total } = run(ts);
  // First frame = 1 step; remaining (N-1) frames cover (N-1)/2 steps.
  assert.ok(Math.abs(total - N / 2) <= 1, `expected ~${N / 2}, got ${total}`);
});

test('30Hz (33.3ms deltas) averages 2 steps/frame', () => {
  const N = 300;
  const ts = [];
  for (let i = 0; i < N; i++) ts.push(i * (STEP_MS * 2));
  const { total } = run(ts);
  assert.ok(Math.abs(total - N * 2) <= 1, `expected ~${N * 2}, got ${total}`);
});

test('huge delta (2000ms) is clamped to MAX_STEPS with excess accumulator discarded', () => {
  let state = { acc: 0, lastTs: null };
  // first frame
  let r = stepAccumulator(state, 1000, {});
  state = { acc: r.acc, lastTs: r.lastTs };
  // background-tab return: 2000ms jump
  r = stepAccumulator(state, 3000, {});
  assert.equal(r.steps, MAX_STEPS); // clamped, no death-burst
  assert.equal(r.acc, 0); // leftover discarded so the burst doesn't leak forward
});

test('post-reset (lastTs reset to null) behaves like a first frame — exactly one step', () => {
  let state = { acc: 5, lastTs: 100 };
  // simulate resume: caller resets
  state = { acc: 0, lastTs: null };
  const r = stepAccumulator(state, 999999, {});
  assert.equal(r.steps, 1);
  assert.equal(r.acc, 0);
  assert.equal(r.lastTs, 999999);
});

test('clock going backwards does not produce negative acc or steps', () => {
  let state = { acc: 0, lastTs: 5000 };
  const r = stepAccumulator(state, 4000, {});
  assert.ok(r.steps >= 0);
  assert.ok(r.acc >= 0);
});
