# Faster Speed Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Steepen the speed ramp from +0.15/level to +0.25/level (cap unchanged at 5.5, now reached at level 12 / score 110), with the anti-tamper mirror kept in sync and the curve locked by tests.

**Architecture:** The curve lives in TWO places inside `flappy_bert.html` that must change together atomically: `updateDifficulty()` (the gameplay write) and the anti-tamper `expectedSpeed()` (the gate that silently rejects out-of-curve writes to `G.gameSpeed`). A new pure-JS test mirror (`tests/lib/difficulty-curve.js`) plus source-sync grep tests pin both. Spec: `docs/superpowers/specs/2026-07-10-speed-progression-design.md`.

**Tech Stack:** Vanilla JS in a single HTML file; `node:test` (`npm test` = `node --test tests/*.test.js`); deploy = push to `origin/main`, Render auto-deploys.

## Global Constraints

- Speed formula (NEW, both sites): `baseSpeed + Math.min(lvl * 0.25, 3)` — exact literal `Math.min(lvl * 0.25, 3)`.
- Unchanged: `baseSpeed: 2.5`, `gravity: 0.25`, `flapForce: -4.8`, gap schedule `Math.max(190 - lvl*4, 110)`, level formula `Math.floor(score/10) + 1`, 500 score cap.
- Server `lib/score-validation.js` must NOT be touched (its 5 pts/sec gate already covers the new curve — see spec).
- Every commit leaves `npm test` green. Baseline: 119 pass. Final: 127 pass.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Difficulty-curve test mirror

**Files:**
- Create: `tests/lib/difficulty-curve.js`
- Create: `tests/difficulty-curve.test.js`

**Interfaces:**
- Produces: `require('./lib/difficulty-curve')` exporting `levelForScore(score)`, `speedAtLevel(lvl)`, `gapAtLevel(lvl)` (all pure, number → number). Task 2 appends source-sync tests to the same test file.

- [ ] **Step 1: Write the failing test**

Create `tests/difficulty-curve.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { levelForScore, speedAtLevel, gapAtLevel } = require('./lib/difficulty-curve');

test('levelForScore: floor(score/10)+1', () => {
  assert.equal(levelForScore(0), 1);
  assert.equal(levelForScore(9), 1);
  assert.equal(levelForScore(10), 2);
  assert.equal(levelForScore(110), 12);
  assert.equal(levelForScore(190), 20);
  assert.equal(levelForScore(500), 51);
});

test('speed ramps +0.25/level below the cap', () => {
  assert.equal(speedAtLevel(1), 2.75);
  assert.equal(speedAtLevel(6), 4.0);
  assert.equal(speedAtLevel(11), 5.25);
});

test('speed caps at 5.5, reached at level 12', () => {
  assert.equal(speedAtLevel(12), 5.5);
  assert.equal(speedAtLevel(13), 5.5);
  assert.equal(speedAtLevel(60), 5.5);
});

test('speed-at-score matches the approved spec table', () => {
  const speedAtScore = (s) => speedAtLevel(levelForScore(s));
  assert.equal(speedAtScore(0), 2.75);
  assert.equal(speedAtScore(50), 4.0);
  assert.equal(speedAtScore(100), 5.25);
  assert.equal(speedAtScore(110), 5.5);
  assert.equal(speedAtScore(190), 5.5);
  assert.equal(speedAtScore(500), 5.5);
});

test('gap schedule is UNCHANGED: 190 - 4/level, floor 110 at level 20', () => {
  assert.equal(gapAtLevel(1), 186);
  assert.equal(gapAtLevel(19), 114);
  assert.equal(gapAtLevel(20), 110);
  assert.equal(gapAtLevel(60), 110);
});

test('speed never decreases and gap never increases across levels 1..60', () => {
  for (let lvl = 2; lvl <= 60; lvl++) {
    assert.ok(speedAtLevel(lvl) >= speedAtLevel(lvl - 1), `speed dip at level ${lvl}`);
    assert.ok(gapAtLevel(lvl) <= gapAtLevel(lvl - 1), `gap rise at level ${lvl}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/difficulty-curve.test.js`
Expected: FAIL — `Cannot find module './lib/difficulty-curve'`

- [ ] **Step 3: Write the mirror module**

Create `tests/lib/difficulty-curve.js`:

```js
// Difficulty curve — pure mirror of updateDifficulty() and the anti-tamper
// expectedSpeed()/expectedGap() closures in flappy_bert.html (keep in sync;
// the source-sync tests in tests/difficulty-curve.test.js grep the HTML for
// the exact speed-formula literal, so drift fails the suite).
const BASE_SPEED = 2.5;
const BASE_PIPE_GAP = 190;
const SPEED_PER_LEVEL = 0.25; // 2026-07-10: was 0.15 — owner-approved mid-tournament pacing change
const SPEED_CAP_BONUS = 3;    // top speed 2.5 + 3 = 5.5, reached at level 12 (score 110)
const GAP_PER_LEVEL = 4;
const MIN_GAP = 110;

function levelForScore(score) {
  return Math.floor(score / 10) + 1;
}

function speedAtLevel(lvl) {
  return BASE_SPEED + Math.min(lvl * SPEED_PER_LEVEL, SPEED_CAP_BONUS);
}

function gapAtLevel(lvl) {
  return Math.max(BASE_PIPE_GAP - lvl * GAP_PER_LEVEL, MIN_GAP);
}

module.exports = { levelForScore, speedAtLevel, gapAtLevel };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/difficulty-curve.test.js`
Expected: PASS — `# pass 6`, `# fail 0`

Run: `npm test`
Expected: 125 pass, 0 fail (119 baseline + 6 new)

- [ ] **Step 5: Commit**

```bash
git add tests/lib/difficulty-curve.js tests/difficulty-curve.test.js
git commit -m "test(difficulty): curve mirror locking the new 0.25/level ramp

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Apply the new curve in flappy_bert.html (both sites, source-sync tested)

**Files:**
- Modify: `flappy_bert.html:2086` (`updateDifficulty()`)
- Modify: `flappy_bert.html:~2496` (anti-tamper `expectedSpeed()`)
- Modify: `tests/difficulty-curve.test.js` (append source-sync tests)

**Interfaces:**
- Consumes: `tests/lib/difficulty-curve.js` from Task 1 (unchanged here).
- Produces: the shipped curve. The source-sync tests are the drift tripwire future changes must satisfy.

- [ ] **Step 1: Append the failing source-sync tests**

Append to `tests/difficulty-curve.test.js`:

```js
// --- Source-sync: the two in-HTML formula sites must both carry the new curve.
// updateDifficulty() writes G.gameSpeed; the anti-tamper expectedSpeed() gates
// that write (rejects values above expected+0.5). If they drift, mid-game
// speed-ups are silently discarded — so we grep the shipped HTML itself.
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'flappy_bert.html'), 'utf8');

test('flappy_bert.html carries the new formula at BOTH sites (updateDifficulty + expectedSpeed)', () => {
  const hits = html.match(/Math\.min\(lvl \* 0\.25, 3\)/g) || [];
  assert.equal(hits.length, 2, `expected exactly 2 sites, found ${hits.length}`);
});

test('no stale 0.15/level speed formula remains in flappy_bert.html', () => {
  assert.ok(!/lvl \* 0\.15/.test(html), 'found leftover "lvl * 0.15"');
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/difficulty-curve.test.js`
Expected: `# pass 6`, `# fail 2` — both source-sync tests fail (HTML still has `lvl * 0.15` at both sites)

- [ ] **Step 3: Edit both HTML sites**

In `flappy_bert.html` `updateDifficulty()` (line 2086), change:

```js
  // Speed increases gradually
  G.gameSpeed = G.baseSpeed + Math.min(lvl * 0.15, 3);
```

to:

```js
  // Speed increases gradually — 0.25/level since 2026-07-10 (cap unchanged at
  // +3 = top speed 5.5 @ level 12). MUST match expectedSpeed() in the
  // anti-tamper block and tests/lib/difficulty-curve.js.
  G.gameSpeed = G.baseSpeed + Math.min(lvl * 0.25, 3);
```

In the anti-tamper block (~line 2496), change:

```js
  function expectedSpeed() {
    const lvl = Math.floor(_score / 10) + 1;
    return EXPECTED.baseSpeed + Math.min(lvl * 0.15, 3);
  }
```

to:

```js
  function expectedSpeed() {
    const lvl = Math.floor(_score / 10) + 1;
    // MUST match updateDifficulty() — the G.gameSpeed setter rejects writes
    // above expectedSpeed()+0.5, so a stale formula here silently freezes the
    // game on the old curve.
    return EXPECTED.baseSpeed + Math.min(lvl * 0.25, 3);
  }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: 127 pass, 0 fail

Also confirm the only content changes to the HTML are the two formula sites:

Run: `git diff flappy_bert.html | grep -E '^[+-]' | grep -v '^[+-][+-]' | grep -vE '^\+\s*//|^-\s*//'`
Expected: exactly one `-`/`+` pair per site, both pairs differing only in `0.15` → `0.25`

- [ ] **Step 5: Commit**

```bash
git add flappy_bert.html tests/difficulty-curve.test.js
git commit -m "feat(difficulty): speed ramp 0.15 -> 0.25/level, cap unchanged (owner-approved mid-tournament)

Top speed still 5.5, now reached at score 110 instead of 190; endgame
190-500 identical. Anti-tamper expectedSpeed() updated in the same commit
(the G.gameSpeed setter rejects writes above expected+0.5, so shipping one
site without the other silently keeps the old curve). Source-sync tests
grep the HTML for the formula literal at both sites.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Docs — CHANGELOG entry + CLAUDE.md policy exception + test count

**Files:**
- Modify: `CHANGELOG.md` (new dated section at top, below the `# Flappy Bert Changelog` heading)
- Modify: `CLAUDE.md` ("Mid-tournament fix policy" section, line ~98; test count, line ~133)

**Interfaces:**
- Consumes: shipped behavior from Task 2. Produces: none (docs only).

- [ ] **Step 1: Add the CHANGELOG section**

Insert directly under the `# Flappy Bert Changelog` line (above the `## 2026-07-09` section):

```markdown
## 2026-07-10 — Faster Speed Progression (owner-approved mid-tournament)

The speed ramp is now **+0.25/level (was +0.15)**; the cap is unchanged, so
top speed is still 5.5 — reached at **score 110** instead of 190. Score 50 now
plays at speed 4.0 (was 3.4), score 100 at 5.25 (was 4.15); the endgame band
(190–500) is identical. Pipe gap, gravity, flap force, and base speed are
untouched.

**Why mid-tournament:** after the 2026-07-09 fixed-timestep fix, the majority
of players (high-refresh phones) found the corrected game slow. This is an
owner-approved exception to the mid-tournament freeze — it makes the 50–190
band harder than the conditions earlier scores were set under; accepted
because those players' conditions had already shifted with the timestep fix
and the leaderboard race lives in the unchanged 190–500 band.

Anti-tamper `expectedSpeed()` updated in the same commit (drift would
silently discard legit speed-ups). New mirror + source-sync suite:
`tests/lib/difficulty-curve.js`, `tests/difficulty-curve.test.js` (119 → 127
tests). Server score validation unchanged — its 5 pts/sec ceiling was sized
for the old 120Hz double-rate world and still comfortably covers the new
curve. Spec: `docs/superpowers/specs/2026-07-10-speed-progression-design.md`.
```

- [ ] **Step 2: Record the policy exception in CLAUDE.md**

In the `## Mid-tournament fix policy (Summer Session, until 2026-09-01)` section, after the 2026-07-09 paragraph (line ~98) and before the `**DEFERRED...**` line, insert:

```markdown
**Exception (owner-approved 2026-07-10):** speed ramp steepened to 0.25/level (cap/top speed unchanged at 5.5, now reached at score 110 not 190). This DOES make the 50–190 band harder than the leader's-240 conditions — approved because most players are on high-refresh phones whose conditions were already reset by the fixed timestep, and the 190–500 race band is untouched. Curve is pinned by `tests/difficulty-curve.test.js` incl. source-sync greps of BOTH in-HTML formula sites (`updateDifficulty()` + anti-tamper `expectedSpeed()` — these must always change together). Spec: `docs/superpowers/specs/2026-07-10-speed-progression-design.md`.
```

Note: the deferred item "Extend the difficulty curve past level 20" stays deferred — this change does not extend the plateau.

- [ ] **Step 3: Bump the test count in CLAUDE.md**

In the testing section (line ~133), change `Current count: 119 (21 tournaments-config + ...` so the total reads `127` and the breakdown gains `+ 8 difficulty-curve` (keep the rest of the breakdown intact).

- [ ] **Step 4: Verify suite still green, then commit**

Run: `npm test`
Expected: 127 pass, 0 fail

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + policy-exception note for the 2026-07-10 speed-ramp change

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Browser smoke verification + deploy

**Files:**
- None modified (verification + push only)

**Interfaces:**
- Consumes: the shipped curve from Task 2.

- [ ] **Step 1: Serve the game locally**

```bash
cd /opt/Flappy-Bert && python3 -m http.server 8765 --bind 127.0.0.1 &
```

- [ ] **Step 2: Drive the game with Playwright MCP and read the live speed**

Using the Playwright MCP tools: `browser_navigate` to `http://127.0.0.1:8765/flappy_bert.html`, click the `▶ PLAY` button (`onclick="startGame()"`, flappy_bert.html:707), then `browser_evaluate`:

```js
() => ({ speed: G.gameSpeed, level: G.level, score: G.score })
```

Expected: `speed: 2.75` at `level: 1` (old curve would read 2.65). This proves the served build runs the new curve end-to-end AND that the anti-tamper setter accepted the write. (Formula-pair sync at higher levels — where a stale `expectedSpeed()` would start rejecting writes, lvl ≥ 6 — is already pinned statically by the Task 2 source-sync tests.)

- [ ] **Step 3: Kill the local server**

```bash
kill %1 2>/dev/null; pkill -f 'http.server 8765' 2>/dev/null; true
```

- [ ] **Step 4: Push to deploy**

```bash
git push origin main
```

Render auto-deploys `main` (`render.yaml`, service `flappy-bert-bot`). Note: the local spec/plan doc commits ride along in the same push.

- [ ] **Step 5: Confirm with the owner**

Ask the owner to hard-reload the mini-app on their phone (~3–5 min after push for the Render build) and confirm the pacing feels right. If it overshoots, the single knob is the `0.25` literal at the two HTML sites + mirror constant — re-run this plan's Task 2 pattern with a new value.
