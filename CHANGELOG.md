# Flappy Bert Changelog

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
