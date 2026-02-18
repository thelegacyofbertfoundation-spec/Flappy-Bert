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
app.use(express.json({ limit: '5mb' }));

console.log('🐕  Flappy Bert Bot starting…');

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
    '🐕 *Welcome to Flappy Bert!*',
    '',
    `Hey ${user.first_name}! Ready to flap?`,
    '',
    'Tap to fly Bert through endless pipes, rack up combos, and earn coins. Climb the weekly leaderboard, complete daily challenges, and unlock skins in the shop.',
    '',
    '🏆 Weekly leaderboards — reset every Monday',
    '🎁 Regular Flap to Earn competitions',
    '🎯 Daily challenges & login streaks',
    '⭐ Score multipliers & custom skins',
    '',
    'Hit the button below to jump in 👇',
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
        { text: '🐕 Launch Flappy Bert', web_app: { url: WEBAPP_URL } }
      ]]
    }
  });
});

// ── /leaderboard — sends an image card ──────────────────────────────
bot.onText(/\/leaderboard/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const entries = db.getWeeklyLeaderboard(50);
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
    '🐕 *Flappy Bert Commands*',
    '',
    '🎮 /play — Launch the game',
    '🏆 /leaderboard — Weekly top 50 card',
    '📊 /mystats — Your personal stats card',
    '📁 /history — Past weekly leaderboard CSVs',
    '❓ /help — This message',
    '',
    '*How It Works:*',
    '• Tap to make Bert flap through pipes',
    '• Earn coins per pipe cleared + level bonuses',
    '• Difficulty increases every 10 pipes',
    '• Buy skins & multipliers in the shop',
    '• Leaderboard resets every Monday 00:00 UTC',
  ].join('\n'), { parse_mode: 'Markdown' });
});

// ── /history — Send past leaderboard CSVs ────────────────────────────
bot.onText(/\/history/, async (msg) => {
  const archives = db.getArchiveList();
  
  if (archives.length === 0) {
    bot.sendMessage(msg.chat.id, '📁 No archived leaderboards yet. Archives are saved each Monday at reset.');
    return;
  }
  
  // Send the most recent archive as a file
  const latest = archives[0];
  const filepath = db.getArchivePath(latest.week);
  
  if (filepath) {
    const caption = `📁 *Archived Leaderboards*\n\nSending most recent: \`${latest.week}\`\n\n${archives.length} total archive(s):\n${archives.map(a => `• ${a.week}`).join('\n')}`;
    
    await bot.sendMessage(msg.chat.id, caption, { parse_mode: 'Markdown' });
    await bot.sendDocument(msg.chat.id, filepath, {}, {
      filename: latest.filename,
      contentType: 'text/csv',
    });
  }
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
      const entries = db.getWeeklyLeaderboard(50);
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
    const entries = db.getWeeklyLeaderboard(50);
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

// POST /api/share — Send score card image to user's Telegram chat
// Body: { telegram_id, image_base64, score, caption? }
app.post('/api/share', async (req, res) => {
  try {
    const { telegram_id, image_base64, score, caption } = req.body;
    
    if (!telegram_id || !image_base64) {
      return res.status(400).json({ error: 'telegram_id and image_base64 required' });
    }
    
    // Strip data URL prefix if present
    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    const defaultCaption = `🐕 Flappy Bert Score: ${score || '?'}\n\n🎮 Can you beat me?\n🔗 Play now: ${WEBAPP_URL}`;
    
    await bot.sendPhoto(telegram_id, imageBuffer, {
      caption: caption || defaultCaption,
      parse_mode: 'HTML',
    }, {
      filename: 'flappy-bert-score.png',
      contentType: 'image/png',
    });
    
    res.json({ ok: true });
  } catch (err) {
    console.error('API share error:', err.message);
    res.status(500).json({ error: 'Failed to send image' });
  }
});

// GET /api/archives — List all archived weeks
app.get('/api/archives', (req, res) => {
  res.json({ archives: db.getArchiveList() });
});

// GET /api/archives/:week — Download a specific week's CSV
app.get('/api/archives/:week', (req, res) => {
  const filepath = db.getArchivePath(req.params.week);
  if (!filepath) return res.status(404).json({ error: 'Archive not found' });
  res.download(filepath);
});

// POST /api/archive-now — Manually trigger archive for current week
app.post('/api/archive-now', authMiddleware, (req, res) => {
  const result = db.archiveWeek();
  if (!result) return res.json({ ok: false, message: 'No scores to archive' });
  res.json({ ok: true, ...result });
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Serve the game HTML from the same directory
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'flappy_bert.html'));
});

// ── Start server ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🌐  API server running on port ${PORT}`);
  console.log(`🐕  Bot is polling for messages…`);
  console.log(`📅  Current week: ${db.getWeekStart()}`);
  console.log(`⏱   Reset in: ${getResetCountdown()}`);
  console.log('');
  console.log('Commands: /start /play /leaderboard /mystats /history /help');
});

// ── Auto-archive: check every 10 minutes, archive before Monday reset ──
let lastArchivedWeek = null;

function checkAutoArchive() {
  const now = new Date();
  const nextMonday = db.getNextMondayUTC();
  const msUntilReset = nextMonday.getTime() - now.getTime();
  const currentWeek = db.getWeekStart();
  
  // Archive if within 30 minutes of reset and not already archived this week
  if (msUntilReset <= 30 * 60 * 1000 && msUntilReset > 0 && lastArchivedWeek !== currentWeek) {
    const result = db.archiveWeek(currentWeek);
    if (result) {
      lastArchivedWeek = currentWeek;
      console.log(`✅  Auto-archived week ${currentWeek}`);
    }
  }
}

// Check every 10 minutes
setInterval(checkAutoArchive, 10 * 60 * 1000);
// Also check on startup (in case server restarted close to reset)
checkAutoArchive();
