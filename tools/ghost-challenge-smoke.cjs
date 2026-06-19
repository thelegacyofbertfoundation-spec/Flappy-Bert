// ghost-challenge-smoke.cjs — boot the real game in headless chromium (SwiftShader,
// no GPU) and verify the Beat-My-Ghost "CHALLENGE A FRIEND" share flow.
//   1) With _botUsername set, challengeFriend() opens the Telegram share sheet with a
//      t.me/<bot>?start=g_<id>_<score> link carrying the player's OWN id + current score.
//   2) With _botUsername null, it gracefully falls back to shareScoreCard() (no throw).
//   3) The "CHALLENGE A FRIEND" button exists in the game-over actions.
//   4) The page boots clean (no unexpected console/page errors) BOTH with and without
//      a ?ghost= challenge param.
// Captures runtime console/page errors and fails on any that are NOT the expected
// offline file:///api fetch failures.
const { chromium } = require('/opt/facelift/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  // Offline file:// loads can't reach /api/* — those fetch failures are expected.
  const isExpected = (t) => /Failed to (load|fetch)|fetch.*(api|player|tournaments|session|config|leaderboard)|net::ERR/i.test(t)
    || /file:\/\/\/api/i.test(t);

  async function boot(url) {
    const page = await browser.newPage({ viewport: { width: 420, height: 740 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !isExpected(m.text())) errors.push('console.error: ' + m.text()); });
    page.on('pageerror', (e) => { if (!isExpected(e.message)) errors.push('pageerror: ' + e.message); });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    return { page, errors };
  }

  // ---- Boot WITHOUT ?ghost= : clean boot + button present + share + fallback ----
  const { page, errors } = await boot('file:///opt/Flappy-Bert/flappy_bert.html');

  const result = await page.evaluate(() => {
    // Stub a verified Telegram user. The real telegram-web-app.js SDK exposes
    // initDataUnsafe as a read-only getter, so we REPLACE window.Telegram with a
    // plain object whose props are writable (matches what getTelegramUser reads).
    window.__shared = null;
    window.Telegram = {
      WebApp: {
        initDataUnsafe: { user: { id: 777, first_name: 'Me' } },
        openTelegramLink: (u) => { window.__shared = u; },
      },
    };

    // --- Case 1: bot username available -> opens share sheet with own id + score ---
    _botUsername = 'FlappyBertBot';
    // G.score has an anti-tamper setter (only +1/+2 per step while playing, resets to 0
    // otherwise), so drive it up legitimately rather than assigning 42 directly.
    G.state = 'playing';
    while (G.score < 42) { G.score = G.score + 1; }
    let threw1 = false;
    try { challengeFriend(); } catch (e) { threw1 = true; }
    const shared = window.__shared;

    // --- Case 2: bot username missing -> graceful fallback to shareScoreCard() ---
    _botUsername = null;
    window.__fellBack = false;
    const realShare = shareScoreCard;
    shareScoreCard = function () { window.__fellBack = true; };
    let threw2 = false;
    try { challengeFriend(); } catch (e) { threw2 = true; }
    shareScoreCard = realShare;

    // --- Button presence in the game-over actions block ---
    const actions = document.querySelector('.go-actions');
    const btns = actions ? Array.from(actions.querySelectorAll('button')) : [];
    const challengeBtn = btns.find((b) => b.textContent.includes('CHALLENGE A FRIEND'));

    return {
      shared,
      threw1,
      threw2,
      fellBack: window.__fellBack,
      hasButton: !!challengeBtn,
      btnOnclick: challengeBtn ? challengeBtn.getAttribute('onclick') : null,
    };
  });

  await page.close();

  // ---- Boot WITH ?ghost= : confirm it still boots clean ----
  const { page: gpage, errors: gerrors } = await boot('file:///opt/Flappy-Bert/flappy_bert.html?ghost=g_999_47');
  await gpage.close();

  await browser.close();

  // The challenge link is URL-encoded INSIDE the share-sheet url (?url=<encoded link>),
  // so decode before asserting the link's substrings (the brief's intent).
  const sharedDecoded = typeof result.shared === 'string' ? decodeURIComponent(result.shared) : '';
  const okShare = typeof result.shared === 'string'
    && sharedDecoded.includes('t.me/FlappyBertBot')
    && sharedDecoded.includes('start=g_')
    && sharedDecoded.includes('_42')
    && !result.threw1;
  const okFallback = result.fellBack === true && result.threw2 === false;
  const okButton = result.hasButton && /challengeFriend\(\)/.test(result.btnOnclick || '');
  const okBoot = errors.length === 0;
  const okGhostBoot = gerrors.length === 0;

  console.log('SHARE url    :', JSON.stringify(result.shared));
  console.log('  -> contains t.me/FlappyBertBot + start=g_ + _42, no throw:', okShare);
  console.log('FALLBACK     : fellBack=' + result.fellBack + ' threw=' + result.threw2, '(expect fellBack=true, no throw)');
  console.log('BUTTON       : present=' + result.hasButton + ' onclick=' + JSON.stringify(result.btnOnclick));
  console.log('BOOT errors (no ?ghost):', errors.length ? JSON.stringify(errors, null, 1) : 'NONE');
  console.log('BOOT errors (?ghost=)  :', gerrors.length ? JSON.stringify(gerrors, null, 1) : 'NONE');

  const pass = okShare && okFallback && okButton && okBoot && okGhostBoot;
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
