# Tournament Framework v2 — Design

**Date:** 2026-04-29
**Owner:** Dr. Inker LABS
**Status:** Spec — pending implementation
**Target ship date:** before May 1, 2026 00:00 UTC

## Problem

Tournament configuration is hardcoded across multiple files. Rolling from one tournament to the next requires editing source code in two places (`bot.js` seed calls + `flappy_bert.html` `TOURNAMENT` const) and shipping an HTML redeploy. The home-screen tournament button has no concept of "between tournaments" or "upcoming tournament," so when no tournament is live the button disappears entirely. There is no archive UX — past tournaments become invisible the moment a new one is added.

This is structural, not cosmetic: the game is moving to a permanent monthly tournament cadence, and the framework cannot support that cleanly today.

## Goals

1. **Adding a new tournament is a config change, not a code change** — append to a JSON file and restart, no client redeploy.
2. **Players can always reach the past** — an explicit, scrollable archive of every completed tournament with frozen final standings.
3. **Players see what's coming** — upcoming tournaments get their own surface with a countdown to start, creating anticipation.
4. **The home screen is never dead** — between tournaments, it shows the most recent winners or the next upcoming event.
5. **Ship May 1 launch on schedule** — April Fools Flap-off 2026 archived, May The Flap Be With You live at 00:00 UTC May 1.

## Non-goals

- Per-tournament rule variants (e.g. "shields disabled" — out of scope, tracked separately if wanted).
- Per-tournament prize distribution / reward automation (out of scope).
- Broadcast notifications when a tournament starts (out of scope).
- Visual theming for May The Flap Be With You (lightsaber pipes etc.) — that's part of sub-project #2 (game improvement pass), not this framework change. May launches with default styling and gets themed up shortly after.

## Architecture

### Data source

Tournaments move from inline `db.createTournament(...)` calls in `bot.js` to a config file at `/opt/Flappy-Bert/tournaments.json`. On startup, `bot.js` reads this file and calls `db.createTournament(...)` for each entry (`INSERT OR IGNORE` on `id`, so re-seeding is idempotent — existing tournament rows and their scores are preserved).

```json
[
  {
    "id": "champions-flapoff-1",
    "name": "Champions Flap-off",
    "sponsor": "TraderSZ",
    "startTime": "2026-02-19T17:00:00Z",
    "endTime": "2026-03-19T23:59:59Z"
  },
  {
    "id": "april-fools-flapoff-2026",
    "name": "April Fools Flap-off 2026",
    "sponsor": "Dr. Inker LABS",
    "startTime": "2026-04-01T00:00:00Z",
    "endTime": "2026-04-30T23:59:59Z"
  },
  {
    "id": "may-the-flap-2026",
    "name": "May The Flap Be With You",
    "sponsor": "Dr. Inker LABS",
    "startTime": "2026-05-01T00:00:00Z",
    "endTime": "2026-05-31T23:59:59Z"
  }
]
```

If the file is missing or malformed, the server logs an error and falls back to an empty tournament list (game still works, tournament UI is hidden). It does NOT crash.

### Server endpoints

`/api/tournaments` (already exists) returns all tournaments with derived `status` (`scheduled` / `live` / `ended`) computed from `startTime` / `endTime` against `Date.now()`. No change needed.

`/api/tournament/:id` (already exists) returns one tournament + its leaderboard. No change.

New: `/api/tournaments/featured` returns the single tournament that should be shown as the home-screen featured one, with priority:
1. Live tournament (most recently started, in case multiple)
2. Upcoming tournament starting in <7 days (soonest first)
3. Most-recent ended tournament that ended within the last 14 days
4. `null` (button hidden)

This logic lives server-side so the client doesn't need to compute it from a list. The endpoint returns the tournament object plus a `featured_state: "live" | "upcoming" | "recently_ended"` discriminator the UI keys off of.

### Telegram bot commands

`/tournament` (no arg) shows the live tournament card if one is live, else the most recently ended. Existing handler in `bot.js` already does "most recent" — extend to prefer live > ended.

`/tournament <id-or-keyword>` shows a specific tournament. Keyword match: case-insensitive substring on `name` or `id`. (`/tournament april` finds `april-fools-flapoff-2026`.) If multiple match, show a disambiguation message listing options.

### Frontend (flappy_bert.html)

**Remove the hardcoded `TOURNAMENT` const.** Replace with two pieces of state hydrated on game load:

```js
let FEATURED_TOURNAMENT = null;  // from /api/tournaments/featured
let ALL_TOURNAMENTS = [];         // from /api/tournaments
```

Both are fetched async at app startup; the menu renders immediately and the tournament button appears once data arrives (default hidden until then). If either fetch fails (offline / server down), the button stays hidden — game still plays.

**Home-screen tournament button** uses `FEATURED_TOURNAMENT.featured_state` to drive presentation:

| state | button color | text | sub-text |
|-------|--------------|------|----------|
| `live` | gold (`#ffd700`), pulse animation | `🏆 [name]` | `ENDS IN 3d 4h 12m` |
| `upcoming` | silver (`#c0c0c0`), no pulse | `⏳ [name]` | `STARTS IN 2d 5h 8m` |
| `recently_ended` | bronze (`#cd7f32`), no pulse | `📜 [name]` | `FINAL RESULTS` |
| (no featured) | hidden | — | — |

Countdowns update every second (existing `setInterval` already in place — adapt it).

**Tournament overlay** (the screen that opens when the button is tapped) gets three sections, each rendered conditionally based on whether tournaments exist in that state:

- `🔴 LIVE` — current live tournament(s). Full leaderboard. Score-submit button enabled. Same look as today's overlay.
- `⏳ UPCOMING` — tournaments not yet started. Per tournament: name, sponsor, start date, countdown to start. No leaderboard (none exists yet).
- `📜 PAST` — ended tournaments, newest first. Per tournament collapsed by default: name, sponsor, dates, top-3 finishers as a strip. Tap to expand → full final standings (top 50). Score-submit disabled.

If the user has scores in any past tournament, their personal rank shows in the collapsed strip alongside the top 3.

The overlay loads tournament list from `ALL_TOURNAMENTS`; expanding a past tournament fetches its leaderboard from `/api/tournament/:id`.

### State transitions

When April ends (May 1 00:00 UTC):
- `/api/tournaments/featured` flips priority — May is `live` (just started), April becomes `recently_ended`.
- Home-screen button auto-switches from gold-April to gold-May within one second tick (no refresh needed because the countdown loop re-evaluates featured state every tick).
- April's row in the overlay moves from `🔴 LIVE` to `📜 PAST`.

No deploy, no admin action.

When May ends (June 1 00:00 UTC):
- May goes to `recently_ended` for 14 days (still featured).
- After 14 days with no new tournament, button hides.
- If June tournament is seeded by then, it becomes featured per priority order.

## Data flow

```
tournaments.json
       │
       ▼ (read on bot.js startup)
SQLite tournaments table  ◄────  /api/admin/* (existing CRUD, unchanged)
       │
       ▼
/api/tournaments  ─────────►  client `ALL_TOURNAMENTS`
/api/tournaments/featured ─►  client `FEATURED_TOURNAMENT`
/api/tournament/:id        ─►  client (on-demand when user expands past)
```

## Error handling

- `tournaments.json` missing → log warn, no tournaments seeded, UI hides tournament button.
- `tournaments.json` malformed (JSON parse error) → log error, server still starts, no tournaments seeded.
- Individual entry missing required field (`id` / `name` / `startTime` / `endTime`) → log warn, skip that entry, continue.
- `/api/tournaments/featured` returns null (no live, no upcoming<7d, no recently_ended<14d) → button hidden, no error to user.
- Client fails to fetch `/api/tournaments` on load → button hidden, console warning, game functions normally.

## Testing

Manual end-to-end flows to verify:

1. **April active state (today):** Open mini-app on 2026-04-29. Home button is gold "🏆 April Fools Flap-off 2026 — ENDS IN 1d Xh." Overlay shows April under `🔴 LIVE`, May under `⏳ UPCOMING — STARTS IN 1d Xh`, Champions Flap-off under `📜 PAST`.
2. **May rollover (May 1 00:00 UTC):** With clock spoofed to 2026-05-01 00:00:01Z, home button is gold "🏆 May The Flap Be With You — ENDS IN 30d 23h 59m." April moves to `📜 PAST`, top of past list with full April standings frozen.
3. **Mid-month (May 15):** Same as #2 with shorter countdown. Verify April's collapsed strip in past shows correct top-3 + frozen final.
4. **Between tournaments (June 1, no June tournament seeded):** Home button is bronze "📜 May The Flap Be With You — FINAL RESULTS." Overlay shows no live, no upcoming, May at top of past.
5. **Long gap (June 15, no upcoming):** May was 14 days ago — button hidden, overlay still accessible from a smaller "All tournaments" entry point (or admin-only? — call below).
6. **Score submission to live tournament:** Submit a score during May, verify it appears in May's leaderboard.
7. **Past tournament is read-only:** Confirm score submission UI is disabled when viewing April after May 1.
8. **Telegram `/tournament`:** Returns May card image during May. `/tournament april` returns April. `/tournament` (no arg, after May ends) returns most recently ended.
9. **Bad config:** Rename `tournaments.json`, restart server. Mini-app still loads, button hidden, no crashes in logs.

## Long-gap archive entry point

When the most recent tournament ended >14 days ago and nothing is upcoming, the home featured-tournament button is hidden. To prevent the archive from becoming unreachable in long gaps, the menu also gets a small persistent "📜 Past Tournaments" link (next to or under the existing Leaderboard button) that opens the same overlay scrolled to the past section. Always reachable, costs ~10 lines of HTML.

## Implementation order

1. Add `tournaments.json` with current 3 tournaments (Champions, April, May).
2. Add `loadTournamentsFromConfig()` to `bot.js`, replace inline seed calls.
3. Add `/api/tournaments/featured` endpoint with priority logic.
4. Frontend: replace `TOURNAMENT` const with hydrated state. Update home button to drive off `featured_state`.
5. Frontend: refactor tournament overlay into 3-section layout (Live / Upcoming / Past).
6. Frontend: add persistent "📜 Past Tournaments" menu entry (resolves open question B).
7. Telegram bot: extend `/tournament` for keyword arg.
8. Test all 9 scenarios above.
9. Commit, push to main, Render auto-deploys.

## Risk

- **State sync at midnight UTC May 1:** the hot path is the moment April ends and May begins. Both transitions are derived (`status` computed from clock, no manual flip), so as long as the server clock is correct (Render runs UTC by default — verified) the transition is automatic.
- **Cached HTML on player devices:** the mini-app currently has no cache-busting on `flappy_bert.html`. Players who opened the app April 30 might still hit a stale TOURNAMENT const on May 1. Mitigation: bump a `?v=N` query param on `/game` redirect to bust the cache. Cheap.
- **`tournaments.json` deploy:** add it to the repo root so it ships in the Docker image. Render rebuilds on push to main. No additional infra needed.
