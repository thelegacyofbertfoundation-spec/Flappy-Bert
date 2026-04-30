# Flappy Bert — Feature Backlog

Aesthetic / gameplay ideas raised during the 2026-04-30 brainstorm but
deferred. Each is its own brainstorm → spec → plan cycle. Re-triage
when starting the next creative pass.

## Gameplay

### New enemy variants
A fast laser-beam JEET, or a homing JEET that lazily tracks Bert.
Touches enemy AI / movement code. Spec needed for spawn rules and
balance against existing JEETS.

### Slow-mo powerup
Pipes/JEETS slow to ~50% for ~3s. Best skill-expression moment.
Touches every speed/movement multiplier (anti-tamper-locked
`gameSpeed` is in the lock list — every consumer needs a slow_mo
factor branch). Higher integration cost than magnet was.

### 2x score window powerup
Score multiplier doubles for ~10 pipes. Cleanest mechanically (existing
`scoreMultiplier` infra including server-side validation that allows
1, 1.5, 2). Least visually exciting of the three powerup options.

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
