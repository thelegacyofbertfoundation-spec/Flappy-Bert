// leaderboard-card.js — Renders a leaderboard PNG using node-canvas
const { createCanvas, registerFont } = require('canvas');
const path = require('path');

// ── Colour palette (matches the game UI) ────────────────────────────
const C = {
  bgDark:    '#0a0e1a',
  bgCard:    '#141829',
  bgPanel:   '#1a1f38',
  bgRow:     '#1e2340',
  bgRowAlt:  '#1a1f38',
  accent:    '#ff6b35',
  accent2:   '#ffb800',
  accent3:   '#00e5ff',
  text:      '#e8e8f0',
  textDim:   '#7a7e9a',
  success:   '#44d62c',
  danger:    '#ff3860',
  gold:      '#ffd700',
  silver:    '#c0c0c0',
  bronze:    '#cd7f32',
  white:     '#ffffff',
};

// ── Skin colours (for the avatar dot) ───────────────────────────────
const SKIN_COLOURS = {
  default: '#ff6b35',
  neon:    '#00e5ff',
  golden:  '#ffd700',
  shadow:  '#8844ff',
  fire:    '#ff3860',
  ice:     '#88ddff',
  matrix:  '#44d62c',
  cosmic:  '#ff88ff',
};

// ── Layout constants ────────────────────────────────────────────────
const WIDTH        = 800;
const HEADER_H     = 130;
const ROW_H        = 44;
const ROW_GAP      = 4;
const PAD          = 28;
const FOOTER_H     = 60;
const CORNER_R     = 16;
const MAX_ENTRIES   = 20;

/**
 * Generate a leaderboard card as a PNG Buffer.
 *
 * @param {Array} entries    — from db.getWeeklyLeaderboard()
 * @param {Object} options
 * @param {number} options.highlightId  — telegram_id to highlight as "YOU"
 * @param {string} options.resetIn      — human-readable time until next reset
 * @param {string} options.weekLabel    — e.g. "Feb 9 – Feb 15, 2026"
 * @returns {Buffer} PNG image buffer
 */
function renderLeaderboardCard(entries, options = {}) {
  const count  = Math.min(entries.length, MAX_ENTRIES);
  const height = HEADER_H + count * (ROW_H + ROW_GAP) + FOOTER_H + PAD * 2;

  const canvas = createCanvas(WIDTH, height);
  const ctx    = canvas.getContext('2d');

  // ── Background ────────────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#0d1225');
  bgGrad.addColorStop(0.3, C.bgDark);
  bgGrad.addColorStop(1, '#06080f');
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, WIDTH, height, CORNER_R);
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = 'rgba(255,107,53,0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, WIDTH - 2, height - 2, CORNER_R);
  ctx.stroke();

  // Decorative corner accents
  drawCornerAccents(ctx, WIDTH, height);

  // ── Header ────────────────────────────────────────────────────────
  // Trophy icon area
  const trophyY = 30;
  ctx.fillStyle = C.accent;
  ctx.font = '32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏆', WIDTH / 2, trophyY + 10);

  // Title
  ctx.fillStyle = C.accent;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FLAPPY BERT', WIDTH / 2, trophyY + 48);

  // Subtitle
  ctx.fillStyle = C.accent2;
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('WEEKLY LEADERBOARD', WIDTH / 2, trophyY + 72);

  // Week info
  if (options.weekLabel) {
    ctx.fillStyle = C.textDim;
    ctx.font = '12px sans-serif';
    ctx.fillText(options.weekLabel, WIDTH / 2, trophyY + 92);
  }

  // Decorative line under header
  const lineY = HEADER_H - 8;
  const lineGrad = ctx.createLinearGradient(PAD, lineY, WIDTH - PAD, lineY);
  lineGrad.addColorStop(0, 'rgba(255,107,53,0)');
  lineGrad.addColorStop(0.2, 'rgba(255,107,53,0.6)');
  lineGrad.addColorStop(0.5, 'rgba(255,184,0,0.8)');
  lineGrad.addColorStop(0.8, 'rgba(255,107,53,0.6)');
  lineGrad.addColorStop(1, 'rgba(255,107,53,0)');
  ctx.fillStyle = lineGrad;
  ctx.fillRect(PAD, lineY, WIDTH - PAD * 2, 2);

  // ── Column headers ────────────────────────────────────────────────
  const colY = HEADER_H + 8;
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = C.textDim;
  ctx.textAlign = 'left';
  ctx.fillText('RANK', PAD + 8, colY);
  ctx.fillText('PLAYER', PAD + 80, colY);
  ctx.textAlign = 'right';
  ctx.fillText('SCORE', WIDTH - PAD - 120, colY);
  ctx.fillText('LEVEL', WIDTH - PAD - 40, colY);
  ctx.fillText('GAMES', WIDTH - PAD, colY);

  // ── Rows ──────────────────────────────────────────────────────────
  const startY = HEADER_H + 20;

  for (let i = 0; i < count; i++) {
    const entry = entries[i];
    const rank  = i + 1;
    const y     = startY + i * (ROW_H + ROW_GAP);
    const isHighlighted = options.highlightId && entry.telegram_id === options.highlightId;

    // Row background
    let rowBg = i % 2 === 0 ? C.bgRow : C.bgRowAlt;
    let borderColour = 'rgba(255,255,255,0.04)';

    if (rank === 1) {
      rowBg = 'rgba(255,215,0,0.08)';
      borderColour = 'rgba(255,215,0,0.35)';
    } else if (rank === 2) {
      rowBg = 'rgba(192,192,192,0.06)';
      borderColour = 'rgba(192,192,192,0.25)';
    } else if (rank === 3) {
      rowBg = 'rgba(205,127,50,0.06)';
      borderColour = 'rgba(205,127,50,0.25)';
    }

    if (isHighlighted) {
      rowBg = 'rgba(0,229,255,0.1)';
      borderColour = 'rgba(0,229,255,0.5)';
    }

    // Draw row
    ctx.fillStyle = rowBg;
    roundRect(ctx, PAD, y, WIDTH - PAD * 2, ROW_H, 8);
    ctx.fill();
    ctx.strokeStyle = borderColour;
    ctx.lineWidth = 1;
    roundRect(ctx, PAD, y, WIDTH - PAD * 2, ROW_H, 8);
    ctx.stroke();

    // Glow for top 3
    if (rank <= 3) {
      const glowColour = rank === 1 ? C.gold : rank === 2 ? C.silver : C.bronze;
      ctx.save();
      ctx.shadowColor = glowColour;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = 'rgba(0,0,0,0)';
      roundRect(ctx, PAD, y, WIDTH - PAD * 2, ROW_H, 8);
      ctx.stroke();
      ctx.restore();
    }

    const rowCenterY = y + ROW_H / 2;

    // ── Rank ──
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (rank === 1) {
      ctx.font = '20px sans-serif';
      ctx.fillText('🥇', PAD + 32, rowCenterY);
    } else if (rank === 2) {
      ctx.font = '20px sans-serif';
      ctx.fillText('🥈', PAD + 32, rowCenterY);
    } else if (rank === 3) {
      ctx.font = '20px sans-serif';
      ctx.fillText('🥉', PAD + 32, rowCenterY);
    } else {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = C.textDim;
      ctx.fillText(`#${rank}`, PAD + 32, rowCenterY);
    }

    // ── Avatar dot (skin colour) ──
    const skinColour = SKIN_COLOURS[entry.skin || 'default'] || C.accent;
    const dotX = PAD + 68;
    ctx.beginPath();
    ctx.arc(dotX, rowCenterY, 10, 0, Math.PI * 2);
    ctx.fillStyle = skinColour;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Inner highlight on dot
    ctx.beginPath();
    ctx.arc(dotX - 3, rowCenterY - 3, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();

    // ── Name ──
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = isHighlighted ? C.accent3 : C.text;
    let displayName = entry.first_name || entry.username || 'Unknown';
    if (displayName.length > 18) displayName = displayName.slice(0, 17) + '…';
    if (isHighlighted) displayName = '▶ ' + displayName;
    ctx.fillText(displayName, PAD + 86, rowCenterY);

    // ── Score ──
    ctx.textAlign = 'right';
    ctx.font = 'bold 16px sans-serif';
    const scoreColour = rank === 1 ? C.gold : rank === 2 ? C.silver : rank === 3 ? C.bronze : C.accent2;
    ctx.fillStyle = scoreColour;
    ctx.fillText(String(entry.best_score), WIDTH - PAD - 120, rowCenterY);

    // ── Level ──
    ctx.font = '12px sans-serif';
    ctx.fillStyle = C.success;
    ctx.fillText(`${entry.max_level || 1}`, WIDTH - PAD - 46, rowCenterY);

    // ── Games played ──
    ctx.fillStyle = C.textDim;
    ctx.fillText(`${entry.games_played || 0}`, WIDTH - PAD - 4, rowCenterY);
  }

  // ── Empty state ───────────────────────────────────────────────────
  if (count === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '14px sans-serif';
    ctx.fillStyle = C.textDim;
    ctx.fillText('No scores this week. Be the first to play!', WIDTH / 2, startY + 40);
  }

  // ── Footer ────────────────────────────────────────────────────────
  const footerY = height - FOOTER_H;

  // Decorative line
  const fLineGrad = ctx.createLinearGradient(PAD, footerY, WIDTH - PAD, footerY);
  fLineGrad.addColorStop(0, 'rgba(0,229,255,0)');
  fLineGrad.addColorStop(0.5, 'rgba(0,229,255,0.4)');
  fLineGrad.addColorStop(1, 'rgba(0,229,255,0)');
  ctx.fillStyle = fLineGrad;
  ctx.fillRect(PAD, footerY + 4, WIDTH - PAD * 2, 1);

  // Reset timer
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = C.textDim;
  if (options.resetIn) {
    ctx.fillText(`⏱ Resets in ${options.resetIn}`, WIDTH / 2, footerY + 24);
  }

  // Branding
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = 'rgba(255,107,53,0.4)';
  ctx.fillText('FLAPPY BERT  •  FLAP TO EARN', WIDTH / 2, footerY + 44);

  // ── Return PNG buffer ─────────────────────────────────────────────
  return canvas.toBuffer('image/png');
}

// ── Helper: rounded rectangle path ──────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Helper: decorative corner brackets ──────────────────────────────
function drawCornerAccents(ctx, w, h) {
  const len = 20;
  const off = 8;
  ctx.strokeStyle = 'rgba(255,184,0,0.25)';
  ctx.lineWidth = 2;

  // Top-left
  ctx.beginPath();
  ctx.moveTo(off, off + len);
  ctx.lineTo(off, off);
  ctx.lineTo(off + len, off);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(w - off - len, off);
  ctx.lineTo(w - off, off);
  ctx.lineTo(w - off, off + len);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(off, h - off - len);
  ctx.lineTo(off, h - off);
  ctx.lineTo(off + len, h - off);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(w - off - len, h - off);
  ctx.lineTo(w - off, h - off);
  ctx.lineTo(w - off, h - off - len);
  ctx.stroke();
}

/**
 * Render a personal stats card for a single player.
 */
function renderPlayerCard(playerData, statsData, rank, options = {}) {
  const WIDTH  = 600;
  const HEIGHT = 340;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx    = canvas.getContext('2d');

  // Background
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, '#0d1225');
  bg.addColorStop(1, '#06080f');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, WIDTH, HEIGHT, 16);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,229,255,0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, 16);
  ctx.stroke();

  drawCornerAccents(ctx, WIDTH, HEIGHT);

  // Header
  ctx.textAlign = 'center';
  ctx.fillStyle = C.accent3;
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('PLAYER STATS', WIDTH / 2, 38);

  // Name
  ctx.fillStyle = C.text;
  ctx.font = 'bold 18px sans-serif';
  const name = playerData.first_name || playerData.username || 'Unknown';
  ctx.fillText(name, WIDTH / 2, 72);

  // Avatar dot
  const skin = SKIN_COLOURS[playerData.skin || 'default'] || C.accent;
  ctx.beginPath();
  ctx.arc(WIDTH / 2, 100, 16, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Stats grid
  const stats = [
    { label: 'WEEKLY BEST',    value: statsData.best_score || 0,           colour: C.accent2 },
    { label: 'WEEKLY RANK',    value: rank ? `#${rank}` : '—',            colour: C.accent  },
    { label: 'GAMES PLAYED',   value: statsData.games_played || 0,         colour: C.accent3 },
    { label: 'MAX LEVEL',      value: statsData.max_level || 0,            colour: C.success },
    { label: 'ALL-TIME BEST',  value: statsData.all_time_best || 0,        colour: C.gold    },
    { label: 'TOTAL COINS',    value: `${playerData.coins || 0} 🪙`,      colour: C.accent2 },
  ];

  const cols = 3;
  const cellW = (WIDTH - 60) / cols;
  const cellH = 70;
  const gridX = 30;
  const gridY = 130;

  stats.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = gridX + col * cellW + cellW / 2;
    const cy = gridY + row * cellH;

    // Cell bg
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    roundRect(ctx, gridX + col * cellW + 4, cy - 4, cellW - 8, cellH - 8, 8);
    ctx.fill();

    // Value
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = s.colour;
    ctx.fillText(String(s.value), cx, cy + 28);

    // Label
    ctx.font = '9px sans-serif';
    ctx.fillStyle = C.textDim;
    ctx.fillText(s.label, cx, cy + 48);
  });

  // Footer
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = 'rgba(255,107,53,0.4)';
  ctx.textAlign = 'center';
  ctx.fillText('FLAPPY BERT  •  FLAP TO EARN', WIDTH / 2, HEIGHT - 16);

  return canvas.toBuffer('image/png');
}

module.exports = { renderLeaderboardCard, renderPlayerCard };
