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
const { scoreVerdict } = require('./lib/score-validation');
const { allowedBadges } = require('./lib/badge-allowlist');
const { parseGhost, buildStartParam, formatChallengeMessage } = require('./lib/ghost-challenge');
const { renderLeaderboardCard, renderPlayerCard, renderTournamentCard } = require('./leaderboard-card');

// ── Config ──────────────────────────────────────────────────────────
const BOT_TOKEN  = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-domain.com/flappy_bert.html';
const PORT       = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || '';

// ── Anti-cheat: game sessions ────────────────────────────────────────
// Score-validation limits now live in ./lib/score-validation (required above).
const gameSessions = new Map(); // sessionId -> { telegramId, startedAt, used }
const SESSION_TTL_MS = 15 * 60 * 1000;   // shortened from 30m (memory-DoS hardening)
const MAX_SESSIONS = 50000;              // hard ceiling; evict oldest on overflow
const MAX_RATE_KEYS = 50000;             // hard ceiling for the rate-limit Map
const INITDATA_MAX_AGE_S = 24 * 3600;    // initData replay bound (lenient for long sessions)

// Evict oldest sessions until under the ceiling. Map keys iterate in insertion
// (≈ start-time) order, so the first key is the oldest — O(1) per eviction.
function boundSessions() {
  while (gameSessions.size >= MAX_SESSIONS) {
    const oldest = gameSessions.keys().next().value;
    if (oldest === undefined) break;
    gameSessions.delete(oldest);
  }
}

// Clean up expired sessions every minute
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, sess] of gameSessions) {
    if (sess.startedAt < cutoff) gameSessions.delete(id);
  }
}, 60 * 1000);

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
    // Freshness: reject initData older than INITDATA_MAX_AGE_S to bound replay of
    // a captured initData string (Telegram always stamps auth_date).
    const authDate = Number(params.get('auth_date'));
    if (!authDate || (Date.now() / 1000 - authDate) > INITDATA_MAX_AGE_S) return null;
    const user = params.get('user');
    return user ? JSON.parse(user) : null;
  } catch(e) { return null; }
}

// Require a cryptographically-verified Telegram identity. Returns the verified
// user object (from the signed initData), or null AFTER sending a 403 — callers
// MUST `return` when it returns null. Identity is derived ONLY from the signed
// payload; body-supplied telegram_id/first_name/username are never trusted.
function requireVerifiedUser(req, res) {
  const initData = req.body && req.body.init_data;
  const verified = initData ? validateTelegramInitData(initData) : null;
  if (!verified || verified.id == null) {
    res.status(403).json({ error: 'Telegram identity required' });
    return null;
  }
  return verified; // { id, first_name, username, ... } — cryptographically attested
}

// Server-side score validation. Identity is enforced separately by
// requireVerifiedUser; this checks only score/level/coins against
// server-trusted state (all HARD rejects; body-supplied rate inflators are
// ignored). Decision logic lives in ./lib/score-validation (scoreVerdict).
function validateScore(session, body, board) {
  const elapsedMs = session ? (Date.now() - session.startedAt) : 0;
  // Single-use is tracked PER BOARD so one game can record to BOTH the weekly and
  // the tournament leaderboard, while still blocking a replay to either board.
  const usedFlag = board === 'tournament' ? 'usedTournament' : 'usedWeekly';
  return scoreVerdict({
    score: body.score,
    level: body.level,
    coins: body.coins_earned,
    hasSession: !!session,
    sessionUsed: !!(session && session[usedFlag]),
    elapsedMs,
  });
}

// Escape Telegram Markdown V1 special characters in user/operator-supplied strings.
// V1 has 4 specials: _ * ` [
// V1 has no backslash-escape mechanism, but Telegram tolerates a leading backslash
// before V1 specials and renders them as the literal char (verified empirically).
function escapeMarkdown(s) {
  if (s == null) return '';
  return String(s).replace(/([_*`\[])/g, '\\$1');
}

// When a request reaches /api/score or /api/tournament/:id/score without a
// first_name (sessionless curl, mini-app pre-load, Telegram clients that strip
// it), fall back to a stable per-id anonymous name. Avoids namespace collision
// on "Player" — every fallback used to share that one name and they all
// false-highlighted as "you" on each others' leaderboards.
function anonName(telegramId) {
  return 'Anon-' + String(telegramId).slice(-4);
}

if (!BOT_TOKEN) {
  console.error('❌  BOT_TOKEN environment variable is required.');
  console.error('   Get one from @BotFather on Telegram.');
  process.exit(1);
}

// ── Initialise ──────────────────────────────────────────────────────
db.init();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let botUsername = null;
bot.getMe().then((me) => { botUsername = me.username || null; }).catch(() => {});
const app = express();
app.use(cors());
app.set('trust proxy', 1);
// Minimal security headers. Deliberately NO X-Frame-Options / restrictive
// frame-ancestors — the game runs inside Telegram's in-app webview (framed).
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
// Body-size: tiny globally; only /api/share needs room for a base64 PNG upload
// (a score-card PNG is well under 2mb — bounds the share relay).
const smallJson = express.json({ limit: '64kb' });
const largeJson = express.json({ limit: '2mb' });
app.use((req, res, next) => (req.path === '/api/share' ? largeJson : smallJson)(req, res, next));

// Simple rate limiter — per IP, 30 requests per minute
const rateLimits = new Map();
function rateLimit(limit = 30, windowMs = 60000) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    // Bound the Map: evict the oldest key when at the ceiling (memory-DoS guard).
    if (rateLimits.size >= MAX_RATE_KEYS && !rateLimits.has(key)) {
      const oldest = rateLimits.keys().next().value;
      if (oldest !== undefined) rateLimits.delete(oldest);
    }
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
bot.onText(/\/start(?:\s+(\S+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const user   = msg.from;

  db.upsertPlayer(user.id, user.first_name, user.username);

  // Beat-My-Ghost: a "/start g_<id>_<score>" deep-link → personalized challenge.
  const challenge = match && match[1] ? parseGhost(match[1]) : null;
  if (challenge) {
    const sharer = db.getPlayer(challenge.id);
    const name = (sharer && (sharer.first_name || sharer.username)) || null;
    const ghostUrl = WEBAPP_URL + (WEBAPP_URL.includes('?') ? '&' : '?') +
      'ghost=' + encodeURIComponent(buildStartParam(challenge.id, challenge.score));
    bot.sendMessage(chatId, formatChallengeMessage(name, challenge.score), {
      reply_markup: { inline_keyboard: [[
        { text: '▶ Beat it!', web_app: { url: ghostUrl } },
      ]] },
    });
    return;
  }

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
    
    // Remove all existing scores + forged badges
    db.removeAllPlayerScores(targetId);
    db.updatePlayerBadges(targetId, []);
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

    // Scores are recorded ONLY via the validated /api/score path (mandatory
    // initData + anti-cheat). The shipped client does not use Telegram sendData;
    // this handler must NOT write unvalidated, session-less scores to the shared
    // board — it only echoes a game-over message based on already-recorded state.
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
  const provided = Buffer.from(String(req.headers['x-api-secret'] || ''));
  const expected = Buffer.from(API_SECRET);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/session — Start a game session (called when game starts)
app.post('/api/session', rateLimit(10, 60000), (req, res) => {
  const verified = requireVerifiedUser(req, res);
  if (!verified) return;

  boundSessions();
  const sessionId = generateSessionId();
  gameSessions.set(sessionId, {
    id: sessionId,
    telegramId: verified.id,
    startedAt: Date.now(),
    usedWeekly: false,
    usedTournament: false,
  });

  res.json({ session_id: sessionId, server_time: Date.now() });
});

// POST /api/score
// Body: { init_data (required), score, level, coins_earned, session_id, badges? }
// Identity (telegram_id / first_name / username) is derived from the verified init_data.
app.post('/api/score', rateLimit(10, 60000), (req, res) => {
  try {
    const verified = requireVerifiedUser(req, res);
    if (!verified) return;
    const telegram_id = verified.id;

    const { score, level, coins_earned, session_id, badges } = req.body;
    if (score == null) {
      return res.status(400).json({ error: 'score is required' });
    }

    // Check if player is banned (by verified identity)
    if (db.isBanned(telegram_id)) {
      return res.status(403).json({ error: 'Player is banned' });
    }

    // Session must belong to this verified user
    const session = gameSessions.get(session_id);
    if (session && session.telegramId !== telegram_id) {
      console.log(`⚠️  Session hijack attempt: session=${session_id} owner=${session.telegramId} submitter=${telegram_id}`);
      return res.status(403).json({ error: 'Invalid session' });
    }

    const validation = validateScore(session, { score, level, coins_earned }, 'weekly');
    if (!validation.valid) {
      console.log(`🚫 Score REJECTED [${telegram_id}]: score=${score} reason=${validation.reason}`);
      return res.status(403).json({ error: 'Score rejected', reason: validation.reason });
    }

    // Consume this session's WEEKLY slot. Per-board single-use, so the same game
    // can still record to the tournament board (separate slot) — but a weekly
    // replay on this session is rejected.
    if (session) session.usedWeekly = true;

    // Identity comes from the verified initData; db.upsertPlayer sanitizes the name.
    db.upsertPlayer(telegram_id, verified.first_name || anonName(telegram_id), verified.username || null);
    db.submitScore(telegram_id, Number(score), validation.level, validation.coins);

    // Badges: allowlist + score-gate + union-with-existing (no forgery).
    if (Array.isArray(badges)) {
      let existing = [];
      try { existing = JSON.parse(db.getPlayer(telegram_id)?.badges || '[]'); } catch (e) { existing = []; }
      db.updatePlayerBadges(telegram_id, allowedBadges(badges, Number(score), existing));
    }

    const rank = db.getPlayerRank(telegram_id);
    res.json({ ok: true, rank, weekStart: db.getWeekStart(), flagged: false });
  } catch (err) {
    console.error('API score error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/leaderboard?limit=20
app.get('/api/leaderboard', rateLimit(30, 60000), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const entries = db.getWeeklyLeaderboard(limit);
  res.json({
    week:     db.getWeekStart(),
    resetIn:  getResetCountdown(),
    entries,
  });
});

// Bounded TTL cache for rendered PNGs — repeated requests hit memory, not the
// synchronous canvas renderer, closing the render-flood DoS. With the per-IP
// rate limit below, highlight-rotation can't force unbounded renders either.
const renderCache = new Map(); // key -> { buf, exp }
const RENDER_CACHE_TTL_MS = 60 * 1000;
const RENDER_CACHE_MAX = 200;
function cachedRender(key, produce) {
  const now = Date.now();
  const hit = renderCache.get(key);
  if (hit && hit.exp > now) {
    // LRU: re-insert so a hot entry isn't FIFO-evicted under key rotation.
    renderCache.delete(key);
    renderCache.set(key, hit);
    return hit.buf;
  }
  const buf = produce();
  renderCache.set(key, { buf, exp: now + RENDER_CACHE_TTL_MS });
  while (renderCache.size > RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next().value;
    if (oldest === undefined) break;
    renderCache.delete(oldest);
  }
  return buf;
}

// GET /api/leaderboard/image?highlight=TELEGRAM_ID
app.get('/api/leaderboard/image', rateLimit(20, 60000), (req, res) => {
  try {
    const board = db.getWeeklyLeaderboard(50);
    const reqHl = parseInt(req.query.highlight) || null;
    // Only honor highlight if the id is actually on the board — collapses
    // attacker-rotated fake ids to one cache key, neutralizing render-flood via
    // ?highlight rotation (the expensive toBuffer render stays cached).
    const highlightId = (reqHl && board.some((e) => e.telegram_id === reqHl)) ? reqHl : null;
    const key = `lb:${db.getWeekStart()}:${highlightId || 0}`;
    const pngBuffer = cachedRender(key, () => renderLeaderboardCard(board, {
      highlightId,
      resetIn:   getResetCountdown(),
      weekLabel:  getWeekLabel(),
    }));
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(pngBuffer);
  } catch (err) {
    console.error('API image error:', err);
    res.status(500).json({ error: 'Failed to render image' });
  }
});

// GET /api/player/:id
app.get('/api/player/:id', rateLimit(30, 60000), (req, res) => {
  const id = parseInt(req.params.id);
  const player  = db.getPlayer(id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const weekly  = db.getPlayerWeeklyBest(id);
  const rank    = db.getPlayerRank(id);
  const allTime = db.getAllTimeStats(id);
  res.json({ player, weekly, rank, allTime });
});

// GET /api/player/:id/card
app.get('/api/player/:id/card', rateLimit(20, 60000), (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const player  = db.getPlayer(id);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const key = `card:${db.getWeekStart()}:${id}`;
    const pngBuffer = cachedRender(key, () => {
      const weekly  = db.getPlayerWeeklyBest(id);
      const rank    = db.getPlayerRank(id);
      const allTime = db.getAllTimeStats(id);
      const statsData = {
        best_score:    weekly?.best_score || 0,
        games_played:  weekly?.games_played || 0,
        max_level:     weekly?.max_level || 0,
        all_time_best: allTime?.all_time_best || 0,
      };
      return renderPlayerCard(player, statsData, rank);
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=60');
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

    // Don't relay through the bot on behalf of a banned player.
    if (db.isBanned(chatId)) {
      return res.status(403).json({ error: 'Player is banned' });
    }

    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 required' });
    }

    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    // Validate it's actually a PNG (magic bytes) before relaying through the bot —
    // don't let the bot forward arbitrary attacker-supplied bytes.
    if (imageBuffer.length < 8 || imageBuffer[0] !== 0x89 || imageBuffer[1] !== 0x50 ||
        imageBuffer[2] !== 0x4e || imageBuffer[3] !== 0x47) {
      return res.status(400).json({ error: 'Invalid image' });
    }

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
app.get('/api/tournament/:id', rateLimit(30, 60000), (req, res) => {
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
app.post('/api/tournament/:id/score', rateLimit(10, 60000), (req, res) => {
  try {
    const t = db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });

    const now = new Date();
    const start = new Date(t.start_time);
    const end = new Date(t.end_time);
    if (now < start || now > end) {
      return res.status(400).json({ error: 'Tournament not active' });
    }

    const verified = requireVerifiedUser(req, res);
    if (!verified) return;
    const telegram_id = verified.id;

    const { score, level, coins_earned, session_id } = req.body;
    if (score == null) {
      return res.status(400).json({ error: 'score required' });
    }

    if (db.isBanned(telegram_id)) {
      return res.status(403).json({ error: 'Player is banned' });
    }

    // Session must belong to this verified user
    const session = gameSessions.get(session_id);
    if (session && session.telegramId !== telegram_id) {
      console.log(`⚠️  Tournament session hijack attempt: session=${session_id} owner=${session.telegramId} submitter=${telegram_id}`);
      return res.status(403).json({ error: 'Invalid session' });
    }

    // Full anti-cheat validation (numeric guard, hard cap, bounds, time-based, session reuse)
    const validation = validateScore(session, { score, level, coins_earned }, 'tournament');
    if (!validation.valid) {
      console.log(`🚫 Tournament score REJECTED [${telegram_id}]: score=${score} reason=${validation.reason}`);
      return res.status(403).json({ error: 'Score rejected', reason: validation.reason });
    }

    // Consume this session's TOURNAMENT slot (separate from the weekly slot).
    if (session) session.usedTournament = true;

    // Identity from verified initData; db.upsertPlayer sanitizes the name.
    db.upsertPlayer(telegram_id, verified.first_name || anonName(telegram_id), verified.username || null);
    db.submitTournamentScore(req.params.id, telegram_id, Number(score), validation.level, validation.coins);

    const rank = db.getTournamentPlayerRank(req.params.id, telegram_id);
    res.json({ ok: true, rank, flagged: false });
  } catch (err) {
    console.error('API tournament score error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/archives/:week — Download a specific week's CSV
app.get('/api/archives/:week', (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.week)) {
    return res.status(400).json({ error: 'Invalid week' });
  }
  const filepath = db.getArchivePath(req.params.week);
  if (!filepath) return res.status(404).json({ error: 'Archive not found' });
  res.download(filepath);
});

// POST /api/archive-now — Manually trigger archive for current week
app.post('/api/archive-now', rateLimit(10, 60000), authMiddleware, (req, res) => {
  const result = db.archiveWeek();
  if (!result) return res.json({ ok: false, message: 'No scores to archive' });
  res.json({ ok: true, ...result });
});

// POST /api/admin/remove-scores — Remove a player's scores (requires API_SECRET)
app.post('/api/admin/remove-scores', rateLimit(10, 60000), authMiddleware, (req, res) => {
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
app.post('/api/admin/remove-tournament-scores', rateLimit(10, 60000), authMiddleware, (req, res) => {
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

// Read-only: lets the client build t.me/<bot>?start=… challenge links.
app.get('/api/config', (req, res) => res.json({ botUsername }));

// Serve the game HTML from the same directory
app.get('/game', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'flappy_bert.html'));
});

// Terminal error handler — catches body-parser errors (malformed JSON, payload
// too large) and any uncaught route error. Returns a generic message so stack
// traces / filesystem paths / dependency versions never leak to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = (err && (err.status || err.statusCode)) || 500;
  console.error('Unhandled error:', err && err.message);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: 'Request failed' });
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

// Boot-time recovery: if any of the last 4 completed weeks is missing its
// CSV (e.g. bot was deploying or crashed across the Monday 00:00 UTC window),
// archive it now. archiveWeek is idempotent — returns {alreadyExists:true} if
// the file is there, so this is a no-op when the file system is up to date.
function recoverMissedArchives() {
  const currentWeek = db.getWeekStart();
  const currentMs = new Date(currentWeek + 'T00:00:00Z').getTime();
  for (let i = 1; i <= 4; i++) {
    const past = new Date(currentMs - i * 7 * 24 * 60 * 60 * 1000);
    const pastWeek = past.toISOString().slice(0, 10);
    const result = db.archiveWeek(pastWeek);
    if (result && !result.alreadyExists) {
      console.log(`✅  Boot-time archive recovery: archived week ${pastWeek} (${result.playerCount} players)`);
    }
  }
}

// Check every 10 minutes
setInterval(checkAutoArchive, 10 * 60 * 1000);
// Also check on startup (in case server restarted close to reset)
checkAutoArchive();
// Recover any missed weeks (bot down across a Monday reset)
recoverMissedArchives();
