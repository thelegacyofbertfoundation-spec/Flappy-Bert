// Game-over "rank nudge" helper — pure mirror of the logic in
// flappy_bert.html's showGameOverScreen(). Tests reference this; the HTML
// implementation must match.
//
// leaderboard: DESC-sorted array of { score } (highest first), as the game stores it.
// score:       the just-finished run's score.
// returns:
//   { type: 'rank', rank }            — you're inside the top 10 at 1-based `rank`
//   { type: 'behind', points, rank }  — you're `points` short of the NEAREST
//                                        attainable rank (1-based `rank`)
//   null                              — nothing worth saying (empty board, or score 0)
const TOP_N = 10;

function rankNudge(leaderboard, score) {
  if (!leaderboard || leaderboard.length === 0) return null;
  if (!score || score <= 0) return null; // a 0-score death shouldn't chirp about rank

  // First slot whose score you meet or beat = your rank position on a DESC list.
  const myIdx = leaderboard.findIndex(e => e.score <= score);
  if (myIdx >= 0 && myIdx < TOP_N) {
    return { type: 'rank', rank: myIdx + 1 };
  }

  // Otherwise find the NEAREST rank above you: the LAST entry still scoring
  // higher than you (the smallest gap to close), NOT the leader.
  let nearestIdx = -1;
  for (let i = 0; i < leaderboard.length; i++) {
    if (leaderboard[i].score > score) nearestIdx = i;
  }
  if (nearestIdx >= 0) {
    return {
      type: 'behind',
      points: leaderboard[nearestIdx].score - score,
      rank: nearestIdx + 1,
    };
  }
  return null;
}

module.exports = { rankNudge };
