# Hot-path audit — 2026-04-30

## Coverage table
| Hot path | Files read | Approx lines covered |
|----------|-----------|----------------------|
| 1. Score submission | bot.js, db.js, flappy_bert.html | bot.js 40-143, 604-690; db.js 86-143; html 3644-3705, 1492-1496 |
| 2. Weekly leaderboard | bot.js, db.js, leaderboard-card.js | bot.js 252-281, 565-586, 692-720, 942-964; db.js 147-200, 305-345; leaderboard-card.js 1-493 |
| 3. Tournament flow | bot.js, db.js, tournaments-config.js, flappy_bert.html | bot.js 180-186, 395-417, 443-528, 793-873; db.js 202-263; tournaments-config.js 1-92; html 490-512, 3115-3397, 3382-3397 |
| 4. Mini-app rendering | flappy_bert.html | 480-630, 1180-1258, 1492-1629, 1700-1857, 2820-2860, 3115-3397, 3592-3705 |
| 5. Telegram admin | bot.js, db.js | bot.js 346-417, 592-602, 882-921; db.js 265-301 |

## Findings

### Critical (3)

- **C1: XSS in mini-app weekly leaderboard via Telegram first_name**
  - Location: `flappy_bert.html:3622` (renderLeaderboard)
  - Problem: Every player who opens the in-game `RANKINGS` overlay executes attacker-controlled HTML in their browser/WebApp. Account takeover, coin/data exfil from localStorage, and silent score-padding via the same authenticated session are all reachable.
  - Root cause: `html += '<div class="lb-name">' + (isYou ? '\u{25B6} ' : '') + entry.name + '</div>';` — `entry.name` is populated from `fetchServerLeaderboard()` (line 3711), which copies the raw `first_name` / `username` returned by `/api/leaderboard`. The string is interpolated into `lbPanel.innerHTML` at line 3628 with no escaping. `renderLeaderboard()` is the only renderer in the bunch that uses `innerHTML` interpolation; the tournament renderers at lines 3349-3380 already use `_makeEl(... { text: ... })` (textContent) and are safe. Telegram first_name accepts arbitrary unicode including `<`, `>`, `"` — there is no client-side first_name validation.
  - Proposed fix: Replace the innerHTML build with DOM-construction equivalent to `_makeEl('div', { text: entry.name })`, mirroring the tournament code path that already exists in this file. Alternatively, add a `escapeHtml(s)` helper applied to `entry.name` (and `medal` is fine — it's a controlled emoji literal). DOM construction is preferred because it removes the whole class of bug from this overlay.
  - Effort: S
  - Production reproduction: Set your Telegram first name to `<img src=x onerror=alert('xss')>`, play one game so the score lands on the public weekly leaderboard, then any other player who opens the in-game `RANKINGS` overlay (or `🏆 RANKINGS` button) will execute the payload. Curl version of the inserted data: `curl https://<deploy>/api/leaderboard?limit=20 | jq '.entries[].first_name'`.

- **C2: /api/tournament/:id/score has no anti-cheat beyond the 500 hard cap and no rate limit**
  - Location: `bot.js:840-873` (lines 840-873)
  - Problem: An attacker with any valid `telegram_id` (e.g. their own) can flood the tournament with score=499 submissions and unconditionally claim the top spot. There's no MIN_GAME_DURATION, no time-vs-score sanity check, no shield/ad bookkeeping, and no rate-limit middleware. This is the same surface that `/api/score` defends with `validateScore()` and `rateLimit(10, 60000)`, missing here.
  - Root cause: The handler hand-rolls a "lite" check (lines 860-868): only `score > MAX_ABSOLUTE_SCORE` and a session-owner mismatch test. Crucially, `if (session && session.telegramId !== telegram_id)` only triggers when a session exists; submissions with no `session_id` (or stale id) skip the check entirely. There is no `app.post('/api/tournament/:id/score', rateLimit(...), ...)` either — the rate-limit middleware is wired only for `/api/score`, `/api/session`, and `/api/share`.
  - Proposed fix: Reuse `validateScore(session, body)` here (it's already exported at module level). Wrap the route in `rateLimit(10, 60000)` like `/api/score`. Also call `db.upsertPlayer(...)` before `db.submitTournamentScore(...)` so first-time mini-app users actually appear on the leaderboard (see I1). Lift `init_data` Telegram identity verification from `/api/score` (lines 644-649) into this handler too — copy/paste, no new dep.
  - Effort: S
  - Production reproduction: `for i in $(seq 1 200); do curl -s -X POST https://<deploy>/api/tournament/april-fools-flapoff-2026/score -H 'content-type: application/json' -d '{"telegram_id": 7137489161, "score": 499, "level": 50}'; done` — every request returns `{ok:true, rank:1}` and the leaderboard is poisoned.

- **C3: /api/share lets anyone send arbitrary photos with arbitrary captions to any Telegram user who has /start'd the bot**
  - Location: `bot.js:759-786`
  - Problem: Spam / phishing primitive. The endpoint accepts an arbitrary `telegram_id` as the destination chat plus an arbitrary base64 image and arbitrary caption (with `parse_mode: 'HTML'`). No auth, no Telegram identity verification, no ownership check — only a 5/min rate limit which is itself broken (see I3). An attacker sweeps known telegram_ids from the public leaderboard (`/api/leaderboard` returns them) and uses the bot account to deliver any image plus a phishing caption with hyperlinks (`<a href="...">click</a>` is allowed under HTML parse mode) to those users. The bot account is the perceived sender, so the message looks legitimate.
  - Root cause: No `init_data` verification and no equivalence check between caller identity and `telegram_id`. The endpoint trusts the request body. Even if you are the user calling /api/share for yourself, you should send to your *own* chat — the chat_id should be derived from the verified initData, not from the request body.
  - Proposed fix: Require `init_data` in the request body, run it through `validateTelegramInitData()`, derive `chatId = verified.id`, and ignore any `telegram_id` from the body. Optionally, also restrict caption to `parse_mode: 'Markdown'` with the image+score template only — no caller-supplied caption — to remove the phishing payload surface entirely.
  - Effort: S
  - Production reproduction: Pick a victim's telegram_id from `curl https://<deploy>/api/leaderboard?limit=50 | jq '.entries[].telegram_id'`. Then `curl -X POST https://<deploy>/api/share -H 'content-type: application/json' -d '{"telegram_id": <victim_id>, "image_base64": "<a 1x1 transparent png base64>", "caption": "Click here to claim your prize: <a href=\"https://attacker.example/\">drinkerlabs.info/claim</a>"}'`. Bot delivers the phishing message to the victim.

### Important (8)

- **I1: Tournament score handler skips db.upsertPlayer — first-time submitters don't appear on the leaderboard**
  - Location: `bot.js:840-873` (specifically the missing call before line 870)
  - Problem: A new user who opens the WebApp link directly (without ever running `/start` and without the mini-app's `submitScoreToServer` call winning the race against `submitTournamentScore`) gets their tournament_scores row written, but the `players` row never exists. `db.getTournamentLeaderboard` (db.js:234-251) does an INNER JOIN on `players p`, so the row is silently filtered from the leaderboard. The user sees their own rank via `getTournamentPlayerRank` (which doesn't JOIN), but the public leaderboard never shows their name. They appear to have submitted a phantom score.
  - Root cause: `flappy_bert.html:1494-1495` fires `submitScoreToServer` and `submitTournamentScore` in parallel (no `await`), so order is undefined. `/api/score` does `db.upsertPlayer(...)` (bot.js:675), but `/api/tournament/:id/score` does not.
  - Proposed fix: Add `db.upsertPlayer(telegram_id, first_name || 'Player', username || null)` right before `db.submitTournamentScore` in the handler. Accept `first_name` and `username` from the request body the same way `/api/score` does, and have the mini-app's `submitTournamentScore` (html:3382-3397) include them in the body.
  - Effort: S
  - Production reproduction: With a fresh test telegram_id that has never used the bot, `curl -X POST https://<deploy>/api/tournament/april-fools-flapoff-2026/score -H 'content-type: application/json' -d '{"telegram_id": 99999999, "score": 50, "level": 5}'`, then `curl https://<deploy>/api/tournament/april-fools-flapoff-2026 | jq '.entries'` — the row submitted is absent.

- **I2: finalGameOver pill/submit divergence (pre-known)**
  - Location: `flappy_bert.html:1616` (status check) vs `flappy_bert.html:3383` (submission)
  - Problem: The "🏟 CHAMPIONS FLAP-OFF — SCORE SUBMITTED!" pill in the gameover screen reads `getTournamentStatus()` (line 3208), which is derived from `FEATURED_TOURNAMENT?.featured_state === 'live'`. `submitTournamentScore` (line 3383) instead does `ALL_TOURNAMENTS.find(t => t.status === 'live')`. The two sources are populated by different `/api/...` calls and by different state machines (FEATURED_TOURNAMENT comes from `/api/tournaments/featured` with a 7d-window filter; ALL_TOURNAMENTS comes from `/api/tournaments` with raw start/end). At a rollover boundary they can disagree — pill shows submitted but no submit happened, or vice versa. Player will file this.
  - Root cause: Two independently maintained "is a tournament live right now" oracles.
  - Proposed fix: Make finalGameOver's pill key off the same `ALL_TOURNAMENTS.find(t => t.status === 'live')` value that `submitTournamentScore` uses (or have `submitTournamentScore` return a boolean and store it on a local var). One source of truth.
  - Effort: S
  - Production reproduction: At any tournament `endTime` boundary (e.g. `2026-04-30T23:59:59Z` for april-fools-flapoff-2026), if the user finishes a game in the ~5 minute window where the server cron hasn't refreshed but the client hydrate is stale (or vice versa), the pill says SUBMITTED but the POST 400's with "Tournament not active", or the pill is hidden but the POST succeeds.

- **I3: Express rate-limit middleware uses req.ip without `app.set('trust proxy', ...)` — entire planet shares one rate-limit bucket**
  - Location: `bot.js:160-171` (rateLimit factory) plus the missing `app.set('trust proxy', ...)`
  - Problem: Render runs the app behind a proxy. Without `trust proxy`, `req.ip` is the proxy's address, identical for every real user. That means `/api/score` (10/min), `/api/session` (10/min), and `/api/share` (5/min) cap out planet-wide at 10, 10, and 5 requests/min respectively. During any small spike, legitimate users get 429s. Operator would file a "scores aren't saving" report.
  - Root cause: `bot.js` never calls `app.set('trust proxy', true)` (or the safer `1` for one hop). The rateLimit factory at line 162 just does `const key = req.ip;`.
  - Proposed fix: Add `app.set('trust proxy', 1);` near `app.use(cors())` (line 155). Verify `req.ip` resolves to the upstream client IP after deploy by logging once.
  - Effort: S
  - Production reproduction: From two different ISPs, simultaneously submit 6 scores each in the same minute. After the 11th total submission cluster-wide, all subsequent /api/score calls return 429 until the window rolls. (For a quick sanity check post-deploy: `curl https://<deploy>/api/health` and observe the access log — the logged IP should match the caller, not Render's edge.)

- **I4: Markdown injection in /tournament Telegram caption (pre-known)**
  - Location: `bot.js:518` (caption template) — also reachable via tournaments.json operator config and the future tournament name surface
  - Problem: `chosen.name` and `chosen.sponsor` (operator-provided JSON, but also future-proofing-relevant) are interpolated into a Telegram Markdown caption: `🏟 *${chosen.name}*\nSponsored by ${chosen.sponsor}\n\n${statusText}${rankText}\n\nUse /play to compete!`. Telegram's Markdown parser is unforgiving — any `*`, `_`, `[`, `` ` `` in name/sponsor unbalances the markup and the entire `sendPhoto` rejects with 400, so the user gets the generic `❌ Failed to generate tournament leaderboard.` instead of the card. With operator-only config this is mostly an operational footgun, but if tournament names ever get sourced from a webhook/admin command, this becomes an injection surface (closed-link, reply-keyboard markup, etc.).
  - Root cause: No escaping of Telegram-Markdown special chars before `parse_mode: 'Markdown'` interpolation. The same risk exists at `bot.js:369, 389, 412, 433` for player first_name in admin /ban, /unban, /resettournament, /history captions.
  - Proposed fix: Add a small `escapeMarkdown(s)` helper (`s.replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1')`) and apply it to `chosen.name`, `chosen.sponsor`, and the player-name interpolations in the admin handlers. Or switch these to `parse_mode: 'HTML'` and escape with the (much smaller) `<>&"` set. HTML is the safer default for caption surfaces with user-supplied substrings.
  - Effort: S
  - Production reproduction: Edit `tournaments.json` to set a tournament name to `Test *Bold*` (or with `_` underscores), restart the bot, run `/tournament test` from Telegram. The bot replies `❌ Failed to generate tournament leaderboard.` instead of the card. Logs show `Tournament card render failed: ETELEGRAM: 400 ...can't parse entities...`.

- **I5: Score and tournament endpoints do no numeric validation — non-numeric or negative scores get persisted**
  - Location: `bot.js:639` (`/api/score`), `bot.js:852` (`/api/tournament/:id/score`)
  - Problem: `if (!telegram_id || score == null)` is the only sanity check on `score` — it lets through `score: -50`, `score: "abc"`, `score: 1.5`, `score: 6e9` (which exceeds 500 and IS rejected, but the type still passes). `validateScore`'s `score > 500` then JS-coerces strings like `"abc" > 500` to `false`, and `db.submitScore` writes the value through SQLite's loose typing. Negative scores poison `MAX(score)` only for the offending player (since MAX takes the largest = 0 from other rows), but they're permanently visible in admin queries and `getAllTimeStats` returns them.
  - Root cause: Missing `Number.isFinite(Number(score)) && score >= 0` guard before the hard-cap check.
  - Proposed fix: At the top of `validateScore` and at the top of `/api/tournament/:id/score`, add `const n = Number(score); if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { valid: false, reason: 'invalid_score' };` and use `n` thereafter. Coerce to integer on the way to the DB.
  - Effort: S
  - Production reproduction: `curl -X POST https://<deploy>/api/score -H 'content-type: application/json' -d '{"telegram_id": <your_id>, "score": -100, "first_name": "Test"}'` — returns `{ok:true,...}`. Confirm with `curl https://<deploy>/api/player/<your_id> | jq '.allTime.all_time_best'`.

- **I6: SQLite foreign keys are not enforced — orphan tournament_scores rows are possible**
  - Location: `db.js:12-17` (init — no `db.pragma('foreign_keys = ON')`)
  - Problem: All FOREIGN KEY clauses in the schema (db.js:37, 64-65) are silently ignored. Combined with I1 (tournament endpoint doesn't upsertPlayer), this means the `tournament_scores` table can accumulate orphan rows that no leaderboard query surfaces but that count toward `getTournamentPlayerRank` (which does NOT join `players`, db.js:253-263). A player can self-rank via the API and see "Your rank: #1" while the public leaderboard never lists them.
  - Root cause: better-sqlite3 doesn't enable FK enforcement unless explicitly turned on per connection. The init function calls `db.pragma('journal_mode = WAL')` but no `foreign_keys = ON`.
  - Proposed fix: Add `db.pragma('foreign_keys = ON');` in `init()` after the journal_mode pragma. Then audit the schema — current rows that already orphan would block ALTER, but `tournament_scores` is the only FK-bearing table that is not effectively guarded by code paths. After enabling, the I1 fix becomes load-bearing (or you'd start getting INSERT failures for tournament-only flows).
  - Effort: S
  - Production reproduction: `curl https://<deploy>/api/tournament/april-fools-flapoff-2026/score -X POST -H 'content-type: application/json' -d '{"telegram_id": 88888888, "score": 50}'` (a telegram_id that has never run /start and never used the mini-app), then `curl 'https://<deploy>/api/tournament/april-fools-flapoff-2026' | jq '.entries[] | select(.telegram_id==88888888)'` returns empty even though the row exists.

- **I7: lastArchivedWeek is in-memory only — auto-archive can permanently miss a week if the bot misses its 30-min window**
  - Location: `bot.js:943-964` (auto-archive loop and lastArchivedWeek state)
  - Problem: `lastArchivedWeek` is reset to `null` on every bot restart. The condition `msUntilReset <= 30 * 60 * 1000 && msUntilReset > 0` only fires in the 30 minutes before each Monday 00:00 UTC. If the bot is deploying or crashed across that window (e.g. operator restarts at 23:55 Sun for an unrelated fix), the week is never archived — the next tick is at Mon 00:05, where `msUntilReset` is ~7 days. There is no "if last week is unarchived, do it now on boot" recovery path. The data is still in `scores` of course, but the operator-facing CSV file never lands in `/data/archives/`, so `/history` won't list it and operator must manually call `POST /api/archive-now` (which they may not realize is needed).
  - Root cause: State that should be persistent (which weeks have been CSV-archived) is held only in-memory. `archiveWeek` returns `{alreadyExists: true}` if the file exists, but the auto-archive loop never *probes* for "the week before currentWeek" on startup — it only runs when within the 30-min pre-reset window.
  - Proposed fix: On boot (in `checkAutoArchive` or a separate boot-time routine), iterate the most-recent N completed weeks (e.g. last 4) and call `archiveWeek(week)` for each — `archiveWeek` already returns `alreadyExists: true` if the CSV is there, so it's idempotent. The fs check is the persistence layer; treat it as the source of truth instead of `lastArchivedWeek`.
  - Effort: S
  - Production reproduction: Stop the service at Mon 00:05 UTC (or any time after the pre-reset window). Restart it. Check `/data/archives/`: the just-completed week's CSV is missing. Calling `/history` from Telegram lists archives but excludes that week.

- **I8: G.playerName defaults to 'Player' — any leaderboard entry with first_name == 'Player' falsely highlights as "you"**
  - Location: `flappy_bert.html:3605-3606` (renderLeaderboard isYou logic), `flappy_bert.html:1099` (default), `bot.js:675` (server-side default)
  - Problem: `isYou = (currentUser && entry.telegram_id && String(entry.telegram_id) === String(currentUser.id)) || entry.name === G.playerName`. The fallback on `entry.name === G.playerName` means any row whose Telegram first_name happens to be `"Player"` is highlighted as the viewer. Worse: `bot.js:675` writes `db.upsertPlayer(telegram_id, first_name || 'Player', ...)` — if a user submits with no first_name (sessionless curl, or Telegram clients that strip it), every such user gets first_name="Player". Multiple "Player"s collide on the leaderboard, all highlighted, and the local `updateLeaderboard()` (line 1686) deduplicates by name == "Player" so only one entry per "you" would show.
  - Root cause: The local fallback name logic predates the telegram_id-keyed flow and is now redundant + wrong. Also the server-side `first_name || 'Player'` collapses the namespace.
  - Proposed fix: Drop the `|| entry.name === G.playerName` clause — telegram_id is reliable. Separately, change `bot.js:675` (and `bot.js:537`, the WebApp data path) to fall back to `'Anon-' + telegram_id.toString().slice(-4)` so collisions are rare and identifiable.
  - Effort: S
  - Production reproduction: Set your Telegram first_name to `Player` exactly. Open the in-game leaderboard. Any other "Player" rows on the leaderboard will all be highlighted with the cyan ▶ "you" arrow.

### Minor (3)

- **M1: Dead code — getTournamentCountdown() at flappy_bert.html:3209 has no callers (pre-known)**
  - Location: `flappy_bert.html:3209`
  - Problem: A `function getTournamentCountdown() { return ''; }` stub remains, with a comment explaining it is "kept for symmetry / external callers". Grep across the file shows no callers. The comment claims "Retained helpers" but only `getTournamentStatus` is actually called.
  - Root cause: Leftover from the tournament UI redesign that introduced `getCountdownString(targetMs, fromMs)` (line 3139) as the replacement.
  - Proposed fix: Delete the function and update the comment block to drop the symmetry justification. Also drop the comment's reference to line ~1602 — the actual call is at line 1616.
  - Effort: S
  - Production reproduction: `grep -n "getTournamentCountdown" flappy_bert.html` returns only the definition.

- **M2: validateScore destructures `frames` and `signature` previously — check they're really gone (pre-known fixed in f628e78, verify)**
  - Location: `bot.js:78` (current destructure)
  - Problem: Pre-known finding said this was fixed. Current line 78 destructures `{ score, level, shieldUsed, adContinueUsed, scoreMultiplier }` only. The body params actually sent (html:3684-3694) include `duration` and `badges` which are ignored — that's fine, no crash. Confirmed clean. (Logging this as CLOSED for the audit trail.)
  - Root cause: n/a, was a ReferenceError. Resolved.
  - Proposed fix: No action.
  - Effort: n/a
  - Production reproduction: n/a — confirmed closed via reading current source.

- **M3: /api/leaderboard/image and /api/player/:id/card are unauthed and unrate-limited canvas-render endpoints**
  - Location: `bot.js:704-720, 734-755`
  - Problem: Each request triggers a synchronous `node-canvas` render (50ms+ CPU on starter Render plan). No auth, no rate limit, server-side cache headers say `public, max-age=60` for the leaderboard image but the cache is at the CDN, not at the origin — direct origin requests bypass it. A trivial DoS with `ab -n 1000 -c 50 https://<deploy>/api/leaderboard/image` will pin the event loop and starve `/api/score`. Not critical because traffic is low and Render restarts on memory blow-up, but a player or operator submitting a real spike would notice.
  - Root cause: Both endpoints predate the rate-limit middleware. They're meant to be inline-image targets for Telegram callbacks, but they're publicly reachable.
  - Proposed fix: Wrap both endpoints in `rateLimit(30, 60000)` (after the I3 trust-proxy fix lands). Optionally cache the rendered PNG buffer in-process for 60s keyed by `(highlightId, weekStart)` for /api/leaderboard/image; the per-player card has lower hit rate so leave it.
  - Effort: S
  - Production reproduction: `ab -n 200 -c 20 https://<deploy>/api/leaderboard/image` from a single client. Watch `/api/health` latency rise during the run; watch `/api/score` 429-rates rise after the I3 fix is in place.

## Coverage gaps (if any)

None — all five hot paths were traced end to end. The renderTournamentCard emoji-handling edge cases in node-canvas were not separately exercised (this auditor read the code but did not run it), so visual-bug risk in that surface is not flagged here.

## Notes

- `tournaments-config.js` and the test alongside it are the single best-tested module in the repo and the validator is correctly defensive (rejects malformed start/end ordering, non-string fields, missing fields). Use it as the template for any future external-config loader.
- The anti-tamper IIFE at `flappy_bert.html:1700-1857` is well-thought-out — load-order is correct (IIFE runs before `loadData()`), the per-state setter logic for `score`/`combo`/`coins` correctly handles the menu↔playing↔gameover transitions, and console-side `G.score = 999` is genuinely blocked. The one historical risk vector (`G.bestCombo` carrying over between games and locking out increments) is dodged because `startGame()` resets all the protected counters before the next game runs. No bug here, just worth noting it survived the audit.
- `seasons.py`-style "honest dual-display" reporting is not relevant to this codebase, but the equivalent disciplines (typed score validation, telegram_id as canonical identity, idempotent archive) are the same shape — see I5 / I8 / I7.
- `db.archiveWeek` returning `{alreadyExists: true}` for re-runs is good; flagged elsewhere only because the *caller* doesn't probe past weeks on boot.
