# Aesthetic Pass — Design Spec

**Date:** 2026-04-30
**Status:** Approved by user, ready for implementation plan
**Predecessor:** 2026-04-30 hot-path bug sweep (sub-project #2 option A) — shipped same day
**Successor:** Implementation plan (next: invoke `superpowers:writing-plans`)

## Goal

Polish the *feel* of Flappy Bert across every meaningful in-game moment, add one new powerup (Magnet), and rebuild the game-over screen as a sequenced reveal with a hero score. Keep the chiptune / 8-bit identity but allow tasteful modern accents (additive glow, soft bloom) on key moments.

This is option C from the original sub-project brainstorm: aesthetic improvements + juice + new feature.

## Scope

**In scope:**

1. **Polish sweep** across 10 named moments (coin pickup, pipe pass, combo, near-miss, shield hit, level-up, JEET spawn, JEET dodge, game-over, audio).
2. **New powerup: Magnet** — drops in pipe gaps (~3% rate from level 2), pulls on-screen coins toward Bert for 5 seconds.
3. **Game-over redesign** — sequenced reveal (~2-3.2s), hero score treatment, dead ad-gated UI removed.
4. **Audio polish** — pure Web Audio synth, helper extensions (`_adsr`, `_chord`, `_sweep`, `_noiseBurst`), synthesized reverb, per-event SFX rewrites.
5. **Bundled cleanup:**
   - Delete dead `getTournamentCountdown()` function (deferred bug M1).
   - Remove dormant ad-gated UI (`goContinueBtn`, `goDoubleCoins` markup, `continueWithAd()`, `doubleCoinsWithAd()`, `adContinueUsed` / `adInterstitialCounter` plumbing).
   - Mark M1 resolved in `docs/superpowers/bugs-defer-to-june.md`.
   - Create `docs/superpowers/feature-backlog.md` recording the deferred C-side ideas.

**Out of scope:**

- Server-side changes (`bot.js`, `db.js`, `leaderboard-card.js`).
- M3 deferred bug (unauth canvas-render endpoints) — unrelated to aesthetics, stays deferred.
- Tournament-DB ops cleanup (`DELETE FROM tournaments WHERE id='april-flapoff-2026'`) — ops task.
- Other deferred C-side features (enemy variants, share-card upgrade, daily streak, trail/accessory cosmetics, skin-reveal moment, slow-mo, 2x-score powerups). These go to `feature-backlog.md`.
- Music-loop overhaul beyond a stretch goal in Section 3.

## Visual style direction

**8-bit + tasteful modern accents.** Keep the pixel font (Press Start 2P), blocky shapes, gold accents, dark backgrounds. Allow soft additive glow / bloom on key moments only — combo, level-up, magnet aura, hero score, game-over reveal. Modern accents are *layered on top of* the pixel base, not a replacement for it.

## Architecture: the FX module

A new `FX` object in the inline `<script>` of `flappy_bert.html`, declared after the `Sound` singleton and before game-loop functions. It is the single entry point for every "moment" in the game.

```
const FX = {
  // Polish sweep events
  coinPickup(x, y),     pipePass(),       combo(n, x, y),
  nearMiss(x, y),       shieldHit(x, y),  levelUp(n),
  jeetSpawn(x, y),      jeetDodge(x, y),

  // New powerup
  magnetPickup(x, y),   magnetActivate(),  magnetExpire(),

  // Game-over orchestrator
  gameOverSequence(stats, onDone),

  // Internal helpers (not called from game code)
  _spawnParticles(opts),
  _shake(intensity, frames),
  _flash(alpha, color),
  _glowText(domId, color, durationMs),
};
```

Each public method is a self-contained orchestration: spawns particles, plays SFX, triggers screen effects, glows the relevant DOM number — whatever the moment needs. Game-loop code calls **one line per event**.

`Sound.fx*` methods stay as the audio layer; `FX.*` methods *use* them. Particles continue to live in `G.particles`; `FX._spawnParticles(opts)` is a thin wrapper enforcing a soft cap and applying centralized defaults.

The existing scattered juice (death particles, current shake/flash code, the few existing `Sound.fx*` calls in the game loop) gets refactored to call `FX.*` instead.

## Event catalog

Format: **trigger** → **visual** + **audio** + **screen FX**. *Italic* = existing behavior. **Bold** = new.

### 1. `FX.coinPickup(x, y)` — pipe-gap coin grabbed
- *Existing: short beep.*
- **6-8 gold sparkle particles (additive blend, fade out 400ms), short coin-pickup chime (two-osc swept frequency, ~80ms), tiny +1 coin counter glow pulse on the HUD.**

### 2. `FX.pipePass()` — passing through a pipe (score tick)
- *Existing: silent + score number increments.*
- **Brief swooosh SFX (white-noise burst with quick lowpass envelope, ~60ms), score number gets a 1-frame scale-pulse (1.0 → 1.15 → 1.0).** Kept light — fires every ~1s.

### 3. `FX.combo(n, x, y)` — every 5 pipes (existing combo bonus)
- *Existing: bonus coins added silently.*
- **Rainbow-glow combo number floats up from `(x, y)` ("COMBO ×5!"), 12 confetti particles in alt-colors, ascending arpeggio (3 notes), HUD coin counter chime.**

### 4. `FX.nearMiss(x, y)` — squeezed past pipe by < threshold (existing +3 coins)
- *Existing: +3 coins, no announce.*
- **Brief slow-mo ghost trail behind Bert (4 alpha-decreasing copies of the player rect), "+3 ⚡" floater rises from `(x, y)`, sharp twang SFX.** Pure visual — does not actually slow the game.

### 5. `FX.shieldHit(x, y)` — shield absorbs a hit
- *Existing: shield icon disappears.*
- **Cyan ring shockwave from impact point (expands 0 → 80px over 250ms, alpha 1 → 0), 6-frame screen shake (intensity 4), flash alpha 0.3 cyan-tinted, glass-shatter SFX (filtered noise burst).**

### 6. `FX.levelUp(n)` — every 10 pipes
- *Existing: nothing announced; speed/gap quietly shifts.*
- **Full-width banner "LEVEL N" sweeps in from left, holds 800ms, sweeps out — pixel font, 8-bit + soft glow on the digits. Three-note ascending fanfare. Background palette nudges one step on each level-up (cycle 6 palettes).**

### 7. `FX.jeetSpawn(x, y)` — JEET enters from edge
- *Existing: pops in.*
- **Warning indicator (small red triangle at edge of screen) flashes 200ms before the JEET enters, then JEET fades in with red glow halo (400ms decay). Low growl SFX (sawtooth + noise, ~150ms).**

### 8. `FX.jeetDodge(x, y)` — JEET passes Bert without contact
- New event — *no existing analogue.* Bert is fixed on the left, world scrolls right-to-left, so JEETs move toward Bert and exit left. Tracked when a JEET exits the **left** side of the screen (Bert's side) without hitting.
- **Pure feel — no coin reward (avoid coin inflation, don't change balance). 4 small black-puff particles trailing the JEET, deep "whoosh" SFX.**

### 9. `FX.gameOverSequence(stats, onDone)` — see "Game-over redesign" section below

### 10. Audio polish (cross-cutting) — see "Audio system upgrades" section below

### 11. `FX.magnetPickup(x, y)` — Bert grabs a magnet powerup token
- **Strong magnetic-engage SFX (rising sweep + low pulse), purple shockwave ring at pickup, screen flash purple alpha 0.2.**

### 12. `FX.magnetActivate()` — fires immediately after pickup; starts the 5s window
- **Bert gets a faint purple aura (drawn each frame in `drawPlayer`), small "MAGNET 5s" timer pill in the HUD with countdown bar.**

### 13. `FX.magnetExpire()` — 5s window ends
- **Aura fades 300ms, soft "depower" SFX (descending sweep), timer pill fades out.**

## Audio system upgrades

All pure Web Audio (no asset bytes added).

1. **ADSR helper** — `Sound._adsr(gainNode, { attack, decay, sustain, release, peak })` replaces the inline ramps.
2. **Harmonic stacking helper** — `Sound._chord(freqs, type, durMs, gainPerVoice)` for combo arpeggios, level-up fanfare, magnet activation chord.
3. **Synthesized reverb** — one shared `ConvolverNode` with a synthesized impulse response (white noise × exponential decay, ~400ms, generated at boot from a `Math.random()`-seeded buffer). New `Sound.reverbSend` gain (default 0.15). Per-SFX opt-in via `reverb: true`.
4. **Lowpass filter helper** — `Sound._noiseBurst(durMs, cutoffHz, decayMs)` for swooshes, shield-shatter, magnet sweep noise. White-noise `AudioBufferSourceNode` → `BiquadFilterNode` (lowpass) → gain envelope.
5. **Frequency-sweep helper** — `Sound._sweep(fStart, fEnd, durMs, type)` for coin pickups (ascending), magnet pickup (rising), magnet expire (descending).
6. **Per-event SFX rewrites** — each `Sound.fx*` method tied to one of the catalog events below is rewritten using the helpers above with explicit ADSR characteristics. Music-loop scheduling functions are out of scope here (see point 7).
   - Coin pickup: short bright sweep (660 → 1320Hz, 80ms, sine + tri stacked)
   - Combo: three-note arpeggio (root, fifth, octave) with reverb send
   - Level-up: fanfare (root, third, fifth, octave) over 700ms, reverb on
   - Shield hit: filtered noise burst (1200Hz lowpass, 250ms decay) + sub thump
   - JEET spawn: sawtooth + noise growl (low freq, 150ms)
   - JEET dodge: short white-noise whoosh (low cutoff, 200ms)
   - Game-over sting: descending minor third with long reverb tail (~1.2s)
   - Magnet activate: rising sweep (220 → 880Hz) + chord stack on arrival
   - Magnet expire: descending sweep (mirror)
7. **Music-loop polish (stretch goal — drop if it bloats):** add sub-octave to the lead and an LFO-modulated lowpass. Flag in plan as soft target.

**Volume / mix:** existing `musicGain` (0.25) and `sfxGain` (0.4) levels stay. Reverb routes through `sfxGain`, respecting mute toggle.

## Magnet powerup mechanics

**Spawn:**
- Drops in pipe gaps, mutually exclusive with coin spawns (gap rolls magnet first; if it lands, no coin in that gap).
- Spawn rate: ~3% per pipe gap.
- Earliest possible spawn: level 2.
- No per-run cap.

**Visual (token):**
- Drawn in canvas, pixel-style horseshoe magnet (~22×22 px): red top half + silver poles, 2-pixel border, soft purple glow halo. Glow pulses (sin wave on alpha, ~1Hz).
- Position: gap-center, slight vertical bob (existing coin pattern).

**Pickup:**
- AABB collision with Bert (existing pattern, same as coin collision).
- On hit: token removed, `FX.magnetPickup(x,y)` fires, `FX.magnetActivate()` starts the 5s window.

**Active window:**
- Duration: 5 seconds, tracked as a game-frame count: `G.powerups.magnet.expiresAt = G.frameCount + 60*5`.
- Stored under `G.powerups.magnet = { active: true, expiresAt }` to leave room for future powerups (slow-mo, 2x score) without rework.
- HUD: small "MAGNET 5s" pill (top-right corner near coin counter), countdown bar shrinks from 100% → 0%.
- Picking up a second magnet while active **refreshes** the timer to a full 5s (no stacking).

**Coin-attraction physics:**
- Each frame while active, every coin in `G.coins` (where `0 ≤ coin.x ≤ canvas.width + 50`) gets a velocity nudge toward Bert.
- Spring-style: `dx = bert.x - coin.x; dy = bert.y - coin.y; dist = hypot(dx, dy); strength = clamp(900 / dist², 0.05, 1.2); coin.vx += (dx/dist) * strength; coin.vy += (dy/dist) * strength;`. Numbers are starting tuning targets; final values picked during implementation playtest.
- Velocity cap: `coin.vx`, `coin.vy` clamped to ±10 px/frame.
- Drag override: while a coin is being magnetically pulled, normal screen-scroll drift (`coin.x -= G.gameSpeed`) is suppressed for that coin.
- Off-screen coins (already exited left, `coin.x < -coinSize`) are not pulled back. One-way magnet.
- Pickup detection unchanged.

**Aura:**
- Drawn in `drawPlayer()` while `G.powerups.magnet.active` is true: 3 concentric purple rings around Bert, alpha-decreasing outward, additive blend, slow rotation (~30°/sec).
- Fades over 300ms during expire.

**Interactions / edge cases:**
- Pause / unpause: `G.frameCount` advances only on active frames, so pause is automatically respected. Verify existing pause handling does not increment `frameCount` during implementation.
- Game-over while active: clear `G.powerups.magnet.active = false` in the death path.
- Shield + magnet: independent, both can coexist.
- Score multiplier (1.5x / 2x) + magnet: independent. Magnet pulls coins; multiplier scales pipe-pass score. No interaction.

**Anti-tamper:**
- `G.powerups.magnet.expiresAt` and `.active` are *not* added to the `Object.defineProperty` lock list. Tampering would let a cheater collect on-screen coins more aggressively, which trades into the score economy via shop multipliers (capped at 2x server-side). Risk: low. Cost of locking: meaningful (existing locks complicate every read/write site).

**Anti-cheat (server-side):** zero changes. Magnet does not affect score; it only changes coin-pickup probability, which is local-only currency. Score validation rules unchanged.

## Game-over redesign

**Markup changes** (in `<div id="gameOverOverlay">`, currently around line 564):

- Remove `goDoubleCoins` div (lines 574-576) — dead ad UI.
- Remove `goContinueBtn` (line 583) — dead ad UI.
- Remove `continueWithAd()` and `doubleCoinsWithAd()` functions and the `G.adContinueUsed` / `G.adInterstitialCounter` plumbing and the `AdSystem.showInterstitial(...)` call at line 1628-1630. The `AdSystem` stub stays *defined* (referenced from `isRewardedReady()` which is also called elsewhere; we'll grep for callers and only remove dead branches).
- Restructure the panel into named groups for the reveal:
  - `.go-hero` — score number + "NEW BEST" / "X away" line + medal.
  - `.go-stats` — level, combo, multiplier, rank nudge.
  - `.go-rewards` — coins, badge popup, tournament line.
  - `.go-actions` — buttons (PLAY AGAIN, MENU, SHOP, RANKS).
- Hero score gets its own large class (`.go-score-hero`) — 64px Press Start 2P, gold default / rainbow-gradient on new-best, glow on both.

**Hero score treatment:**

- Default: large gold pixel digits with soft additive glow (`text-shadow: 0 0 12px rgba(255,215,0,.7)`).
- New best: same plus animated rainbow text gradient (CSS keyframes shimmer through the 6 palette colors over 1.5s, infinite while overlay open) **and** confetti burst (canvas particles spawned once at score-punch-in, behind the panel).

**Reveal sequence** (new function `FX.gameOverSequence(stats, onDone)`, called from `showGameOverScreen()` after data is populated):

| t (ms) | Action |
|---|---|
| 0    | Overlay fades in (existing `panelSlideIn` 300ms anim; contents start `visibility: hidden` so they pop one at a time). Game-over sting SFX. |
| 200  | "GAME OVER" title type-on (8 chars × ~25ms). |
| 450  | Hero score "punches in": scale(0.4) rotate(-15°) → scale(1.2) → settle scale(1.0). 250ms cubic-bezier. Punch SFX (low thump + high click). |
| 700  | Score animates 0 → final over 600ms (eased), digit-click SFX every 50ms (max ~12 clicks, capped). |
| 1300 | Medal slides down + bounces (existing `medalBounce` keyframe reused). |
| 1500 | Best/rank nudge fades in (200ms). New-best confetti burst here. |
| 1700 | Stats group (level/combo/multiplier) staggers in left-to-right (each 100ms apart). |
| 2050 | Coins counter ticks 0 → final (400ms), coin-clink SFX every 80ms. |
| 2450 | Badge popup (if any) drops from top with bounce. |
| 2700 | Tournament line fades in (if applicable). |
| 2900 | Action buttons fade in together (300ms). Hands control to player. |

Total: ~3.2s for a maximal run, ~2.0s for short (skips combo/multiplier/badge/tournament steps when absent). Buttons gate next start.

**Skip-to-end:** any pointerdown on the overlay during reveal jumps to t=2900 (everything visible, buttons enabled). Implementation: single `pointerdown` listener calling `FX.gameOverSequence.skip()`.

**Server submit timing:** `finalGameOver()` calls `submitScoreToServer` and `submitTournamentScore` *before* the sequence — they run in parallel with the reveal. Network latency hidden behind animation.

**Performance:** all animations are CSS transitions/keyframes triggered by class toggles. No per-frame JS for the reveal itself. `setTimeout` chain inside `FX.gameOverSequence` orchestrates class toggles. Canvas continues rendering Bert falling + death particles behind the overlay.

**Edge cases:**
- Network slow / submit fails: sequence is independent of submit promise. Error logging only; player still sees their game-over.
- User taps PLAY AGAIN before sequence finishes: overlay closes, sequence canceled (timeouts cleared via `FX.gameOverSequence.cancel()`), normal restart.
- Badge popup conflict with stats stagger: separate group, no conflict.

## Performance budget

- **Particle ceiling:** soft cap at 150 simultaneous. `FX._spawnParticles(opts)` checks length and drops the request silently if at cap.
- **Per-event particle counts** (sized to fit under the cap with overlap):
  - coinPickup: 6-8, pipePass: 0, combo: 12, nearMiss: 0 (4 cached rect copies for ghost trail), shieldHit: 0 (single shockwave drawn each frame from a state object), levelUp: 0 (banner is DOM), jeetSpawn: 0 (halo per-frame draw), jeetDodge: 4, magnetPickup: 12, magnetActivate: 0 (aura per-frame draw), death: 20 (existing).
  - Worst plausible co-occurrence: combo (12) + magnetPickup (12) + jeetDodge (4) + death (20) = 48. Well under 150.
- **Audio voice budget:** existing `musicNodes` array trimmed to last 128. New SFX use ad-hoc oscillators that `stop()` themselves on envelope completion. Reverb convolver is single shared node, allocated once at boot.
- **DOM cost (game-over reveal):** ~10 class toggles + 1 score-counter rAF over 600ms. Negligible.
- **Frame target:** 60fps on a Pixel 4a-class phone. No dropped frames during a typical 30s run with combo + level-up + 1 magnet pickup.

## Testing

**Unit tests** (extend `tests/`, follow `tournaments-config.test.js` pattern using `node:test` + `node:assert/strict`):

- `Sound._adsr` — given input params, gain envelope hits expected values at expected times (mock AudioNode).
- `FX._spawnParticles` — respects 150-cap, drops silently when over.
- Magnet expire timing — given `G.frameCount`, `G.powerups.magnet` clears at correct frame.
- Magnet pickup-while-active — refreshes timer, does not stack.
- Game-over sequence — `cancel()` clears all pending timeouts.

**Manual playtest checklist:**

- All 10 polish events fire without console errors across a normal run.
- Magnet drops at roughly expected rate (~1 per 35 pipes — verify across 3 long runs).
- Magnet pulls coins as expected; no coins fly past Bert; off-screen coins don't snap back.
- Game-over reveal completes without overlap/clipping at minimum (score-only) and maximum (combo + multiplier + badge + tournament + new-best) panel state.
- Skip-tap works at any point in the reveal.
- 60fps holds during heaviest combo+magnet+JEET overlap.

**Anti-cheat regression:** verify score validation still rejects > hard cap (500), still rejects too-fast submission, still rejects multipliers other than 1/1.5/2. Magnet does not change scoring; confirm.

**Server side:** zero changes. No new endpoints, no schema changes.

## File organization

All work in `flappy_bert.html` (per CLAUDE.md "single monolithic file" convention).

New code in this order in the existing `<script>` block:

1. `FX` object — defined right after `Sound` singleton, before game-loop functions.
2. `Sound` helper extensions (`_adsr`, `_chord`, `_sweep`, `_noiseBurst`) — added inline to existing `Sound` object.
3. `G.powerups` initialization — added to existing game-state object.
4. Game-loop integration — magnet physics in existing per-frame coin update; FX calls replace inline juice in event handlers.

Markup changes — game-over panel restructure inside existing `<div id="gameOverOverlay">`.

CSS — new keyframes (`comboFloat`, `levelBanner`, `heroScorePunch`, `goCount`, `magnetPulse`, `magnetAura`, etc.) appended to existing `<style>` block.

## Bundled cleanup

- Delete `getTournamentCountdown()` (line ~3209). One-line removal.
- Remove dead ad-gated UI per "Game-over redesign" section.
- Update `docs/superpowers/bugs-defer-to-june.md` — mark M1 as resolved with commit SHA, leave M3 in place.
- Create `docs/superpowers/feature-backlog.md` recording deferred C-side ideas: enemy variants, share-card upgrade, daily streak, trail/accessory cosmetics, skin-reveal moment, slow-mo powerup, 2x-score powerup, "something else."

## Acceptance criteria

- All 10 polish events implemented and firing during normal play.
- Magnet powerup drops, attracts coins, expires correctly. Refresh-on-pickup works. No score-economy regressions.
- Game-over reveal sequences correctly for short runs and maximal runs. Skip-tap works. Hero score animates. Dead ad UI is gone.
- Audio helpers exist; per-event SFX are rewritten using them; reverb is wired and audible on tagged events.
- M1 deleted. `bugs-defer-to-june.md` updated. `feature-backlog.md` created.
- Unit tests pass.
- Manual playtest checklist passes.
- 60fps holds on a Pixel 4a-class phone during heavy moments.
- Zero server-side changes.
