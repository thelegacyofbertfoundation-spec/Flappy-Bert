const { renderTournamentCard } = require('../leaderboard-card');
const fs = require('fs');
// with prizes + only 2 entries (so 3 empty "up for grabs" slots)
const buf = renderTournamentCard(
  [{ telegram_id: 1, first_name: 'Sam', best_score: 47, max_level: 5, games_played: 3, skin: 'default' },
   { telegram_id: 2, first_name: 'Alex', best_score: 42, max_level: 4, games_played: 2, skin: 'default' }],
  { name: 'The Summer Session', sponsor: 'Dr. Inker LABS', status: '🔴 LIVE', prizes: [100, 60, 40, 30, 20] });
fs.writeFileSync('docs/verification/tournament-card-prizes.png', buf);
// backward-compat: no prizes must still render
const buf2 = renderTournamentCard([{ telegram_id: 1, first_name: 'Sam', best_score: 47, max_level: 5, games_played: 3, skin: 'default' }], { name: 'X', sponsor: 'Y', status: 'ended' });
console.log('with-prizes bytes:', buf.length, '| no-prizes bytes:', buf2.length);
console.log(buf.length > 1000 && buf2.length > 1000 ? '>>> PASS (both rendered)' : '>>> FAIL');
