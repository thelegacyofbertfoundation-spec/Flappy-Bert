// Server-side badge gating — shared module required by bot.js and the tests.
// Badges are decorative (boards rank by score, not badges) but render on the
// shared/public leaderboard cards, so a submitter must not be able to forge
// arbitrary or unearned badges onto their (or, pre-initData-fix, a victim's) row.
// Rules: allowlist known ids; score-gate the score badges to the submitted
// (already validated) score; UNION with the player's existing badges so a low
// score never wipes previously-earned ones; cap the array length.
const VALID_BADGES = [
  'rookie', 'pipe_dodger', 'sky_king', 'legend', 'immortal',
  'streak_master', 'combo_king', 'close_call', 'shield_breaker',
];
const BADGE_MIN_SCORE = { rookie: 10, pipe_dodger: 25, sky_king: 50, legend: 100, immortal: 200 };
// The remaining "achievement" badges (combo_king, shield_breaker, …) are
// client-attested feats and not server-verifiable. Gate them at a modest default
// so they can't be self-awarded at score 0 (still cosmetic — boards rank by
// score, not badges — but no free score-0 flex on the public cards).
const DEFAULT_MIN_SCORE = 10;

function allowedBadges(submitted, validatedScore, existing) {
  const accepted = new Set(
    (Array.isArray(existing) ? existing : []).filter((b) => VALID_BADGES.includes(b)),
  );
  for (const b of Array.isArray(submitted) ? submitted : []) {
    if (typeof b !== 'string' || !VALID_BADGES.includes(b)) continue;
    const min = (b in BADGE_MIN_SCORE) ? BADGE_MIN_SCORE[b] : DEFAULT_MIN_SCORE;
    if (Number(validatedScore) < min) continue;
    accepted.add(b);
  }
  return [...accepted].slice(0, VALID_BADGES.length);
}

module.exports = { allowedBadges, VALID_BADGES, BADGE_MIN_SCORE, DEFAULT_MIN_SCORE };
