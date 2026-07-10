// Difficulty curve — pure mirror of updateDifficulty() and the anti-tamper
// expectedSpeed()/expectedGap() closures in flappy_bert.html (keep in sync;
// the source-sync tests in tests/difficulty-curve.test.js grep the HTML for
// the exact speed-formula literal, so drift fails the suite).
const BASE_SPEED = 2.5;
const BASE_PIPE_GAP = 190;
const SPEED_PER_LEVEL = 0.25; // 2026-07-10: was 0.15 — owner-approved mid-tournament pacing change
const SPEED_CAP_BONUS = 3;    // top speed 2.5 + 3 = 5.5, reached at level 12 (score 110)
const GAP_PER_LEVEL = 4;
const MIN_GAP = 110;

function levelForScore(score) {
  return Math.floor(score / 10) + 1;
}

function speedAtLevel(lvl) {
  return BASE_SPEED + Math.min(lvl * SPEED_PER_LEVEL, SPEED_CAP_BONUS);
}

function gapAtLevel(lvl) {
  return Math.max(BASE_PIPE_GAP - lvl * GAP_PER_LEVEL, MIN_GAP);
}

module.exports = { levelForScore, speedAtLevel, gapAtLevel };
