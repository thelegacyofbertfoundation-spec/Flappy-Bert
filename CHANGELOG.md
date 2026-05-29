# Flappy Bert Changelog

## 2026-05-29 — The Summer Session Update

Summer content drop launching alongside **The Summer Session** tournament
(2026-06-01 00:00 → 2026-09-01 00:00 UTC, 3 months). A new homing enemy, a new
2x-score powerup, and a harmonized summer glow-up of the world + menu.

### Headline changes

- **The Summer Session tournament** — data-driven entry in `tournaments.json`
  (`summer-session-2026`, Jun 1 – Sep 1 2026, sponsor Dr. Inker LABS). Shows in
  the Upcoming section now, becomes the live featured at 6/1 00:00 UTC, then
  recently_ended for 14 days after 9/1. No code change (bot seeds on restart).
- **Homing HUNTER JEET** — a new enemy variant that lazily tracks Bert's
  altitude. Spawns from level 4 (~30% of JEET spawns), size 1–2 only, slower in
  x so the tracking — not raw speed — is the threat. `baseY` eases toward Bert
  (TRACK_GAIN 0.03, MAX_TRACK 1.6 px/frame) with a small wobble, so it partially
  tracks on screen and stays dodgeable with a late altitude change. Magenta
  telegraph (longer-lived warning) + rising sting; magenta label + targeting
  reticle + a lock-on tick pointing at Bert. Reuses existing enemy collision/
  dodge (shield absorbs).
- **2x-Score FRENZY powerup** — pipe-attached token (~2.5% per gap from level 3,
  mutually exclusive with magnet/coin/shield). Sets `scoreMultiplier = 2` for an
  8-second window, restoring the prior (shop) multiplier on expiry. Gold HUD
  countdown pill stacked below the magnet pill (both can be active), a gold "2X"
  pipe token, a rotating golden sun-ray aura around Bert, dedicated pickup/
  activate/expire SFX. Anti-tamper compliant (the locked setter only accepts
  {1, 1.5, 2}); the multiplier submitted at game-over stays honest.
- **Summer aesthetic** — the day endpoints of the sky gradient warmed/brightened
  to a vivid-blue-crown → golden-horizon summer sky (night unchanged, so the
  day/night cycle still reads at low scores); a new sun that fades IN as day
  rises (mirror of the moon, which fades out), with soft animated rays + a warm
  radial glow; brighter, warm-white, puffier clouds by day; menu reskinned from
  "SEASON 3" to a gold "☀ SUMMER SEASON ☀".

### Tests

- +3 `tournaments-config` tests (real-file integration: Summer Session present &
  valid, live at 6/1 00:00:01, recently_ended after 9/1).
- +5 `frenzy-timer` + +4 `homing-enemy` pure-logic replica tests (TDD). The
  in-HTML logic mirrors these libs (drift-risk accepted per project convention).
- Suite: 26 → 38, all green.

## 2026-04-30 — Aesthetic / creative pass (Season 3)

The juice update. Centralised `FX` module orchestrates particles, audio,
screen shake/flash, and DOM glow for every in-game moment. New polish on
all the named events (coin pickup, pipe pass, combo, near-miss, shield hit,
level-up, JEET spawn, JEET dodge, game-over). New Magnet powerup with
auto-collect + particle trail. Game-over screen rebuilt as a sequenced
reveal with hero score (rainbow shimmer on new best). Pure Web Audio synth
upgrades (ADSR, chord, sweep, noiseBurst helpers + synthesised reverb).
Menu now shows SEASON 3.

### Headline changes

- **FX module + AudioSystem helpers** — single entry point for every
  visible/audible "moment"; ADSR / chord / sweep / noiseBurst primitives
  on AudioSystem; synthesised convolver reverb routed through `sfxGain`.
- **Magnet powerup** — pipe-attached token (~3% per gap from level 2),
  5-second active window with auto-collect of on-screen coins (purple
  trail to Bert), HUD countdown pill, rotating purple aura around Bert.
  Refresh-on-pickup; not anti-tamper-locked (low risk per spec).
- **Game-over redesign** — sequenced reveal (~2.9s) over named groups
  (`title` → `hero` → `stats` → `rewards` → `actions`), hero score
  punch-in + count-up, rainbow shimmer on new-best, skip-tap on overlay,
  PLAY-AGAIN cancels in-flight reveals.
- **All ten polish moments wired** — coinPickup, pipePass, combo (with
  rainbow-gradient floater), nearMiss (ghost trail + floater), shieldHit
  (cyan shockwave), levelUp (sweep banner + fanfare), jeetSpawn (red
  warning triangle + growl), jeetDodge (puff particles + whoosh).

### Bundled cleanup

- M1 deferred bug resolved — deleted `getTournamentCountdown()` stub.
- Removed dormant ad-gated UI: `goContinueBtn`, `goDoubleCoins` markup,
  `continueWithAd` and `doubleCoinsWithAd` functions, `G.adContinueUsed`
  / `G.adInterstitialCounter` plumbing, the interstitial-every-4th-game
  trigger from `showGameOverScreen`. `AdSystem` stub itself preserved.
- Removed pre-existing 80-particle FIFO cap in render loop; the new
  `FX.PARTICLE_CAP = 150` admission cap is now the actual ceiling.
- New `docs/superpowers/feature-backlog.md` capturing deferred ideas:
  enemy variants, slow-mo / 2x-score powerups, share-card upgrade, daily
  streak, trail/accessory cosmetics, skin-reveal moment, palette nudge
  per level (deferred — would conflict with the day-cycle sky), music
  loop polish (deferred — was Task 28 stretch).

### Out of scope (still deferred)

- M3 deferred bug — unauthed `/api/leaderboard/image` and
  `/api/player/:id/card` canvas-render endpoints (DoS surface).
- Tournament-DB ops cleanup — `DELETE FROM tournaments WHERE id='april-flapoff-2026'`.

### Tests

26/26 passing (was 19): added `tests/lib/spawn-cap.js` + 4 tests, 
`tests/lib/magnet-timer.js` + 4 tests, `tests/lib/sequence-runner.js` 
+ 3 tests. All test mirrors are pure-JS replicas of in-HTML logic; 
drift risk acknowledged in commit bodies.

Source spec: `docs/superpowers/specs/2026-04-30-aesthetic-pass-design.md`.
Source plan: `docs/superpowers/plans/2026-04-30-aesthetic-pass.md`.

## 2026-04-30 — Hot-path bug sweep

Audit + fix pass on the five hot paths (score submission, weekly leaderboard, tournament flow, mini-app rendering, Telegram admin). Audit report at `docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md`. 11 findings shipped; 2 deferred to June (`docs/superpowers/bugs-defer-to-june.md`).

### Critical (security & data integrity)

- **C1 — XSS in mini-app weekly leaderboard via Telegram first_name** (`1a6b66c`)
  Player with first_name `<img src=x onerror=alert(1)>` could pwn anyone opening the in-game RANKINGS overlay. Fixed by replacing `innerHTML` build with `_makeEl`/`textContent` DOM construction.

- **C2 — `/api/tournament/:id/score` had no anti-cheat or rate limit** (`0470d04`)
  Attacker could flood with score=499 submissions and claim #1 in any tournament. Now uses `validateScore`, `rateLimit(10, 60000)`, optional `init_data` identity verification, and `upsertPlayer` before submit.

- **C3 — `/api/share` was an open spam-as-the-bot primitive** (`99ea764` server, `76b0a2d` frontend)
  Anyone could send arbitrary photos with arbitrary HTML captions to any Telegram user who'd /start'd the bot. Now requires `init_data`, derives `chatId` from verified user, drops caller-supplied caption, drops `parse_mode: 'HTML'`.

### Important

- **I1 — Tournament submissions from new players were silently filtered** (`ca628b2` frontend; server-side covered by C2's `0470d04`)
  Mini-app now sends `first_name`/`username`/`init_data`/`scoreMultiplier` so server can `upsertPlayer` before tournament submit. INNER JOIN no longer drops phantom rows.

- **I2 — Game-over tournament pill diverged from submission outcome** (`1c58520`)
  Pill keyed on `FEATURED_TOURNAMENT.featured_state` while submit keyed on `ALL_TOURNAMENTS`. Now both read from the same source. Bonus: pill shows the actual live tournament's name (was hardcoded "CHAMPIONS FLAP-OFF").

- **I3 — Express rate limits were planet-wide due to missing trust-proxy setting** (`081d081`)
  Without `app.set('trust proxy', 1)`, `req.ip` returned Render's edge IP for every user, so all rate-limit buckets were shared globally. Now per-client.

- **I4 — Markdown injection in Telegram captions** (`5889c0f`, `06f4954` follow-up)
  Player and tournament names with `_`/`*`/`` ` ``/`[` broke the parse_mode and the entire `sendPhoto` 400'd. Added `escapeMarkdown` (V1-correct character class) applied at all interpolation sites. Also coerced WebApp game-over numeric fields to `Number`.

- **I5 — Score endpoints accepted negative/non-integer/non-numeric scores** (`ac0faaa`)
  `validateScore` now rejects with `reason: 'invalid_score'` if `score` isn't a non-negative integer. DB write coerces via `Number(score)`.

- **I6 — SQLite foreign keys were silently not enforced** (`044deb1`)
  Added `db.pragma('foreign_keys = ON')` at init. With C2/I1 in place upserting players before tournament submits, enabling FK is safe; new orphan rows are now impossible.

- **I7 — Auto-archive could permanently miss a week if bot was down across Mon 00:00 UTC** (`a20b346`)
  Boot-time recovery now iterates last 4 completed weeks and calls `archiveWeek` (idempotent — no-op when caught up). Bot restart no longer drops a CSV.

- **I8 — Leaderboard "you" highlight false-positived on `first_name === "Player"`** (`16acc03`)
  Server-side default first_name was `"Player"` for any sessionless submission; client-side fallback `entry.name === G.playerName` highlighted all of them as "you". Now: client keys on `telegram_id` only; server fallback is `Anon-NNNN` (last 4 digits of telegram_id).

### Deferred to June

See `docs/superpowers/bugs-defer-to-june.md`:
- M1 — Dead `getTournamentCountdown()` function (cosmetic cleanup)
- M3 — `/api/leaderboard/image` and `/api/player/:id/card` unauthed canvas-render endpoints (DoS surface, low traffic right now)

### Operations notes

- The fix to `/api/share` (C3) requires the mini-app to have been reloaded — older cached HTML still sends the old shape. The `Cache-Control: no-cache` header on `/game` (shipped 2026-04-29) means players will get the new HTML on their next page load.
- `bugs-defer-to-june.md` will be re-triaged at the start of the June creative pass.
