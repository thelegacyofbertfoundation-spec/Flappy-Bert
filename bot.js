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
const crypto    = require('crypto');
const db          = require('./db');
const { loadTournamentsFromFile, getFeaturedTournament } = require('./tournaments-config');
const { renderLeaderboardCard, renderPlayerCard, renderTournamentCard } = require('./leaderboard-card');

// ── Config ──────────────────────────────────────────────────────────
const BOT_TOKEN  = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-domain.com/flappy_bert.html';
const PORT       = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || '';

// ── Anti-cheat: game sessions ────────────────────────────────────────
const gameSessions = new Map(); // sessionId -> { telegramId, startedAt, used }
const SCORE_LIMITS = {
  MAX_SCORE_PER_SECOND: 2.5,    // generous — accounts for 2x multiplier
  MAX_ABSOLUTE_SCORE: 500,       // hard cap — anything above is cheating
  MIN_GAME_DURATION_MS: 2000,    // must play at least 2 seconds
};

// Clean up old sessions every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, sess] of gameSessions) {
    if (sess.startedAt < cutoff) gameSessions.delete(id);
  }
}, 5 * 60 * 1000);

function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function validateTelegramInitData(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const sorted = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computed !== hash) return null;
    const user = params.get('user');
    return user ? JSON.parse(user) : null;
  } catch(e) { return null; }
}

function validateScore(session, body) {
  const { score, level, shieldUsed, adContinueUsed, scoreMultiplier } = body;
  const issues = [];

  // 1. Hard score cap — only true hard reject
  if (score > SCORE_LIMITS.MAX_ABSOLUTE_SCORE) {
    console.log(`🚫 Score REJECTED: score=${score} exceeds hard cap`);
    return { valid: false, reason: 'exceeds_cap' };
  }

  // 2. Session checks — log but allow if missing (network can fail)
  if (!session) {
    issues.push('no_session');
  } else {
    if (session.used) {
      issues.push('session_reused');
    }

    // Time-based checks only if we have a session
    const elapsed = Date.now() - session.startedAt;
    if (elapsed < SCORE_LIMITS.MIN_GAME_DURATION_MS && score > 5) {
      issues.push('too_fast');
    }

    // Scale rate limit by score multiplier (1x, 1.5x, or 2x)
    const mult = (scoreMultiplier === 1.5 || scoreMultiplier === 2) ? scoreMultiplier : 1;
    let maxScorePerSecond = SCORE_LIMITS.MAX_SCORE_PER_SECOND * mult;

    // Further relax when shield/ad continue used
    if (shieldUsed && adContinueUsed) {
      maxScorePerSecond *= 1.5;
    } else if (shieldUsed) {
      maxScorePerSecond *= 1.2;
    } else if (adContinueUsed) {
      maxScorePerSecond *= 1.2;
    }

    const maxScoreForTime = Math.ceil((elapsed / 1000) * maxScorePerSecond);
    if (score > maxScoreForTime && score > 10) {
      issues.push('score_exceeds_time');
    }
  }

  if (issues.length > 0) {
    const tid = session ? session.telegramId : 'unknown';
    console.log(`⚠️  Score flagged [${tid}]: score=${score} issues=[${issues.join(',')}]`);
  }

  // Reject replay attacks
  if (issues.includes('session_reused') && score > 20) {
    return { valid: false, reason: 'session_reused' };
  }
  // Reject sessionless high scores (curl attacks)
  if (issues.includes('no_session') && score > 30) {
    return { valid: false, reason: 'no_session_high_score' };
  }
  // Reject impossibly fast scores
  if (issues.includes('too_fast') && score > 15) {
    return { valid: false, reason: 'too_fast' };
  }
  // Reject scores exceeding time-based limit
  if (issues.includes('score_exceeds_time') && score > 30) {
    return { valid: false, reason: 'score_exceeds_time' };
  }

  return { valid: true, issues, flagged: issues.length > 0 };
}

// Escape Telegram Markdown V1 special characters in user/operator-supplied strings.
// V1 has 4 specials: _ * ` [
// V1 has no backslash-escape mechanism, but Telegram tolerates a leading backslash
// before V1 specials and renders them as the literal char (verified empirically).
function escapeMarkdown(s) {
  if (s == null) return '';
  return String(s).replace(/([_*`\[])/g, '\\$1');
}

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
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));

// Simple rate limiter — per IP, 30 requests per minute
const rateLimits = new Map();
function rateLimit(limit = 30, windowMs = 60000) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    rateLimits.set(key, entry);
    if (entry.count > limit) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}
// Clean rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 5 * 60 * 1000);

// Seed tournaments from config file (idempotent — INSERT OR IGNORE on id)
const TOURNAMENTS_CONFIG_PATH = path.join(__dirname, 'tournaments.json');
const seededTournaments = loadTournamentsFromFile(TOURNAMENTS_CONFIG_PATH);
for (const t of seededTournaments) {
  db.createTournament(t.id, t.name, t.sponsor, t.startTime, t.endTime);
}
console.log(`Loaded ${seededTournaments.length} tournament(s) from config`);

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
    `Hey ${escapeMarkdown(user.first_name)}! Ready to flap?`,
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
        `📊 *Stats for ${escapeMarkdown(player.first_name)}*`,
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
    '🏟 /tournament — Tournament leaderboard',
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

// ── Admin: /ban <telegram_id> — Remove cheater from all leaderboards ─
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);

bot.onText(/\/ban(?:\s+(\d+))?/, (msg, match) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  
  const targetId = match[1] ? parseInt(match[1]) : null;
  if (!targetId) {
    bot.sendMessage(msg.chat.id, '⚠️ Usage: /ban <telegram_id>');
    return;
  }
  
  try {
    // Permanently ban — blocks all future score submissions
    db.banPlayer(targetId, 'banned by admin');
    
    // Remove all existing scores
    db.removeAllPlayerScores(targetId);
    const tournaments = db.getAllTournaments();
    tournaments.forEach(t => db.removeTournamentScores(targetId, t.id));
    
    const player = db.getPlayer(targetId);
    const name = player ? player.first_name : 'Unknown';
    
    bot.sendMessage(msg.chat.id, `🚫 Permanently banned *${escapeMarkdown(name)}* (${targetId})\n\nAll scores removed. Future submissions blocked.`, { parse_mode: 'Markdown' });
    console.log(`🚫 Admin ${msg.from.id} banned player ${targetId}`);
  } catch(err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

bot.onText(/\/unban(?:\s+(\d+))?/, (msg, match) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  
  const targetId = match[1] ? parseInt(match[1]) : null;
  if (!targetId) {
    bot.sendMessage(msg.chat.id, '⚠️ Usage: /unban <telegram_id>');
    return;
  }
  
  try {
    db.unbanPlayer(targetId);
    const player = db.getPlayer(targetId);
    const name = player ? player.first_name : 'Unknown';
    bot.sendMessage(msg.chat.id, `✅ Unbanned *${escapeMarkdown(name)}* (${targetId})`, { parse_mode: 'Markdown' });
  } catch(err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

bot.onText(/\/resettournament/, (msg) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;

  try {
    // Reset the live tournament if one exists, else most-recently-ended
    const allTourneys = db.getAllTournaments();
    const now = new Date();
    const live = allTourneys.find(t => new Date(t.start_time) <= now && now <= new Date(t.end_time));
    const recentEnded = allTourneys
      .filter(t => now > new Date(t.end_time))
      .sort((a, b) => new Date(b.end_time) - new Date(a.end_time))[0];
    const target = live || recentEnded;
    if (!target) {
      bot.sendMessage(msg.chat.id, '🏟 No tournament to reset.');
      return;
    }
    db.resetTournamentScores(target.id);
    bot.sendMessage(msg.chat.id, `🗑 Tournament scores wiped for *${escapeMarkdown(target.name)}*.`, { parse_mode: 'Markdown' });
    console.log(`🗑 Admin ${msg.from.id} reset tournament scores for ${target.id}`);
  } catch(err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
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

// ── /tournament [keyword] — show tournament card (defaults to live, else most-recent-ended)
bot.onText(/^\/tournament(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const arg = (match && match[1] || '').trim().toLowerCase();
  const tournaments = db.getAllTournaments();

  if (tournaments.length === 0) {
    bot.sendMessage(chatId, '🏟 No tournaments yet. Stay tuned!');
    return;
  }

  const withStatus = tournaments.map(t => {
    const now = new Date();
    const start = new Date(t.start_time);
    const end = new Date(t.end_time);
    let status = 'ended';
    if (now < start) status = 'scheduled';
    else if (now <= end) status = 'live';
    return { ...t, status };
  });

  let chosen;
  if (arg) {
    const matches = withStatus.filter(t =>
      t.id.toLowerCase().includes(arg) ||
      t.name.toLowerCase().includes(arg)
    );
    if (matches.length === 0) {
      bot.sendMessage(chatId, `🏟 No tournament matching "${arg}". Try /tournament with no args.`);
      return;
    }
    if (matches.length > 1) {
      const list = matches.map(t => `• ${t.name} (${t.id})`).join('\n');
      bot.sendMessage(chatId, `🏟 Multiple matches:\n${list}\n\nTry a more specific keyword.`);
      return;
    }
    chosen = matches[0];
  } else {
    chosen = withStatus.find(t => t.status === 'live')
      || withStatus.filter(t => t.status === 'ended').sort((a, b) => new Date(b.end_time) - new Date(a.end_time))[0]
      || withStatus[0];
  }

  // Build a human-readable status string for the card overlay + caption.
  const now = new Date();
  const start = new Date(chosen.start_time);
  const end = new Date(chosen.end_time);
  let statusText;
  if (chosen.status === 'scheduled') {
    const diff = start.getTime() - now.getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    statusText = `⏳ Starts in ${h}h ${m}m`;
  } else if (chosen.status === 'live') {
    const diff = end.getTime() - now.getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    statusText = `🔴 LIVE — Ends in ${h}h ${m}m`;
  } else {
    statusText = '🏁 Tournament ended';
  }

  try {
    const entries = db.getTournamentLeaderboard(chosen.id, 50);
    const pngBuffer = renderTournamentCard(entries, {
      name: chosen.name,
      sponsor: chosen.sponsor,
      status: statusText,
      highlightId: msg.from.id,
    });

    const rank = db.getTournamentPlayerRank(chosen.id, msg.from.id);
    const rankText = rank ? `\n🏅 Your rank: #${rank}` : '';

    await bot.sendPhoto(chatId, pngBuffer, {
      caption: `🏟 *${escapeMarkdown(chosen.name)}*\nSponsored by ${escapeMarkdown(chosen.sponsor)}\n\n${statusText}${rankText}\n\nUse /play to compete!`,
      parse_mode: 'Markdown',
    }, {
      filename: 'tournament.png',
      contentType: 'image/png',
    });
  } catch (err) {
    console.error('Tournament card render failed:', err.message);
    bot.sendMessage(chatId, '❌ Failed to generate tournament leaderboard.');
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
      `📊 Score: *${Number(data.score) || 0}*`,
      `📈 Level: ${Number(data.level) || 0}`,
      `🪙 Coins earned: +${Number(data.coinsEarned) || 0}`,
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

// Middleware: API secret check — fail-closed when API_SECRET is unset so
// admin endpoints can never be hit by an unauthenticated caller.
function authMiddleware(req, res, next) {
  if (!API_SECRET) {
    return res.status(503).json({ error: 'Admin endpoints disabled (API_SECRET not configured)' });
  }
  if (req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/session — Start a game session (called when game starts)
app.post('/api/session', rateLimit(10, 60000), (req, res) => {
  const { telegram_id, init_data } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });

  // Validate Telegram identity if initData provided
  if (init_data) {
    const verified = validateTelegramInitData(init_data);
    if (!verified || String(verified.id) !== String(telegram_id)) {
      return res.status(403).json({ error: 'Invalid Telegram identity' });
    }
  }

  const sessionId = generateSessionId();
  gameSessions.set(sessionId, {
    id: sessionId,
    telegramId: telegram_id,
    startedAt: Date.now(),
    used: false,
  });
  
  res.json({ session_id: sessionId, server_time: Date.now() });
});

// POST /api/score
// Body: { telegram_id, first_name, username?, score, level, coins_earned, session_id, duration }
app.post('/api/score', rateLimit(10, 60000), (req, res) => {
  try {
    const {
      telegram_id, first_name, username,
      score, level, coins_earned,
      session_id, duration,
      badges, shieldUsed, adContinueUsed, scoreMultiplier
    } = req.body;

    if (!telegram_id || score == null) {
      return res.status(400).json({ error: 'telegram_id and score are required' });
    }

    // Validate Telegram identity if initData provided
    if (req.body.init_data) {
      const verified = validateTelegramInitData(req.body.init_data);
      if (!verified || String(verified.id) !== String(telegram_id)) {
        return res.status(403).json({ error: 'Invalid Telegram identity' });
      }
    }

    // Check if player is banned
    if (db.isBanned(telegram_id)) {
      return res.status(403).json({ error: 'Player is banned' });
    }

    // Validate with anti-cheat
    const session = gameSessions.get(session_id);

    // Check session belongs to this user
    if (session && session.telegramId !== telegram_id) {
      console.log(`⚠️  Session hijack attempt: session=${session_id} owner=${session.telegramId} submitter=${telegram_id}`);
      return res.status(403).json({ error: 'Invalid session' });
    }

    const validation = validateScore(session, { score, level, coins_earned, duration, shieldUsed, adContinueUsed, scoreMultiplier });

    if (!validation.valid) {
      console.log(`🚫 Score REJECTED [${telegram_id}]: score=${score} reason=${validation.reason || validation.issues.join(',')}`);
      return res.status(403).json({ error: 'Score rejected', reason: validation.reason });
    }

    // Mark session as used
    if (session) session.used = true;

    db.upsertPlayer(telegram_id, first_name || 'Player', username || null);
    db.submitScore(telegram_id, score, level || 1, coins_earned || 0);

    // Store badges if provided
    if (badges && Array.isArray(badges)) {
      db.updatePlayerBadges(telegram_id, badges);
    }

    const rank = db.getPlayerRank(telegram_id);

    res.json({ ok: true, rank, weekStart: db.getWeekStart(), flagged: validation.flagged });
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
// Body: { init_data, image_base64, score }
// Auth: chat_id derived from verified initData; body's telegram_id is ignored.
app.post('/api/share', rateLimit(5, 60000), async (req, res) => {
  try {
    const { init_data, image_base64, score } = req.body;

    // Auth: derive chat_id from verified Telegram identity, not the body.
    const verified = init_data ? validateTelegramInitData(init_data) : null;
    if (!verified || !verified.id) {
      return res.status(403).json({ error: 'Invalid Telegram identity' });
    }
    const chatId = verified.id;

    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 required' });
    }

    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Caption is server-supplied, not caller-supplied. No HTML parse mode.
    const caption = `🐕 Flappy Bert Score: ${score || '?'}\n\n🎮 Can you beat me?\n🔗 Play now: ${WEBAPP_URL}`;

    await bot.sendPhoto(chatId, imageBuffer, {
      caption,
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

// ── Tournament API ───────────────────────────────────────────────────

// GET /api/tournaments — List all tournaments with status
app.get('/api/tournaments', (req, res) => {
  const tournaments = db.getAllTournaments().map(t => {
    const now = new Date();
    const start = new Date(t.start_time);
    const end = new Date(t.end_time);
    let status = 'ended';
    if (now < start) status = 'scheduled';
    else if (now <= end) status = 'live';
    return { ...t, status };
  });
  res.json({ tournaments });
});

// GET /api/tournaments/featured — Returns the single featured tournament
// for the home-screen button, or null if none qualify.
app.get('/api/tournaments/featured', (req, res) => {
  const all = db.getAllTournaments().map(t => ({
    id: t.id,
    name: t.name,
    sponsor: t.sponsor,
    startTime: t.start_time,
    endTime: t.end_time,
  }));
  const featured = getFeaturedTournament(all, new Date());
  res.json({ tournament: featured });
});

// GET /api/tournament/:id — Tournament info + leaderboard
app.get('/api/tournament/:id', (req, res) => {
  const t = db.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  
  const now = new Date();
  const start = new Date(t.start_time);
  const end = new Date(t.end_time);
  let status = 'ended';
  if (now < start) status = 'scheduled';
  else if (now <= end) status = 'live';
  
  const entries = db.getTournamentLeaderboard(t.id, 50);
  res.json({ tournament: { ...t, status }, entries });
});

// POST /api/tournament/:id/score — Submit score to tournament
app.post('/api/tournament/:id/score', (req, res) => {
  const t = db.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  
  const now = new Date();
  const start = new Date(t.start_time);
  const end = new Date(t.end_time);
  if (now < start || now > end) {
    return res.status(400).json({ error: 'Tournament not active' });
  }
  
  const { telegram_id, score, level, coins_earned, session_id } = req.body;
  if (!telegram_id || score == null) {
    return res.status(400).json({ error: 'telegram_id and score required' });
  }
  
  if (db.isBanned(telegram_id)) {
    return res.status(403).json({ error: 'Player is banned' });
  }
  
  // Anti-cheat: hard cap + session check
  if (score > SCORE_LIMITS.MAX_ABSOLUTE_SCORE) {
    console.log(`🚫 Tournament score REJECTED [${telegram_id}]: score=${score} exceeds cap`);
    return res.status(403).json({ error: 'Score rejected' });
  }
  const session = gameSessions.get(session_id);
  if (session && session.telegramId !== telegram_id) {
    return res.status(403).json({ error: 'Invalid session' });
  }
  
  db.submitTournamentScore(req.params.id, telegram_id, score, level || 1, coins_earned || 0);
  const rank = db.getTournamentPlayerRank(req.params.id, telegram_id);
  res.json({ ok: true, rank });
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

// POST /api/admin/remove-scores — Remove a player's scores (requires API_SECRET)
app.post('/api/admin/remove-scores', authMiddleware, (req, res) => {
  const { telegram_id, week_only } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
  
  try {
    if (week_only) {
      const week = db.getWeekStart();
      db.removePlayerWeekScores(telegram_id, week);
      console.log(`🗑  Removed weekly scores for ${telegram_id} (week: ${week})`);
    } else {
      db.removeAllPlayerScores(telegram_id);
      console.log(`🗑  Removed ALL scores for ${telegram_id}`);
    }
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/remove-tournament-scores — Remove from tournament
app.post('/api/admin/remove-tournament-scores', authMiddleware, (req, res) => {
  const { telegram_id, tournament_id } = req.body;
  if (!telegram_id || !tournament_id) return res.status(400).json({ error: 'telegram_id and tournament_id required' });
  
  try {
    db.removeTournamentScores(telegram_id, tournament_id);
    console.log(`🗑  Removed tournament scores for ${telegram_id} from ${tournament_id}`);
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Serve the game HTML from the same directory
app.get('/game', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
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
