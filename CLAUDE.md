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
- `POST /api/score` — Submit score (REQUIRES verified Telegram initData; identity server-derived)
- `GET /api/leaderboard` — Weekly leaderboard JSON
- `GET /api/player/:id` — Player stats JSON
- `GET /api/tournament/:id` — Tournament leaderboard JSON
- `POST /api/tournament/:id/score` — Submit tournament score
- `POST /api/share` — Send score card image to Telegram chat
- `GET /api/config` — `{ botUsername }` (from `bot.getMe()`, cached at startup) so the client can build `t.me/<bot>?start=…` challenge links. Read-only.
- `GET /game` — Serves `flappy_bert.html`

## Tournaments (data-driven since 2026-04-29)
Tournament config lives in `tournaments.json` at project root, seeded into the SQLite `tournaments` table on bot startup via `tournaments-config.js` (idempotent — `INSERT OR IGNORE` on `id`). Adding a new tournament = append to the JSON and restart. No code changes.

- **Active config:** Champions Flap-off (ended), April Fools Flap-off 2026 (Apr 1–30 UTC), May The Flap Be With You (May 1–31 UTC), The Summer Session (Jun 1 – Sep 1 UTC, 3-month flagship).
- **Featured selection:** `/api/tournaments/featured` returns the prominent tournament for the home button using priority: live > upcoming<7d > recently_ended<14d. The mini-app's smart home button drives off `featured_state` (gold / silver / bronze).
- **Three-section overlay:** the tournament screen renders Live / Upcoming / Past sections with conditional rendering. Past entries are collapsible.
- **Persistent archive entry:** the menu has a "📜 PAST TOURNAMENTS" link that always opens the overlay scrolled to the past section, even when no tournament is featured.
- **Production note:** the prod DB has duplicate April rows (`april-flapoff-2026` + `april-fools-flapoff-2026` from prior deploys). The `/api/tournaments/featured` priority logic picks one when both are live; ops cleanup is a `DELETE FROM tournaments WHERE id='april-flapoff-2026'` when convenient.

## Roadmap
- **Recently shipped — Beat-My-Ghost challenge loop (2026-06-19).** A stateless, Telegram-native "challenge a friend" loop (from the creativity deep-dive). The whole challenge rides in a URL param — **zero new server state/schema**. Share builds `t.me/<bot>?start=g_<sharerId>_<score>`; the bot's `/start` deep-link branch (regex `parseGhost`) resolves the sharer's name from the id (`db.getPlayer`) and replies with a personalized challenge + a `web_app` Play button at `WEBAPP_URL?ghost=…`; the client reads `?ghost=` (or `start_param`), shows a **target pill** (rival + score, gold-pops when passed), a mid-run "PASSED <name>!" celebration, and a "YOU BEAT <name>!" game-over line + the "🎯 CHALLENGE A FRIEND" button (which doubles as challenge-back). The ghost param is **cosmetic/display-only** — it never touches score validation/coins/badges/writes; the shared link is built from the player's OWN verified id + clamped `G.score`. Pure helpers: `lib/ghost-challenge.js` (required by `bot.js` + tested; the client inlines a `parseGhost` mirror). New `GET /api/config` exposes the bot username. Built via subagent-driven TDD (5 tasks, per-task + clean final whole-branch review). Spec/plan: `docs/superpowers/{specs,plans}/2026-06-19-beat-my-ghost*`. Smokes: `tools/ghost-*-smoke.cjs`. **Note:** the share round-trip needs the live bot (`getMe` is null locally).
- **Recently fixed — tournament scores never recorded (2026-06-19).** Game-over fires `submitScoreToServer` + `submitTournamentScore` back-to-back with the SAME single-use `_gameSession` (`flappy_bert.html:2178-2179`); the weekly submit consumed the session, so the tournament submit was rejected (`session_reused`, later `no_session`). Fix: **per-board single-use** (`usedWeekly`/`usedTournament`) so one game records to both boards while replay stays blocked per board. Reproduced + verified by `tools/repro-tournament-bug.cjs`. (Pre-existing since single-use sessions; not caused by the security pass.)
- **Recently shipped — PixelLab sprite/aesthetic pass (2026-06-19).** Swapped placeholder art for curated PixelLab.ai pixel sprites, each drawn behind its prior fallback (load/decode failure degrades to the old art — never a broken render): an **animated 5-frame flap Bert** (animates the existing `SPRITE_B64` as the first frame, so all 8 tint-based skins inherit the animation for free; the procedural `drawTail` is skipped on the animated path since the frames bake in a tail), **green-dragon JEET + magenta HUNTER enemy sprites** replacing `fillText('JEETS')` (the homing reticle telegraph is kept), and **coin / magnet / frenzy / shield pickup sprites** replacing the procedural tokens (glow halos kept). World (pipes, parallax city, ground, FX) stays procedural by design. Generated + curated by a multi-agent workflow (per-asset generate-and-judge + adversarial cohesion panel). Spec: `docs/superpowers/specs/2026-06-19-pixellab-aesthetics-design.md`. See the sprite-pipeline note under Important notes.
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
**Hardened 2026-05-29 after a multi-agent red-team audit** (report: `docs/superpowers/audit-reports/2026-05-29-anticheat-redteam.md` — kept LOCAL, not committed: it documents live exploits). The trust boundary is the SERVER only — the client HTML is fully attacker-controlled, so client anti-tamper is best-effort, not a control. Enforcement logic lives in `lib/` (`score-validation`, `badge-allowlist`, `csv-cell`, `sanitize-name`), required by `bot.js`/`db.js` AND the tests (single source, no drift).
- **Telegram initData is MANDATORY** on `/api/session`, `/api/score`, `/api/tournament/:id/score` (`requireVerifiedUser`). Identity (`telegram_id`/`first_name`/`username`) is derived ONLY from the verified payload — body fields are never trusted. HMAC keyed on `BOT_TOKEN`; `auth_date` freshness ≤24h bounds replay.
- **Score validation** (`lib/score-validation` `scoreVerdict`) — server-trusted inputs only (body `scoreMultiplier`/`shieldUsed`/`adContinueUsed` IGNORED). HARD rejects: hard cap 500, `level` 1..1000, mandatory single-use session, `too_fast` (<2s), `score_exceeds_time` at a flat **5/sec** (covers legit 2x on 120/144Hz frame-locked play). `coins_earned` is COSMETIC (boards rank by score) so it's CLAMPED to a generous ceiling, never rejected (the combo bonus makes legit coins quadratic in score — clamping, not rejecting, avoids false-positives).
- **Game sessions** — minted only with valid initData; **single-use PER BOARD** (one weekly + one tournament submit per session, since one game over fires both `/api/score` and `/api/tournament/:id/score` with the same `_gameSession`; `validateScore(session, body, board)` checks/sets `usedWeekly`/`usedTournament` separately so both boards record but a replay to either board is rejected); 15-min TTL; `gameSessions`/`rateLimits` Maps bounded (50k, drop-oldest).
- **Render endpoints** (`/api/leaderboard/image`, `/api/player/:id/card`) — `rateLimit(20/min)` + bounded TTL `cachedRender` (closes the synchronous-canvas DoS).
- **Badges** — `allowedBadges` allowlist + score-gate + union-with-existing; `db.updatePlayerBadges` caps count/length; cleared on `/ban`. `express.json` 64KB global, 6MB only on `/api/share`.
- **CSV archive** — `csvCell` RFC-4180-quotes + formula-defangs every cell; `upsertPlayer` sanitizes names.
- **Admin** — fail-closed `authMiddleware` (503 if `API_SECRET` unset), constant-time secret compare; bot commands gated on `ADMIN_IDS` vs Telegram-authed `msg.from.id`. `/api/archives/:week` date-regex guarded.
- **Rate limiting** — per-IP: sessions 10/min, scores 10/min, shares 5/min, render 20/min, public reads (`/api/leaderboard`, `/api/player/:id`, `/api/tournament/:id`) 30/min, admin routes 10/min. (`/api/tournaments` + `/api/tournaments/featured` are intentionally unlimited — the client polls them every 5 min.)
- **Player bans** — admin command, checked on score submission against the verified id (evasion now needs a fresh phone-verified Telegram account).
- **Anti-tamper (client, best-effort)** — `gravity`/`flapForce`/`scoreMultiplier`/`score`/`coins`/… locked via `Object.defineProperty`. Assume bypassable; the server validation above is the real control.
- **Hardened again 2026-06-19 after a second multi-agent audit** (find → adversarial-verify → synthesize + independent code review). No criticals found; the 2026-05-29 controls held. Patched: rate-limited the 3 unauth read routes (synchronous-aggregation loop DoS); `?highlight` now honored only for in-board ids + LRU render cache (render-flood); terminal error handler + `NODE_ENV=production` (no stack/path leak); `level` clamped to `floor(score/10)+1` (no fake MAX LEVEL); default min-score gate on the 4 ungated achievement badges (no score-0 self-award); `/api/share` rejects banned players + validates PNG magic bytes (body limit 6→2mb); admin routes rate-limited; `nosniff`/`Referrer-Policy` headers (NOT `X-Frame-Options` — the game is framed inside Telegram's webview). The audit's "HIGH un-indexed-query DoS" was recalibrated to MEDIUM (indexes `idx_scores_week`/`idx_scores_player`/`idx_tscore_tournament` already exist).
- **Known residual / deferred:** a *verified* account can still wait ~100s on an aged session to submit the 500 cap (bounded by the cap + ban-able identity; full fix = server-side gameplay checkpoints). The 24h `auth_date`/initData replay window is **kept deliberately** (tightening to ~1h risks rejecting a legit long-open mini-app; the replay only lets you act as that already-attested user, subject to all anti-cheat). Coin totals can be farmed by repeated cap submits (coins are cosmetic — boards rank by score — so this is accepted; a per-week coin ceiling is the fix if it ever matters). Audit #7 (split the polling bot into a separate process) is deferred — the render DoS is closed by rate-limit+cache. The `web_app_data` sendData score-write was REMOVED (unvalidated, session-less; the client submits via HTTP `/api/score`).

## Important notes
- **PixelLab sprite pipeline (2026-06-19).** Character/enemy/powerup art is generated via PixelLab.ai and embedded as base64 in `flappy_bert.html` (block marked `// ===== PixelLab aesthetic pass`). Helpers: `bertFlapReady()`/`bertFlapIndex()`/`bertFlapFrames` (5-frame flap) and `PL_SPR`/`plReady(key)` (jeet, hunter, magnet, frenzy, shield, coin). EVERY sprite draw is `if (ready) drawImage(...) else <prior procedural/static draw>`, so missing art never breaks a render. Source PNGs live in `assets/pixellab/` (+ `assets/base-bert.png`, the decoded legacy sprite used as the flap seed). Regenerate with `node tools/pl-gen.mjs sprite|animate ...` (lean wrapper over bert-mmo's `lib/pixellab.mjs`, Flappy's own palette, key at `/opt/bert-mmo/scripts/.pixellab.key`), re-embed with `node tools/inject-sprites.mjs` (idempotent), and smoke-test with `node tools/render-smoke.cjs` (node-canvas composite) + `node tools/browser-smoke.cjs` (real chromium boot — needs `~/.cache/ms-playwright` chromium + playwright from `/opt/facelift/node_modules`). This pass added no unit tests (pure asset/render change, covered by the render smokes).
- `flappy_bert.html` is a single monolithic file — all game code, styles, and markup in one place. This is intentional for Telegram Mini App simplicity.
- The Ad system (`AdSystem`) is a stub — `isRewardedReady()` always returns false. Continue/double-coins UI was removed during the 2026-04-30 aesthetic pass; only `AdSystem.init()` and `AdSystem.preload()` callsites remain (both stub-safe). When a real ad SDK is wired, re-introduce the UI.
- `API_BASE` in the frontend is empty string — API calls use relative URLs, so the game HTML must be served from the same origin as the bot API (the `/game` endpoint handles this).
- Canvas font "Press Start 2P" loaded from Google Fonts. Falls back to monospace if unavailable.
- The menu season label is gold (summer-themed) and **dynamic**: it shows "SEASON 3" until The Summer Session starts (Jun 1 2026 00:00 UTC), then auto-flips to "SEASON 4" via `updateSeasonLabel()` (called from `updateTournamentUI`'s 1s tick; boundary derived from the tournament's start time with `SEASON4_START_MS` fallback). The `.menu-season` label + `seasonGlow` keyframes are warm-gold themed. Mirror logic: `tests/lib/season-label.js`.
- Never add seasonal/theme text to BertBot NFT PFP generations — breaks art style.
- The `archives/` directory contains old versions of files. Don't modify.

## Tests
`npm test` runs `node --test tests/*.test.js`. Test mirror files in `tests/lib/` are pure-JS replicas of in-HTML logic (drift risk, accepted per the 2026-04-30 spec). Current count: 75 (18 tournaments-config + 14 score-validation + 7 badge-allowlist + 6 sanitize-name + 6 csv-cell + 5 fx-frenzy-timer + 4 season-label + 4 homing-enemy + 4 fx-spawn-cap + 4 fx-magnet-timer + 3 fx-game-over-sequence). The score-validation + badge-allowlist suites include the 2026-06-19 security regressions (level→score clamp, ungated-badge min-score gate).
