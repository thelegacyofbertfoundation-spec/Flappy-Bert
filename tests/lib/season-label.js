// Season label logic — mirror of updateSeasonLabel() in flappy_bert.html.
// The menu bumps from SEASON 3 to SEASON 4 when The Summer Session begins
// (Jun 1 2026 00:00 UTC). Derives the boundary from the tournament's own
// start time when available; falls back to the constant otherwise. The season
// counter only goes up — it does NOT revert after the tournament ends.
const SEASON4_START_MS = Date.parse('2026-06-01T00:00:00Z');

function seasonLabel(nowMs, tournaments) {
  let startMs = SEASON4_START_MS;
  if (Array.isArray(tournaments)) {
    const summer = tournaments.find(t => t && t.id === 'summer-session-2026');
    if (summer && !Number.isNaN(Date.parse(summer.startTime))) startMs = Date.parse(summer.startTime);
  }
  return nowMs >= startMs ? 'SEASON 4' : 'SEASON 3';
}

module.exports = { seasonLabel, SEASON4_START_MS };
