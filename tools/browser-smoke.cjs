// browser-smoke.cjs — boot the real game in headless chromium (SwiftShader, no GPU),
// capture runtime errors (the new draw code runs every frame, so a bug floods console),
// verify sprites loaded, and screenshot a live gameplay state.
const { chromium } = require('/opt/facelift/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 740 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('file:///opt/Flappy-Bert/flappy_bert.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => {
    const r = {};
    try { r.flapReady = (typeof bertFlapReady === 'function') ? bertFlapReady() : 'no-fn'; } catch (e) { r.flapErr = e.message; }
    try { r.sprites = Object.fromEntries(Object.keys(PL_SPR).map((k) => [k, plReady(k)])); } catch (e) { r.sprErr = e.message; }
    try { r.gState = (typeof G !== 'undefined') ? G.state : 'no-G'; } catch (e) { r.gErr = e.message; }
    return r;
  });
  await page.screenshot({ path: 'docs/verification/pixellab-flappy/browser-menu.png' });

  // Force a gameplay frame with enemies + tokens, let the draw loop run, screenshot.
  let playShot = false;
  try {
    await page.evaluate(() => {
      if (typeof startGame === 'function') startGame();
      if (typeof G !== 'undefined') {
        G.state = 'playing';
        if (Array.isArray(G.enemies)) {
          G.enemies.push({ type: 'bat', homing: false, x: 300, y: 230, vx: -1, baseY: 230, age: 0, size: 28, scale: 2, amplitude: 10, freq: 0.04, freq2: 0.01, amp2: 10, vyDrift: 0, nextDirChange: 100 });
          G.enemies.push({ type: 'hunter', homing: true, x: 360, y: 300, vx: -1, baseY: 300, age: 0, size: 14, scale: 1, amplitude: 6, freq: 0.05, freq2: 0.01, amp2: 0, vyDrift: 0, nextDirChange: 100 });
        }
      }
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'docs/verification/pixellab-flappy/browser-play.png' });
    playShot = true;
  } catch (e) { errors.push('play-setup: ' + e.message); }

  console.log('STATE:', JSON.stringify(state));
  console.log('RUNTIME ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'NONE');
  console.log('playShot:', playShot);
  await browser.close();
  process.exit(errors.length ? 2 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
