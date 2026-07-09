# Flappy Bert — Future Improvements Memo

Consolidated from the 2026-07-09 five-dimension critique (design / frontend /
backend / UX / tests) + hands-on verification. The mid-tournament-safe subset
already shipped that day (see CHANGELOG). Everything below is still open.

Companion docs: `CLAUDE.md` §"Mid-tournament fix policy" (the hard gate),
`docs/superpowers/feature-backlog.md` (older creative ideas, still valid),
`docs/RESEARCH_LOG.md` (session history).

---

## 🚦 GATED: do NOT ship before Sep 1 (Summer Session ends)

These change difficulty or competitive access mid-race and would advantage
scores already on the board. Ship together at the season boundary, announced
as next season's rules.

1. **Remove the shop 2x multiplier's effect on tournament scoring.**
   A 750-coin consumable halves the pipe-passes needed to reach the 500 cap on
   a board paying real USD. Options: multiplier applies to weekly board only;
   or becomes coin-multiplier instead of score-multiplier; or tournament
   submits divide out the shop multiplier server-side (client already keeps it
   honest in {1,1.5,2}). Decide alongside #3 — the multiplier is the main coin
   sink.
2. **Extend the difficulty curve past level 20.** Speed/gap/interval all
   plateau at score 200 while the cap is 500 — the last 60% of the range is a
   flat endurance grind that funnels skilled players onto the cap (where ties
   decide money). Ideas: resume gentle speed scaling to level 50, introduce the
   laser JEET (backlog) at lvl 25+, or reduce coin spawns to zero at plateau.
   Revisit whether the 500 cap itself should rise with a harder curve.
3. **Coin economy rebalance.** Three coupled defects:
   - *Double-count bug:* near-miss/combo/magnet/shield coins are credited live
     AND banked again at game over via `G.coins += G.coinsEarned`
     (flappy_bert.html ~:2213 vs :2779/:2800/:2590/:3013). Base pipe coins and
     gap pickups are single-counted — inconsistent. Related: the anti-tamper
     coins setter silently drops live combo bonuses >10, so the +N floater
     lies.
   - *Quadratic faucet:* combo bonus grows with the counter — a score-100 run
     nets ~1,400 coins vs a 915-coin one-time skin catalog. Currency is dead
     after day one, which guts the streak/challenge return loop.
   - *No recurring sink:* add one (rotating seasonal cosmetics, tournament
     entry cosmetic stakes, upgradeable trail FX). Balance target: catalog
     exhaustion should take weeks, not one session.
4. **Tighten the server score-rate cap (5/sec → ~3/sec).** Only safe once the
   fixed-timestep client has fully rolled out (no cached 120Hz client can then
   legitimately score ~10/sec). Check Telegram webview cache behavior before
   assuming rollout; give it ≥2 weeks after deploy.

## 🔴 High value, safe anytime

- **Split the polling bot from the API process** (2026-06-19 audit item #7,
  deferred twice). One process = a bot fault degrades score submits. Two
  services sharing the SQLite file (WAL mode) or a tiny IPC. Also unlocks
  restarting the bot without dropping in-flight sessions (gameSessions Map is
  in-memory — consider persisting sessions or accepting the loss window).
- **bot.js integration test coverage.** The auth/session/rate-limit/admin
  surface (two red-team audits' worth of controls) has ZERO regression tests.
  `tools/repro-tournament-bug.cjs` already proves the pattern — sandbox it
  (FLAPPY_DATA_DIR temp dir now exists for exactly this), parameterize the
  cwd, and promote it into `npm test`. The 2026-07-09 verification's
  forged-HMAC HTTP driver (session mint → dual-board submit → tie ranking →
  replay/tamper rejection) is a ready-made spec for it.
- **Out-of-Telegram experience.** A shared link opened in a plain browser is a
  silent trap: mobile plays but scores never save (no notice — submit
  early-returns before the "didn't save" toast); desktop hard-blocks on an
  unsatisfiable ROTATE YOUR DEVICE wall. Add an "Open in Telegram" CTA +
  a "scores won't save here" banner; let desktop reach the menu.
- **Score-table growth + reset-boundary index.** `scores`/`tournament_scores`
  are never pruned and every board read is a full GROUP BY over them; the
  Summer Session's `played_at >= since` filter has no supporting index and the
  dormant pre-reset rows are scanned for the whole 3-month flagship. Add
  `(tournament_id, played_at)` index + a prune/archive job for weeks older
  than N.

## 🟡 UX / retention (safe anytime, bundle into a polish pass)

- **Challenge progress counters** — "3/5 near-misses" instead of a binary
  IN PROGRESS; the daily loop currently gives no sense of closeness.
  Also scale challenge targets to the player's recent best (score-10 challenge
  is noise for a 100-scorer) and drop/raise the trivially-auto-completed
  coins-20/40 and play-N-games variants.
- **Game-over SHOP/RANKS should return to the game-over card**, not dump to
  menu — players who check the shop after a run lose the one-tap PLAY AGAIN.
- **Hold-to-fly reminder** — the jetpack-hold nuance is taught once (first
  session) and never reinforced; returning players tap-tap like classic Flappy
  and get weak lift. Cheap fix: occasional "HOLD to fly higher" toast when
  many short taps are detected.
- **Shop previews undersell** — skins render as flat color circles though
  fire/matrix/cosmic have real particle effects in-game. Tiny animated preview
  or effect badge. Cosmetic depth generally thin (8 tints) — ties into the
  economy sink work (#3 above).
- **Huge-JEET fairness check** — a size-3 JEET (~42px) with ~78px combined
  wave travel + random reversals inside a 110px floor gap is plausibly
  undodgeable. Playtest at level 20+; if confirmed, cap erratic-wave size or
  make spawns gap-aware. (Difficulty-adjacent: if it makes the game EASIER
  it's still fine mid-tournament, but bundle with #2 to be safe.)

## 🟢 Engineering hygiene (small, anytime)

- **Fix drifted test mirrors:** `tests/lib/spawn-cap.js` lacks the real
  `vx0/vy0` offsets and `glow` flag of `FX._spawnParticles`;
  `tests/lib/sequence-runner.js` tests a generic timer chain, not the actual
  9-step game-over choreography (real timings/DOM/doneId untested).
- **Portable tooling:** 5 smoke scripts hardcode
  `/opt/facelift/node_modules/playwright`; `tools/pl-gen.mjs` hardcodes
  `/opt/bert-mmo` paths+key. Add playwright as a devDependency (or an env
  override) so the sprite pipeline's only verification isn't box-specific.
- **Weekly boundary tests:** `db.js` `getWeekStart`/`getNextMondayUTC` and the
  auto-archive cron (`checkAutoArchive`/`recoverMissedArchives`) have no
  tests, unlike the near-identical tournament-reset helpers.
- **Perf nits (low-end devices):** per-frame `screenFlash` style write even at
  alpha 0; a setTimeout per pipe-pass for the score-bump class; uncapped
  devicePixelRatio makes full-canvas redraw scale 3-4x on high-DPI. Cheap wins
  on exactly the devices that struggle.
- **Cruft:** startup `deleteTournament('april-flapoff-2026')` one-time fix
  runs forever (bot.js:219) — remove after confirming prod DB is clean;
  `tournaments-config.js` accepts fractional prize values that render as
  "$33.33" (add integer check); consider a per-week coin ceiling if coins ever
  stop being cosmetic.

## 📊 Post-deploy watches (from 2026-07-09)

- Render logs: throttled `polling_error` lines should be rare after deploy
  overlap settles; any `Unhandled promise rejection (kept alive)` line is a
  bug to chase (it means a send escaped the safeSend sweep).
- Watch for the first 500-cap score — the tiebreak is untested at the cap in
  prod (unit-proven only). When two players cap, verify the card order matches
  earliest-achievement and the prize announcement uses it.
- 120Hz players' scores may RISE after the timestep fix (they were playing a
  2x-hard game) — expected, not cheating. Frame-throttle exploiters' scores
  should stop climbing.
