# Deferred bugs — to be considered in June creative pass

Findings from the 2026-04-30 hot-path audit (`docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md`) that didn't justify a hotfix today. They may or may not justify work in the June pass — re-triage at the start of that brainstorm.

## Findings (deferred 2026-04-30)

### M1: Dead code — `getTournamentCountdown()` has no callers

- **Location:** `flappy_bert.html:3209`
- **Problem:** A `function getTournamentCountdown() { return ''; }` stub remains, with a comment claiming it is "kept for symmetry / external callers". `grep` confirms no callers anywhere in the file.
- **Root cause:** Leftover from the tournament UI redesign that introduced `getCountdownString(targetMs, fromMs)` (line 3139) as the replacement.
- **Proposed fix:** Delete the function and update the comment block to drop the symmetry justification.
- **Effort:** S
- **Why deferred:** Default Minor. No user-observable effect. Cleanup candidate for the June refactor pass.

### M3: `/api/leaderboard/image` and `/api/player/:id/card` are unauthed and unrate-limited canvas-render endpoints

- **Location:** `bot.js:704-720, 734-755`
- **Problem:** Each request triggers a synchronous `node-canvas` render (50ms+ CPU on starter Render plan). No auth, no rate limit. Trivial DoS with `ab -n 1000 -c 50 https://<deploy>/api/leaderboard/image` will pin the event loop and starve `/api/score`.
- **Root cause:** Both endpoints predate the rate-limit middleware. They're meant to be inline-image targets for Telegram callbacks but are publicly reachable.
- **Proposed fix:** Wrap both endpoints in `rateLimit(30, 60000)`. Optionally cache the rendered PNG buffer in-process for 60s keyed by `(highlightId, weekStart)`.
- **Effort:** S
- **Why deferred:** Default Minor. Current traffic is low and Render starter plan auto-restarts on memory blow-up. Worth fixing if traffic grows or if bot popularity spikes.

## Notes on revisiting

When you revisit, update each entry with one of:
- `**Resolved:** <commit SHA>` (and keep the entry as historical record)
- Move the entry to a CHANGELOG entry and remove from this file

The audit report itself (`docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md`) is the canonical reference for context.
