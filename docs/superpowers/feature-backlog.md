# Flappy Bert — Feature Backlog

Aesthetic / gameplay ideas raised during the 2026-04-30 brainstorm but
deferred. Each is its own brainstorm → spec → plan cycle. Re-triage
when starting the next creative pass.

## Gameplay

### New enemy variants
**Homing variant SHIPPED 2026-05-29** as the HUNTER JEET (lazily tracks Bert's
altitude, lvl 4+). The fast **laser-beam JEET** is still open — revisit once the
HUNTER is validated in the wild.
Touches enemy AI / movement code. Spec needed for spawn rules and
balance against existing JEETS.

### Slow-mo powerup — DEFERRED (still open)
Considered for 2026-05-29 but deferred: confirmed the anti-tamper `gameSpeed`
setter rejects values below `baseSpeed`, so slow-mo can't mutate `gameSpeed` —
every read site (pipes, enemies, ground, Bert physics, spawn timer) needs a
slow_mo factor branch. Highest integration / core-feel risk; not worth pairing
with a difficulty-raising enemy in the same pass.

Pipes/JEETS slow to ~50% for ~3s. Best skill-expression moment.
Touches every speed/movement multiplier (anti-tamper-locked
`gameSpeed` is in the lock list — every consumer needs a slow_mo
factor branch). Higher integration cost than magnet was.

### 2x score window powerup — SHIPPED 2026-05-29
Shipped as the **FRENZY** powerup (8-second `scoreMultiplier = 2` window,
restores the prior shop multiplier on expiry; gold HUD pill + sun-ray aura).
As predicted it reused the `scoreMultiplier` infra cleanly; the only wrinkle was
save/restoring the shop multiplier and giving it a dedicated stacked HUD pill.

## Cosmetics

### Skin reveal moment
When a skin is unlocked or purchased, a "ta-da" sequence (current behavior:
just appears in shop). Touches shop flow + a new animation.

### Trail / accessory cosmetics
Visual unlocks (rainbow trail, glasses, halo) layered on top of skin tints.
Requires shop-row expansion + render pipeline for accessory layers.

### Daily login streak / cosmetic reward
Small loop to bring players back. Drops a cosmetic every N days.
Requires DB schema change (streak counter), bot reminder UX, UI for
streak status.

### Background palette nudge per level
Originally part of the 2026-04-30 aesthetic pass (Task 11) but
dropped during implementation — would conflict with the existing
time-of-day sky gradient + moon system. Future work needs to
either retire the day-cycle gradient or thread palette nudges
through it.

## Audio

### Music-loop polish
Originally Task 28 of the 2026-04-30 aesthetic pass (stretch
goal); dropped without an attempt because manual playtest was
unavailable in autonomous-mode and the risk of regressing the
existing music loop was non-trivial. Sub-octave on the lead +
LFO-modulated lowpass is the proposed direction.

## Sharing / outreach

### Share-card upgrade
The current `/api/share` and `leaderboard-card.js` produce a basic card.
A polished server-rendered run card showing PB, combo, tournament rank
that's actually beautiful, not a screenshot. Touches `leaderboard-card.js`
heavily.

## Operational follow-ups (not features but tracked here for visibility)

- **M3 deferred bug:** `/api/leaderboard/image` and `/api/player/:id/card`
  are unauthed canvas-render endpoints (DoS surface). Tracked in
  `bugs-defer-to-june.md`.
- **Tournament-DB cleanup:** prod has duplicate April rows
  (`april-flapoff-2026` and `april-fools-flapoff-2026`). Run
  `DELETE FROM tournaments WHERE id='april-flapoff-2026'` when convenient.
