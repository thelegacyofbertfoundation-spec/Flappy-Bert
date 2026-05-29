// Hardened score-validation logic — shared module required by bot.js
// (validateScore) and the test suite. Single source of truth (no drift).
// Pure decision function so it can be unit-tested without Date.now()/sessions.
//
// Security model: server-trusted inputs only — body-supplied scoreMultiplier /
// shieldUsed / adContinueUsed are IGNORED (they were attacker-controlled rate
// inflators). score / level / session / time are HARD rejects. COINS are
// cosmetic (leaderboards rank by score, never coins), so coins NEVER reject a
// score — they are CLAMPED to a generous ceiling. This stops absurd self-credit
// (e.g. 1e9) WITHOUT false-rejecting the quadratic combo-bonus earnings of a
// legitimate clean run (combo bonus adds +combo every 5 pipes).
const LIMITS = {
  MAX_ABSOLUTE_SCORE: 500,    // hard cap
  MAX_SCORE_PER_SECOND: 5,    // covers legit 2x multiplier on 120/144Hz displays —
                              // the loop is frame-locked, so high-refresh ~doubles the rate
  MIN_GAME_DURATION_MS: 2000,
  MAX_LEVEL: 1000,            // legit max ~51 at the 500 cap; 1000 rejects garbage like 9.2e18
};

// Generous cosmetic ceiling for coins. A clean max-combo run to score n earns
// ~n^2/10 + ~5n coins, so this clears legit play comfortably while clamping junk.
function coinCeiling(n) {
  return Math.ceil((n * n) / 4 + n * 20 + 1000);
}

// inputs: { score, level, coins, hasSession, sessionUsed, elapsedMs }
// elapsedMs is server-measured (Date.now() - session.startedAt); 0 if no session.
function scoreVerdict(input, L = LIMITS) {
  const n = Number(input.score);
  if (!Number.isInteger(n) || n < 0) return { valid: false, reason: 'invalid_score' };
  if (n > L.MAX_ABSOLUTE_SCORE) return { valid: false, reason: 'exceeds_cap' };

  const lvl = input.level == null ? 1 : Number(input.level);
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > L.MAX_LEVEL) return { valid: false, reason: 'invalid_level' };

  // Session is mandatory and single-use; time checks use server-measured elapsed.
  if (!input.hasSession) return { valid: false, reason: 'no_session' };
  if (input.sessionUsed) return { valid: false, reason: 'session_reused' };

  const elapsedMs = Number(input.elapsedMs) || 0;
  if (elapsedMs < L.MIN_GAME_DURATION_MS && n > 5) return { valid: false, reason: 'too_fast' };

  const maxScoreForTime = Math.ceil((elapsedMs / 1000) * L.MAX_SCORE_PER_SECOND);
  if (n > maxScoreForTime) return { valid: false, reason: 'score_exceeds_time' };

  // Coins are cosmetic — CLAMP to a generous ceiling, never reject the score.
  const rawCoins = Number(input.coins);
  const coins = (Number.isInteger(rawCoins) && rawCoins > 0) ? Math.min(rawCoins, coinCeiling(n)) : 0;

  return { valid: true, level: lvl, coins };
}

module.exports = { scoreVerdict, LIMITS, coinCeiling };
