# Tournament Score Reset + Prize Ladder — Design

**Date:** 2026-06-19
**Status:** Approved, ready for implementation plan
**Trigger:** Owner wants the current tournament (The Summer Session, `summer-session-2026`) to reset
its scores at **00:00 UTC on 2026-06-22**, and the leaderboard to show prizes for places 1–5:
**1st $100, 2nd $60, 3rd $40, 4th $30, 5th $20**.

## Principle
Config-driven, non-destructive, deterministic. No DB schema migration, no cron, no scheduled wipe —
the reset is a pure function of time. Fully backward-compatible: a tournament without the new config
fields renders and behaves exactly as today.

## Decisions (owner-selected)
- **Reset mechanism: time-boundary (non-destructive).** The leaderboard counts only scores from the
  reset boundary onward, once that boundary has passed. Deploy-now-and-it-auto-fires; no scheduled
  job, no restart risk, old scores preserved (just stop counting). Chosen over a destructive wipe for
  prize-competition safety.
- **Prize display: always-show 5-place ladder.** Positions 1–5 always render with their prize even
  when empty ("— up for grabs —"), so after the reset the empty board still advertises the full ladder.
- **Where: both** the in-app tournament overlay AND the bot `/tournament` card image.

## 1. Data model — `tournaments.json` (no DB change)
The `summer-session-2026` entry gains two OPTIONAL fields:
```json
{
  "id": "summer-session-2026",
  "name": "The Summer Session",
  "sponsor": "Dr. Inker LABS",
  "startTime": "2026-06-01T00:00:00Z",
  "endTime": "2026-09-01T00:00:00Z",
  "scoreResetAt": "2026-06-22T00:00:00Z",
  "prizes": [100, 60, 40, 30, 20]
}
```
- `scoreResetAt` — ISO-8601 UTC; the boundary from which scores count after it passes.
- `prizes` — array of USD integers for places 1..N (here 5). Displayed with a `$` prefix.
- `tournaments-config.js` `loadTournamentsFromFile` passes these through (they are optional — absent =
  no reset / no prizes, today's behavior). The server keeps a `config-by-id` Map so the API/bot can
  look up a tournament's `scoreResetAt`/`prizes` at request time. These fields are NOT stored in the
  DB (the `tournaments` row is seeded `INSERT OR IGNORE` and would not update an existing row); they
  live in config and are read in-process — which also keeps the reset boundary deterministic.

## 2. The reset (time-boundary)
- Pure helper `effectiveResetSince(scoreResetAt, nowMs)`: returns the SQLite-formatted boundary
  string (`YYYY-MM-DD HH:MM:SS`, UTC) **iff** `scoreResetAt` is set AND `nowMs >= Date.parse(scoreResetAt)`;
  otherwise `null`.
- Pure helper `isoToSqliteUTC(iso)`: `"2026-06-22T00:00:00Z"` → `"2026-06-22 00:00:00"` (replace `T`
  with a space, drop `Z`/milliseconds). Matches the format of `tournament_scores.played_at`
  (`DEFAULT datetime('now')` → `YYYY-MM-DD HH:MM:SS` UTC), so a lexicographic `played_at >= ?`
  comparison is correct.
- `db.getTournamentLeaderboard(tournamentId, limit, since)` and
  `db.getTournamentPlayerRank(tournamentId, telegramId, since)` gain an OPTIONAL `since`. When
  provided, the query adds `AND ts.played_at >= ?`. When omitted/null, the query is unchanged
  (today's behavior).
- Applied everywhere the standings are computed: `GET /api/tournament/:id` (client overlay), the bot
  `/tournament` card command, and `POST /api/tournament/:id/score`'s returned rank. Each computes
  `since = effectiveResetSince(cfg?.scoreResetAt, Date.now())`.
- **Behavior:** before 22/06 00:00 UTC the board shows current scores (no filter); at/after it,
  only post-boundary scores count → the board resets to empty and fills fresh. Old rows remain in the
  DB (dormant). Reversible by removing `scoreResetAt`.

## 3. Prize ladder rendering (always-show, both views)
- `GET /api/tournament/:id` response gains `prizes: cfg?.prizes || null` alongside `entries`.
- **In-app overlay** (`renderEntriesInto(listEl, entries, prizes)` in `flappy_bert.html`): when
  `prizes` is present, render positions 1..max(prizes.length, entries.length). For positions within
  `prizes`: show the prize (`$<amount>`) + the holder at that rank, or "— up for grabs —" if no entry
  holds it. Positions beyond `prizes.length` render as normal rows (no prize). When `prizes` is
  absent, render exactly as today. `renderEntriesInto` (`flappy_bert.html:4374`) is tournament-specific:
  its only call site is the tournament fetch (`:4364`); the weekly board uses a separate
  `renderLeaderboard` (`:4643`), so this change does not touch the weekly leaderboard.
- **Bot `/tournament` card** (`renderTournamentCard(entries, options)` in `leaderboard-card.js`):
  `options.prizes` drives the same 1..N prize ladder on the canvas (prize text per row for ranks
  1..prizes.length, with the "up for grabs" placeholder for empty slots). The bot `/tournament`
  command passes `prizes` from config and applies the same `since` boundary when fetching entries.
- A tournament with no `prizes` renders both views exactly as today (backward-compatible).

## 4. Pre-reset note (small, kept)
Before the boundary passes, the overlay shows a one-line notice
"🏁 Prize competition starts 22 Jun 00:00 UTC — scores reset then" (derived from `scoreResetAt`,
shown only while `now < scoreResetAt`), so the pre-reset scores shown next to live prizes are not
confusing. After the boundary it disappears.

## 5. Testing
- Pure unit tests (new `lib/` helpers, required by the server + tests): `isoToSqliteUTC` (format
  conversion, edge cases), `effectiveResetSince` (before boundary → null; at/after → boundary string;
  no `scoreResetAt` → null), and prize formatting.
- Config-loader test (`tournaments-config.test.js`): the new `scoreResetAt`/`prizes` fields are read
  through; absent fields default to undefined (no breakage).
- DB mechanism test (in-memory, FK-on schema, like `tools/verify-tournament-cleanup.cjs`): insert
  scores before AND after a boundary; assert `getTournamentLeaderboard` with `since` counts ONLY
  post-boundary scores, and without `since` counts all.
- Client browser smoke: the overlay renders the prize ladder (filled + "up for grabs" slots) given a
  `prizes` payload; renders as today with no `prizes`.
- Bot card render check: `renderTournamentCard` with `prizes` draws the ladder without error
  (headless canvas), and without `prizes` is unchanged.

## 6. Deadline / deploy
The boundary auto-fires at 2026-06-22T00:00:00Z — the only hard requirement is to **deploy before
then** (≈3 days of margin). No action is needed at the reset moment.

## Out of scope
No recurring/repeating reset (this is a one-time boundary), no payout/claim system (prizes are
display-only — the owner pays winners out-of-band), no per-place prize editing UI (prizes are a JSON
field), no change to the weekly leaderboard.
