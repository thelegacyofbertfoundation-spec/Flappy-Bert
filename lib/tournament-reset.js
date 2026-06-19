// Pure helpers for the non-destructive, time-boundary tournament reset.
// Shared by bot.js and the tests. The boundary is a pure function of time.

// ISO-8601 → SQLite "YYYY-MM-DD HH:MM:SS" (UTC), to compare against
// tournament_scores.played_at (DEFAULT datetime('now')).
function isoToSqliteUTC(iso) {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

// The SQLite boundary string iff scoreResetAt is set AND now has reached it;
// otherwise null (= no filter = pre-reset / no-reset behavior).
function effectiveResetSince(scoreResetAt, nowMs) {
  if (!scoreResetAt) return null;
  const t = Date.parse(scoreResetAt);
  if (Number.isNaN(t)) return null;
  if (nowMs < t) return null;
  return isoToSqliteUTC(scoreResetAt);
}

module.exports = { isoToSqliteUTC, effectiveResetSince };
