// repro-tournament-bug.cjs — reproduce: weekly + tournament submitted with ONE
// single-use session => the second (tournament) is rejected. Forges a valid
// initData locally (known test token), replays the game-over two-submit sequence.
const crypto = require('crypto');
const { spawn } = require('child_process');

const TOKEN = 'test:reprotoken';
const SECRET = 'reprosecret';
const PORT = 3998;
const TID = 'summer-session-2026';

function makeInitData(token, user) {
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAA', user: JSON.stringify(user) };
  const dcs = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  const usp = new URLSearchParams(params); usp.set('hash', hash);
  return usp.toString();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body) => fetch(`http://127.0.0.1:${PORT}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

(async () => {
  const srv = spawn('node', ['bot.js'], {
    cwd: '/opt/Flappy-Bert',
    env: { ...process.env, BOT_TOKEN: TOKEN, API_SECRET: SECRET, PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    await sleep(3500);
    const user = { id: 777001, first_name: 'ReproUser', username: 'repro' };
    const initData = makeInitData(TOKEN, user);

    const sess = await post('/api/session', { init_data: initData });
    const sid = sess.body.session_id;
    console.log('session:', sess.status, sid ? 'minted' : JSON.stringify(sess.body));
    if (!sid) throw new Error('no session');

    await sleep(2500); // clear the 5/sec time gate for a small score

    const score = 3, level = 1, coins = 2;
    const weekly = await post('/api/score', { score, level, coins_earned: coins, session_id: sid, init_data: initData });
    console.log('WEEKLY  /api/score          :', weekly.status, JSON.stringify(weekly.body));

    const tourn = await post(`/api/tournament/${TID}/score`, { score, level, coins_earned: coins, session_id: sid, init_data: initData });
    console.log('TOURNEY /api/tournament/score:', tourn.status, JSON.stringify(tourn.body));

    // Anti-cheat must still hold: a SECOND submit to the SAME board on this
    // session is a replay and must be rejected.
    const weeklyReplay = await post('/api/score', { score, level, coins_earned: coins, session_id: sid, init_data: initData });
    const tournReplay = await post(`/api/tournament/${TID}/score`, { score, level, coins_earned: coins, session_id: sid, init_data: initData });
    console.log('WEEKLY  replay (expect reject):', weeklyReplay.status, weeklyReplay.body.reason || '');
    console.log('TOURNEY replay (expect reject):', tournReplay.status, tournReplay.body.reason || '');

    const weeklyOk = weekly.status === 200 && weekly.body.ok;
    const tournOk = tourn.status === 200 && tourn.body.ok;
    const replayBlocked = weeklyReplay.status === 403 && tournReplay.status === 403;
    console.log('\n=== RESULT ===');
    console.log('weekly recorded    :', weeklyOk);
    console.log('tournament recorded:', tournOk);
    console.log('replay blocked     :', replayBlocked);
    if (weeklyOk && !tournOk) console.log('>>> BUG REPRODUCED: weekly saved, tournament REJECTED (' + (tourn.body.reason || tourn.status) + ')');
    else if (weeklyOk && tournOk && replayBlocked) console.log('>>> FIXED: both boards recorded + per-board replay still blocked');
    else if (weeklyOk && tournOk && !replayBlocked) console.log('>>> REGRESSION: both recorded but replay NOT blocked (anti-cheat hole!)');
    else console.log('>>> UNEXPECTED state');
  } catch (e) {
    console.error('repro error:', e.message);
  } finally {
    srv.kill();
  }
})();
