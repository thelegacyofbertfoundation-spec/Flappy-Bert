// Fixed 60Hz timestep accumulator — pure mirror of the loop-clock logic in
// flappy_bert.html's gameLoop(). Tests reference this; the HTML implementation
// must match it byte-for-byte in behavior.
//
// Contract: update() (the physics/game step) runs a whole number of times per
// rAF; render() runs once per rAF. This module owns ONLY the "how many steps
// this frame + what to carry" arithmetic, so it can be unit-tested without a DOM.
const STEP_MS = 1000 / 60;   // one physics step = 1/60s
const MAX_STEPS = 4;         // catch-up cap: a backgrounded tab / GC hitch must
                             // not fire a burst of updates that kills the player.
// Tolerance so a ~16ms rAF delta (16/17ms integer jitter around 16.667) still
// counts as exactly one step — this is what keeps a real 60Hz display at a rock-
// steady 1 step/frame (identical to the pre-fix behavior) with no drift and no
// spurious double-steps. It's far below the 8.3ms gap to 120Hz and the 16.6ms
// gap to 30Hz, so those rates are unaffected.
const STEP_EPS = 1.0;

// state: { acc: number, lastTs: number|null }
// ts:    the rAF timestamp for this frame
// opts:  optional { stepMs, maxSteps } overrides (for tests)
// returns: { steps, acc, lastTs } — steps = update() calls to run this frame,
//          acc/lastTs = the state to carry into the next frame.
function stepAccumulator(state, ts, opts) {
  const STEP = (opts && opts.stepMs) || STEP_MS;
  const MAX = (opts && opts.maxSteps) || MAX_STEPS;
  const EPS = (opts && opts.stepEps != null) ? opts.stepEps : STEP_EPS;

  // First frame, or a resume/visibility reset (lastTs cleared): run exactly one
  // step and consume no time, so a stale/huge lastTs can't fire a catch-up burst.
  if (state.lastTs == null) {
    return { steps: 1, acc: 0, lastTs: ts };
  }

  let acc = state.acc + (ts - state.lastTs);
  if (acc < 0) acc = 0; // guard: monotonic-clock hiccups / clock going backwards

  let steps = 0;
  while (acc >= STEP - EPS && steps < MAX) {
    acc -= STEP;
    steps++;
  }
  if (acc < 0) acc = 0; // a sub-step-short delta counted via EPS can leave acc slightly negative
  // Hit the catch-up cap with time still owed: discard the excess so the debt
  // doesn't leak into subsequent frames as a slow-motion burst.
  if (steps >= MAX) acc = 0;

  return { steps, acc, lastTs: ts };
}

module.exports = { stepAccumulator, STEP_MS, MAX_STEPS };
