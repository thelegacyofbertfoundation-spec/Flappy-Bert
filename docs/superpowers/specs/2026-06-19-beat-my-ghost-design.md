# Beat-My-Ghost — Design

**Date:** 2026-06-19
**Status:** Approved, ready for implementation plan
**Source:** the creativity deep-dive shortlist (rank 6, the one strategic growth lever)

## Goal
Add a viral, Telegram-native "challenge a friend" loop to Flappy-Bert **without
over-complicating it**: a player shares a link carrying their score; a friend taps it,
launches the game with that score as a visible target, and gets a "YOU BEAT <name>!"
payoff. The entire challenge rides in a URL param — **zero new server state, zero schema,
no anti-cheat surface, no new control** (the one-tap loop is untouched; the target is a
visual goal only).

## Decisions (owner-selected)
- **Launch mechanism: zero-setup bot deep-link.** Share builds `t.me/<bot>?start=g_<id>_<score>`.
  The friend's tap opens the bot chat; the bot replies with a personalized challenge message
  + a Play button whose `web_app` URL carries the challenge (`WEBAPP_URL?ghost=g_<id>_<score>`).
  No BotFather Mini-App short-name config required. (The slicker 1-tap `?startapp=` direct
  link was rejected to avoid the external config dependency.)
- **Target UX: persistent target pill.** A small pill near the score shows the rival name +
  target score; it turns gold and pops the instant the player's score passes it.

## Architecture / data flow
```
Sharer (game-over) — "🎯 Challenge a friend" → Telegram share sheet
    link: https://t.me/<botUsername>?start=g_<sharerId>_<score>
Friend taps → bot chat → /start g_<id>_<score>
    bot validates the param, resolves the sharer's NAME from the id (db.getPlayer),
    replies "🎯 <name> dares you to beat <score>!" + [▶ Beat it] button
    button url: WEBAPP_URL?ghost=g_<id>_<score>
Friend taps the button → game opens with ?ghost=… in its URL
    client parses ?ghost=, fetches the rival name via GET /api/player/:id,
    shows the target pill, the mid-run pass-moment, and the game-over result.
```

## Param format
- `g_<sharerId>_<score>` — only digits + `_`, ≤64 chars (fits Telegram's `start` charset
  `A-Za-z0-9_-`). The name is **not** in the param (names carry spaces/emoji → encoding pain);
  it is always resolved *from the id*.
- The score in the param is **display-only**. It is never an input to score validation, coins,
  badges, or any reward. Treated as untrusted/attacker-supplied throughout.

## Components (all additive — no new screens, no persistent state)
1. **Client — share** (`flappy_bert.html`): a "🎯 Challenge a friend" button on the game-over
   screen. Builds the `t.me/<botUsername>?start=…` link and opens the Telegram share sheet via
   `Telegram.WebApp.openTelegramLink('https://t.me/share/url?url=<link>&text=<taunt>')`. If the
   bot username isn't available, the button falls back to the existing score-card share.
2. **Client — receive** (`flappy_bert.html`):
   - On load: parse `?ghost=` from `window.location.search` (also accept `initDataUnsafe.start_param`
     as a forward-compatible second source — cheap, and makes the direct-link upgrade free later).
     If valid and `sharerId !== myId`, set `G.ghost = { id, score, name }`.
   - **Target pill**: reuse the magnet/frenzy HUD-pill idiom — an absolutely-positioned **DOM**
     pill (same as the existing powerup pills) near the score reading "<name> … <score>"; turns
     gold + scale-pops when `G.score > G.ghost.score`. Hidden when there is no ghost.
   - **Pass-moment**: when the score first crosses the target, fire `FX._floater("PASSED <name>!")`
     + a fanfare chord (reuse `AudioSystem`/`FX` patterns). One-shot per run.
   - **Game-over variant**: inject a result line into the existing `gameOverSequence` — win:
     "YOU BEAT <name>!  <yourScore> › <target>"; loss: "So close — <yourScore>/<target>". Add a
     "🔄 Challenge back" button that shares a NEW link with the player's own fresh score.
3. **Bot** (`bot.js`): `/start` regex gains an optional capture (`/\/start(?:\s+(\S+))?/`). If the
   captured param matches `^g_\d+_\d+$` with the score in `0..500` (the score cap), resolve the
   sharer's name and send the personalized challenge message + Play button. A non-matching param
   falls through to the normal welcome; param-less `/start` behavior is unchanged.
4. **Server — one read-only endpoint**: `GET /api/config` → `{ botUsername }`, sourced from
   `bot.getMe()` cached once at startup. The only new server code; stateless, no DB.

## Edge cases & security
- **Own link** (`sharerId === myId`): ignore the ghost (no pill, normal game).
- **Garbage / malformed / overflow param**: strict regex; clamp score to `0..500`; otherwise ignore.
- **Missing player / name**: fall back to "a friend".
- **No bot username** (config fetch failed): the challenge-share button falls back to the existing
  score-card share; the receive side is unaffected.
- **Security invariant**: the ghost param is cosmetic-only and never reaches score validation,
  the coin/badge economy, or any server write. The bot `/start` param is regex-validated and used
  solely to look up a name and build a button URL.

## Testing
- **Pure helper** `parseGhostParam(str)` → `{ id, score } | null`, extracted to a `tests/lib/`
  mirror and unit-tested: valid, malformed, missing parts, non-numeric, score overflow (>500),
  64-char bound, leading-zero/charset cases.
- **Pure formatter** for the bot's challenge message (name + score → text), unit-tested, so the
  bot reply is covered without a live Telegram round-trip.
- **Manual** (owner, post-deploy): a real shared-link round-trip on Telegram (share → friend taps →
  bot message → Play → pill → beat → game-over variant).

## Out of scope (explicitly — guard against the bloat traps)
No rivalry **system** (no rival lists, no head-to-head W/L records, no push notifications), no
persisted "challenges sent/received" state, no leaderboard of challenges, no new economy. If any
of these is wanted later, it's a separate spec — this feature is a stateless, one-param cosmetic loop.
