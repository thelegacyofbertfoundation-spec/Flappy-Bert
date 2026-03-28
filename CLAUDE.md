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
- `API_SECRET` — Optional shared secret for admin endpoints
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

## Current tournament
- **April Fools Flap-off 2026** — `april-fools-flapoff-2026`
- April 1–30, 2026 UTC
- Sponsor: Dr. Inker LABS
- Tournament button always visible with countdown, goes green when live

## Game mechanics
- **Levels:** Every 10 pipes cleared = +1 level. Speed, gap, pipe interval scale with level, plateau at level 20.
- **JEETS enemies:** Spawn from level 2. Cooldown system (min 3 pipes between spawns), drought ramp (5%→15%). Three sizes: normal (60%), 2x big (25%), 3x huge (15%). Unpredictable dual-wave movement with random direction changes.
- **Moving pipes:** From level 8, 30% chance. Oscillate vertically.
- **Coins:** 30% chance in pipe gaps. Near-miss bonus +3 coins. Combo bonus every 5 pipes.
- **Shield:** ~5.6% chance, once per game. Absorbs one hit.
- **Shop:** Skins (color tints) and score multipliers (1.5x, 2x). Purchased with coins.
- **Daily challenges:** 3 random challenges, reset at UTC midnight.

## Anti-cheat / security
- **Telegram initData HMAC validation** — verifies player identity server-side using BOT_TOKEN
- **Anti-tamper properties** — `gravity`, `flapForce`, `baseSpeed`, `basePipeGap`, `pipeWidth`, `scoreMultiplier`, `gameSpeed`, `pipeGap`, `score`, `coins`, `combo`, `bestCombo`, `_scoreAccum` all locked with `Object.defineProperty`
- **Game sessions** — server-issued session IDs, reuse detection
- **Score validation** — hard cap (500), time-based rate checks, sessionless rejection (>30), too-fast rejection (>15)
- **Rate limiting** — per-IP: sessions 10/min, scores 10/min, shares 5/min
- **Player bans** — admin command, checked on score submission

## Important notes
- `flappy_bert.html` is a single monolithic file — all game code, styles, and markup in one place. This is intentional for Telegram Mini App simplicity.
- The Ad system (`AdSystem`) is a stub — `isRewardedReady()` always returns false. Continue/double-coins features are dormant until a real ad SDK is integrated.
- `API_BASE` in the frontend is empty string — API calls use relative URLs, so the game HTML must be served from the same origin as the bot API (the `/game` endpoint handles this).
- Canvas font "Press Start 2P" loaded from Google Fonts. Falls back to monospace if unavailable.
- Never add seasonal/theme text to BertBot NFT PFP generations — breaks art style.
- The `archives/` directory contains old versions of files. Don't modify.
