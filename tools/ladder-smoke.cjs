// ladder-smoke.cjs — boot the real game in headless chromium (SwiftShader, no GPU)
// and exercise the always-show prize ladder renderer `renderEntriesInto(div, entries, prizes)`.
// Asserts: 5 prize rows render for [100,60,40,30,20] with one entry; row 1 carries the
// $100 prize + the player name; row 3 (no entry) shows the $40 prize + "up for grabs".
// Then asserts the no-prizes empty path still renders "No scores yet". Captures runtime
// console/page errors and fails on any that are NOT the expected offline file:///api failures.
const { chromium } = require('/opt/facelift/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 740 } });
  const errors = [];
  // Offline file:// loads can't reach /api/* — those fetch failures are expected.
  const isExpected = (t) => /Failed to (load|fetch)|fetch.*(api|player|tournaments|session|config|leaderboard)|net::ERR/i.test(t)
    || /file:\/\/\/api/i.test(t);
  page.on('console', (m) => { if (m.type() === 'error' && !isExpected(m.text())) errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => { if (!isExpected(e.message)) errors.push('pageerror: ' + e.message); });

  await page.goto('file:///opt/Flappy-Bert/flappy_bert.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  // Always-show ladder: one entry + 5 prizes -> 5 rows.
  const ladder = await page.evaluate(() => {
    const div = document.createElement('div');
    renderEntriesInto(div, [{ telegram_id: 1, first_name: 'Sam', best_score: 47, games_played: 3 }], [100, 60, 40, 30, 20]);
    const rows = Array.from(div.children).map((c) => c.textContent);
    return { count: div.children.length, row1: rows[0] || '', row3: rows[2] || '' };
  });

  // No-prizes empty path -> "No scores yet" (backward compatible).
  const empty = await page.evaluate(() => {
    const div = document.createElement('div');
    renderEntriesInto(div, [], null);
    return { count: div.children.length, text: div.textContent };
  });

  await browser.close();

  const ok5rows = ladder.count === 5;
  const okRow1 = ladder.row1.includes('$100') && ladder.row1.includes('Sam');
  const okRow3 = ladder.row3.includes('$40') && ladder.row3.includes('up for grabs');
  const okEmpty = empty.count === 1 && empty.text.includes('No scores yet');

  console.log('LADDER rows :', ladder.count, '(expect 5)');
  console.log('LADDER row1 :', JSON.stringify(ladder.row1), '(expect $100 + Sam)');
  console.log('LADDER row3 :', JSON.stringify(ladder.row3), '(expect $40 + up for grabs)');
  console.log('EMPTY       :', JSON.stringify(empty), '(expect 1 row, No scores yet)');
  console.log('RUNTIME ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'NONE');

  const pass = ok5rows && okRow1 && okRow3 && okEmpty && errors.length === 0;
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
