# PixelLab Aesthetic Pass — Design

**Date:** 2026-06-19
**Status:** Implemented (full-auto execution authorized by owner)

## Goal
Use the PixelLab.ai pixel-art generation API (already integrated in bert-mmo) to upgrade
Flappy-Bert's character/sprite art **without regressing** the hand-tuned neon night-city look.
Flappy-Bert is a natively-2D canvas game, so PixelLab's transparent pixel sprites drop in via
the same base64-in-HTML pattern the game already uses for `SPRITE_B64`.

## Decisions (owner-selected, then delegated to full-auto)
- **Scope:** full character pass — Bert flap animation, JEET + HUNTER enemies, powerup pickups.
- **Art direction:** *faithful HD upgrade* — stay on-model (canonical Bert: orange bucket hat,
  blue hoodie cat-bear), match the existing neon palette. "Same game, sharper + animated."
- **Ship gate:** curate-then-auto-ship to `main` (deploys to Render). Owner accepted the risk;
  mitigated by hard quality gates + graceful fallbacks (see below).

### Autonomous engineering calls
- **Bert flap = animate the EXISTING `SPRITE_B64`** as the first frame → guaranteed on-model.
- **Skins stay tint-based.** All 8 skins tint the one base sprite; once the base is animated,
  every skin inherits the animation for free and stays cohesive. Bespoke per-skin PixelLab Berts
  were dropped — they risk off-model/inconsistent results (some crafted, some tinted) on a live
  game. Better engineering than the menu option; full-auto delegated the call.
- **World stays procedural.** Pipes, parallax city, ground, gradients, FX are already cohesive
  and *dynamic*; static sprites would be lateral-or-worse + add tiling cost. Out of scope.

## Asset list
| Asset | Endpoint | Source | Replaces |
|---|---|---|---|
| Bert flap (5 frames, 246×100) | `animate-with-text-v3` | existing sprite as first frame | static rotating PNG in `drawBert` |
| JEET enemy | `create-image-pixflux` | text prompt | `fillText('JEETS')` (line ~3197) |
| HUNTER enemy (magenta) | `create-image-pixflux` | text prompt | magenta `fillText` + reticle |
| magnet / frenzy / shield / coin pickups | `create-image-pixflux` | text prompt | procedural tokens (lines ~3084-3164) |

## Pipeline (the "team of agents")
1. **Setup (main loop):** branch `feat/pixellab-art-pass`; decode `SPRITE_B64` →
   `assets/base-bert.png`; lean generator `tools/pl-gen.mjs` (reuses bert-mmo's pure
   `lib/pixellab.mjs` body builders but with Flappy's OWN neon palette as `color_image`, and NO
   master-palette art-gate).
2. **Bert flap (main loop):** animate the existing sprite; vision-judge; ship.
3. **Workflow `flappy-pixellab-art` (parallel agents):** one generate+curate agent per
   exploratory asset (JEET, HUNTER, magnet, frenzy, shield, coin). Each: generate via
   `pl-gen.mjs` → READ the PNG to vision-judge → reroll (≤3) → **ship or SKIP**. Then an
   **adversarial cohesion panel** (palette / readability / theme lenses) majority-votes; an asset
   ships only with ≥2 passes.
4. **Integrate (main loop):** base64-embed survivors; swap each draw call to "draw sprite if
   loaded, else existing procedural/static code." Bert flap cycles frames by `frameCount`; drops
   the procedural tail on the animated path; keeps tint-for-skins + velocity rotation.
5. **Verify:** `npm test` (42 tests stay green) + headless render smoke (boots, no console
   errors, sprites render) + before/after contact sheet.
6. **Ship:** merge to `main`, push (Render auto-deploy).

## Quality gates / safety (auto-ship is gated, not reckless)
- **Hard bar:** an asset ships only if it passes the per-asset judge AND the cohesion panel;
  anything failing is **skipped** (current art stays). Worst case = no change, never a regression.
- **Graceful fallback:** every new sprite renders behind the existing static/procedural draw, so
  a load/decode failure degrades to today's art — never a broken render.
- **Pre-push verification:** tests green + render smoke clean are preconditions to push.
- **One-commit revert:** the whole pass is one mergeable change; revert + push restores instantly.

## Out of scope
Bespoke skin sprites, world/background sprites, pipe sprites, audio, gameplay changes.
