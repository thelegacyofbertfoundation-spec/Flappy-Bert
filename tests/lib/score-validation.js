// Hardened score-validation logic — mirror of validateScore() in bot.js.
// Pure decision function so it can be unit-tested without Date.now()/sessions.
// Security model: server-trusted inputs only — body-supplied scoreMultiplier /
// shieldUsed / adContinueUsed are IGNORED (they were attacker-controlled rate
// inflators). All anti-cheat conditions are HARD rejects (no n>30/n>20/n>15
// "allow" gaps). level and coins are bounded as small non-negative integers.
const LIMITS = {
  MAX_ABSOLUTE_SCORE: 500,    // hard cap
  MAX_SCORE_PER_SECOND: 2.5,  // base rate (already comfortably covers legit 2x play)
  MIN_GAME_DURATION_MS: 2000,
  MAX_LEVEL: 1000,
  COINS_PER_POINT: 10,        // generous per-point coin ceiling
  COINS_SLACK: 50,            // flat allowance (near-miss/combo/shield bonuses)
};

// inputs: { score, level, coins, hasSession, sessionUsed, elapsedMs }
// elapsedMs is server-measured (Date.now() - session.startedAt); 0 if no session.
function scoreVerdict(input, L = LIMITS) {
  const n = Number(input.score);
  if (!Number.isInteger(n) || n < 0) return { valid: false, reason: 'invalid_score' };
  if (n > L.MAX_ABSOLUTE_SCORE) return { valid: false, reason: 'exceeds_cap' };

  const lvl = input.level == null ? 1 : Number(input.level);
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > L.MAX_LEVEL) return { valid: false, reason: 'invalid_level' };

  const coins = input.coins == null ? 0 : Number(input.coins);
  if (!Number.isInteger(coins) || coins < 0 || coins > n * L.COINS_PER_POINT + L.COINS_SLACK) {
    return { valid: false, reason: 'invalid_coins' };
  }

  // Session is mandatory and single-use; time checks use server-measured elapsed.
  if (!input.hasSession) return { valid: false, reason: 'no_session' };
  if (input.sessionUsed) return { valid: false, reason: 'session_reused' };

  const elapsedMs = Number(input.elapsedMs) || 0;
  if (elapsedMs < L.MIN_GAME_DURATION_MS && n > 5) return { valid: false, reason: 'too_fast' };

  const maxScoreForTime = Math.ceil((elapsedMs / 1000) * L.MAX_SCORE_PER_SECOND);
  if (n > maxScoreForTime) return { valid: false, reason: 'score_exceeds_time' };

  return { valid: true, level: lvl, coins };
}

module.exports = { scoreVerdict, LIMITS };
