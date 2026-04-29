# Tournament Framework v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded tournament config with a data-driven framework so the April→May rollover (and every future month) is a config-only change, plus give players a permanent archive UX.

**Architecture:** Tournaments load from `tournaments.json` at server startup (idempotent seed via `INSERT OR IGNORE`). A new `/api/tournaments/featured` endpoint picks one prominent tournament for the home button using priority rules (live > upcoming<7d > recently_ended<14d). The mini-app removes its hardcoded `TOURNAMENT` const and hydrates state from server endpoints, refactoring the tournament overlay into three labeled sections (Live / Upcoming / Past) using DOM API methods (createElement / textContent) for all rendering of operator- and user-supplied strings.

**Tech Stack:** Node 20, Express, better-sqlite3, vanilla JS (Canvas mini-app), `node:test` (built-in test runner — no new dependency).

**Spec:** `docs/superpowers/specs/2026-04-29-tournament-framework-v2-design.md`

**Working directory:** All paths absolute. Project root is `/opt/Flappy-Bert/`.

**Cwd note:** This repo's `package.json` doesn't define a `test` script today. We'll add one as part of Task 2. Until then, run tests with the explicit `node --test` command shown in each step.

**TDD scope:** Server-side pure logic (config loader + featured-priority) gets a real TDD cycle with `node:test`. Frontend HTML/JS is verified manually against the 9 scenarios in the spec — bootstrapping Playwright/jsdom is too heavy for this codebase given the deadline.

**Security note (frontend):** All operator-supplied strings (`t.name`, `t.sponsor`, `t.id`) and user-supplied strings (`e.first_name`, `e.username`) MUST be inserted via `el.textContent = ...` or `document.createTextNode(...)`, never via string interpolation into `innerHTML`. The existing codebase has `innerHTML` patterns in some places — do not extend that pattern in the new code. Click handlers that take a tournament id MUST use `dataset.id` + `addEventListener`, never inline `onclick="...id..."`.

---

## File Structure

**Create:**
- `tournaments.json` — config file at project root, three tournament entries (Champions / April / May)
- `tournaments-config.js` — pure module: `loadTournamentsFromFile(path)`, `validateTournament(obj)`, `getFeaturedTournament(tournaments, now)`. Server-only, requires nothing from `bot.js`.
- `tests/tournaments-config.test.js` — unit tests for the above

**Modify:**
- `bot.js` — replace inline `db.createTournament(...)` block (lines 179-193) with a call into `tournaments-config.js`; add `/api/tournaments/featured` endpoint near other tournament routes (~line 753); extend `/tournament` Telegram command (~line 438) to accept a keyword arg; set `Cache-Control: no-cache` on the `/game` route.
- `flappy_bert.html` — remove hardcoded `TOURNAMENT` const (lines 3102-3170); add hydration on app load; rewrite `showTournament()` and the overlay markup at line 491-499 for 3-section layout using DOM API; add a "📜 PAST TOURNAMENTS" button next to RANKINGS (line 539-540).
- `package.json` — add `"test": "node --test tests/"` script.

---

## Task 1: Create `tournaments.json` config file

**Files:**
- Create: `/opt/Flappy-Bert/tournaments.json`

- [ ] **Step 1: Create the config file**

Write `/opt/Flappy-Bert/tournaments.json`:

```json
[
  {
    "id": "champions-flapoff-1",
    "name": "Champions Flap-off",
    "sponsor": "TraderSZ",
    "startTime": "2026-02-19T17:00:00Z",
    "endTime": "2026-03-19T23:59:59Z"
  },
  {
    "id": "april-fools-flapoff-2026",
    "name": "April Fools Flap-off 2026",
    "sponsor": "Dr. Inker LABS",
    "startTime": "2026-04-01T00:00:00Z",
    "endTime": "2026-04-30T23:59:59Z"
  },
  {
    "id": "may-the-flap-2026",
    "name": "May The Flap Be With You",
    "sponsor": "Dr. Inker LABS",
    "startTime": "2026-05-01T00:00:00Z",
    "endTime": "2026-05-31T23:59:59Z"
  }
]
```

- [ ] **Step 2: Verify it parses as JSON**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('/opt/Flappy-Bert/tournaments.json','utf8')).length)"`
Expected: `3`

- [ ] **Step 3: Commit**

```bash
cd /opt/Flappy-Bert
git add tournaments.json
git commit -m "feat(tournaments): seed config file with Champions/April/May tournaments"
```

---

## Task 2: Set up test infrastructure + write failing test for config loader

**Files:**
- Create: `/opt/Flappy-Bert/tests/tournaments-config.test.js`
- Modify: `/opt/Flappy-Bert/package.json`

- [ ] **Step 1: Add test script to package.json**

Update the `"scripts"` block in `/opt/Flappy-Bert/package.json` to include a `test` entry:

```json
"scripts": {
  "start": "node bot.js",
  "dev": "node --watch bot.js",
  "test": "node --test tests/"
}
```

- [ ] **Step 2: Create the failing test file**

Write `/opt/Flappy-Bert/tests/tournaments-config.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { loadTournamentsFromFile } = require('../tournaments-config');

function withTempFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flappy-test-'));
  const file = path.join(dir, 'tournaments.json');
  fs.writeFileSync(file, contents);
  try { return fn(file); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('loadTournamentsFromFile parses a valid 3-tournament file', () => {
  const json = JSON.stringify([
    { id: 'a', name: 'A', sponsor: 'X', startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-31T23:59:59Z' },
    { id: 'b', name: 'B', sponsor: 'X', startTime: '2026-02-01T00:00:00Z', endTime: '2026-02-28T23:59:59Z' },
    { id: 'c', name: 'C', sponsor: 'X', startTime: '2026-03-01T00:00:00Z', endTime: '2026-03-31T23:59:59Z' },
  ]);
  withTempFile(json, (file) => {
    const result = loadTournamentsFromFile(file);
    assert.equal(result.length, 3);
    assert.equal(result[0].id, 'a');
  });
});

test('loadTournamentsFromFile returns [] when file missing', () => {
  const result = loadTournamentsFromFile('/nonexistent/path/tournaments.json');
  assert.deepEqual(result, []);
});

test('loadTournamentsFromFile returns [] when JSON is malformed', () => {
  withTempFile('{not json', (file) => {
    const result = loadTournamentsFromFile(file);
    assert.deepEqual(result, []);
  });
});

test('loadTournamentsFromFile skips entries missing required fields', () => {
  const json = JSON.stringify([
    { id: 'good', name: 'G', sponsor: 'X', startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-31T23:59:59Z' },
    { id: 'bad-no-end', name: 'B', sponsor: 'X', startTime: '2026-02-01T00:00:00Z' },
    { name: 'bad-no-id', sponsor: 'X', startTime: '2026-03-01T00:00:00Z', endTime: '2026-03-31T23:59:59Z' },
  ]);
  withTempFile(json, (file) => {
    const result = loadTournamentsFromFile(file);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'good');
  });
});

test('loadTournamentsFromFile returns [] when JSON is not an array', () => {
  withTempFile(JSON.stringify({ id: 'wrong' }), (file) => {
    const result = loadTournamentsFromFile(file);
    assert.deepEqual(result, []);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /opt/Flappy-Bert && npm test`
Expected: FAIL with `Cannot find module '../tournaments-config'`

- [ ] **Step 4: Commit**

```bash
cd /opt/Flappy-Bert
git add package.json tests/tournaments-config.test.js
git commit -m "test(tournaments-config): add failing tests for config loader"
```

---

## Task 3: Implement `tournaments-config.js` config loader

**Files:**
- Create: `/opt/Flappy-Bert/tournaments-config.js`

- [ ] **Step 1: Write the implementation**

Create `/opt/Flappy-Bert/tournaments-config.js`:

```javascript
// tournaments-config.js — loads and validates tournament configuration
// from a JSON file. Pure module: no side effects, no DB access.

const fs = require('node:fs');

const REQUIRED_FIELDS = ['id', 'name', 'sponsor', 'startTime', 'endTime'];

function validateTournament(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const field of REQUIRED_FIELDS) {
    if (typeof obj[field] !== 'string' || obj[field].length === 0) return false;
  }
  if (Number.isNaN(Date.parse(obj.startTime))) return false;
  if (Number.isNaN(Date.parse(obj.endTime))) return false;
  return true;
}

function loadTournamentsFromFile(filepath) {
  let raw;
  try {
    raw = fs.readFileSync(filepath, 'utf8');
  } catch (err) {
    console.warn(`[tournaments-config] could not read ${filepath}: ${err.message}`);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[tournaments-config] malformed JSON in ${filepath}: ${err.message}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error(`[tournaments-config] ${filepath} must contain a JSON array, got ${typeof parsed}`);
    return [];
  }

  const valid = [];
  for (const entry of parsed) {
    if (validateTournament(entry)) {
      valid.push(entry);
    } else {
      console.warn(`[tournaments-config] skipping invalid entry: ${JSON.stringify(entry)}`);
    }
  }
  return valid;
}

module.exports = { loadTournamentsFromFile, validateTournament };
```

- [ ] **Step 2: Run the tests and verify they pass**

Run: `cd /opt/Flappy-Bert && npm test`
Expected: 5 tests passing, exit code 0.

- [ ] **Step 3: Commit**

```bash
cd /opt/Flappy-Bert
git add tournaments-config.js
git commit -m "feat(tournaments-config): implement loader with validation"
```

---

## Task 4: Write failing tests for `getFeaturedTournament` priority logic

**Files:**
- Modify: `/opt/Flappy-Bert/tests/tournaments-config.test.js`

- [ ] **Step 1: Append failing tests to the test file**

Append to `/opt/Flappy-Bert/tests/tournaments-config.test.js`:

```javascript
const { getFeaturedTournament } = require('../tournaments-config');

const T = (id, startISO, endISO) => ({
  id, name: id, sponsor: 'X',
  startTime: startISO, endTime: endISO,
});

test('getFeaturedTournament: returns null when list is empty', () => {
  const result = getFeaturedTournament([], new Date('2026-05-15T12:00:00Z'));
  assert.equal(result, null);
});

test('getFeaturedTournament: prefers a live tournament over everything else', () => {
  const tournaments = [
    T('past',     '2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z'),
    T('live',     '2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    T('upcoming', '2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-15T12:00:00Z'));
  assert.equal(result.id, 'live');
  assert.equal(result.featured_state, 'live');
});

test('getFeaturedTournament: picks upcoming starting in <7d if no live', () => {
  const tournaments = [
    T('soon', '2026-05-05T00:00:00Z', '2026-05-31T23:59:59Z'),
    T('far',  '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-01T12:00:00Z'));
  assert.equal(result.id, 'soon');
  assert.equal(result.featured_state, 'upcoming');
});

test('getFeaturedTournament: ignores upcoming tournaments more than 7d away', () => {
  const tournaments = [
    T('far', '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-01T12:00:00Z'));
  assert.equal(result, null);
});

test('getFeaturedTournament: picks recently_ended within 14d if no live and no upcoming<7d', () => {
  const tournaments = [
    T('just-ended', '2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z'),
    T('older',      '2026-02-01T00:00:00Z', '2026-02-28T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-05T12:00:00Z'));
  assert.equal(result.id, 'just-ended');
  assert.equal(result.featured_state, 'recently_ended');
});

test('getFeaturedTournament: ignores ended tournaments older than 14d', () => {
  const tournaments = [
    T('old', '2026-02-01T00:00:00Z', '2026-02-28T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-15T12:00:00Z'));
  assert.equal(result, null);
});

test('getFeaturedTournament: when multiple live, returns the most recently started', () => {
  const tournaments = [
    T('older-live', '2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    T('newer-live', '2026-05-10T00:00:00Z', '2026-06-09T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-15T12:00:00Z'));
  assert.equal(result.id, 'newer-live');
  assert.equal(result.featured_state, 'live');
});

test('getFeaturedTournament: handles April→May handoff at midnight UTC', () => {
  const tournaments = [
    T('april', '2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z'),
    T('may',   '2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-01T00:00:01Z'));
  assert.equal(result.id, 'may');
  assert.equal(result.featured_state, 'live');
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `cd /opt/Flappy-Bert && npm test`
Expected: FAIL — the new tests error with `getFeaturedTournament is not a function`. The existing 5 loader tests still pass.

- [ ] **Step 3: Commit**

```bash
cd /opt/Flappy-Bert
git add tests/tournaments-config.test.js
git commit -m "test(tournaments-config): add failing tests for getFeaturedTournament"
```

---

## Task 5: Implement `getFeaturedTournament` priority logic

**Files:**
- Modify: `/opt/Flappy-Bert/tournaments-config.js`

- [ ] **Step 1: Add the implementation**

Append to `/opt/Flappy-Bert/tournaments-config.js`, before the existing `module.exports = ...` line:

```javascript
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENTLY_ENDED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function getFeaturedTournament(tournaments, now) {
  const t = now instanceof Date ? now : new Date(now);
  const nowMs = t.getTime();

  let live = null;
  let upcoming = null;
  let recentlyEnded = null;

  for (const entry of tournaments) {
    const startMs = Date.parse(entry.startTime);
    const endMs = Date.parse(entry.endTime);

    if (nowMs >= startMs && nowMs <= endMs) {
      if (live === null || startMs > Date.parse(live.startTime)) {
        live = entry;
      }
    } else if (nowMs < startMs) {
      if (startMs - nowMs <= UPCOMING_WINDOW_MS) {
        if (upcoming === null || startMs < Date.parse(upcoming.startTime)) {
          upcoming = entry;
        }
      }
    } else {
      if (nowMs - endMs <= RECENTLY_ENDED_WINDOW_MS) {
        if (recentlyEnded === null || endMs > Date.parse(recentlyEnded.endTime)) {
          recentlyEnded = entry;
        }
      }
    }
  }

  if (live) return { ...live, featured_state: 'live' };
  if (upcoming) return { ...upcoming, featured_state: 'upcoming' };
  if (recentlyEnded) return { ...recentlyEnded, featured_state: 'recently_ended' };
  return null;
}
```

Then change the existing `module.exports` line at the bottom to:

```javascript
module.exports = { loadTournamentsFromFile, validateTournament, getFeaturedTournament };
```

- [ ] **Step 2: Run all tests, verify they pass**

Run: `cd /opt/Flappy-Bert && npm test`
Expected: 13 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /opt/Flappy-Bert
git add tournaments-config.js
git commit -m "feat(tournaments-config): implement featured-tournament priority logic"
```

---

## Task 6: Wire config loader into `bot.js` startup

**Files:**
- Modify: `/opt/Flappy-Bert/bot.js`

- [ ] **Step 1: Add the require**

In `/opt/Flappy-Bert/bot.js`, after `const db = require('./db');` (around line 30), add:

```javascript
const { loadTournamentsFromFile, getFeaturedTournament } = require('./tournaments-config');
```

- [ ] **Step 2: Replace inline seed block with config-driven load**

Replace the block at lines 179-193 (containing the comment `// Seed tournaments` followed by two `db.createTournament(...)` calls) with:

```javascript
// Seed tournaments from config file (idempotent — INSERT OR IGNORE on id)
const TOURNAMENTS_CONFIG_PATH = path.join(__dirname, 'tournaments.json');
const seededTournaments = loadTournamentsFromFile(TOURNAMENTS_CONFIG_PATH);
for (const t of seededTournaments) {
  db.createTournament(t.id, t.name, t.sponsor, t.startTime, t.endTime);
}
console.log(`Loaded ${seededTournaments.length} tournament(s) from config`);
```

- [ ] **Step 3: Smoke-start the server to verify it loads**

Run: `cd /opt/Flappy-Bert && timeout 4 node bot.js 2>&1 | head -10 || true`
Expected: log line `Loaded 3 tournament(s) from config` appears. (Server may then error on missing BOT_TOKEN — that's fine; we're just verifying config load.)

- [ ] **Step 4: Commit**

```bash
cd /opt/Flappy-Bert
git add bot.js
git commit -m "refactor(bot): load tournaments from config file instead of inline seeds"
```

---

## Task 7: Add `/api/tournaments/featured` endpoint

**Files:**
- Modify: `/opt/Flappy-Bert/bot.js`

- [ ] **Step 1: Add the endpoint**

In `/opt/Flappy-Bert/bot.js`, immediately after the closing `});` of `app.get('/api/tournaments', ...)` (around line 767), insert:

```javascript
// GET /api/tournaments/featured — Returns the single featured tournament
// for the home-screen button, or null if none qualify.
app.get('/api/tournaments/featured', (req, res) => {
  const all = db.getAllTournaments().map(t => ({
    id: t.id,
    name: t.name,
    sponsor: t.sponsor,
    startTime: t.start_time,
    endTime: t.end_time,
  }));
  const featured = getFeaturedTournament(all, new Date());
  res.json({ tournament: featured });
});
```

Note the column-name mapping: SQLite uses `start_time`/`end_time` (snake_case from `db.js` schema) but `getFeaturedTournament` expects `startTime`/`endTime`.

- [ ] **Step 2: Smoke test the endpoint**

In one terminal: `cd /opt/Flappy-Bert && BOT_TOKEN=fake node bot.js` (Telegram polling will fail, but Express listens).

In another: `curl -s http://localhost:3000/api/tournaments/featured`

Expected: JSON containing `"tournament":{"id":"april-fools-flapoff-2026",...,"featured_state":"live"}` (today is in April).

Stop the server.

- [ ] **Step 3: Commit**

```bash
cd /opt/Flappy-Bert
git add bot.js
git commit -m "feat(api): add /api/tournaments/featured endpoint"
```

---

## Task 8: Add `Cache-Control: no-cache` to `/game` route

**Files:**
- Modify: `/opt/Flappy-Bert/bot.js`

- [ ] **Step 1: Locate the `/game` route**

Run: `cd /opt/Flappy-Bert && grep -n "/game" bot.js`
Note the line number of `app.get('/game', ...)`.

- [ ] **Step 2: Add cache header**

Update the `/game` handler so it sets `Cache-Control: no-cache, no-store, must-revalidate` before sending the file. For example:

```javascript
app.get('/game', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'flappy_bert.html'));
});
```

If the existing handler does anything else, just add the `res.set(...)` line as the first statement inside.

- [ ] **Step 3: Verify**

```bash
cd /opt/Flappy-Bert && BOT_TOKEN=fake node bot.js &
sleep 2 && curl -sI http://localhost:3000/game | grep -i cache-control
kill %1
```

Expected: `cache-control: no-cache, no-store, must-revalidate`

- [ ] **Step 4: Commit**

```bash
cd /opt/Flappy-Bert
git add bot.js
git commit -m "fix(game): disable caching of mini-app HTML so May 1 rollover applies immediately"
```

---

## Task 9: Frontend — replace hardcoded `TOURNAMENT` const with hydrated state

**Files:**
- Modify: `/opt/Flappy-Bert/flappy_bert.html`

- [ ] **Step 1: Replace the const + helpers block**

In `/opt/Flappy-Bert/flappy_bert.html`, locate the block from line 3102 (`// ========== TOURNAMENT SYSTEM ==========`) through line 3170 (the `setInterval(updateTournamentUI, 1000);` line). Replace it with:

```javascript
// ========== TOURNAMENT SYSTEM ==========
let FEATURED_TOURNAMENT = null;
let ALL_TOURNAMENTS = [];

async function hydrateTournaments() {
  const base = API_BASE || '';
  try {
    const [allRes, featuredRes] = await Promise.all([
      fetch(base + '/api/tournaments'),
      fetch(base + '/api/tournaments/featured'),
    ]);
    if (allRes.ok) {
      const data = await allRes.json();
      ALL_TOURNAMENTS = data.tournaments || [];
    }
    if (featuredRes.ok) {
      const data = await featuredRes.json();
      FEATURED_TOURNAMENT = data.tournament || null;
    }
  } catch(e) { /* network error: leave defaults */ }
  updateTournamentUI();
}

function getCountdownString(targetMs, fromMs) {
  const diff = targetMs - fromMs;
  if (diff <= 0) return '0d 0h 0m';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
  return h + 'h ' + m + 'm ' + s + 's';
}

function updateTournamentUI() {
  const btn = document.getElementById('tournamentBtn');
  const statusEl = document.getElementById('tournamentStatus');
  if (!btn || !statusEl) return;

  if (!FEATURED_TOURNAMENT) {
    btn.style.display = 'none';
    statusEl.style.display = 'none';
    return;
  }

  btn.style.display = '';
  statusEl.style.display = '';

  const t = FEATURED_TOURNAMENT;
  const now = Date.now();
  let icon, color, statusText, pulseAnim;

  if (t.featured_state === 'live') {
    icon = '\u{1F3C6}';
    color = '#ffd700';
    pulseAnim = 'pulse 2s infinite';
    statusText = '\u{1F534} ENDS IN ' + getCountdownString(Date.parse(t.endTime), now);
  } else if (t.featured_state === 'upcoming') {
    icon = '\u{23F3}';
    color = '#c0c0c0';
    pulseAnim = 'none';
    statusText = 'STARTS IN ' + getCountdownString(Date.parse(t.startTime), now);
  } else {
    icon = '\u{1F4DC}';
    color = '#cd7f32';
    pulseAnim = 'none';
    statusText = 'FINAL RESULTS';
  }

  // Use textContent for the operator-supplied tournament name (XSS-safe)
  btn.textContent = icon + ' ' + String(t.name || '').toUpperCase();
  btn.style.color = color;
  btn.style.borderColor = color;
  btn.style.animation = pulseAnim;
  statusEl.textContent = statusText;
  statusEl.style.color = color;
}

setInterval(updateTournamentUI, 1000);
setInterval(hydrateTournaments, 5 * 60 * 1000);
```

- [ ] **Step 2: Trigger hydration on app load**

Find the existing app-load init point. Run: `grep -n "loadProgressFromServer\|loadDailyChallenges\|DOMContentLoaded" /opt/Flappy-Bert/flappy_bert.html | head -5`

Pick a line where other init calls happen (e.g., near `loadProgressFromServer()` or similar). Add `hydrateTournaments();` to that initialization block.

- [ ] **Step 3: Manual smoke test**

Open the mini-app in a browser. Verify:
- Home button shows "🏆 APRIL FOOLS FLAP-OFF 2026" in gold with `🔴 ENDS IN 1d Xh Ym` countdown ticking down.
- DevTools network tab shows `/api/tournaments` and `/api/tournaments/featured` requests on load.

- [ ] **Step 4: Commit**

```bash
cd /opt/Flappy-Bert
git add flappy_bert.html
git commit -m "feat(client): hydrate tournament state from server, smart featured button"
```

---

## Task 10: Frontend — three-section tournament overlay (DOM API rendering)

**Files:**
- Modify: `/opt/Flappy-Bert/flappy_bert.html`

This task builds the overlay UI using `document.createElement` + `el.textContent` for all operator/user-supplied strings (tournament names, sponsors, player names). No string-built `innerHTML` is allowed for any user data — only static structure may use `innerHTML`. Click handlers use `addEventListener` and `dataset.id`, never inline `onclick="..."` with id interpolation.

- [ ] **Step 1: Replace overlay markup**

In `/opt/Flappy-Bert/flappy_bert.html`, replace the block at lines 491-499 (the existing `<!-- Tournament Leaderboard -->` overlay) with:

```html
<!-- Tournament Leaderboard / Archive -->
<div class="overlay" id="tournamentOverlay">
  <div class="shop-panel" style="border-color:#ffd700;max-height:90vh;overflow-y:auto">
    <div class="shop-title" style="color:#ffd700">&#x1F3DF; TOURNAMENTS</div>

    <div id="tournamentSectionLive" style="display:none;margin-top:8px">
      <div style="font-size:clamp(6px,1.4vw,8px);color:#ff4d4d;letter-spacing:2px;margin-bottom:6px">&#x1F534; LIVE</div>
      <div id="tournamentLiveBody"></div>
    </div>

    <div id="tournamentSectionUpcoming" style="display:none;margin-top:14px">
      <div style="font-size:clamp(6px,1.4vw,8px);color:#c0c0c0;letter-spacing:2px;margin-bottom:6px">&#x23F3; UPCOMING</div>
      <div id="tournamentUpcomingBody"></div>
    </div>

    <div id="tournamentSectionPast" style="display:none;margin-top:14px">
      <div style="font-size:clamp(6px,1.4vw,8px);color:#cd7f32;letter-spacing:2px;margin-bottom:6px">&#x1F4DC; PAST</div>
      <div id="tournamentPastBody"></div>
    </div>

    <button class="btn btn-secondary" style="margin-top:12px" onclick="hideAllOverlays();showOverlay('menuOverlay')">&#x2190; BACK</button>
  </div>
</div>
```

- [ ] **Step 2: Replace `showTournament()` and `renderTournamentLeaderboard()`**

Locate `async function showTournament()` (it currently calls `/api/tournament/' + TOURNAMENT.id`). Replace `showTournament` AND `renderTournamentLeaderboard` AND `submitTournamentScore` with the following block. All operator/user-supplied strings are inserted via `textContent`, click handlers use `addEventListener` with `dataset.id`.

```javascript
async function showTournament(scrollToPast) {
  hideAllOverlays();
  showOverlay('tournamentOverlay');
  if (ALL_TOURNAMENTS.length === 0) await hydrateTournaments();
  renderTournamentSections();
  if (scrollToPast) {
    const past = document.getElementById('tournamentSectionPast');
    if (past) past.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function renderTournamentSections() {
  const live = ALL_TOURNAMENTS.filter(t => t.status === 'live');
  const upcoming = ALL_TOURNAMENTS.filter(t => t.status === 'scheduled')
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const past = ALL_TOURNAMENTS.filter(t => t.status === 'ended')
    .sort((a, b) => Date.parse(b.end_time) - Date.parse(a.end_time));

  renderLiveSection(live);
  renderUpcomingSection(upcoming);
  renderPastSection(past);
}

function _makeEl(tag, opts) {
  const el = document.createElement(tag);
  if (opts && opts.style) el.setAttribute('style', opts.style);
  if (opts && opts.text != null) el.textContent = opts.text;
  if (opts && opts.cls) el.className = opts.cls;
  return el;
}

function _tournamentCard(t, accentColor, bgColor) {
  const card = _makeEl('div', { style: 'background:' + bgColor + ';border:1px solid ' + accentColor + ';border-radius:8px;padding:10px;margin-bottom:8px' });
  const name = _makeEl('div', { style: 'font-size:clamp(8px,1.8vw,11px);color:' + accentColor, text: t.name || '' });
  const sponsor = _makeEl('div', { style: 'font-size:clamp(5px,1.2vw,7px);color:#00e5ff;margin-top:2px', text: 'Sponsored by ' + (t.sponsor || '') });
  card.appendChild(name);
  card.appendChild(sponsor);
  return card;
}

function renderLiveSection(tournaments) {
  const section = document.getElementById('tournamentSectionLive');
  const body = document.getElementById('tournamentLiveBody');
  body.replaceChildren();
  if (tournaments.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';

  tournaments.forEach(t => {
    const card = _tournamentCard(t, '#ffd700', 'rgba(255,77,77,0.08)');
    card.style.borderColor = 'rgba(255,77,77,0.3)';
    const list = _makeEl('div', { style: 'margin-top:8px;max-height:40vh;overflow-y:auto' });
    const loading = _makeEl('div', { style: 'text-align:center;color:var(--text-dim);font-size:7px;padding:12px', text: 'Loading…' });
    list.appendChild(loading);
    card.appendChild(list);
    body.appendChild(card);
    fetchAndRenderEntries(t.id, list);
  });
}

function renderUpcomingSection(tournaments) {
  const section = document.getElementById('tournamentSectionUpcoming');
  const body = document.getElementById('tournamentUpcomingBody');
  body.replaceChildren();
  if (tournaments.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';

  const now = Date.now();
  tournaments.forEach(t => {
    const card = _tournamentCard(t, '#c0c0c0', 'rgba(192,192,192,0.06)');
    card.style.borderColor = 'rgba(192,192,192,0.3)';
    const startMs = Date.parse(t.start_time);
    const countdown = _makeEl('div', { style: 'font-size:clamp(6px,1.4vw,8px);color:#ffd700;margin-top:6px', text: 'Starts in ' + getCountdownString(startMs, now) });
    card.appendChild(countdown);
    body.appendChild(card);
  });
}

const _expandedPast = new Set();

function renderPastSection(tournaments) {
  const section = document.getElementById('tournamentSectionPast');
  const body = document.getElementById('tournamentPastBody');
  body.replaceChildren();
  if (tournaments.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';

  tournaments.forEach(t => {
    const card = _makeEl('div', { style: 'background:rgba(205,127,50,0.06);border:1px solid rgba(205,127,50,0.3);border-radius:8px;padding:10px;margin-bottom:8px' });

    const header = _makeEl('div', { style: 'display:flex;align-items:center;justify-content:space-between;cursor:pointer' });
    const left = _makeEl('div');
    const name = _makeEl('div', { style: 'font-size:clamp(8px,1.8vw,11px);color:#cd7f32', text: t.name || '' });
    const sponsor = _makeEl('div', { style: 'font-size:clamp(5px,1.2vw,7px);color:#7a7e9a;margin-top:2px', text: 'Sponsored by ' + (t.sponsor || '') });
    left.appendChild(name);
    left.appendChild(sponsor);
    const toggle = _makeEl('div', { style: 'font-size:14px;color:#cd7f32', text: '▼' });
    header.appendChild(left);
    header.appendChild(toggle);

    const list = _makeEl('div', { style: 'margin-top:8px;max-height:40vh;overflow-y:auto;display:none' });
    const loading = _makeEl('div', { style: 'text-align:center;color:var(--text-dim);font-size:7px;padding:12px', text: 'Loading…' });
    list.appendChild(loading);

    header.addEventListener('click', () => {
      if (_expandedPast.has(t.id)) {
        list.style.display = 'none';
        toggle.textContent = '▼';
        _expandedPast.delete(t.id);
      } else {
        list.style.display = '';
        toggle.textContent = '▲';
        _expandedPast.add(t.id);
        fetchAndRenderEntries(t.id, list);
      }
    });

    card.appendChild(header);
    card.appendChild(list);
    body.appendChild(card);
  });
}

async function fetchAndRenderEntries(tournamentId, listEl) {
  if (!listEl) return;
  try {
    const res = await fetch((API_BASE || '') + '/api/tournament/' + encodeURIComponent(tournamentId));
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    renderEntriesInto(listEl, data.entries || []);
  } catch(e) {
    listEl.replaceChildren();
    listEl.appendChild(_makeEl('div', {
      style: 'text-align:center;color:var(--text-dim);font-size:7px;padding:12px',
      text: 'Could not load leaderboard',
    }));
  }
}

function renderEntriesInto(listEl, entries) {
  const user = getTelegramUser();
  listEl.replaceChildren();
  if (entries.length === 0) {
    listEl.appendChild(_makeEl('div', {
      style: 'text-align:center;color:var(--text-dim);font-size:7px;padding:12px',
      text: 'No scores yet',
    }));
    return;
  }
  entries.forEach((e, i) => {
    const rank = i + 1;
    const isYou = user && e.telegram_id === user.id;
    const medal = rank === 1 ? '\u{1F947}' : (rank === 2 ? '\u{1F948}' : (rank === 3 ? '\u{1F949}' : '#' + rank));
    const bg = isYou ? 'rgba(255,215,0,0.15)' : (rank <= 3 ? 'rgba(255,215,0,0.06)' : 'rgba(255,255,255,0.03)');
    const border = isYou ? 'border:1px solid rgba(255,215,0,0.4);' : '';
    const nameColor = isYou ? '#ffd700' : '#e8e8f0';
    const displayName = (isYou ? '▶ ' : '') + (e.first_name || e.username || 'Player');

    const row = _makeEl('div', { style: 'display:flex;align-items:center;padding:6px 8px;margin:3px 0;border-radius:6px;background:' + bg + ';' + border });
    const medalEl = _makeEl('div', { style: 'width:28px;text-align:center;font-size:' + (rank<=3?'12px':'8px') + ';flex-shrink:0', text: medal });
    const nameEl = _makeEl('div', { style: 'flex:1;font-size:8px;color:' + nameColor + ';margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: displayName });
    const scoreEl = _makeEl('div', { style: 'font-size:10px;font-weight:bold;color:#ffd700;margin-left:8px', text: String(e.best_score) });
    const gamesEl = _makeEl('div', { style: 'font-size:7px;color:#7a7e9a;margin-left:8px;width:20px;text-align:right', text: String(e.games_played) + 'g' });

    row.appendChild(medalEl);
    row.appendChild(nameEl);
    row.appendChild(scoreEl);
    row.appendChild(gamesEl);
    listEl.appendChild(row);
  });
}

async function submitTournamentScore(score, level, coinsEarned) {
  const live = ALL_TOURNAMENTS.find(t => t.status === 'live');
  if (!live) return;
  const user = getTelegramUser();
  if (!user) return;
  try {
    await fetch((API_BASE || '') + '/api/tournament/' + encodeURIComponent(live.id) + '/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: user.id, score, level, coins_earned: coinsEarned,
        session_id: _gameSession,
      }),
    });
  } catch(e) {}
}
```

- [ ] **Step 3: Manual smoke test**

Reload mini-app. Open the tournament overlay (tap the gold home button). Verify:
- 🔴 LIVE section shows April Fools Flap-off 2026 with current leaderboard.
- ⏳ UPCOMING section shows May The Flap Be With You with `Starts in 1d Xh ...` countdown.
- 📜 PAST section shows Champions Flap-off (collapsed). Tap row → expands → loads final standings.

In DevTools Elements, inspect a leaderboard row and confirm there's no inline `onclick=` attribute with an interpolated id, and no `innerHTML` setting in the rendering (only `textContent` for user data).

- [ ] **Step 4: Commit**

```bash
cd /opt/Flappy-Bert
git add flappy_bert.html
git commit -m "feat(client): three-section tournament overlay (Live/Upcoming/Past) using DOM API"
```

---

## Task 11: Frontend — persistent "Past Tournaments" menu link

**Files:**
- Modify: `/opt/Flappy-Bert/flappy_bert.html`

- [ ] **Step 1: Add the button**

In the menu overlay (around line 539-540), immediately after the existing `<button class="btn btn-gold" onclick="showLeaderboard()">&#x1F3C6; RANKINGS</button>`, add:

```html
<button class="btn btn-secondary" onclick="showTournament(true)" style="border-color:#cd7f32;color:#cd7f32">&#x1F4DC; PAST TOURNAMENTS</button>
```

This button is always visible. Tapping calls `showTournament(true)` — the `true` argument scrolls the overlay to the past section.

- [ ] **Step 2: Manual smoke test**

Reload mini-app. Verify a bronze "📜 PAST TOURNAMENTS" button is visible on the home menu. Tap it → tournament overlay opens with the past section visible/scrolled into view.

- [ ] **Step 3: Commit**

```bash
cd /opt/Flappy-Bert
git add flappy_bert.html
git commit -m "feat(client): persistent past-tournaments link in main menu"
```

---

## Task 12: Telegram `/tournament` keyword arg

**Files:**
- Modify: `/opt/Flappy-Bert/bot.js`

- [ ] **Step 1: Read the current handler**

Run: `cd /opt/Flappy-Bert && sed -n '438,495p' bot.js`
Note the exact start and end line of the `bot.onText(/\/tournament/, ...)` handler.

- [ ] **Step 2: Replace the handler with a keyword-aware version**

Replace the existing `bot.onText(/\/tournament/, async (msg) => { ... });` block with:

```javascript
// /tournament [keyword] — show tournament card (defaults to live, else most-recent-ended)
bot.onText(/^\/tournament(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const arg = (match && match[1] || '').trim().toLowerCase();
  const tournaments = db.getAllTournaments();

  if (tournaments.length === 0) {
    bot.sendMessage(chatId, '🏟 No tournaments yet. Stay tuned!');
    return;
  }

  const withStatus = tournaments.map(t => {
    const now = new Date();
    const start = new Date(t.start_time);
    const end = new Date(t.end_time);
    let status = 'ended';
    if (now < start) status = 'scheduled';
    else if (now <= end) status = 'live';
    return { ...t, status };
  });

  let chosen;
  if (arg) {
    const matches = withStatus.filter(t =>
      t.id.toLowerCase().includes(arg) ||
      t.name.toLowerCase().includes(arg)
    );
    if (matches.length === 0) {
      bot.sendMessage(chatId, `🏟 No tournament matching "${arg}". Try /tournament with no args.`);
      return;
    }
    if (matches.length > 1) {
      const list = matches.map(t => `• ${t.name} (${t.id})`).join('\n');
      bot.sendMessage(chatId, `🏟 Multiple matches:\n${list}\n\nTry a more specific keyword.`);
      return;
    }
    chosen = matches[0];
  } else {
    chosen = withStatus.find(t => t.status === 'live')
      || withStatus.filter(t => t.status === 'ended').sort((a, b) => new Date(b.end_time) - new Date(a.end_time))[0]
      || withStatus[0];
  }

  try {
    const entries = db.getTournamentLeaderboard(chosen.id, 50);
    const buf = await renderTournamentCard(chosen, entries);
    await bot.sendPhoto(chatId, buf, {
      caption: `🏟 *${chosen.name}*\nSponsored by ${chosen.sponsor}\nStatus: ${chosen.status.toUpperCase()}`,
      parse_mode: 'Markdown',
      filename: 'tournament.png',
    });
  } catch (err) {
    console.error('Tournament card render failed:', err.message);
    bot.sendMessage(chatId, '❌ Failed to generate tournament leaderboard.');
  }
});
```

- [ ] **Step 3: Smoke test**

If you have access to the bot's Telegram chat: send `/tournament`, `/tournament april`, `/tournament may`, `/tournament zzz`. Verify each returns the expected card or message.

If not, just verify the bot starts cleanly:

```bash
cd /opt/Flappy-Bert && timeout 4 BOT_TOKEN=fake node bot.js 2>&1 | head -20 || true
```

Expected: `Loaded 3 tournament(s) from config` line, no syntax errors.

- [ ] **Step 4: Commit**

```bash
cd /opt/Flappy-Bert
git add bot.js
git commit -m "feat(bot): /tournament accepts a keyword to pick a specific tournament"
```

---

## Task 13: End-to-end manual test pass against spec scenarios

**Files:** None (verification only)

This task runs the 9 scenarios from the spec section "Testing." For each scenario, record PASS/FAIL before moving on.

- [ ] **Step 1: Today (April 29) state**

Open mini-app. Verify:
- Home button: gold "🏆 APRIL FOOLS FLAP-OFF 2026" + `🔴 ENDS IN 1d Xh Ym`.
- Overlay: April under 🔴 LIVE; May under ⏳ UPCOMING (`STARTS IN 1d Xh Ym`); Champions Flap-off under 📜 PAST (collapsed).

- [ ] **Step 2: Persistent past link**

From home, tap "📜 PAST TOURNAMENTS". Overlay opens with past section visible. Tap Champions Flap-off row → expands → shows top 50 final standings.

- [ ] **Step 3: April→May rollover (clock spoof)**

If `faketime` is available:

```bash
cd /opt/Flappy-Bert
faketime '2026-05-01 00:00:01' BOT_TOKEN=$BOT_TOKEN node bot.js
```

(If `faketime` is not available, skip this step; rely on Task 5 unit-test coverage of the priority logic and verify against production after May 1 00:00 UTC.)

Open mini-app:
- Home button: gold "🏆 MAY THE FLAP BE WITH YOU" + `🔴 ENDS IN 30d 23h 59m`.
- Overlay: May under 🔴 LIVE; April under 📜 PAST (top of past list).

- [ ] **Step 4: Mid-month (May 15)**

`faketime '2026-05-15 12:00:00'`. Same as #3 with shorter countdown.

- [ ] **Step 5: Between tournaments (June 1)**

`faketime '2026-06-01 00:00:01'`. Verify home button is bronze "📜 MAY THE FLAP BE WITH YOU — FINAL RESULTS." Overlay: no live, no upcoming, May at top of past.

- [ ] **Step 6: Long gap (June 15, no upcoming)**

`faketime '2026-06-15 12:00:00'`. May ended 14d ago — home featured button hidden. Persistent "📜 PAST TOURNAMENTS" menu button still works → opens overlay with past section.

- [ ] **Step 7: Score submission to live**

Restore real clock. Submit a score (play a game in the mini-app). Verify it appears in April's leaderboard within the overlay.

- [ ] **Step 8: Past tournament is read-only**

`faketime '2026-05-15'`. Open overlay. Confirm there's no submit-score control inside expanded April past entry. (`submitTournamentScore` checks `t.status === 'live'`, so April scores will be silently rejected.)

- [ ] **Step 9: Telegram `/tournament` variants**

If Telegram-accessible:
- `/tournament` → April card (live).
- `/tournament april` → April card.
- `/tournament may` → May card (scheduled).
- `/tournament zzz` → "No tournament matching..."
- `/tournament 2026` → multi-match disambiguation (April + May both match).

- [ ] **Step 10: Bad config**

```bash
cd /opt/Flappy-Bert
mv tournaments.json tournaments.json.bak
timeout 4 BOT_TOKEN=fake node bot.js 2>&1 | head -10 || true
mv tournaments.json.bak tournaments.json
```

Expected: `[tournaments-config] could not read ... ENOENT...` warning + `Loaded 0 tournament(s) from config`. Server starts cleanly.

- [ ] **Step 11: Cache header**

```bash
cd /opt/Flappy-Bert && BOT_TOKEN=fake node bot.js &
sleep 2 && curl -sI http://localhost:3000/game | grep -i cache-control
kill %1
```

Expected: `cache-control: no-cache, no-store, must-revalidate`.

- [ ] **Step 12: All tests still pass**

```bash
cd /opt/Flappy-Bert && npm test
```

Expected: 13 tests, exit 0.

- [ ] **Step 13: Push to deploy**

```bash
cd /opt/Flappy-Bert
git status
git push origin main
```

Render auto-deploys from `main`. Watch the Render dashboard. Once live, repeat Step 1's checks against the production URL.

---

## Self-review notes

- Spec coverage:
  - Data source — Tasks 1, 6.
  - Server endpoints (`/api/tournaments`, `/api/tournament/:id`, `/api/tournaments/featured`) — existing + Task 7.
  - Telegram bot commands — Task 12.
  - Frontend hydration — Task 9.
  - 3-section overlay — Task 10.
  - State transitions (auto-rollover at midnight UTC) — Task 5 priority logic + Task 9 second-tick refresh.
  - Error handling (missing/malformed config, fetch failures) — Tasks 3, 9.
  - Long-gap UX — Task 11 persistent menu link.
  - Cache risk — Task 8.
- Function names consistent across tasks: `loadTournamentsFromFile`, `validateTournament`, `getFeaturedTournament`, `hydrateTournaments`, `updateTournamentUI`, `getCountdownString`, `showTournament`, `renderTournamentSections`, `renderLiveSection`, `renderUpcomingSection`, `renderPastSection`, `fetchAndRenderEntries`, `renderEntriesInto`, `submitTournamentScore`, `_makeEl`, `_tournamentCard`.
- Property names consistent: `featured_state` from server JSON; `start_time`/`end_time` on DB-row objects (used in `flappy_bert.html` filtering and Task 12); `startTime`/`endTime` on config objects (mapped server-side in Task 7).
- All operator/user data in the mini-app rendering goes through `textContent`, not `innerHTML`. Click handlers use closure capture of `t`, not stringified ids.
- Each task ends in a commit so a partial run leaves the repo on a coherent state.
