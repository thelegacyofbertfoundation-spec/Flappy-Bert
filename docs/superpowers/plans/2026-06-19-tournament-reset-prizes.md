# Tournament Score Reset + Prize Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset the Summer Session tournament's leaderboard at 00:00 UTC 2026-06-22 (non-destructive time-boundary) and show a 1–5 prize ladder ($100/$60/$40/$30/$20) in the in-app overlay and the bot `/tournament` card.

**Architecture:** Config-driven, non-destructive, deterministic. Two optional fields on the tournament config (`scoreResetAt`, `prizes`) drive a pure time-boundary filter (`played_at >= boundary` once `now >= boundary`) applied to the existing tournament-leaderboard reads, plus an "always-show" prize ladder in both renderers. No DB schema migration, no cron, no destructive wipe.

**Tech Stack:** Node/Express + better-sqlite3 (`bot.js`, `db.js`), node-canvas (`leaderboard-card.js`), vanilla JS single-file client (`flappy_bert.html`), `node --test` unit tests.

## Global Constraints

- Reset is **non-destructive + deterministic**: a pure function of (`now`, `scoreResetAt`, `played_at`). No scheduled job, no row deletion, no persisted flag. Old scores are preserved (dormant after the boundary).
- The boundary string MUST match `tournament_scores.played_at` format: SQLite `YYYY-MM-DD HH:MM:SS` (UTC, space-separated). Convert `scoreResetAt` ISO → that format before any `played_at >= ?` compare.
- `scoreResetAt` and `prizes` are **optional** config fields. A tournament without them must behave/render EXACTLY as today (fully backward-compatible).
- Prize values: `prizes: [100, 60, 40, 30, 20]` for places 1–5; displayed `$<amount>`. Empty prize positions show "— up for grabs —".
- This is a **money competition** — favor safety: every change degrades to today's behavior when config is absent.
- Commit after each task. Do NOT push (deploy) until the user approves — but it MUST be deployed before 2026-06-22T00:00:00Z for the boundary to take effect on time.

---

### Task 1: `lib/tournament-reset.js` pure helpers + tests

**Files:**
- Create: `lib/tournament-reset.js`
- Test: `tests/tournament-reset.test.js`

**Interfaces:**
- Produces:
  - `isoToSqliteUTC(iso: string) → string` — ISO-8601 → `"YYYY-MM-DD HH:MM:SS"` (UTC)
  - `effectiveResetSince(scoreResetAt: string|undefined, nowMs: number) → string | null` — the SQLite boundary string iff set AND `nowMs >= Date.parse(scoreResetAt)`, else `null`

- [ ] **Step 1: Write the failing test**

Create `tests/tournament-reset.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isoToSqliteUTC, effectiveResetSince } = require('../lib/tournament-reset');

const RESET = '2026-06-22T00:00:00Z';
const SQL = '2026-06-22 00:00:00';

test('isoToSqliteUTC converts ISO to SQLite UTC datetime', () => {
  assert.equal(isoToSqliteUTC(RESET), SQL);
  assert.equal(isoToSqliteUTC('2026-06-22T00:00:00.000Z'), SQL);
  assert.equal(isoToSqliteUTC('2026-06-22T05:30:00+05:30'), SQL); // normalized to UTC
});

test('effectiveResetSince returns null before the boundary', () => {
  const before = Date.parse('2026-06-21T23:59:59Z');
  assert.equal(effectiveResetSince(RESET, before), null);
});

test('effectiveResetSince returns the boundary at/after it', () => {
  assert.equal(effectiveResetSince(RESET, Date.parse('2026-06-22T00:00:00Z')), SQL);
  assert.equal(effectiveResetSince(RESET, Date.parse('2026-07-01T12:00:00Z')), SQL);
});

test('effectiveResetSince returns null for missing/invalid config', () => {
  assert.equal(effectiveResetSince(undefined, Date.now()), null);
  assert.equal(effectiveResetSince(null, Date.now()), null);
  assert.equal(effectiveResetSince('not-a-date', Date.now()), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tournament-reset.test.js`
Expected: FAIL — `Cannot find module '../lib/tournament-reset'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournament-reset.js`:
```js
// Pure helpers for the non-destructive, time-boundary tournament reset.
// Shared by bot.js and the tests. The boundary is a pure function of time.

// ISO-8601 → SQLite "YYYY-MM-DD HH:MM:SS" (UTC), to compare against
// tournament_scores.played_at (DEFAULT datetime('now')).
function isoToSqliteUTC(iso) {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

// The SQLite boundary string iff scoreResetAt is set AND now has reached it;
// otherwise null (= no filter = pre-reset / no-reset behavior).
function effectiveResetSince(scoreResetAt, nowMs) {
  if (!scoreResetAt) return null;
  const t = Date.parse(scoreResetAt);
  if (Number.isNaN(t)) return null;
  if (nowMs < t) return null;
  return isoToSqliteUTC(scoreResetAt);
}

module.exports = { isoToSqliteUTC, effectiveResetSince };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tournament-reset.test.js` → PASS (4 tests). Then `npm test` → all green (84 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/tournament-reset.js tests/tournament-reset.test.js
git commit -m "feat(tournament): pure time-boundary reset helpers + tests"
```

---

### Task 2: Tournament config — accept + validate `scoreResetAt`/`prizes`, set them on Summer Session

**Files:**
- Modify: `tournaments-config.js:8-17` (validateTournament)
- Modify: `tournaments.json` (the `summer-session-2026` entry)
- Test: `tests/tournaments-config.test.js` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `loadTournamentsFromFile` returns entries that may carry `scoreResetAt: string` and `prizes: number[]`; an entry with an INVALID optional field is rejected (logged + skipped), same as a missing required field.

- [ ] **Step 1: Write the failing test**

Append to `tests/tournaments-config.test.js`:
```js
test('accepts optional scoreResetAt + prizes when valid', () => {
  const ok = validateTournament({
    id: 't', name: 'T', sponsor: 'S',
    startTime: '2026-06-01T00:00:00Z', endTime: '2026-09-01T00:00:00Z',
    scoreResetAt: '2026-06-22T00:00:00Z', prizes: [100, 60, 40, 30, 20],
  });
  assert.equal(ok, true);
});

test('rejects invalid optional fields', () => {
  const base = { id: 't', name: 'T', sponsor: 'S', startTime: '2026-06-01T00:00:00Z', endTime: '2026-09-01T00:00:00Z' };
  assert.equal(validateTournament({ ...base, scoreResetAt: 'not-a-date' }), false);
  assert.equal(validateTournament({ ...base, prizes: 'nope' }), false);
  assert.equal(validateTournament({ ...base, prizes: [10, -5] }), false);
});

test('still valid with neither optional field (backward compatible)', () => {
  assert.equal(validateTournament({ id: 't', name: 'T', sponsor: 'S', startTime: '2026-06-01T00:00:00Z', endTime: '2026-09-01T00:00:00Z' }), true);
});
```
(`validateTournament` is already imported in this test file via `require('../tournaments-config')` — confirm the import line includes it; if not, add `validateTournament` to the destructure.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tournaments-config.test.js`
Expected: FAIL — the `scoreResetAt:'not-a-date'` and `prizes` cases return `true` (no validation yet).

- [ ] **Step 3: Add the optional-field validation**

In `tournaments-config.js`, replace the end of `validateTournament` (the `return true;` at line 16) so it validates the optional fields first:
```js
  if (Date.parse(obj.endTime) <= Date.parse(obj.startTime)) return false;
  // Optional fields (Beat-My-Ghost-style reset + prizes). When present they must be well-formed.
  if (obj.scoreResetAt !== undefined) {
    if (typeof obj.scoreResetAt !== 'string' || Number.isNaN(Date.parse(obj.scoreResetAt))) return false;
  }
  if (obj.prizes !== undefined) {
    if (!Array.isArray(obj.prizes) || obj.prizes.some((p) => typeof p !== 'number' || !Number.isFinite(p) || p < 0)) return false;
  }
  return true;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tournaments-config.test.js` → PASS. Then `npm test` → all green.

- [ ] **Step 5: Set the fields on Summer Session**

In `tournaments.json`, edit ONLY the `summer-session-2026` object to add the two fields (keep the others unchanged):
```json
  {
    "id": "summer-session-2026",
    "name": "The Summer Session",
    "sponsor": "Dr. Inker LABS",
    "startTime": "2026-06-01T00:00:00Z",
    "endTime": "2026-09-01T00:00:00Z",
    "scoreResetAt": "2026-06-22T00:00:00Z",
    "prizes": [100, 60, 40, 30, 20]
  }
```
Verify it parses + loads: `node -e "const {loadTournamentsFromFile}=require('./tournaments-config');const t=loadTournamentsFromFile('./tournaments.json').find(x=>x.id==='summer-session-2026');console.log(t.scoreResetAt, JSON.stringify(t.prizes));"`
Expected: `2026-06-22T00:00:00Z [100,60,40,30,20]`

- [ ] **Step 6: Commit**

```bash
git add tournaments-config.js tournaments.json tests/tournaments-config.test.js
git commit -m "feat(tournament): config scoreResetAt + prizes (validated); set on Summer Session"
```

---

### Task 3: `db.js` — optional `since` boundary on the two tournament reads

**Files:**
- Modify: `db.js:246-263` (getTournamentLeaderboard), `db.js:265-275` (getTournamentPlayerRank)
- Test: `tools/verify-tournament-reset.cjs` (create — in-memory mechanism test)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `getTournamentLeaderboard(tournamentId, limit=50, since=null)` — when `since` truthy, filters `AND ts.played_at >= since`
  - `getTournamentPlayerRank(tournamentId, telegramId, since=null)` — same filter inside the ranked subquery

- [ ] **Step 1: Add the `since` param to both queries**

In `db.js`, replace `getTournamentLeaderboard` (lines 246-263) with:
```js
function getTournamentLeaderboard(tournamentId, limit = 50, since = null) {
  const where = since ? 'WHERE ts.tournament_id = ? AND ts.played_at >= ?' : 'WHERE ts.tournament_id = ?';
  const params = since ? [tournamentId, since, limit] : [tournamentId, limit];
  return db.prepare(`
    SELECT
      p.telegram_id, p.first_name, p.username, p.skin,
      MAX(ts.score) AS best_score,
      COUNT(ts.id)  AS games_played,
      MAX(ts.level) AS max_level
    FROM tournament_scores ts
    JOIN players p ON p.telegram_id = ts.telegram_id
    ${where}
    GROUP BY ts.telegram_id
    ORDER BY best_score DESC
    LIMIT ?
  `).all(...params);
}
```
And replace `getTournamentPlayerRank` (lines 265-275) with:
```js
function getTournamentPlayerRank(tournamentId, telegramId, since = null) {
  const where = since ? 'WHERE tournament_id = ? AND played_at >= ?' : 'WHERE tournament_id = ?';
  const params = since ? [tournamentId, since, telegramId] : [tournamentId, telegramId];
  const row = db.prepare(`
    SELECT rank FROM (
      SELECT telegram_id, RANK() OVER (ORDER BY MAX(score) DESC) as rank
      FROM tournament_scores
      ${where}
      GROUP BY telegram_id
    ) WHERE telegram_id = ?
  `).get(...params);
  return row ? row.rank : null;
}
```

- [ ] **Step 2: Write the mechanism test**

Create `tools/verify-tournament-reset.cjs`:
```js
// Proves the time-boundary filter: scores before the boundary are excluded once
// `since` is applied; all scores count when `since` is null. In-memory, FK-on.
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE players (telegram_id INTEGER PRIMARY KEY, first_name TEXT, username TEXT, skin TEXT);
  CREATE TABLE tournament_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id TEXT, telegram_id INTEGER, score INTEGER, level INTEGER, played_at TEXT,
    FOREIGN KEY (telegram_id) REFERENCES players(telegram_id));`);
db.prepare('INSERT INTO players VALUES (?,?,?,?)').run(1, 'Old', 'old', 'default');
db.prepare('INSERT INTO players VALUES (?,?,?,?)').run(2, 'New', 'new', 'default');
const ins = db.prepare('INSERT INTO tournament_scores (tournament_id,telegram_id,score,level,played_at) VALUES (?,?,?,?,?)');
ins.run('t', 1, 99, 9, '2026-06-20 12:00:00'); // before boundary
ins.run('t', 2, 40, 4, '2026-06-22 09:00:00'); // after boundary

const SINCE = '2026-06-22 00:00:00';
const lb = (since) => db.prepare(`
  SELECT p.telegram_id, MAX(ts.score) AS best_score FROM tournament_scores ts
  JOIN players p ON p.telegram_id = ts.telegram_id
  ${since ? 'WHERE ts.tournament_id = ? AND ts.played_at >= ?' : 'WHERE ts.tournament_id = ?'}
  GROUP BY ts.telegram_id ORDER BY best_score DESC LIMIT ?
`).all(...(since ? ['t', since, 50] : ['t', 50]));

const all = lb(null);
const reset = lb(SINCE);
const checks = {
  no_since_counts_all: all.length === 2 && all[0].best_score === 99,
  since_excludes_pre_boundary: reset.length === 1 && reset[0].telegram_id === 2 && reset[0].best_score === 40,
};
for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
const ok = Object.values(checks).every(Boolean);
console.log(ok ? '\n>>> PASS — boundary excludes pre-reset scores; null counts all' : '\n>>> FAIL');
process.exit(ok ? 0 : 1);
```

- [ ] **Step 3: Run the mechanism test + syntax check**

Run: `node --check db.js && node tools/verify-tournament-reset.cjs`
Expected: `db.js OK`-equivalent (no output from --check) then both checks `PASS` and `>>> PASS`. Then `npm test` → all green (the existing tournament tests still pass since `since` defaults to null).

- [ ] **Step 4: Commit**

```bash
git add db.js tools/verify-tournament-reset.cjs
git commit -m "feat(tournament): optional since boundary on leaderboard + rank reads"
```

---

### Task 4: `bot.js` — wire config map + apply boundary + expose prizes

**Files:**
- Modify: `bot.js` — add require (near line 31-35); build a config-by-id map after seeding (~line 205); `/api/tournament/:id` (912-925); `/api/tournament/:id/score` rank (974); the `/tournament` command (552-560)

**Interfaces:**
- Consumes: `effectiveResetSince` (Task 1); `getTournamentLeaderboard(id,limit,since)` + `getTournamentPlayerRank(id,tid,since)` (Task 3); `seededTournaments` (already loaded, bot.js:201).
- Produces: `GET /api/tournament/:id` response gains `prizes`; the boundary + prizes are applied in all three tournament read paths.

- [ ] **Step 1: Add the require + config map**

After `bot.js:35` (the `leaderboard-card` require) add:
```js
const { effectiveResetSince } = require('./lib/tournament-reset');
```
After the seeding block — immediately after the `console.log(`Loaded ${seededTournaments.length}...`)` line (bot.js:205) add:
```js
// Config-by-id (incl. optional scoreResetAt/prizes) for the reset boundary + prize ladder.
const tournamentConfigById = new Map(seededTournaments.map((t) => [t.id, t]));
const tournamentSince = (id) => effectiveResetSince(tournamentConfigById.get(id)?.scoreResetAt, Date.now());
const tournamentPrizes = (id) => tournamentConfigById.get(id)?.prizes || null;
```

- [ ] **Step 2: Apply in `GET /api/tournament/:id`**

Replace the body line `const entries = db.getTournamentLeaderboard(t.id, 50);` + the `res.json(...)` (bot.js:923-924) with (note `scoreResetAt` is added to the returned tournament — it's config-only, not on the DB row, and the client's pre-reset note needs it):
```js
  const since = tournamentSince(t.id);
  const entries = db.getTournamentLeaderboard(t.id, 50, since);
  res.json({
    tournament: { ...t, status, scoreResetAt: tournamentConfigById.get(t.id)?.scoreResetAt || null },
    entries,
    prizes: tournamentPrizes(t.id),
  });
```

- [ ] **Step 3: Apply in the post-score rank**

Replace `bot.js:974` `const rank = db.getTournamentPlayerRank(req.params.id, telegram_id);` with:
```js
    const rank = db.getTournamentPlayerRank(req.params.id, telegram_id, tournamentSince(req.params.id));
```

- [ ] **Step 4: Apply in the `/tournament` command (card)**

Replace the `const entries = db.getTournamentLeaderboard(chosen.id, 50);` (bot.js:552), the `renderTournamentCard(entries, { ... })` call (553-558), and the rank line (560):
```js
    const since = tournamentSince(chosen.id);
    const entries = db.getTournamentLeaderboard(chosen.id, 50, since);
    const pngBuffer = renderTournamentCard(entries, {
      name: chosen.name,
      sponsor: chosen.sponsor,
      status: statusText,
      highlightId: msg.from.id,
      prizes: tournamentPrizes(chosen.id),
    });

    const rank = db.getTournamentPlayerRank(chosen.id, msg.from.id, since);
```

- [ ] **Step 5: Verify**

Run: `node --check bot.js` → clean. `npm test` → all green.
Local smoke (boundary not yet reached today, so the board is unfiltered + prizes present):
```bash
BOT_TOKEN=dummy:smoke API_SECRET=s PORT=3996 node bot.js >/tmp/tlog 2>&1 &
SRV=$!; sleep 4
curl -s "http://127.0.0.1:3996/api/tournament/summer-session-2026" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("prizes:",JSON.stringify(j.prizes),"| entries:",Array.isArray(j.entries));})'
kill $SRV
```
Expected: `prizes: [100,60,40,30,20] | entries: true`.

- [ ] **Step 6: Commit**

```bash
git add bot.js
git commit -m "feat(tournament): apply reset boundary + expose prizes in API + bot card"
```

---

### Task 5: Client — prize ladder in the overlay + pre-reset note

**Files:**
- Modify: `flappy_bert.html` — `fetchAndRenderEntries` (~4358-4372) to pass prizes; `renderEntriesInto` (4374-4406) for the always-show ladder; add the pre-reset note in the live-section render.

**Interfaces:**
- Consumes: `GET /api/tournament/:id` now returns `{ entries, prizes }`.
- Produces: `renderEntriesInto(listEl, entries, prizes)` renders the 1–5 prize ladder.

- [ ] **Step 1: Thread prizes from fetch to renderer**

In `flappy_bert.html`, in `fetchAndRenderEntries`, replace `renderEntriesInto(listEl, data.entries || []);` with:
```js
    renderEntriesInto(listEl, data.entries || [], data.prizes || null);
    if (data.tournament) maybeShowResetNote(listEl, data.tournament);
```

- [ ] **Step 2: Rewrite `renderEntriesInto` for the always-show ladder**

Replace `function renderEntriesInto(listEl, entries) { ... }` (4374-4406) with a version that, when `prizes` is present, always renders positions 1..max(prizes.length, entries.length):
```js
function renderEntriesInto(listEl, entries, prizes) {
  const user = getTelegramUser();
  listEl.replaceChildren();
  const nPrize = Array.isArray(prizes) ? prizes.length : 0;
  if (entries.length === 0 && nPrize === 0) {
    listEl.appendChild(_makeEl('div', { style: 'text-align:center;color:var(--text-dim);font-size:7px;padding:12px', text: 'No scores yet' }));
    return;
  }
  const rows = Math.max(nPrize, entries.length);
  for (let i = 0; i < rows; i++) {
    const rank = i + 1;
    const e = entries[i];
    const prize = (i < nPrize) ? prizes[i] : null;
    const isYou = e && user && e.telegram_id === user.id;
    const medal = rank === 1 ? '\u{1F947}' : (rank === 2 ? '\u{1F948}' : (rank === 3 ? '\u{1F949}' : '#' + rank));
    const bg = isYou ? 'rgba(255,215,0,0.15)' : (rank <= 3 ? 'rgba(255,215,0,0.06)' : 'rgba(255,255,255,0.03)');
    const border = isYou ? 'border:1px solid rgba(255,215,0,0.4);' : '';
    const nameColor = isYou ? '#ffd700' : (e ? '#e8e8f0' : '#7a7e9a');
    const displayName = e ? ((isYou ? '▶ ' : '') + (e.first_name || e.username || 'Player')) : '— up for grabs —';

    const row = _makeEl('div', { style: 'display:flex;align-items:center;padding:6px 8px;margin:3px 0;border-radius:6px;background:' + bg + ';' + border });
    row.appendChild(_makeEl('div', { style: 'width:28px;text-align:center;font-size:' + (rank<=3?'12px':'8px') + ';flex-shrink:0', text: medal }));
    if (prize != null) {
      row.appendChild(_makeEl('div', { style: 'font-size:8px;font-weight:bold;color:#ffd700;width:34px;flex-shrink:0;text-align:center', text: '$' + prize }));
    }
    row.appendChild(_makeEl('div', { style: 'flex:1;font-size:8px;color:' + nameColor + ';margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: displayName }));
    row.appendChild(_makeEl('div', { style: 'font-size:10px;font-weight:bold;color:#ffd700;margin-left:8px', text: e ? String(e.best_score) : '' }));
    row.appendChild(_makeEl('div', { style: 'font-size:7px;color:#7a7e9a;margin-left:8px;width:20px;text-align:right', text: e ? (String(e.games_played) + 'g') : '' }));
    listEl.appendChild(row);
  }
}
```

- [ ] **Step 3: Add the pre-reset note helper**

Add near `renderEntriesInto` (a new function):
```js
// One-line note while the prize reset is still upcoming, so the pre-reset scores
// shown next to live prizes aren't confusing. Hidden once the boundary passes.
function maybeShowResetNote(listEl, tournament) {
  const resetAt = tournament && tournament.scoreResetAt;
  if (!resetAt) return;
  const ms = Date.parse(resetAt);
  if (Number.isNaN(ms) || Date.now() >= ms) return;
  const note = _makeEl('div', {
    style: 'text-align:center;font-size:7px;color:#ffd700;background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.25);border-radius:6px;padding:5px 8px;margin:4px 0',
    text: '\u{1F3C1} Prize competition starts ' + new Date(ms).toUTCString().replace(' GMT', ' UTC') + ' — scores reset then',
  });
  listEl.insertBefore(note, listEl.firstChild);
}
```
NOTE: `scoreResetAt` reaches the client because Task 4 Step 2 already adds it to the returned `tournament` object (`tournament.scoreResetAt`). This helper just reads it.

- [ ] **Step 4: Verify (syntax + browser smoke)**

Run the inlined-JS check:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("flappy_bert.html","utf8");const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join("\n");fs.writeFileSync("/tmp/fbt.js",m);' && node --check /tmp/fbt.js && echo "JS OK"
```
Browser smoke (adapt `tools/ghost-pill-smoke.cjs`): load `flappy_bert.html`, then `page.evaluate` to build a `<div>` and call `renderEntriesInto(div, [{telegram_id:1,first_name:'Sam',best_score:47,games_played:3}], [100,60,40,30,20])`; assert the div has 5 rows, row 1 text contains `$100` and `Sam`, row 3 text contains `$40` and `up for grabs`. Also call with `(div, [], null)` and assert it shows `No scores yet`. Confirm no console errors. Commit the smoke script.

- [ ] **Step 5: Commit**

```bash
git add flappy_bert.html tools/
git commit -m "feat(tournament): always-show prize ladder in overlay + pre-reset note"
```

---

### Task 6: Bot card — prize ladder in `renderTournamentCard`

**Files:**
- Modify: `leaderboard-card.js` — `renderTournamentCard` (607: `count`; the row loop body ~677-748)

**Interfaces:**
- Consumes: `options.prizes: number[] | null` (passed from Task 4 Step 4).
- Produces: the card renders positions 1..max(entries, prizes.length); prize positions show `$<amount>` + "up for grabs" for empty slots.

**Read first:** `leaderboard-card.js` `renderTournamentCard` (function body from line 607 to its `return canvas.toBuffer`) to see the constants (`WIDTH`, `PAD`, `ROW_H`, `ROW_GAP`, `MAX_ENTRIES`, `C`) and the exact per-row drawing. The change follows the existing per-column `ctx.fillText` pattern — read it, don't guess pixel positions.

- [ ] **Step 1: Extend the row count to include empty prize slots**

Replace `const count = Math.min(entries.length, MAX_ENTRIES);` (line 607) with:
```js
  const nPrize = Array.isArray(options.prizes) ? options.prizes.length : 0;
  const count  = Math.min(Math.max(entries.length, nPrize), MAX_ENTRIES);
```

- [ ] **Step 2: Guard the row body for empty slots + draw the prize**

In the `for (let i = 0; i < count; i++)` loop, the body reads `const entry = entries[i];` then draws name/score/level/games from `entry`. Make it empty-slot-safe and add the prize:
  1. After `const entry = entries[i];` add `const prize = i < nPrize ? options.prizes[i] : null;` and treat `entry` as possibly `undefined`.
  2. Wherever the body reads `entry.telegram_id` / `entry.skin` / `entry.first_name` / `entry.best_score` / `entry.max_level` / `entry.games_played`, guard with `entry && ...`. For an empty slot: draw the player name as `— up for grabs —` in `C.textDim`, and SKIP the score/level/games/avatar draws (or draw blanks).
  3. Draw the prize for prize rows: after the medal/rank is drawn, render the prize in bold gold. Use a fixed x just left of the SCORE column — the score is right-aligned at `WIDTH - PAD - 120`; draw the prize right-aligned at `WIDTH - PAD - 175` (read the actual layout to confirm no overlap with the truncated name; if tight, shorten the name `.substring(0, 14)` for prize rows). Example, matching the file's pattern:
```js
    if (prize != null) {
      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = C.gold;
      ctx.fillText('$' + prize, WIDTH - PAD - 175, rowCenterY);
      ctx.restore();
    }
```
Keep all existing non-prize behavior identical when `options.prizes` is absent (`nPrize === 0` ⇒ `count` and the body are unchanged; no prize drawn).

- [ ] **Step 3: Verify (headless render)**

Create a quick render check `tools/verify-tournament-card.cjs`:
```js
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
```
Run: `node --check leaderboard-card.js && node tools/verify-tournament-card.cjs` → both buffers render (`>>> PASS`). READ `docs/verification/tournament-card-prizes.png` and confirm the prize ladder + "up for grabs" slots look right. Then `npm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add leaderboard-card.js tools/verify-tournament-card.cjs docs/verification/tournament-card-prizes.png
git commit -m "feat(tournament): prize ladder on the bot /tournament card"
```

---

## Self-Review

- **Spec coverage:** time-boundary reset (Task 1 helper + Task 3 query `since` + Task 4 wiring) ✓; config fields + Summer Session values (Task 2) ✓; always-show prize ladder overlay (Task 5) ✓; bot card ladder (Task 6) ✓; pre-reset note (Task 5 + the Task-4 `scoreResetAt` passthrough noted in Task 5 Step 3) ✓; applied to API + bot card + post-submit rank (Task 4) ✓; backward-compat when config absent (every task guards on `since`/`prizes` truthiness) ✓; testing (pure unit + DB mechanism + config + browser + card render) ✓; deploy-before-22/06 (Global Constraints) ✓.
- **Placeholder scan:** Task 6 Steps 2 directs the implementer to read the canvas constants rather than hardcoding unseen pixel values — this is a precise, bounded instruction (exact data, exact guard logic, exact prize-draw snippet, named overlap risk), not a vague "handle layout." Acceptable for a complex existing canvas renderer; all other tasks carry complete code.
- **Type consistency:** `effectiveResetSince(scoreResetAt, nowMs)`, `isoToSqliteUTC(iso)`, `getTournamentLeaderboard(id, limit, since)`, `getTournamentPlayerRank(id, tid, since)`, `renderEntriesInto(listEl, entries, prizes)`, `options.prizes`, `tournament.scoreResetAt` are consistent across Tasks 1→6. The `scoreResetAt` client passthrough is added in Task 4 Step 2 and consumed in Task 5 Step 3 (cross-referenced in both).
- **Test-count note:** Task 1 adds 4 tests (→84), Task 2 adds 3 (→87). Update CLAUDE.md's count after the feature lands (not a task step).
