# Flappy Bert

## What this is
Telegram Mini App game — tap-to-flap through pipes, collect coins, dodge JEETS enemies. Backend handles score tracking, leaderboards, tournaments, and Telegram bot commands.

## Tech stack
- **Frontend:** Single-file HTML5 Canvas game (`flappy_bert.html`) — vanilla JS, no framework
- **Backend:** Node.js + Express (`bot.js`) + better-sqlite3 (`db.js`)
- **Bot:** node-telegram-bot-api (polling mode)
- **Rendering:** `canvas` npm package for server-side leaderboard/stats card images (`leaderboard-card.js`)
- **Deploy:** Render (Docker), auto-deploys on push to `main`
- **DB:** SQLite at `/data/flappy_bert.db` (Render persistent disk) or `./flappy_bert.db` locally

## Deployment
Push to `main` on `thelegacyofbertfoundation-spec/Flappy-Bert` triggers Render auto-deploy.

```bash
git add <files> && git commit -m "message" && git push origin main
```

No manual deploy step needed. Render builds from Dockerfile.

## Key files
- `flappy_bert.html` — Entire game: HTML, CSS, Canvas rendering, game logic, shop, challenges, leaderboard UI, audio, anti-tamper (~3500 lines)
- `bot.js` — Express API server + Telegram bot commands + anti-cheat validation + tournament seeds
- `db.js` — SQLite schema, queries, leaderboard, tournaments, bans, admin functions
- `leaderboard-card.js` — Server-side Canvas rendering for leaderboard/player/tournament card images
- `render.yaml` — Render deployment config (Docker, persistent disk at `/data`)
- `Dockerfile` — Node 20 + native canvas deps (cairo, pango, etc.)

## ENV vars (set in Render dashboard)
- `BOT_TOKEN` — Telegram bot token (required)
- `WEBAPP_URL` — Public URL where the game HTML is hosted
- `PORT` — HTTP port (default 3000)
- `API_SECRET` — Required for admin endpoints. If unset, `/api/admin/*` and `/api/archive-now` return 503 (fail-closed since 2026-04-29). Set in Render dashboard with a long random value (e.g. `openssl rand -hex 32`).
- `ADMIN_IDS` — Comma-separated Telegram user IDs for admin commands

## Bot commands
- `/start` — Welcome message + play button
- `/play` — Launch Mini App
- `/leaderboard` — Weekly leaderboard card image
- `/mystats` — Personal stats card image
- `/tournament` — Tournament leaderboard card image
- `/help` — Command list
- `/ban <id>` — Admin: ban player
- `/unban <id>` — Admin: unban player
- `/removescores <id>` — Admin: wipe player's weekly scores
- `/resettournament` — Admin: wipe all tournament scores

## API endpoints
- `POST /api/session` — Start anti-cheat game session
- `POST /api/score` — Submit score (with Telegram initData HMAC validation)
- `GET /api/leaderboard` — Weekly leaderboard JSON
- `GET /api/player/:id` — Player stats JSON
- `GET /api/tournament/:id` — Tournament leaderboard JSON
- `POST /api/tournament/:id/score` — Submit tournament score
- `POST /api/share` — Send score card image to Telegram chat
- `GET /game` — Serves `flappy_bert.html`

## Tournaments (data-driven since 2026-04-29)
Tournament config lives in `tournaments.json` at project root, seeded into the SQLite `tournaments` table on bot startup via `tournaments-config.js` (idempotent — `INSERT OR IGNORE` on `id`). Adding a new tournament = append to the JSON and restart. No code changes.

- **Active config:** Champions Flap-off (ended), April Fools Flap-off 2026 (Apr 1–30 UTC), May The Flap Be With You (May 1–31 UTC), The Summer Session (Jun 1 – Sep 1 UTC, 3-month flagship).
- **Featured selection:** `/api/tournaments/featured` returns the prominent tournament for the home button using priority: live > upcoming<7d > recently_ended<14d. The mini-app's smart home button drives off `featured_state` (gold / silver / bronze).
- **Three-section overlay:** the tournament screen renders Live / Upcoming / Past sections with conditional rendering. Past entries are collapsible.
- **Persistent archive entry:** the menu has a "📜 PAST TOURNAMENTS" link that always opens the overlay scrolled to the past section, even when no tournament is featured.
- **Production note:** the prod DB has duplicate April rows (`april-flapoff-2026` + `april-fools-flapoff-2026` from prior deploys). The `/api/tournaments/featured` priority logic picks one when both are live; ops cleanup is a `DELETE FROM tournaments WHERE id='april-flapoff-2026'` when convenient.

## Roadmap
- **Recently shipped — The Summer Session Update (2026-05-29).** Homing HUNTER JEET (tracks altitude, lvl 4+), 2x-score FRENZY powerup (8s, restores prior shop mult), summer aesthetic (warm day sky + sun + brighter day clouds + gold menu season label that flips SEASON 3→4 at Jun 1), and The Summer Session tournament (Jun 1 – Sep 1 2026). Spec: `docs/superpowers/specs/2026-05-29-summer-session-update-design.md`. Plan: `docs/superpowers/plans/2026-05-29-summer-session-update.md`.
- **Recently shipped — Aesthetic / creative pass (2026-04-30).** Centralised `FX` module orchestrates particles, audio, screen shake/flash, DOM glow per moment. Magnet powerup (pipe-attached, ~3% from level 2, 5s auto-collect window). Game-over redesign: sequenced reveal with hero score (rainbow shimmer on new best). Pure Web Audio synth upgrades: ADSR / chord / sweep / noiseBurst helpers + synthesised reverb. Spec: `docs/superpowers/specs/2026-04-30-aesthetic-pass-design.md`. Plan: `docs/superpowers/plans/2026-04-30-aesthetic-pass.md`. Backlog of deferred ideas: `docs/superpowers/feature-backlog.md`.
- **Next session — re-triage `docs/superpowers/feature-backlog.md`.** Remaining top candidates: slow-mo powerup (deferred — gameSpeed-lock integration cost), a second enemy (laser JEET, once HUNTER is validated), share-card upgrade, daily login streak, palette-nudge per level.

## Game mechanics
- **Levels:** Every 10 pipes cleared = +1 level. Speed, gap, pipe interval scale with level, plateau at level 20. Level transitions fire a sweep banner + fanfare.
- **JEETS enemies:** Spawn from level 2. Cooldown system (min 3 pipes between spawns), drought ramp (5%→15%). Three sizes: normal (60%), 2x big (25%), 3x huge (15%). Unpredictable dual-wave movement with random direction changes. Spawn fires a brief red triangle warning at the right edge + low growl SFX. Dodging a JEET (it exits left without hitting) fires puff particles + whoosh. From level 4, ~30% of JEET spawns are the **homing HUNTER** variant (`type:'hunter'`, `homing:true`): magenta, size 1–2 only, slower in x; `baseY` lazily eases toward Bert (TRACK_GAIN 0.03, MAX_TRACK 1.6 px/frame) plus a small wobble, so it partially tracks on screen and is dodgeable with a late altitude change. Telegraphed by a longer magenta warning + rising sting; rendered with a targeting reticle + a lock-on tick pointing at Bert. Mirror logic: `tests/lib/homing-enemy.js`.
- **Moving pipes:** From level 8, 30% chance. Oscillate vertically.
- **Coins:** ~30% chance in pipe gaps (slightly reduced at higher levels, where magnet (lvl 2+) and frenzy (lvl 3+) roll ahead of coins in the spawn ladder). Near-miss bonus +3 coins (+ ghost trail and floater). Combo bonus every 5 pipes (+ rainbow floater + arpeggio).
- **Shield:** ~5.6% chance, once per game. Absorbs one hit. Shield-hit fires cyan shockwave + shatter SFX.
- **Magnet powerup (new 2026-04-30):** ~3% chance per pipe gap from level 2, mutually exclusive with coin spawn. Pickup activates a 5-second window during which on-screen uncollected coins auto-collect with a particle trail to Bert. Refresh-on-pickup (no stacking). HUD pill (top-right) shows countdown text + bar. Bert displays three rotating purple aura arcs while active.
- **Frenzy powerup (new 2026-05-29):** 2x-score window. ~2.5% chance per pipe gap from level 3, mutually exclusive with magnet/coin/shield (spawn band 0.03–0.055). Pickup sets `scoreMultiplier = 2` for 8s (`FRENZY_DURATION_FRAMES`), restoring the prior multiplier (`G._frenzyPrevMult`) on expiry. Refresh-on-pickup (no stacking; prev mult saved only on a fresh activate). Gold HUD pill stacked below the magnet pill (`top:52px`; both can be active at once), gold "2X" pipe token, rotating golden sun-ray aura. `scoreMultiplier` stays in {1,1.5,2} so it's anti-tamper + server compliant; `gameOver` stops tracking without altering the multiplier (honest submit). Mirror logic: `tests/lib/frenzy-timer.js`.
- **Shop:** Skins (color tints) and score multipliers (1.5x, 2x). Purchased with coins.
- **Daily challenges:** 3 random challenges, reset at UTC midnight.

## FX module (since 2026-04-30)
A single `FX` object in `flappy_bert.html` is the entry point for every visible/audible "moment". Each public method orchestrates particles + audio + screen shake/flash + DOM glow. `AudioSystem` carries the synth helpers (`_adsr`, `_chord`, `_sweep`, `_noiseBurst`, synth-reverb via `reverbSend`) plus per-event `fx*` methods. Particle soft-cap is `FX.PARTICLE_CAP = 150` — enforced at spawn time; the prior 80-cap render-loop FIFO was removed. Game-over flow: `FX.gameOverSequence(stats)` (sequenced reveal, skip-tap on overlay, cancel via `FX._goSeqCancel`).

## Game-over screen (since 2026-04-30)
- Markup is grouped into named `fx-go-step` sections (`title`, `hero`, `stats`, `rewards`, `actions`) revealed via a `setTimeout` chain over ~2.9s.
- Hero score is 64px gold with `fxHeroPunch` scale-in; `new-best` adds a rainbow `fxHeroShimmer` background gradient.
- Skip-tap any pointerdown on the overlay during reveal jumps to fully shown.
- PLAY AGAIN cancels the sequence via `FX._goSeqCancel()` at the top of `startGame()`.
- Dormant ad-gated UI (`continueWithAd`, `doubleCoinsWithAd`, `goContinueBtn`, `goDoubleCoins`, `G.adContinueUsed`, `G.adInterstitialCounter`) was removed in this pass.

## Anti-cheat / security
- **Telegram initData HMAC validation** — verifies player identity server-side using BOT_TOKEN
- **Anti-tamper properties** — `gravity`, `flapForce`, `baseSpeed`, `basePipeGap`, `pipeWidth`, `scoreMultiplier`, `gameSpeed`, `pipeGap`, `score`, `coins`, `combo`, `bestCombo`, `_scoreAccum` all locked with `Object.defineProperty`. Note: `G.powerups.magnet.{active,expiresAt}` is intentionally NOT locked (low risk, lock cost meaningful — see spec for rationale).
- **Game sessions** — server-issued session IDs, reuse detection
- **Score validation** — hard cap (500), time-based rate checks (scaled by scoreMultiplier: base 2.5/sec × mult), sessionless rejection (>30), too-fast rejection (>15). Frontend sends `scoreMultiplier` in score payload; server only accepts 1, 1.5, or 2.
- **Rate limiting** — per-IP: sessions 10/min, scores 10/min, shares 5/min
- **Player bans** — admin command, checked on score submission

## Important notes
- `flappy_bert.html` is a single monolithic file — all game code, styles, and markup in one place. This is intentional for Telegram Mini App simplicity.
- The Ad system (`AdSystem`) is a stub — `isRewardedReady()` always returns false. Continue/double-coins UI was removed during the 2026-04-30 aesthetic pass; only `AdSystem.init()` and `AdSystem.preload()` callsites remain (both stub-safe). When a real ad SDK is wired, re-introduce the UI.
- `API_BASE` in the frontend is empty string — API calls use relative URLs, so the game HTML must be served from the same origin as the bot API (the `/game` endpoint handles this).
- Canvas font "Press Start 2P" loaded from Google Fonts. Falls back to monospace if unavailable.
- The menu season label is gold (summer-themed) and **dynamic**: it shows "SEASON 3" until The Summer Session starts (Jun 1 2026 00:00 UTC), then auto-flips to "SEASON 4" via `updateSeasonLabel()` (called from `updateTournamentUI`'s 1s tick; boundary derived from the tournament's start time with `SEASON4_START_MS` fallback). The `.menu-season` label + `seasonGlow` keyframes are warm-gold themed. Mirror logic: `tests/lib/season-label.js`.
- Never add seasonal/theme text to BertBot NFT PFP generations — breaks art style.
- The `archives/` directory contains old versions of files. Don't modify.

## Tests
`npm test` runs `node --test tests/*.test.js`. Test mirror files in `tests/lib/` are pure-JS replicas of in-HTML logic (drift risk, accepted per the 2026-04-30 spec). Current count: 42 (18 tournaments-config + 4 spawn-cap + 4 magnet-timer + 3 sequence-runner + 5 frenzy-timer + 4 homing-enemy + 4 season-label).
