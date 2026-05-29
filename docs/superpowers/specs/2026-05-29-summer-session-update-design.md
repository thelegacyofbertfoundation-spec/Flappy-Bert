# The Summer Session Update — Design

**Date:** 2026-05-29
**Author:** autonomous session (Claude, fully-auto mode)
**Status:** approved-by-delegation (user requested ~2h autonomous gameplay + feature + aesthetic
work; per-section approval gate waived by explicit "fully auto mode" instruction)

## Goal

Ship a cohesive, summer-themed content drop that launches alongside **The Summer Session**
tournament (2026-06-01 00:00 UTC → 2026-09-01 00:00 UTC, 3 months). Three pillars:

1. **Gameplay** — a new homing enemy variant (the headline the user picked).
2. **Feature** — a new in-game powerup that rewards aggressive scoring (tournament-coherent).
3. **Aesthetic** — a harmonized "summer" glow-up of the existing day/night world + menu.

Plus the tournament itself (data-driven, no code) and the supporting tests.

## Constraints discovered during exploration

- **`flappy_bert.html` is one monolith (~4400 lines).** All work is sequential, single-file.
- **Anti-tamper locks** (`flappy_bert.html` ~2230–2386):
  - `scoreMultiplier` setter accepts **only `{1, 1.5, 2}`**.
  - the `score` setter caps per-frame increase at `1` (mult < 1.5) or `2` (mult ≥ 1.5).
    → the *only* legitimate way to award 2 points/pipe is `scoreMultiplier ≥ 1.5`.
  - `gameSpeed` setter **rejects values below `baseSpeed`** → a slow-mo powerup is impossible
    without threading a factor through every read site (deferred; too high-risk this pass).
- **Enemies** move on a baked `e.vx` (not re-read from `gameSpeed`) plus erratic dual-wave
  `baseY`. Enemy collision lives in `update()` (not `checkCollision()`).
- **`G.timeOfDay = score/40`** drives the sky lerp + a **moon that fades out** as day rises.
  There is currently **no sun**. The summer pass layers onto this; it must not replace it.
- **Tournament is fully data-driven**: `bot.js:209` seeds `tournaments.json` (idempotent
  `INSERT OR IGNORE`), `/api/tournaments/featured` calls `getFeaturedTournament`. Adding a
  tournament = append JSON + restart. Featured priority: `live > upcoming<7d > recently_ended<14d`.

## Approaches considered (powerup)

The user liked "new enemy variant"; the backlog offered three powerups. Evaluated against
*low core-feel regression risk* (we are already raising difficulty with a new enemy, during a
3-month flagship tournament) and *tournament coherence* (ranks by score):

- **A. 2x-score window ("Frenzy") — CHOSEN.** Reuses the validated scoring path; sets
  `scoreMultiplier = 2` for a window and restores the prior shop value after. Score-positive,
  directly rewards climbing the Summer Session leaderboard. Low render/physics risk.
- **B. Slow-mo.** Best skill expression, pairs beautifully with a homing enemy — but the
  `gameSpeed` lock forces a `slowFactor` through pipes/enemies/ground/physics/spawn-timer:
  highest integration cost and core-feel risk. **Deferred.**
- **C. Shrink / phase.** Touches Bert's render scale or trivializes difficulty. Weaker
  tournament fit. **Rejected.**

## Design

### 1. The Summer Session tournament (data-only)

Append to `tournaments.json`:

```json
{
  "id": "summer-session-2026",
  "name": "The Summer Session",
  "sponsor": "Dr. Inker LABS",
  "startTime": "2026-06-01T00:00:00Z",
  "endTime": "2026-09-01T00:00:00Z"
}
```

- `sponsor` continues the recent "Dr. Inker LABS" pattern (April + May).
- `endTime` is exactly **0000 UTC Sept 1** as specified (note: prior entries used `23:59:59`;
  we honor the user's explicit boundary). `validateTournament` passes (end > start).
- **Behavior:** until 2026-05-31 23:59:59, "May The Flap Be With You" remains the *live*
  featured; Summer Session shows in the overlay's **Upcoming** section. At 2026-06-01 00:00:00
  it becomes the live featured (home button). For 14 days after Sept 1 it is `recently_ended`.

### 2. New enemy variant — Homing "HUNTER" JEET

A JEET that **lazily tracks Bert's altitude** — distinct from the existing erratic wobblers.

- **Spawn:** within the existing JEET spawn (cooldown/drought unchanged). When a JEET is rolled
  **and `level ≥ 4`**, ~**30%** chance it is a `hunter` instead of `bat/ghost/spark`.
  Hunters are **size 1 or 2 only** (never the 3× huge — unfair while homing) and **slower in x**
  (`vx ×0.7`) so the *tracking* is the threat, not raw speed.
- **Movement (the new logic):** each frame the hunter's `baseY` eases toward `G.bert.y`:
  `baseY += clamp((bertY − baseY) × TRACK_GAIN, −MAX_TRACK, +MAX_TRACK)`
  with `TRACK_GAIN = 0.03`, `MAX_TRACK = 1.6 px/frame`, plus a small sine wobble so it is not a
  perfect laser. Lazy gain + late altitude change ⇒ a fair, skill-based dodge.
- **Telegraph:** distinct spawn warning (magenta edge marker + a dedicated `fxHunterSpawn`
  rising-pitch sting, vs the basic JEET's descending growl). While alive it renders a **faint
  reticle ring + lock-on tick** that tracks Bert, and the "JEETS" label is **magenta** (`#ff4dd2`)
  not white.
- **Collision / dodge:** reuse the existing enemy collision loop (shield absorbs; else game over)
  and the dodge-on-exit FX.

### 3. New powerup — 2x-Score "FRENZY" window

- **State:** `G.powerups.frenzy = { active, expiresAt }`; `FRENZY_DURATION_FRAMES = 60*8` (8 s).
  `G._frenzyPrevMult` holds the multiplier to restore.
- **Spawn roll** (in `addPipe`): `level ≥ 3`, ~**2.5%**, mutually exclusive with magnet/coin/shield
  (inserted at the top of the existing roll ladder).
- **Activate** (`FX.frenzyActivate`): on a *fresh* activate (`!active`) save
  `G._frenzyPrevMult = G.scoreMultiplier`; then `G.scoreMultiplier = 2`, set
  `expiresAt = frameCount + FRENZY_DURATION_FRAMES`, play SFX. Refresh-on-pickup, **no stacking**
  (re-pickup extends the window but does not overwrite the saved prev mult).
- **Expire** (top of `update()`, mirroring magnet): restore
  `G.scoreMultiplier = (prev === 1.5 || prev === 2) ? prev : 1`, `FX.frenzyExpire` (sets
  `active = false` + SFX), hide pill.
- **HUD:** a **gold `#frenzyPill`** cloned from `.magnet-pill`, **stacked below** the magnet pill
  (`top: 52px`) since both powerups can be active simultaneously. Shows `2X` + countdown bar.
- **Visual:** a **golden sun-ray aura** around Bert while active (mirror of the magnet arc aura).
  The existing multiplier ring (renders gold at mult ≥ 2) is a free bonus indicator.
- **Pipe collectible:** a gold "2X" star icon in the gap (mirror of the magnet icon block).
- **Anti-tamper / server:** `scoreMultiplier` is always in `{1,1.5,2}` ⇒ fully compliant; the
  value submitted at death is honest (2 if active at death, else the restored prev). `_frenzyPrevMult`
  and `powerups.frenzy` are unlocked — same low-risk rationale as the existing magnet props.
- **Resets:** `startGame` clears frenzy (`active=false`, `expiresAt=0`, `_frenzyPrevMult` unset).
  `gameOver` sets `frenzy.active = false` **without** touching `scoreMultiplier` (keeps the
  submitted multiplier honest).

### 4. Summer aesthetic pass (harmonized with `timeOfDay`)

- **Warmer summer sky:** nudge only the **day-end** targets of the sky gradient lerp toward a
  brighter, warmer summer palette (vivid blue crown, golden haze near the horizon). Night
  endpoints unchanged. All channels clamped 0–255.
- **Sun:** add a sun that **fades in as day rises** (`sunAlpha = clamp((t − 0.15)/0.6, 0, 1)`),
  a warm radial gradient with a soft glow and a few gentle rays, positioned opposite the moon
  (`x ≈ w*0.22, y ≈ h*0.14`). Drawn right after the moon (the moon fades out as the sun fades in).
- **Brighter day clouds:** scale cloud alpha up with `t` so puffy summer clouds appear by day.
- **Menu:** retheme the season label to a warm **"☀ SUMMER SEASON ☀"** (was "SEASON 3"),
  tying the menu to the flagship tournament.
- All additions are **purely additive / day-target-only** ⇒ the day/night gradient + moon system
  keep working unchanged.

## Testing

Pure-JS logic replicas in `tests/lib/` (the project's accepted drift-risk pattern), tested via
`node --test`:

- **`tournaments-config.test.js`** (+3): the real `tournaments.json` parses & contains a valid
  Summer Session; `getFeaturedTournament` returns it `live` at 2026-06-01T00:00:01Z; returns it
  `recently_ended` a few days after Sept 1.
- **`tests/lib/frenzy-timer.js` + `fx-frenzy-timer.test.js`** (+4): activate sets mult=2 and
  expiresAt; tick at expiry restores prev mult and clears active; refresh-while-active keeps the
  original prev (no stacking); prev restore clamps invalid → 1.
- **`tests/lib/homing-enemy.js` + `homing-enemy.test.js`** (+4): eases toward target; clamps to
  `MAX_TRACK`; converges within N steps; symmetric for target above/below.

Target: 26 → ~37 tests, all green. Existing tests must stay green.

## Files touched

- `tournaments.json` — tournament entry
- `flappy_bert.html` — enemy, powerup, HUD markup + CSS, aesthetics, menu label, constants
- `tests/lib/{frenzy-timer,homing-enemy}.js`, `tests/{fx-frenzy-timer,homing-enemy}.test.js`,
  `tests/tournaments-config.test.js`
- `CHANGELOG.md`, `CLAUDE.md` (mechanics + roadmap), `docs/superpowers/{specs,plans}`,
  `docs/superpowers/feature-backlog.md` (mark items done / re-triage)

## Out of scope (deferred)

- Slow-mo powerup (gameSpeed-lock integration cost).
- Second enemy (laser JEET) — note as future once the hunter is validated.
- Share-card upgrade, daily-login streak, the unauthed-canvas-endpoint hardening
  (tracked in `bugs-defer-to-june.md`), prod duplicate-April-row cleanup.
