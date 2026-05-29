// Frenzy (2x-score window) timer logic — mirror of code in flappy_bert.html.
// Tests reference this; the HTML implementation must match.
const FRENZY_DURATION_FRAMES = 60 * 8; // 8 seconds at 60fps
const VALID_MULTS = [1, 1.5, 2];

function createFrenzyState() {
  return { powerups: { frenzy: { active: false, expiresAt: 0 } }, scoreMultiplier: 1, _frenzyPrevMult: 1 };
}

// Fresh activate saves the prior multiplier; refresh-while-active extends the
// window without overwriting the saved prev (no stacking of the prev value).
function frenzyActivate(G, frameCount) {
  if (!G.powerups.frenzy.active) G._frenzyPrevMult = G.scoreMultiplier;
  G.scoreMultiplier = 2;
  G.powerups.frenzy.active = true;
  G.powerups.frenzy.expiresAt = frameCount + FRENZY_DURATION_FRAMES;
}

// Returns true if frenzy just expired this tick (restoring the prev multiplier,
// clamped to the server-valid set {1, 1.5, 2}).
function frenzyTick(G, frameCount) {
  if (G.powerups.frenzy.active && frameCount >= G.powerups.frenzy.expiresAt) {
    G.powerups.frenzy.active = false;
    G.scoreMultiplier = VALID_MULTS.includes(G._frenzyPrevMult) ? G._frenzyPrevMult : 1;
    return true;
  }
  return false;
}

module.exports = { createFrenzyState, frenzyActivate, frenzyTick, FRENZY_DURATION_FRAMES };
