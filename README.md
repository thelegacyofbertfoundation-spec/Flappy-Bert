# 🐱 Flappy Bert — Telegram Mini App

A complete "Flap to Earn" game for Telegram with weekly leaderboards, a coin shop,
power-ups, and server-generated leaderboard card images.

## Architecture

```
┌──────────────────────────────┐
│     Telegram Mini App        │  ← flappy_bert.html (hosted on HTTPS)
│  Canvas game engine          │
│  Shop, powers, skins         │
│  Local + server leaderboard  │
└──────────┬───────────────────┘
           │ WebApp.sendData() + HTTP API
           ▼
┌──────────────────────────────┐
│     Node.js Bot Server       │  ← bot.js
│  Telegram Bot API (polling)  │
│  Express REST API            │
│  SQLite database             │
│  node-canvas image renderer  │
└──────────────────────────────┘
```

## Features

### Game (`flappy_bert.html`)
- Canvas-based flappy gameplay with your Bert pixel character
- Tail animation flaps when you tap
- Progressive difficulty: speed increases, gap narrows, moving pipes from level 8+
- Coin earning: 1 coin per pipe + bonus gold coins in gaps + level bonuses
- 8 skins with unique visual effects (fire particles, matrix rain, cosmic stars, etc.)
- 5 power-ups: Shield, Slow-Mo, Mini Bert, 2X Coins, Coin Magnet
- Parallax city skyline with starfield background
- Local weekly leaderboard with countdown timer
- Telegram WebApp SDK integration

### Bot Server (`bot.js`)
- `/start` — Welcome message + Play button
- `/play` — Launch the Mini App inline
- `/leaderboard` — Generates and sends a beautiful PNG leaderboard card
- `/mystats` — Personal stats card with weekly rank, best score, games played
- `/help` — Command reference
- Inline "Play Again" and "Leaderboard" buttons after game over
- Automatic weekly reset at 00:00 UTC every Monday

### REST API
- `POST /api/score` — Submit scores from the Mini App
- `GET /api/leaderboard` — JSON leaderboard data
- `GET /api/leaderboard/image` — PNG leaderboard card
- `GET /api/player/:id` — Player stats JSON
- `GET /api/player/:id/card` — Player stats PNG card
- `GET /health` — Health check

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token
4. Send `/setmenubutton` → select your bot → send your webapp URL

### 2. Install Dependencies

```bash
cd flappy-bert-bot
npm install
```

> **Note:** `canvas` (node-canvas) requires system libs.
> On Ubuntu/Debian: `sudo apt install build-essential libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev librsvg2-dev`
> On macOS: `brew install pkg-config cairo pango libpng jpeg giflib librsvg`

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values:
#   BOT_TOKEN=your_token_from_botfather
#   WEBAPP_URL=https://your-domain.com/flappy_bert.html
#   PORT=3000
#   API_SECRET=optional_shared_secret
```

### 4. Host the Game HTML

The Mini App (`flappy_bert.html`) must be served over HTTPS.
Options:
- **Vercel / Netlify / Cloudflare Pages** — Drop the HTML file in a static site
- **Your own server** — Serve it with nginx, caddy, or the Express server itself
- **GitHub Pages** — Push to a repo and enable Pages

After hosting, update `WEBAPP_URL` in `.env` and `API_BASE` in the HTML file.

### 5. Connect the Game to the API

In `flappy_bert.html`, find this line near the bottom:
```js
const API_BASE = ''; // Set to your server URL
```
Change it to your server's public URL:
```js
const API_BASE = 'https://your-server.com';
```

### 6. Register the Mini App

Tell BotFather about your webapp:
1. Message @BotFather
2. `/mybots` → select your bot → Bot Settings → Menu Button
3. Set the URL to your hosted `flappy_bert.html`

### 7. Run the Bot

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start

# Or with PM2
pm2 start bot.js --name flappy-bert
```

## Deployment Options

### Railway / Render / Fly.io
```bash
# These platforms auto-detect Node.js
# Set environment variables in their dashboard
# The bot uses polling, so no webhook setup needed
```

### VPS (with PM2)
```bash
npm install -g pm2
pm2 start bot.js --name flappy-bert
pm2 save
pm2 startup
```

### Docker
```dockerfile
FROM node:20
RUN apt-get update && apt-get install -y \
    build-essential libcairo2-dev libjpeg-dev \
    libpango1.0-dev libgif-dev librsvg2-dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "bot.js"]
```

## Weekly Reset

The leaderboard automatically resets every Monday at 00:00 UTC.
- All scores from the previous week are kept in the database for history
- The leaderboard query filters by the current week's start date
- The countdown timer is shown on both the game UI and the card image

## File Structure

```
flappy-bert-bot/
├── bot.js              # Main bot + Express server
├── db.js               # SQLite database module
├── leaderboard-card.js # Canvas PNG renderer
├── package.json
├── .env.example
├── .env                # Your config (git-ignored)
└── flappy_bert.db      # Auto-created SQLite database

flappy_bert.html        # The game (host separately over HTTPS)
```

## Customisation

### Adding Skins
Edit the `SKINS` array in `flappy_bert.html` and add matching entries in
`SKIN_COLOURS` in `leaderboard-card.js`.

### Difficulty Tuning
In `flappy_bert.html`, adjust these in the `updateDifficulty()` function:
- `G.baseSpeed` — Starting pipe scroll speed
- `G.basePipeGap` — Starting gap between pipes
- Speed increment per level
- Gap reduction per level
- Moving pipe threshold level

### Leaderboard Card Style
Edit `leaderboard-card.js` — all colours, fonts, and layout constants are
defined at the top of the file. The card uses `node-canvas` which supports
any system fonts plus custom font registration.
