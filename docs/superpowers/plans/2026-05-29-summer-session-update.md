# The Summer Session Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). All gameplay/
> powerup/aesthetic work edits the single monolith `flappy_bert.html`; parallel subagents would
> collide, so execute sequentially in one session. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship a summer-themed content drop — The Summer Session tournament + a homing "HUNTER"
JEET + a 2x-score "FRENZY" powerup + a harmonized summer aesthetic — all green-tested.

**Architecture:** Tournament is data-only (`tournaments.json`). Pure-logic for the powerup timer
and homing motion is extracted to `tests/lib/` replicas (project's accepted pattern) and TDD'd,
then wired into `flappy_bert.html`, mirroring the existing magnet/JEET/FX patterns. Aesthetics
layer additively onto the `timeOfDay` day/night system.

**Tech Stack:** vanilla JS / HTML5 Canvas (`flappy_bert.html`), Node `node:test`, better-sqlite3
(seeded from JSON by `bot.js`), node-telegram-bot-api.

Spec: `docs/superpowers/specs/2026-05-29-summer-session-update-design.md`

---

### Task 1: The Summer Session tournament (data + tests)

**Files:**
- Modify: `tournaments.json`
- Test: `tests/tournaments-config.test.js`

- [ ] **Step 1 — failing tests.** Append to `tests/tournaments-config.test.js`:

```js
// ---- The Summer Session (real config-file integration) ----
const repoConfig = path.join(__dirname, '..', 'tournaments.json');

test('tournaments.json contains a valid Summer Session entry', () => {
  const all = loadTournamentsFromFile(repoConfig);
  const summer = all.find(t => t.id === 'summer-session-2026');
  assert.ok(summer, 'summer-session-2026 present in tournaments.json');
  assert.equal(summer.name, 'The Summer Session');
  assert.equal(summer.startTime, '2026-06-01T00:00:00Z');
  assert.equal(summer.endTime, '2026-09-01T00:00:00Z');
});

test('Summer Session is the live featured at 2026-06-01T00:00:01Z', () => {
  const all = loadTournamentsFromFile(repoConfig);
  const f = getFeaturedTournament(all, new Date('2026-06-01T00:00:01Z'));
  assert.equal(f.id, 'summer-session-2026');
  assert.equal(f.featured_state, 'live');
});

test('Summer Session is recently_ended a few days after Sept 1', () => {
  const all = loadTournamentsFromFile(repoConfig);
  const f = getFeaturedTournament(all, new Date('2026-09-05T12:00:00Z'));
  assert.equal(f.id, 'summer-session-2026');
  assert.equal(f.featured_state, 'recently_ended');
});
```

- [ ] **Step 2 — run, expect FAIL** (`npm test`): the three new tests fail (entry missing).
- [ ] **Step 3 — add the entry** to `tournaments.json` (after the May entry):

```json
  {
    "id": "summer-session-2026",
    "name": "The Summer Session",
    "sponsor": "Dr. Inker LABS",
    "startTime": "2026-06-01T00:00:00Z",
    "endTime": "2026-09-01T00:00:00Z"
  }
```

- [ ] **Step 4 — run, expect PASS** (`npm test`): all green (existing 26 + 3).
- [ ] **Step 5 — commit** `feat(tournament): add The Summer Session (Jun 1 – Sep 1 2026)`.

---

### Task 2: Pure-logic libs (TDD) — frenzy timer + homing motion

**Files:**
- Create: `tests/lib/frenzy-timer.js`, `tests/fx-frenzy-timer.test.js`
- Create: `tests/lib/homing-enemy.js`, `tests/homing-enemy.test.js`

- [ ] **Step 1 — `tests/lib/frenzy-timer.js`** (mirror of the in-HTML frenzy logic):

```js
// Frenzy (2x-score window) timer logic — mirror of code in flappy_bert.html
const FRENZY_DURATION_FRAMES = 60 * 8;
const VALID_MULTS = [1, 1.5, 2];

function createFrenzyState() {
  return { powerups: { frenzy: { active: false, expiresAt: 0 } }, scoreMultiplier: 1, _frenzyPrevMult: 1 };
}

// Fresh activate saves prev mult; refresh-while-active extends without overwriting prev.
function frenzyActivate(G, frameCount) {
  if (!G.powerups.frenzy.active) G._frenzyPrevMult = G.scoreMultiplier;
  G.scoreMultiplier = 2;
  G.powerups.frenzy.active = true;
  G.powerups.frenzy.expiresAt = frameCount + FRENZY_DURATION_FRAMES;
}

// Returns true if frenzy just expired this tick (restoring the prev multiplier).
function frenzyTick(G, frameCount) {
  if (G.powerups.frenzy.active && frameCount >= G.powerups.frenzy.expiresAt) {
    G.powerups.frenzy.active = false;
    G.scoreMultiplier = VALID_MULTS.includes(G._frenzyPrevMult) ? G._frenzyPrevMult : 1;
    return true;
  }
  return false;
}

module.exports = { createFrenzyState, frenzyActivate, frenzyTick, FRENZY_DURATION_FRAMES };
```

- [ ] **Step 2 — `tests/fx-frenzy-timer.test.js`**:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFrenzyState, frenzyActivate, frenzyTick, FRENZY_DURATION_FRAMES } = require('./lib/frenzy-timer');

test('frenzyActivate sets mult=2, active, expiresAt, saves prev', () => {
  const G = createFrenzyState(); G.scoreMultiplier = 1.5;
  frenzyActivate(G, 100);
  assert.equal(G.scoreMultiplier, 2);
  assert.equal(G.powerups.frenzy.active, true);
  assert.equal(G.powerups.frenzy.expiresAt, 100 + FRENZY_DURATION_FRAMES);
  assert.equal(G._frenzyPrevMult, 1.5);
});

test('frenzyTick before expiry keeps mult=2', () => {
  const G = createFrenzyState(); frenzyActivate(G, 0);
  assert.equal(frenzyTick(G, FRENZY_DURATION_FRAMES - 1), false);
  assert.equal(G.scoreMultiplier, 2);
});

test('frenzyTick at expiry restores prev mult and clears active', () => {
  const G = createFrenzyState(); G.scoreMultiplier = 1.5; frenzyActivate(G, 0);
  assert.equal(frenzyTick(G, FRENZY_DURATION_FRAMES), true);
  assert.equal(G.powerups.frenzy.active, false);
  assert.equal(G.scoreMultiplier, 1.5);
});

test('re-activate while active keeps original prev (no stacking the prev)', () => {
  const G = createFrenzyState(); G.scoreMultiplier = 1; frenzyActivate(G, 0);
  frenzyActivate(G, 60); // refresh; prev must stay 1, not become 2
  assert.equal(G._frenzyPrevMult, 1);
  assert.equal(G.powerups.frenzy.expiresAt, 60 + FRENZY_DURATION_FRAMES);
});

test('invalid prev mult restores to 1', () => {
  const G = createFrenzyState(); G.scoreMultiplier = 1; frenzyActivate(G, 0);
  G._frenzyPrevMult = 99; // tampered
  frenzyTick(G, FRENZY_DURATION_FRAMES);
  assert.equal(G.scoreMultiplier, 1);
});
```

- [ ] **Step 3 — `tests/lib/homing-enemy.js`**:

```js
// Homing "HUNTER" JEET vertical-tracking logic — mirror of code in flappy_bert.html
const TRACK_GAIN = 0.03;
const MAX_TRACK = 1.6;

// Eases baseY toward the target (Bert's y) by a clamped step. Returns the new baseY.
function homingStep(baseY, targetY, gain = TRACK_GAIN, maxTrack = MAX_TRACK) {
  let step = (targetY - baseY) * gain;
  if (step > maxTrack) step = maxTrack;
  if (step < -maxTrack) step = -maxTrack;
  return baseY + step;
}

module.exports = { homingStep, TRACK_GAIN, MAX_TRACK };
```

- [ ] **Step 4 — `tests/homing-enemy.test.js`**:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { homingStep, MAX_TRACK } = require('./lib/homing-enemy');

test('homingStep eases toward a target above', () => {
  const next = homingStep(100, 200);
  assert.ok(next > 100 && next < 200, 'moves toward target without overshoot');
});

test('homingStep eases toward a target below (symmetric)', () => {
  const next = homingStep(200, 100);
  assert.ok(next < 200 && next > 100);
});

test('homingStep clamps to MAX_TRACK on a large gap', () => {
  const next = homingStep(0, 100000);
  assert.equal(next, MAX_TRACK);
});

test('homingStep converges to the target within 400 steps', () => {
  let y = 50; const target = 600;
  for (let i = 0; i < 400; i++) y = homingStep(y, target);
  assert.ok(Math.abs(y - target) < 1, `converged (got ${y})`);
});
```

- [ ] **Step 5 — run, expect PASS** (`npm test`): existing + 3 (Task 1) + 9 (frenzy 5 + homing 4) = 38.
- [ ] **Step 6 — commit** `test(summer-session): frenzy-timer + homing-enemy logic replicas (TDD)`.

---

### Task 3: Wire the FRENZY powerup into `flappy_bert.html`

Mirror the magnet powerup end-to-end. **Anchors** (line numbers from the 2026-05-29 read; re-grep
before editing):

- [ ] **Constant** — after `MAGNET_DURATION_FRAMES` (~749): `const FRENZY_DURATION_FRAMES = 60 * 8;`
- [ ] **State** — in `G.powerups` (~831): add `frenzy: { active: false, expiresAt: 0 }`; add `G._frenzyPrevMult` handling.
- [ ] **Audio** — after `fxMagnetExpire` (~1262): add `fxFrenzyPickup/fxFrenzyActivate/fxFrenzyExpire`
  using `_sweep`/`_chord`/`_noiseBurst` (bright gold ascending major chord for activate).
- [ ] **FX** — after `magnetExpire` (~1510): add `frenzyPickup(x,y)` (gold shockwave + flash + particles),
  `frenzyActivate()` (save prev mult guard → `scoreMultiplier=2`, set active/expiresAt, SFX),
  `frenzyExpire()` (SFX + `active=false`).
- [ ] **Pickup roll** — in `addPipe` (~1966 roll ladder): add a `pipe.hasFrenzy` branch at the TOP of the
  ladder: `if (G.level >= 3 && roll < 0.025) pipe.hasFrenzy = true; else if (... magnet ...) ...`.
  Add `hasFrenzy:false, frenzyCollected:false` to the pipe object literal (~1957).
- [ ] **Expiry + HUD** — top of `update()` (after the magnet block ~2413): add a frenzy expiry+pill block
  (restore prev mult via the validated set, update `#frenzyPillText`/bar, hide on expiry).
- [ ] **Pickup detection** — in the pipe loop (after magnet pickup ~2707): `if (p.hasFrenzy && !p.frenzyCollected && dist<25) { collected; FX.frenzyPickup; FX.frenzyActivate; }`.
- [ ] **Render icon** — in the collectibles render loop (after magnet icon ~2970): gold "2X" star in the gap.
- [ ] **Render aura** — after the magnet aura (~3029): golden rotating sun-ray aura when `frenzy.active`.
- [ ] **HUD markup** — after `#magnetPill` (~577): a `#frenzyPill.frenzy-pill` (icon ✦, `#frenzyPillText`, bar).
- [ ] **HUD CSS** — after `.magnet-pill-bar-fill` (~524): `.frenzy-pill` (gold, `top:52px`) + bar-fill rules.
- [ ] **Resets** — `startGame` (~1784): `G.powerups.frenzy.active=false; expiresAt=0; G._frenzyPrevMult=1;`
  and hide `#frenzyPill`. `gameOver` (~2063): `G.powerups.frenzy.active=false;` (do NOT touch mult).
- [ ] **Verify:** `npm test` still green; `node -e "require('vm')...` HTML parse smoke (Task 6).
- [ ] **Commit** `feat(powerup): 2x-score FRENZY window — pickup, HUD pill, aura, FX`.

---

### Task 4: Wire the HUNTER (homing) enemy into `flappy_bert.html`

- [ ] **Spawn** — in `addPipe`'s JEET block (~1984): after choosing `type`, if `G.level >= 4 &&
  Math.random() < 0.30`, set `type='hunter'`, force `scale` to 1 or 2 (re-roll if 3), mark
  `homing:true`, slow vx (`×0.7`). Push enemy with `homing` + `wobbleAmp`/`wobbleFreq` for the
  small sine. Fire `FX.hunterSpawn(...)` instead of `FX.jeetSpawn(...)` for hunters.
- [ ] **Movement** — in the enemies update loop (~2722): branch `if (e.homing) { e.baseY = homingStep
  toward G.bert.y (clamped, inlined); e.y = e.baseY + sin(age*wobbleFreq)*wobbleAmp; }` else existing
  dual-wave. Keep the off-screen dodge + collision unchanged (they already cover all enemies).
- [ ] **Telegraph FX/Audio** — add `AudioSystem.fxHunterSpawn()` (rising magenta sting) and
  `FX.hunterSpawn(x,y)` (push a `jeetWarnings` entry with `homing:true`).
- [ ] **Render warning color** — in the `jeetWarnings` render (~2981): magenta fill when `w.homing`.
- [ ] **Render enemy** — in the enemy render (~2993): if `e.homing`, fill `#ff4dd2` and draw a faint
  reticle ring + a short lock-on tick pointing at Bert; else white as today.
- [ ] **Verify:** `npm test` green; HTML parse smoke.
- [ ] **Commit** `feat(enemy): homing HUNTER JEET — tracks altitude, telegraphed, lvl 4+`.

---

### Task 5: Summer aesthetic pass

- [ ] **Sky day-targets** — in `render()` sky lerp (~2854–2862): warm/brighten only the t=1 (day) target
  of each `lerpC(night, day, t)` toward a summer palette (vivid blue crown, golden horizon haze).
  Keep night targets; clamp 0–255.
- [ ] **Sun** — after the moon block (~2889): draw a sun with `sunAlpha = clamp((t-0.15)/0.6,0,1)`,
  warm radial gradient + soft glow + a few gentle rays, at `x≈w*0.22, y≈h*0.14`.
- [ ] **Day clouds** — cloud fill alpha scales with `t` (brighter puffy clouds by day).
- [ ] **Menu** — change the `.menu-season` text (~676) from `SEASON 3` to `☀ SUMMER SEASON ☀`; warm the
  `.menu-season` CSS (~77) if needed.
- [ ] **Verify:** HTML parse smoke; visual reasoning only (no headless canvas test).
- [ ] **Commit** `feat(aesthetic): summer sky + sun + brighter day clouds + menu retheme`.

---

### Task 6: Verify, document, review, prepare ship

- [ ] Run full `npm test` — expect ~38 green.
- [ ] HTML smoke: extract the `<script>` and `node --check` it (syntax) + a DOM-light load check.
- [ ] Update `CHANGELOG.md` (new section) + `CLAUDE.md` (mechanics: hunter, frenzy; roadmap) +
  `docs/superpowers/feature-backlog.md` (mark 2x-score done; note hunter shipped, laser deferred).
- [ ] Commit untracked `package-lock.json` if appropriate (Dockerfile uses it).
- [ ] `requesting-code-review` (Agent, model opus) against the spec; triage findings.
- [ ] Commit docs; summarize; present ship decision (push to `main` = Render auto-deploy).

## Self-Review

- **Spec coverage:** tournament (T1), hunter enemy (T2 logic, T4 wiring), frenzy powerup (T2 logic,
  T3 wiring), summer aesthetic (T5), tests (T1/T2), docs+review+ship (T6). All spec sections mapped.
- **Type consistency:** `frenzyActivate/frenzyTick/FRENZY_DURATION_FRAMES`, `homingStep/TRACK_GAIN/
  MAX_TRACK`, `G.powerups.frenzy.{active,expiresAt}`, `G._frenzyPrevMult`, `pipe.hasFrenzy/
  frenzyCollected`, `e.homing` — names consistent across lib, tests, and wiring tasks.
- **Placeholders:** lib + tests have full code; monolith wiring uses precise anchors + signatures
  (implementer has full file context). No TBD/TODO.
