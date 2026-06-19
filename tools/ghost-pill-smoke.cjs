// ghost-pill-smoke.cjs — boot the real game in headless chromium (SwiftShader, no GPU)
// with a ?ghost= challenge param, and verify the Beat-My-Ghost target pill shows
// (cosmetic display-only HUD). Asserts the pill is `display:flex` while playing and
// its text carries the rival name + target score. Captures runtime console/page
// errors and fails on any that are NOT the expected offline file:///api fetch failures.
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

  await page.goto('file:///opt/Flappy-Bert/flappy_bert.html?ghost=g_999_47', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => {
    // Simulate the in-game state the pill needs (offline /api/player never resolves,
    // so populate the name the way the resolved fetch would).
    G.state = 'playing';
    G.ghost = { id: 999, score: 47, name: 'Sam', passed: false };
    updateGhostPill();
    return {
      disp: getComputedStyle(document.getElementById('ghostPill')).display,
      text: document.getElementById('ghostPillText').textContent,
    };
  });

  // Also verify the param-parse + own-challenge ignore paths in isolation.
  const logic = await page.evaluate(() => ({
    parseOk: JSON.stringify(parseGhost('g_999_47')),
    parseBad: parseGhost('g_0_47'),       // id<=0 -> null
    parseOver: parseGhost('g_5_999'),     // score>500 -> null
  }));

  await page.screenshot({ path: 'docs/verification/ghost-pill-smoke.png' }).catch(() => {});

  const okDisp = result.disp === 'flex';
  const okText = result.text.includes('Sam') && result.text.includes('47');
  const okParse = logic.parseOk === '{"id":999,"score":47}' && logic.parseBad === null && logic.parseOver === null;

  console.log('PILL display:', result.disp, '(expect flex)');
  console.log('PILL text   :', JSON.stringify(result.text), '(expect contains Sam + 47)');
  console.log('PARSE       :', JSON.stringify(logic));
  console.log('RUNTIME ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'NONE');

  await browser.close();
  const pass = okDisp && okText && okParse && errors.length === 0;
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
