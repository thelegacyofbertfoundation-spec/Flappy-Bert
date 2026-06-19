# Beat-My-Ghost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stateless Telegram "challenge a friend" loop — share a link carrying your score, a friend taps it, plays with that score as a visible target, and gets a "YOU BEAT <name>!" payoff.

**Architecture:** The whole challenge rides in a URL param (`g_<sharerId>_<score>`). Zero new server state/schema. A new pure module `lib/ghost-challenge.js` (parse/build/format) is shared by `bot.js` and the unit tests; the client inlines the same parse. The bot's `/start` gains a challenge branch; a tiny read-only `GET /api/config` exposes the bot username so the client can build `t.me/<bot>?start=…` links.

**Tech Stack:** Vanilla JS (single-file `flappy_bert.html`), Node/Express + node-telegram-bot-api (`bot.js`), better-sqlite3, `node --test` for unit tests.

## Global Constraints

- The ghost param is **cosmetic/display-only** — it must NEVER reach score validation, coins, badges, or any server write. Treat it as untrusted everywhere.
- Param format: `g_<sharerId>_<score>`, charset `[g_0-9]` only, score in `0..500` (the score cap), ≤64 chars.
- No new control scheme; the one-tap loop is untouched. No persistent state, no new overlay screens.
- Launch mechanism is the **zero-setup bot deep-link** (`t.me/<bot>?start=…` → bot reply → `web_app` button at `WEBAPP_URL?ghost=…`). No BotFather config.
- Follow existing patterns: `lib/*.js` are CommonJS modules required by `bot.js` + tests; in-`flappy_bert.html` logic is mirrored (drift accepted).
- Commit after each task. Do NOT push (deploy) until the user approves the finished feature.

---

### Task 1: `lib/ghost-challenge.js` pure helpers + tests

**Files:**
- Create: `lib/ghost-challenge.js`
- Test: `tests/ghost-challenge.test.js`

**Interfaces:**
- Produces:
  - `parseGhost(param: string) → { id: number, score: number } | null`
  - `buildStartParam(id: number, score: number) → string` (`"g_<id>_<score>"`)
  - `formatChallengeMessage(name: string|null, score: number) → string`
  - `MAX_SCORE = 500`

- [ ] **Step 1: Write the failing test**

Create `tests/ghost-challenge.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGhost, buildStartParam, formatChallengeMessage, MAX_SCORE } = require('../lib/ghost-challenge');

test('parses a valid ghost param', () => {
  assert.deepEqual(parseGhost('g_123456789_47'), { id: 123456789, score: 47 });
});
test('rejects malformed / out-of-range params', () => {
  assert.equal(parseGhost('g_1_501'), null);       // score over cap
  assert.equal(parseGhost('g_0_10'), null);        // id must be > 0
  assert.equal(parseGhost('g_abc_10'), null);      // non-numeric id
  assert.equal(parseGhost('x_1_10'), null);        // wrong prefix
  assert.equal(parseGhost('g_1_10_9'), null);      // extra segment
  assert.equal(parseGhost(''), null);
  assert.equal(parseGhost(null), null);
  assert.equal(parseGhost('g_1_-5'), null);        // negative
});
test('accepts the score boundaries 0 and 500', () => {
  assert.deepEqual(parseGhost('g_5_0'), { id: 5, score: 0 });
  assert.deepEqual(parseGhost('g_5_500'), { id: 5, score: 500 });
  assert.equal(MAX_SCORE, 500);
});
test('buildStartParam round-trips through parseGhost', () => {
  const p = buildStartParam(987654321, 88);
  assert.equal(p, 'g_987654321_88');
  assert.deepEqual(parseGhost(p), { id: 987654321, score: 88 });
});
test('formatChallengeMessage uses the name, falls back when missing', () => {
  assert.match(formatChallengeMessage('Sam', 47), /Sam/);
  assert.match(formatChallengeMessage('Sam', 47), /47/);
  assert.match(formatChallengeMessage(null, 12), /friend/i);
  assert.match(formatChallengeMessage('   ', 12), /friend/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ghost-challenge.test.js`
Expected: FAIL — `Cannot find module '../lib/ghost-challenge'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/ghost-challenge.js`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ghost-challenge.test.js`
Expected: PASS (5 tests). Then `npm test` — expected: all green (80 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ghost-challenge.js tests/ghost-challenge.test.js
git commit -m "feat(ghost): pure challenge-param helpers + tests"
```

---

### Task 2: bot.js wiring — `/start` challenge branch + `/api/config`

**Files:**
- Modify: `bot.js` — add require (near line 32-33); `/start` handler (line 228-255); add `botUsername` cache + `/api/config` near the other GET routes (after `/health`, ~line 999).

**Interfaces:**
- Consumes: `parseGhost`, `buildStartParam`, `formatChallengeMessage` from Task 1; existing `WEBAPP_URL` (bot.js:38), `db.getPlayer`, `bot.getMe`.
- Produces: `GET /api/config → { botUsername: string|null }`; a `/start g_<id>_<score>` reply with a `web_app` button at `WEBAPP_URL?ghost=<param>`.

- [ ] **Step 1: Add the require**

In `bot.js`, after line 33 (`const { allowedBadges } = require('./lib/badge-allowlist');`) add:
```js
const { parseGhost, buildStartParam, formatChallengeMessage } = require('./lib/ghost-challenge');
```

- [ ] **Step 2: Add the `/start` challenge branch**

Replace the `/start` handler header `bot.onText(/\/start/, (msg) => {` (bot.js:228) with `bot.onText(/\/start(?:\s+(\S+))?/, (msg, match) => {`, and insert the challenge branch right after `db.upsertPlayer(user.id, user.first_name, user.username);` (bot.js:232):
```js
  // Beat-My-Ghost: a "/start g_<id>_<score>" deep-link → personalized challenge.
  const challenge = match && match[1] ? parseGhost(match[1]) : null;
  if (challenge) {
    const sharer = db.getPlayer(challenge.id);
    const name = (sharer && (sharer.first_name || sharer.username)) || null;
    const ghostUrl = WEBAPP_URL + (WEBAPP_URL.includes('?') ? '&' : '?') +
      'ghost=' + encodeURIComponent(buildStartParam(challenge.id, challenge.score));
    bot.sendMessage(chatId, formatChallengeMessage(name, challenge.score), {
      reply_markup: { inline_keyboard: [[
        { text: '▶ Beat it!', web_app: { url: ghostUrl } },
      ]] },
    });
    return;
  }
```
(The existing welcome message below it is unchanged and runs for a param-less or non-matching `/start`.)

- [ ] **Step 3: Add the bot-username cache + `/api/config`**

After the bot is constructed (`const bot = new TelegramBot(...)`, bot.js:149) add:
```js
let botUsername = null;
bot.getMe().then((me) => { botUsername = me.username || null; }).catch(() => {});
```
After the `/health` route (`app.get('/health', ...)`, ~bot.js:999) add:
```js
// Read-only: lets the client build t.me/<bot>?start=… challenge links.
app.get('/api/config', (req, res) => res.json({ botUsername }));
```

- [ ] **Step 4: Verify**

Run: `node --check bot.js` → expected: clean.
Run: `npm test` → expected: all green (the parse/format logic is covered by Task 1).
Local smoke (the bot username is null with a dummy token, which is fine):
```bash
BOT_TOKEN=dummy:smoke API_SECRET=s PORT=3997 node bot.js >/tmp/cfg.log 2>&1 &
SRV=$!; sleep 4
curl -s http://127.0.0.1:3997/api/config; echo
kill $SRV
```
Expected: `{"botUsername":null}` (200, valid JSON — the endpoint works; a real token yields the real username).

- [ ] **Step 5: Commit**

```bash
git add bot.js
git commit -m "feat(ghost): /start challenge branch + /api/config bot-username endpoint"
```

---

### Task 3: Client — receive a challenge on load (parse + target pill)

**Files:**
- Modify: `flappy_bert.html` — CSS near the `.frenzy-pill` block (~line 525-533); pill markup near the `#frenzyPill` div (~line 588-592); JS in the `<script>` (add helpers; call from `init()` at line 949).

**Interfaces:**
- Consumes: existing `getTelegramUser()` (line 4640), `API_BASE` (line 4630), the global `G`.
- Produces: `G.ghost = { id, score, name, passed } | undefined`; `updateGhostPill()`; the challenge is read on load.

- [ ] **Step 1: Add the target-pill CSS**

After the `.frenzy-pill-bar-fill { … }` rule (~line 533), add:
```css
.ghost-pill {
  position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
  z-index: 100; display: none; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 14px;
  background: rgba(20, 24, 41, 0.85); border: 1px solid var(--accent3);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.4);
  font-size: 8px; color: var(--text); white-space: nowrap; pointer-events: none;
}
.ghost-pill.passed {
  border-color: var(--gold); color: var(--gold);
  box-shadow: 0 0 16px rgba(255, 215, 0, 0.7); animation: pulse 0.5s ease-in-out 2;
}
```

- [ ] **Step 2: Add the pill markup**

After the `#frenzyPill` closing `</div>` (~line 592), add:
```html
<div id="ghostPill" class="ghost-pill">🎯 <span id="ghostPillText">…</span></div>
```

- [ ] **Step 3: Add the parse + read + pill-update helpers**

In the `<script>` (place near `getTelegramUser`, ~line 4646), add:
```js
// Mirror of lib/ghost-challenge.parseGhost (browser can't require; drift accepted).
function parseGhost(param) {
  if (typeof param !== 'string') return null;
  const m = /^g_(\d{1,17})_(\d{1,4})$/.exec(param);
  if (!m) return null;
  const id = Number(m[1]), score = Number(m[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (!Number.isInteger(score) || score < 0 || score > 500) return null;
  return { id, score };
}

function updateGhostPill() {
  const pill = document.getElementById('ghostPill');
  if (!pill) return;
  if (!G.ghost || G.state !== 'playing') { pill.style.display = 'none'; return; }
  const name = G.ghost.name || '…';
  document.getElementById('ghostPillText').textContent = name + '  ' + G.ghost.score;
  pill.style.display = 'flex';
  pill.classList.toggle('passed', !!G.ghost.passed);
}

function readGhostChallenge() {
  let raw = null;
  try { raw = new URLSearchParams(window.location.search).get('ghost'); } catch (e) {}
  if (!raw) { try { raw = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null; } catch (e) {} }
  const c = raw ? parseGhost(raw) : null;
  if (!c) return;
  const me = getTelegramUser();
  if (me && me.id === c.id) return; // your own challenge — ignore
  G.ghost = { id: c.id, score: c.score, name: null, passed: false };
  fetch((API_BASE || '') + '/api/player/' + c.id)
    .then((r) => r.json())
    .then((d) => { if (G.ghost) G.ghost.name = (d && d.player && (d.player.first_name || d.player.username)) || 'a friend'; updateGhostPill(); })
    .catch(() => { if (G.ghost) G.ghost.name = 'a friend'; updateGhostPill(); });
}
```

- [ ] **Step 4: Call `readGhostChallenge()` from `init()`**

Inside `init()` (line 949), add a call (e.g., at the end of the function body): `readGhostChallenge();`

- [ ] **Step 5: Verify (syntax + browser smoke)**

Extract + syntax-check the inlined script:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("flappy_bert.html","utf8");const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join("\n");fs.writeFileSync("/tmp/fb.js",m);' && node --check /tmp/fb.js && echo "JS OK"
```
Expected: `JS OK`.
Browser smoke (reuse the chromium-from-facelift pattern): load `file:///opt/Flappy-Bert/flappy_bert.html?ghost=g_999_47`, then `page.evaluate(() => { G.state='playing'; G.ghost={id:999,score:47,name:'Sam',passed:false}; updateGhostPill(); return getComputedStyle(document.getElementById('ghostPill')).display; })` → expected `"flex"`, and the pill text contains `Sam` and `47`. Confirm no console errors.

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(ghost): receive challenge on load + target pill"
```

---

### Task 4: Client — the payoff (pass-moment + game-over result)

**Files:**
- Modify: `flappy_bert.html` — the score-increment block (line 2704-2709); `startGame()` (line 1840); the game-over population in `gameOver()` (near line 2210-2221); add a `#goChallenge` element to the game-over markup (in the `go-stats` step, ~line 724).

**Interfaces:**
- Consumes: `G.ghost`, `G.score`, `FX._floater(text, x, y, extraClass)` (line 1501), `AudioSystem.fxLevelUp()` (line 1283/1525), `updateGhostPill()` (Task 3).
- Produces: a one-shot pass celebration; a `#goChallenge` result line populated on game over.

- [ ] **Step 1: Add the pass-moment to the score-increment block**

Immediately after `G.score += scoreGain;` (line 2709), add:
```js
      if (G.ghost && !G.ghost.passed && G.score > G.ghost.score) {
        G.ghost.passed = true;
        FX._floater('PASSED ' + (G.ghost.name || 'them') + '!', window.innerWidth / 2, window.innerHeight * 0.4, 'fx-near-miss-floater');
        AudioSystem.fxLevelUp();
        updateGhostPill();
      }
```

- [ ] **Step 2: Reset `passed` each game in `startGame()`**

Inside `startGame()` (line 1840), add (after the score/state are reset): `if (G.ghost) G.ghost.passed = false;`

- [ ] **Step 3: Add the game-over result element**

In the `go-stats fx-go-step` div (after `#goMultiplier`, ~line 724), add:
```html
      <div id="goChallenge" style="font-size:8px;margin:5px 0;display:none"></div>
```

- [ ] **Step 4: Populate it in `gameOver()`**

In `gameOver()`, near where `goScore` is set (line 2210-2221), add:
```js
  const goChallenge = document.getElementById('goChallenge');
  if (G.ghost && goChallenge) {
    const beat = G.score > G.ghost.score;
    const who = G.ghost.name || 'them';
    goChallenge.style.display = 'block';
    goChallenge.style.color = beat ? 'var(--gold)' : 'var(--accent3)';
    goChallenge.textContent = beat
      ? `🏆 YOU BEAT ${who}!  ${G.score} › ${G.ghost.score}`
      : `🎯 So close — ${G.score}/${G.ghost.score}. Try again!`;
  } else if (goChallenge) {
    goChallenge.style.display = 'none';
  }
```

- [ ] **Step 5: Verify (syntax + browser smoke)**

Run the extract+`node --check` from Task 3 Step 5 → expected `JS OK`.
Browser smoke: set `G.ghost={id:9,score:5,name:'Sam',passed:false}`, drive a few score increments past 5, confirm `G.ghost.passed === true` and a floater node appears; then call `gameOver()` and assert `#goChallenge` text contains `YOU BEAT Sam`. Confirm no console errors.

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(ghost): pass-moment celebration + game-over result line"
```

---

### Task 5: Client — create/share a challenge

**Files:**
- Modify: `flappy_bert.html` — add `_botUsername` + `loadConfig()` + `challengeFriend()` (near the share helpers, ~line 4384/4630); call `loadConfig()` in `init()` (line 949); add a "🎯 CHALLENGE A FRIEND" button to the game-over actions (line 730-738).

**Interfaces:**
- Consumes: `getTelegramUser()`, `G.score`, existing `shareScoreCard()` (line 4384, used as fallback), `API_BASE`, `buildStartParam` logic.
- Produces: `challengeFriend()` opens the Telegram share sheet with `t.me/<bot>?start=g_<myId>_<myScore>`.

- [ ] **Step 1: Add config load + the share function**

In the `<script>` (near `shareScoreCard`, ~line 4384), add:
```js
let _botUsername = null;
async function loadConfig() {
  try { const r = await fetch((API_BASE || '') + '/api/config'); const d = await r.json(); _botUsername = d.botUsername || null; } catch (e) {}
}

async function challengeFriend() {
  const user = getTelegramUser();
  if (!user || !_botUsername) return shareScoreCard(); // graceful fallback
  const param = 'g_' + user.id + '_' + (G.score | 0);
  const link = 'https://t.me/' + _botUsername + '?start=' + param;
  const text = "I flapped " + (G.score | 0) + " in Flappy Bert 🐕 — bet you can't beat it!";
  const shareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text);
  try {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  } catch (e) { shareScoreCard(); }
}
```

- [ ] **Step 2: Call `loadConfig()` from `init()`**

Inside `init()` (line 949), add: `loadConfig();`

- [ ] **Step 3: Add the game-over button**

In the `go-actions` block, after the PLAY AGAIN button row (line 733, the closing `</div>` of the first button row), insert a new row:
```html
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:6px">
        <button class="btn btn-gold" style="font-size:8px;padding:7px 12px" onclick="challengeFriend()">&#x1F3AF; CHALLENGE A FRIEND</button>
      </div>
```

- [ ] **Step 4: Verify (syntax + browser smoke)**

Run the extract+`node --check` from Task 3 Step 5 → expected `JS OK`.
Browser smoke: set `_botUsername='FlappyBertBot'`, `G.score=42`, stub `window.Telegram.WebApp.openTelegramLink = (u)=>{window.__shared=u}`, call `challengeFriend()`, assert `window.__shared` contains `t.me/FlappyBertBot?start=g_` and `_42`. With `_botUsername=null`, assert it falls back (calls `shareScoreCard`, no throw). Confirm no console errors.

- [ ] **Step 5: Final full verification**

```bash
npm test                                  # expected: all green (80 tests)
node --check bot.js                       # expected: clean
```
Plus the inlined-JS `node --check` (Task 3 Step 5) and a final browser boot smoke confirming the game still loads with no console errors both with and without `?ghost=`.

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(ghost): challenge-a-friend share button + link builder"
```

---

## Self-Review

- **Spec coverage:** launch mechanism (Task 2 `/start` + `/api/config`) ✓; param format + name-from-id (Task 1 + Task 2 + Task 3 fetch) ✓; target pill (Task 3) ✓; pass-moment (Task 4) ✓; game-over variant + challenge-back (Task 4 result + Task 5 button reused) ✓; share side (Task 5) ✓; edge cases own-id/garbage/missing-name (Task 3 `readGhostChallenge`, Task 1 `parseGhost`, Task 3 fetch fallback) ✓; security cosmetic-only (Global Constraints + nothing writes from the param) ✓; testing (Task 1 unit tests + browser smokes) ✓.
- **Type consistency:** `parseGhost`/`buildStartParam`/`formatChallengeMessage` names match across Task 1↔2↔3; `G.ghost = {id, score, name, passed}` shape consistent in Tasks 3/4/5; `updateGhostPill`/`readGhostChallenge`/`challengeFriend`/`loadConfig` referenced consistently.
- **Note on "Challenge back":** the design's "Challenge back" on the game-over screen is satisfied by the single `challengeFriend()` button (Task 5) — it always shares the player's *current* score, so on a post-challenge game over it naturally re-challenges. No separate control needed.
