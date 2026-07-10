# Faster Speed Progression — Design

**Date:** 2026-07-10
**Status:** Approved by owner (mid-tournament exception, see Fairness)
**Scope:** One-formula gameplay tuning + anti-tamper mirror sync + test mirror + docs

## Background

The 2026-07-09 fixed-60Hz-timestep fix (`688439a`) locked the simulation to its
designed rate. Players on 90/120Hz phones — the majority — had been playing at
1.5–2x effective speed, so the corrected game feels slow to them. The owner has
decided the difficulty ramp should be steeper so the game reaches its top pace
sooner.

## Decision

Speed ramp increment changes from **+0.15/level to +0.25/level**. The additive
cap stays **3.0**, so top speed remains **5.5** (baseSpeed 2.5 + 3.0), now
reached at **level 12 / score 110** instead of level 20 / score 190.

Explicitly unchanged:

- `baseSpeed: 2.5`, `gravity: 0.25`, `flapForce: -4.8`
- Pipe-gap schedule: `max(190 − level×4, 110)` — tightest at score 190
- Level formula: `floor(score/10) + 1`
- Endgame (score 190–500) plays identically to the current build

Speed at score (level = score/10 + 1):

| score | 0 | 50 | 100 | 110+ | 190+ |
|-------|-----|------|------|------|------|
| old | 2.65 | 3.40 | 4.15 | 4.30 | 5.50 |
| new | 2.75 | 4.00 | 5.25 | 5.50 | 5.50 |

## Fairness (mid-tournament exception)

The CLAUDE.md mid-tournament fix policy says: no changes that make post-change
runs harder than the conditions the leader's 240 was set under. This change
**breaks that rule for the 50–190 score band** (faster sooner = harder
mid-game). Owner-approved 2026-07-10 on the grounds that: (a) most players are
on high-refresh phones whose conditions were already reset by the timestep fix,
and (b) the endgame band where the leaderboard race actually lives (190–500) is
untouched. CLAUDE.md's policy section must record this exception.

## Implementation — one atomic commit

**1. `flappy_bert.html` `updateDifficulty()` (~line 2086):**

```js
G.gameSpeed = G.baseSpeed + Math.min(lvl * 0.25, 3);
```

**2. `flappy_bert.html` anti-tamper `expectedSpeed()` (~line 2496):**

```js
return EXPECTED.baseSpeed + Math.min(lvl * 0.25, 3);
```

CRITICAL: #1 and #2 must change together. The `G.gameSpeed` defineProperty
setter silently rejects writes above `expectedSpeed() + 0.5`; with only #1
changed, legitimate speed-ups are silently discarded and the game keeps the old
curve (worse: with only #2 changed, the game is unchanged but the gate loosens).

**3. New test mirror (repo convention, pure-JS replica):**

- `tests/lib/difficulty-curve.js` — exports `speedAtLevel(lvl)`,
  `gapAtLevel(lvl)`, `levelForScore(score)` with the NEW formulas.
- `tests/difficulty-curve.test.js` — locks: increment 0.25/level; cap 5.5
  reached at level 12; gap schedule unchanged (tightest 110 at level 20);
  updateDifficulty and expectedSpeed values agree at every level 1..60; a
  handful of exact point values from the table above.

**4. Docs:** CHANGELOG.md entry; CLAUDE.md — record the owner-approved
exception in the "Mid-tournament fix policy" section + bump test count.

## Verified NOT affected (checked 2026-07-10)

- **Server score validation** (`lib/score-validation.js`): the
  `MAX_SCORE_PER_SECOND: 5` gate was calibrated to cover the old frame-locked
  120Hz + 2x-multiplier worst case (~2x today's rates). Top speed is unchanged,
  so legit runs stay well inside it. No change; do not retighten mid-tournament.
- **Ghost challenges** (`lib/ghost-challenge.js`): score-target display only,
  no positional replay to desync.
- **Spawn systems** (coins/JEETS/frenzy/magnet): take `speed` as a parameter,
  scale automatically.
- **Bot cards / leaderboard / tiebreak:** score-domain only.

## Testing & rollout

1. TDD: write `tests/difficulty-curve.test.js` first (fails), add mirror, then
   make the two HTML edits.
2. Full `npm test` (119 → ~125, all green).
3. Browser smoke: play a run past score ~20 and assert `G.gameSpeed` exceeds the
   OLD expected value for that level — proves the anti-tamper gate accepts the
   new curve end-to-end.
4. Commit → push `origin/main` → Render auto-deploys.

## Risks

- **Anti-tamper drift** (the #1/#2 pair) — mitigated by the mirror test that
  pins both formulas and by the browser smoke test.
- **Player surprise:** mid-game suddenly pacier. Accepted; optionally announce
  via the bot later (out of scope here).
