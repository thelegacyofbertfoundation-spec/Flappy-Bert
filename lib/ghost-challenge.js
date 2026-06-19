// Pure helpers for the Beat-My-Ghost challenge param. Shared by bot.js and the
// tests (single source). The CLIENT inlines an identical parseGhost (mirror).
// The param is cosmetic/display-only — never an input to score validation.
const MAX_SCORE = 500;

function parseGhost(param) {
  if (typeof param !== 'string') return null;
  const m = /^g_(\d{1,17})_(\d{1,4})$/.exec(param);
  if (!m) return null;
  const id = Number(m[1]);
  const score = Number(m[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return null;
  return { id, score };
}

function buildStartParam(id, score) {
  return `g_${id}_${score}`;
}

function formatChallengeMessage(name, score) {
  const who = (name && String(name).trim()) ? String(name).trim() : 'A friend';
  return `🎯 ${who} dares you to beat ${score} in Flappy Bert! Tap below to flap.`;
}

module.exports = { parseGhost, buildStartParam, formatChallengeMessage, MAX_SCORE };
