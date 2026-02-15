// bot.js — Flappy Bert Telegram Bot & API Server
// ─────────────────────────────────────────────────────────────────────
//
// ENV VARS:
//   BOT_TOKEN       — Telegram bot token from @BotFather
//   WEBAPP_URL      — Public URL where flappy_bert.html is hosted
//   PORT            — HTTP port for the API server (default 3000)
//   API_SECRET      — Optional shared secret for score submissions
//
// COMMANDS:
//   /start          — Welcome + launch game button
//   /play           — Launch the Mini App
//   /leaderboard    — Weekly leaderboard card (image)
//   /mystats        — Personal stats card (image)
//   /help           — Command list
//
// API ENDPOINTS:
//   POST /api/score — Submit a score  { telegram_id, score, level, coins_earned }
//   GET  /api/leaderboard — JSON leaderboard
//   GET  /api/player/:id  — Player stats JSON
// ─────────────────────────────────────────────────────────────────────

// Load .env file if available (local dev only — Render injects env vars natively)
try { require('dotenv').config(); } catch(e) {}
const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const db          = require('./db');
const { renderLeaderboardCard, renderPlayerCard } = require('./leaderboard-card');

// ── Config ──────────────────────────────────────────────────────────
const BOT_TOKEN  = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-domain.com/flappy_bert.html';
const PORT       = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || '';

if (!BOT_TOKEN) {
  console.error('❌  BOT_TOKEN environment variable is required.');
  console.error('   Get one from @BotFather on Telegram.');
  process.exit(1);
}

// ── Initialise ──────────────────────────────────────────────────────
db.init();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
app.use(cors());
app.use(express.json());

console.log('🐱  Flappy Bert Bot starting…');

// ── Helper: time until next Monday 00:00 UTC ────────────────────────
function getResetCountdown() {
  const next = db.getNextMondayUTC();
  const diff = next.getTime() - Date.now();
  if (diff <= 0) return '0d 0h 0m';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${d}d ${h}h ${m}m`;
}

function getWeekLabel() {
  const start = new Date(db.getWeekStart() + 'T00:00:00Z');
  const end   = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
  return `${fmt(start)} – ${fmt(end)}`;
}

// ── /start ──────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const user   = msg.from;

  db.upsertPlayer(user.id, user.first_name, user.username);

  bot.sendMessage(chatId, [
    '🐱 *Welcome to Flappy Bert!*',
    '',
    'Tap to flap, dodge the pipes, earn coins!',
    '',
    '🏆 Weekly leaderboards reset every Monday at 00:00 UTC',
    '🛒 Spend coins on skins and power-ups in the shop',
    '',
    'Use the button below to launch the game, or try these commands:',
    '',
    '/leaderboard — Weekly top 20 (image card)',
    '/mystats — Your personal stats card',
    '/help — All commands',
  ].join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '🎮 Play Flappy Bert', web_app: { url: WEBAPP_URL } }
      ]]
    }
  });
});

// ── /play ───────────────────────────────────────────────────────────
bot.onText(/\/play/, (msg) => {
  bot.sendMessage(msg.chat.id, '🎮 Tap below to play!', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🐱 Launch Flappy Bert', web_app: { url: WEBAPP_URL } }
      ]]
    }
  });
});

// ── /leaderboard — sends an image card ──────────────────────────────
bot.onText(/\/leaderboard/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const entries = db.getWeeklyLeaderboard(20);
    const pngBuffer = renderLeaderboardCard(entries, {
      highlightId: msg.from.id,
      resetIn:     getResetCountdown(),
      weekLabel:   getWeekLabel(),
    });

    await bot.sendPhoto(chatId, pngBuffer, {
      caption: [
        '🏆 *Weekly Leaderboard*',
        `📅 ${getWeekLabel()}`,
        `⏱ Resets in ${getResetCountdown()}`,
        '',
        'Use /play to compete!',
      ].join('\n'),
      parse_mode: 'Markdown',
    }, {
      filename: 'leaderboard.png',
      contentType: 'image/png',
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    bot.sendMessage(chatId, '❌ Failed to generate leaderboard. Try again later.');
  }
});

// ── /mystats — personal stats image card ────────────────────────────
bot.onText(/\/mystats/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  db.upsertPlayer(userId, msg.from.first_name, msg.from.username);

  try {
    const player   = db.getPlayer(userId);
    const weekly   = db.getPlayerWeeklyBest(userId);
    const rank     = db.getPlayerRank(userId);
    const allTime  = db.getAllTimeStats(userId);

    const statsData = {
      best_score:   weekly?.best_score || 0,
      games_played: weekly?.games_played || 0,
      max_level:    weekly?.max_level || 0,
      all_time_best: allTime?.all_time_best || 0,
    };

    const pngBuffer = renderPlayerCard(player, statsData, rank);

    await bot.sendPhoto(chatId, pngBuffer, {
      caption: [
        `📊 *Stats for ${player.first_name}*`,
        `🏅 Weekly Rank: ${rank ? '#' + rank : 'Unranked'}`,
        `🪙 Coins: ${player.coins}`,
        '',
        'Use /play to improve your score!',
      ].join('\n'),
      parse_mode: 'Markdown',
    }, {
      filename: 'stats.png',
      contentType: 'image/png',
    });
  } catch (err) {
    console.error('Stats error:', err);
    bot.sendMessage(chatId, '❌ Failed to generate stats card. Try again later.');
  }
});

// ── /help ───────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, [
    '🐱 *Flappy Bert Commands*',
    '',
    '🎮 /play — Launch the game',
    '🏆 /leaderboard — Weekly top 20 card',
    '📊 /mystats — Your personal stats card',
    '❓ /help — This message',
    '',
    '*How It Works:*',
    '• Tap to make Bert flap through pipes',
    '• Earn coins per pipe cleared + level bonuses',
    '• Difficulty increases every 10 pipes',
    '• Buy skins & power-ups in the shop',
    '• Leaderboard resets every Monday 00:00 UTC',
  ].join('\n'), { parse_mode: 'Markdown' });
});

// ── Handle WebApp data (sent when game ends) ────────────────────────
bot.on('web_app_data', (msg) => {
  try {
    const data = JSON.parse(msg.web_app_data.data);
    const userId = msg.from.id;

    db.upsertPlayer(userId, msg.from.first_name, msg.from.username);
    db.submitScore(userId, data.score, data.level, data.coinsEarned);

    const rank = db.getPlayerRank(userId);
    const rankText = rank ? `You're #${rank} this week!` : '';

    bot.sendMessage(msg.chat.id, [
      `🎮 *Game Over!*`,
      ``,
      `📊 Score: *${data.score}*`,
      `📈 Level: ${data.level}`,
      `🪙 Coins earned: +${data.coinsEarned}`,
      rankText ? `🏅 ${rankText}` : '',
      '',
      'Use /leaderboard to see the rankings!',
    ].filter(Boolean).join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🔄 Play Again', web_app: { url: WEBAPP_URL } },
          { text: '🏆 Leaderboard', callback_data: 'show_leaderboard' },
        ]]
      }
    });
  } catch (err) {
    console.error('WebApp data error:', err);
  }
});

// ── Callback query handler ──────────────────────────────────────────
bot.on('callback_query', async (query) => {
  if (query.data === 'show_leaderboard') {
    await bot.answerCallbackQuery(query.id);
    try {
      const entries = db.getWeeklyLeaderboard(20);
      const pngBuffer = renderLeaderboardCard(entries, {
        highlightId: query.from.id,
        resetIn:     getResetCountdown(),
        weekLabel:   getWeekLabel(),
      });
      await bot.sendPhoto(query.message.chat.id, pngBuffer, {
        caption: `🏆 Weekly Leaderboard — resets in ${getResetCountdown()}`,
      }, {
        filename: 'leaderboard.png',
        contentType: 'image/png',
      });
    } catch (err) {
      console.error('Callback leaderboard error:', err);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
//  REST API — so the Mini App can submit scores directly via HTTP
// ═══════════════════════════════════════════════════════════════════

// Middleware: optional API secret check
function authMiddleware(req, res, next) {
  if (API_SECRET && req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/score
// Body: { telegram_id, first_name, username?, score, level, coins_earned }
app.post('/api/score', authMiddleware, (req, res) => {
  try {
    const { telegram_id, first_name, username, score, level, coins_earned } = req.body;

    if (!telegram_id || score == null) {
      return res.status(400).json({ error: 'telegram_id and score are required' });
    }

    db.upsertPlayer(telegram_id, first_name || 'Player', username || null);
    db.submitScore(telegram_id, score, level || 1, coins_earned || 0);

    const rank = db.getPlayerRank(telegram_id);

    res.json({ ok: true, rank, weekStart: db.getWeekStart() });
  } catch (err) {
    console.error('API score error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/leaderboard?limit=20
app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const entries = db.getWeeklyLeaderboard(limit);
  res.json({
    week:     db.getWeekStart(),
    resetIn:  getResetCountdown(),
    entries,
  });
});

// GET /api/leaderboard/image?highlight=TELEGRAM_ID
app.get('/api/leaderboard/image', (req, res) => {
  try {
    const entries = db.getWeeklyLeaderboard(20);
    const highlightId = parseInt(req.query.highlight) || null;
    const pngBuffer = renderLeaderboardCard(entries, {
      highlightId,
      resetIn:   getResetCountdown(),
      weekLabel:  getWeekLabel(),
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(pngBuffer);
  } catch (err) {
    console.error('API image error:', err);
    res.status(500).json({ error: 'Failed to render image' });
  }
});

// GET /api/player/:id
app.get('/api/player/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const player  = db.getPlayer(id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const weekly  = db.getPlayerWeeklyBest(id);
  const rank    = db.getPlayerRank(id);
  const allTime = db.getAllTimeStats(id);
  res.json({ player, weekly, rank, allTime });
});

// GET /api/player/:id/card
app.get('/api/player/:id/card', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const player  = db.getPlayer(id);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const weekly  = db.getPlayerWeeklyBest(id);
    const rank    = db.getPlayerRank(id);
    const allTime = db.getAllTimeStats(id);
    const statsData = {
      best_score:    weekly?.best_score || 0,
      games_played:  weekly?.games_played || 0,
      max_level:     weekly?.max_level || 0,
      all_time_best: allTime?.all_time_best || 0,
    };
    const pngBuffer = renderPlayerCard(player, statsData, rank);
    res.set('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (err) {
    console.error('API player card error:', err);
    res.status(500).json({ error: 'Failed to render card' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Serve the game HTML from the same server
app.use(express.static(path.join(__dirname, 'public')));
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'flappy_bert.html'));
});

// ── Start server ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🌐  API server running on port ${PORT}`);
  console.log(`🐱  Bot is polling for messages…`);
  console.log(`📅  Current week: ${db.getWeekStart()}`);
  console.log(`⏱   Reset in: ${getResetCountdown()}`);
  console.log('');
  console.log('Commands: /start /play /leaderboard /mystats /help');
});
