# Phase 1 Engagement Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flappy Bert's core loop more addictive — players play longer per session and return daily — via instant replay, shield power-up, social badges, ad monetisation, and coin economy rebalance.

**Architecture:** All client changes go into the single `flappy_bert.html` file (~2950 lines). Server changes touch `bot.js` (API), `db.js` (SQLite), and `leaderboard-card.js` (PNG renderer). No new files. The AdSystem follows the existing AudioSystem singleton pattern. Badge data flows client→server on score submission; server stores but does not validate.

**Tech Stack:** Vanilla JS (browser), Node.js/Express, better-sqlite3, node-canvas, Telegram WebApp SDK.

**Spec:** `docs/superpowers/specs/2026-03-20-engagement-phase1-design.md`

---

## File Map

| File | Changes |
|------|---------|
| `flappy_bert.html` | New G fields, AdSystem object, shield spawn/pickup/activation, badge definitions + check logic, game over screen redesign, instant replay flow, ad continue/double/interstitial, coin economy rebalance, near-miss per-game counter, anti-cheat flags in score submission |
| `bot.js` | Accept `badges`/`shieldUsed`/`adContinueUsed` in POST /api/score, relax validateScore() thresholds, store badges on player record |
| `db.js` | Add `badges` column migration, update `getWeeklyLeaderboard()` to SELECT badges |
| `leaderboard-card.js` | `drawBadge()` helper, render highest badge circle+abbreviation next to player name on leaderboard and stats cards |

---

## Task 1: Server-Side Data Model — `db.js` Badges Column

**Files:**
- Modify: `db.js:12-79` (init function)
- Modify: `db.js:144-170` (getWeeklyLeaderboard query)

- [ ] **Step 1: Add badges column migration to init()**

In `db.js`, after the existing `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` block (around line 76), add:

```js
// Phase 1: badges column
try { db.exec("ALTER TABLE players ADD COLUMN badges TEXT DEFAULT '[]'"); } catch(e) {}
```

- [ ] **Step 2: Update getWeeklyLeaderboard() to include badges**

In `db.js:144-170`, modify the SELECT to include `p.badges`:

```js
function getWeeklyLeaderboard(limit = 20) {
  const week = getWeekStart();
  return db.prepare(`
    SELECT
      p.telegram_id,
      p.first_name,
      p.username,
      p.skin,
      p.badges,
      MAX(s.score) AS best_score,
      COUNT(s.id)  AS games_played,
      MAX(s.level) AS max_level
    FROM scores s
    JOIN players p ON p.telegram_id = s.telegram_id
    WHERE s.week_start = ?
    GROUP BY s.telegram_id
    ORDER BY best_score DESC
    LIMIT ?
  `).all(week, limit);
}
```

- [ ] **Step 3: Add updatePlayerBadges() function**

Add a new exported function in `db.js`:

```js
function updatePlayerBadges(telegramId, badges) {
  db.prepare('UPDATE players SET badges = ? WHERE telegram_id = ?')
    .run(JSON.stringify(badges), telegramId);
}
```

Export it in the `module.exports` block.

- [ ] **Step 4: Verify server starts cleanly**

Run: `cd /opt/Flappy-Bert && node -e "const db = require('./db'); db.init(); console.log('OK');"`

Expected: `OK` with no errors. If the column already exists, the try/catch silences the error.

- [ ] **Step 5: Commit**

```bash
git add db.js
git commit -m "feat(db): add badges column migration and include badges in leaderboard query"
```

---

## Task 2: Server-Side Anti-Cheat — `bot.js` Score Endpoint

**Files:**
- Modify: `bot.js:41-45` (SCORE_LIMITS)
- Modify: `bot.js:59-100` (validateScore)
- Modify: `bot.js:511-553` (POST /api/score)

- [ ] **Step 1: Update validateScore() to accept shield/ad flags**

Modify `validateScore()` at `bot.js:59` to accept and use the new flags:

```js
function validateScore(session, body) {
  const { score, level, shieldUsed, adContinueUsed } = body;
  const issues = [];

  if (score > SCORE_LIMITS.MAX_ABSOLUTE_SCORE) {
    console.log(`🚫 Score REJECTED: score=${score} exceeds hard cap`);
    return { valid: false, reason: 'exceeds_cap' };
  }

  if (!session) {
    issues.push('no_session');
  } else {
    if (session.used) {
      issues.push('session_reused');
    }

    const elapsed = Date.now() - session.startedAt;
    if (elapsed < SCORE_LIMITS.MIN_GAME_DURATION_MS && score > 5) {
      issues.push('too_fast');
    }

    // Relax time-based threshold when shield/ad continue used
    let maxScorePerSecond = SCORE_LIMITS.MAX_SCORE_PER_SECOND;
    if (shieldUsed && adContinueUsed) {
      maxScorePerSecond *= 1.5;  // 50% relaxation for both
    } else if (shieldUsed) {
      maxScorePerSecond *= 1.2;  // 20% relaxation for shield
    } else if (adContinueUsed) {
      maxScorePerSecond *= 1.2;  // 20% relaxation for ad continue
    }

    const maxScoreForTime = Math.ceil((elapsed / 1000) * maxScorePerSecond);
    if (score > maxScoreForTime && score > 10) {
      issues.push('score_exceeds_time');
    }
  }

  if (issues.length > 0) {
    const tid = session ? session.telegramId : 'unknown';
    console.log(`⚠️ Score flagged [${tid}]: score=${score} issues=[${issues.join(',')}]`);
  }

  if (issues.includes('session_reused') && score > 20) {
    return { valid: false, reason: 'session_reused' };
  }

  return { valid: true, issues, flagged: issues.length > 0 };
}
```

- [ ] **Step 2: Update POST /api/score to accept new fields and store badges**

Modify the endpoint at `bot.js:511` to destructure and forward the new fields:

```js
app.post('/api/score', (req, res) => {
  try {
    const {
      telegram_id, first_name, username,
      score, level, coins_earned,
      session_id, frames, duration, signature,
      badges, shieldUsed, adContinueUsed
    } = req.body;

    if (!telegram_id || score == null) {
      return res.status(400).json({ error: 'telegram_id and score are required' });
    }

    if (db.isBanned(telegram_id)) {
      return res.status(403).json({ error: 'Player is banned' });
    }

    const session = gameSessions.get(session_id);

    if (session && session.telegramId !== telegram_id) {
      console.log(`⚠️ Session hijack attempt: ${session_id} owner=${session.telegramId} submitter=${telegram_id}`);
      return res.status(403).json({ error: 'Invalid session' });
    }

    const validation = validateScore(session, { score, level, coins_earned, frames, duration, signature, shieldUsed, adContinueUsed });

    if (!validation.valid) {
      console.log(`🚫 Score REJECTED [${telegram_id}]: ${validation.reason}`);
      return res.status(403).json({ error: 'Score rejected', reason: validation.reason });
    }

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
```

- [ ] **Step 3: Verify server starts and /api/score still works**

Run: `cd /opt/Flappy-Bert && node -e "const db = require('./db'); db.init(); console.log('DB OK');" && timeout 3 node bot.js 2>&1 || true`

Expected: Server starts without syntax errors. May fail on TELEGRAM_BOT_TOKEN — that's fine, we're checking for parse errors.

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "feat(bot): accept shield/ad flags in score endpoint, relax anti-cheat thresholds, store badges"
```

---

## Task 3: Client Data Model — New G Fields, loadData/saveData

**Files:**
- Modify: `flappy_bert.html:553-620` (G object)
- Modify: `flappy_bert.html:926-963` (loadData)
- Modify: `flappy_bert.html:965-989` (saveData)
- Modify: `flappy_bert.html:1017-1085` (startGame)

- [ ] **Step 1: Add new fields to G object initialisation**

At `flappy_bert.html:617` (before the closing `};` of G), add:

```js
  // Phase 1: Shield
  hasShield: false,
  shieldUsedThisGame: false,
  shieldSpawnedThisGame: false,
  invincibleFrames: 0,
  // Phase 1: Badges
  earnedBadges: [],
  shieldsUsedTotal: 0,
  nearMissesThisGame: 0,
  // Phase 1: Ads
  adContinueUsed: false,
  adInterstitialCounter: 0,
```

- [ ] **Step 2: Update loadData() to restore new persisted fields**

At `flappy_bert.html:960` (inside loadData, after the daily challenge fields), add:

```js
    // Phase 1 persisted fields
    G.earnedBadges = d.earnedBadges || [];
    G.shieldsUsedTotal = d.shieldsUsedTotal || 0;
```

- [ ] **Step 3: Update saveData() to persist new fields**

At `flappy_bert.html:986` (inside the JSON.stringify object, after `coinsEarnedToday`), add:

```js
      earnedBadges: G.earnedBadges,
      shieldsUsedTotal: G.shieldsUsedTotal,
```

- [ ] **Step 4: Reset transient fields in startGame()**

At `flappy_bert.html:1042` (inside startGame, after `G.paused = false;`), add:

```js
  // Phase 1 transient resets
  G.hasShield = false;
  G.shieldUsedThisGame = false;
  G.shieldSpawnedThisGame = false;
  G.invincibleFrames = 0;
  G.nearMissesThisGame = 0;
  G.adContinueUsed = false;
```

Note: `G.adInterstitialCounter` is NOT reset per game — it persists across games but resets on app close (already initialised to 0 in G object).

- [ ] **Step 5: Verify no syntax errors**

Open browser dev console or run a quick syntax check. The file should load without errors.

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(client): add Phase 1 data model fields for shield, badges, ads"
```

---

## Task 4: Coin Economy Rebalance

**Files:**
- Modify: `flappy_bert.html:623-637` (SKINS and MULTIPLIERS arrays)

- [ ] **Step 1: Update skin prices**

Change the SKINS array at `flappy_bert.html:623-632`:

```js
const SKINS = [
  { id: 'default', name: 'CLASSIC BERT', desc: 'The original orange hat Bert', price: 0, color: '#ff6b35' },
  { id: 'neon', name: 'NEON BERT', desc: 'Glowing cyberpunk style', price: 50, color: '#00e5ff' },
  { id: 'golden', name: 'GOLDEN BERT', desc: 'Pure gold luxury edition', price: 100, color: '#ffd700' },
  { id: 'shadow', name: 'SHADOW BERT', desc: 'Dark and mysterious', price: 75, color: '#8844ff' },
  { id: 'fire', name: 'FIRE BERT', desc: 'Blazing hot pixel fire', price: 150, color: '#ff3860' },
  { id: 'ice', name: 'ICE BERT', desc: 'Frozen crystal edition', price: 90, color: '#88ddff' },
  { id: 'matrix', name: 'MATRIX BERT', desc: 'Digital code rain effect', price: 200, color: '#44d62c' },
  { id: 'cosmic', name: 'COSMIC BERT', desc: 'Stars and galaxies', price: 250, color: '#ff88ff' },
];
```

- [ ] **Step 2: Update multiplier prices**

Change the MULTIPLIERS array at `flappy_bert.html:634-637`:

```js
const MULTIPLIERS = [
  { id: 'mult15', name: '1.5X SCORE', desc: '1.5x scores for 3 games', price: 200, mult: 1.5, icon: '\u{2B50}', uses: 3 },
  { id: 'mult2', name: '2X SCORE', desc: 'Double scores for 3 games', price: 750, mult: 2, icon: '\u{1F31F}', uses: 3 },
];
```

- [ ] **Step 3: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(economy): rebalance skin and multiplier prices for faster progression"
```

---

## Task 5: Game Over Screen Redesign & Instant Replay

**Files:**
- Modify: `flappy_bert.html:512-530` (gameOverOverlay HTML)
- Modify: `flappy_bert.html:1272-1341` (showGameOverScreen function)

- [ ] **Step 1: Replace game over overlay HTML**

Replace the `gameOverOverlay` div at `flappy_bert.html:512-530` with the new layout:

```html
<div class="overlay" id="gameOverOverlay">
  <div class="go-panel">
    <div id="goBadgePopup" style="display:none;font-size:10px;color:#ffd700;margin-bottom:6px;animation:pulse 0.5s ease-in-out 3"></div>
    <div class="go-title">GAME OVER</div>
    <div id="goMedal" style="font-size:36px;margin:4px 0;display:none"></div>
    <div class="go-label">SCORE</div>
    <div class="go-score" id="goScore">0</div>
    <div class="go-best" id="goBest">BEST: 0</div>
    <div id="goRankNudge" style="font-size:7px;color:var(--accent3);margin:4px 0;display:none"></div>
    <div class="go-coins" id="goCoins">+0 &#x1FA99;</div>
    <div id="goDoubleCoins" style="display:none;margin:4px 0">
      <button class="btn btn-gold" style="font-size:7px;padding:6px 12px" onclick="doubleCoinsWithAd()">&#x1F3AC; WATCH AD TO DOUBLE</button>
    </div>
    <div class="go-level" id="goLevel">LEVEL 1</div>
    <div id="goCombo" style="font-size:7px;color:#ffb800;margin:4px 0;display:none"></div>
    <div id="goMultiplier" style="font-size:7px;color:var(--accent3);margin:4px 0;display:none"></div>
    <div id="goTournament" style="font-size:7px;color:#ffd700;margin:4px 0;display:none"></div>
    <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:8px">
      <button class="btn btn-primary" style="min-width:120px" onclick="startGame()">&#x1F504; PLAY AGAIN</button>
      <button class="btn btn-gold" id="goContinueBtn" style="min-width:120px;display:none" onclick="continueWithAd()">&#x25B6;&#xFE0F; CONTINUE</button>
    </div>
    <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:6px">
      <button class="btn btn-secondary" style="font-size:7px;padding:6px 10px" onclick="showMenu()">&#x1F3E0; MENU</button>
      <button class="btn btn-secondary" style="font-size:7px;padding:6px 10px" onclick="showShop()">&#x1F6D2; SHOP</button>
      <button class="btn btn-secondary" style="font-size:7px;padding:6px 10px" onclick="showLeaderboard()">&#x1F3C6; RANKS</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS for badge popup pulse animation**

Inside the `<style>` block (around line 8-500), add:

```css
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.8; }
}
```

- [ ] **Step 3: Update showGameOverScreen() with engagement messaging and rank nudge**

Replace `showGameOverScreen()` at `flappy_bert.html:1272-1341`:

```js
function showGameOverScreen() {
  G.state = 'gameover';

  // Add level bonus to coins earned
  G.coinsEarned += (G.level - 1) * 5;
  if (G.bestCombo >= 5) G.coinsEarned += G.bestCombo;
  G.coins += G.coinsEarned;

  // Track daily stats
  G.coinsEarnedToday += G.coinsEarned;
  if (G.bestCombo > G.bestComboToday) G.bestComboToday = G.bestCombo;
  checkDailyChallenges();

  // Check badges before displaying
  const newBadges = checkBadges();

  const isNewBest = G.score > G.bestScore;
  if (isNewBest) G.bestScore = G.score;

  updateLeaderboard(G.playerName, G.score);
  saveData();
  updateCoinDisplay();

  // Increment interstitial counter
  G.adInterstitialCounter++;

  // Submit score (only if not continuing)
  submitScoreToServer(G.score, G.level, G.coinsEarned);
  submitTournamentScore(G.score, G.level, G.coinsEarned);

  // Populate game over screen
  const goScore = document.getElementById('goScore');
  const goBest = document.getElementById('goBest');
  const goCoins = document.getElementById('goCoins');
  const goLevel = document.getElementById('goLevel');
  const goCombo = document.getElementById('goCombo');
  const goMedal = document.getElementById('goMedal');
  const goMultiplier = document.getElementById('goMultiplier');
  const goRankNudge = document.getElementById('goRankNudge');
  const goBadgePopup = document.getElementById('goBadgePopup');
  const goContinueBtn = document.getElementById('goContinueBtn');
  const goDoubleCoins = document.getElementById('goDoubleCoins');

  goScore.textContent = G.score;

  // Best-score messaging
  if (isNewBest) {
    goBest.textContent = '★ NEW BEST! ★';
    goBest.style.color = '#ffd700';
  } else {
    const diff = G.bestScore - G.score;
    goBest.textContent = diff + ' away from your best!';
    goBest.style.color = '';
  }

  goCoins.innerHTML = '+' + G.coinsEarned + ' &#x1FA99;';
  goLevel.textContent = 'LEVEL ' + G.level;

  // Combo display
  if (G.bestCombo >= 3) {
    goCombo.style.display = 'block';
    goCombo.textContent = 'BEST COMBO: ' + G.bestCombo + 'x';
  } else {
    goCombo.style.display = 'none';
  }

  // Medal
  if (G.score >= 100) { goMedal.textContent = '🥇'; goMedal.style.display = 'block'; }
  else if (G.score >= 50) { goMedal.textContent = '🥈'; goMedal.style.display = 'block'; }
  else if (G.score >= 25) { goMedal.textContent = '🥉'; goMedal.style.display = 'block'; }
  else { goMedal.style.display = 'none'; }

  // Multiplier note
  if (G.scoreMultiplier > 1) {
    goMultiplier.style.display = 'block';
    goMultiplier.textContent = G.scoreMultiplier + 'x MULTIPLIER ACTIVE';
  } else {
    goMultiplier.style.display = 'none';
  }

  // Rank nudge (uses cached leaderboard data)
  goRankNudge.style.display = 'none';
  if (G.leaderboard && G.leaderboard.length > 0) {
    const myRank = G.leaderboard.findIndex(e => e.score <= G.score);
    if (myRank >= 0 && myRank < 10) {
      goRankNudge.style.display = 'block';
      goRankNudge.textContent = "You're #" + (myRank + 1) + ' this week!';
    } else if (G.leaderboard.length > 0) {
      const nextAbove = G.leaderboard.find(e => e.score > G.score);
      if (nextAbove) {
        goRankNudge.style.display = 'block';
        goRankNudge.textContent = (nextAbove.score - G.score) + ' points behind #' + G.leaderboard.indexOf(nextAbove) + '!';
      }
    }
  }

  // Badge popup
  goBadgePopup.style.display = 'none';
  if (newBadges.length > 0) {
    const badge = BADGES.find(b => b.id === newBadges[0]);
    if (badge) {
      goBadgePopup.style.display = 'block';
      goBadgePopup.innerHTML = '🏆 ' + badge.name.toUpperCase() + ' UNLOCKED! +' + badge.reward + ' &#x1FA99;';
      setTimeout(() => { goBadgePopup.style.display = 'none'; }, 3000);
    }
  }

  // Continue button (rewarded ad, once per game, only if ad ready)
  goContinueBtn.style.display = (!G.adContinueUsed && AdSystem.isRewardedReady()) ? '' : 'none';

  // Double coins button (only if ad ready and coins > 0)
  goDoubleCoins.style.display = (G.coinsEarned > 0 && AdSystem.isRewardedReady()) ? '' : 'none';

  // Interstitial ad every 4th game
  if (G.adInterstitialCounter % 4 === 0 && AdSystem.isInterstitialReady()) {
    AdSystem.showInterstitial(() => {});
  }

  showOverlay('gameOverOverlay');
}
```

- [ ] **Step 4: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(gameover): redesign game over screen with instant replay, rank nudge, engagement messaging"
```

---

## Task 6: AdSystem Object (Stub + Graceful Fallback)

**Files:**
- Modify: `flappy_bert.html` — add AdSystem after AudioSystem (~line 923)

The AdSystem is a stub that always returns false for `isRewardedReady()`/`isInterstitialReady()`. The actual SDK integration happens in the Section 0 spike. This ensures all UI code works with graceful fallback (ad buttons simply don't appear).

- [ ] **Step 1: Add AdSystem object**

After AudioSystem (around line 923), add:

```js
// ========== AD SYSTEM (STUB — replace with real SDK after spike) ==========
const AdSystem = {
  _sdkLoaded: false,
  _rewardedReady: false,
  _interstitialReady: false,

  init() {
    // Stub: real implementation loads ad SDK here
    // e.g., load Google AdSense/AdMob script, set up ad slots
    console.log('[AdSystem] init (stub — no SDK loaded)');
  },

  preload() {
    // Stub: real implementation requests next ad in background
  },

  isRewardedReady() {
    return this._rewardedReady;
  },

  isInterstitialReady() {
    return this._interstitialReady;
  },

  showRewarded(callback) {
    if (!this._rewardedReady) { if (callback) callback(false); return; }
    // Stub: real implementation shows rewarded ad
    // On completion: callback(true)
    // On skip/fail: callback(false)
    if (callback) callback(false);
  },

  showInterstitial(callback) {
    if (!this._interstitialReady) { if (callback) callback(); return; }
    // Stub: real implementation shows interstitial
    if (callback) callback();
  },
};
```

- [ ] **Step 2: Initialise AdSystem at game load**

Find the existing `AudioSystem.init()` call (around line 699 in the init/DOMContentLoaded section) and add `AdSystem.init();` right after it.

- [ ] **Step 3: Preload ads at game start**

In `startGame()` (around line 1085, near the end), add:

```js
  AdSystem.preload();
```

- [ ] **Step 4: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(ads): add AdSystem stub object with graceful fallback"
```

---

## Task 7: Ad Continue (Resume After Death)

**Files:**
- Modify: `flappy_bert.html` — add `continueWithAd()` function, modify death/score flow

- [ ] **Step 1: Add continueWithAd() function**

After `showGameOverScreen()`, add:

```js
function continueWithAd() {
  AdSystem.showRewarded(function(completed) {
    if (!completed) return;

    G.adContinueUsed = true;

    // Remove pipes near Bert
    const clearRange = G.width * 2;
    G.pipes = G.pipes.filter(p => Math.abs(p.x - G.bert.x) > clearRange);

    // Reset Bert to center with zero velocity
    G.bert.y = (G.height - G.groundHeight) / 2;
    G.bert.vy = 0;
    G.bert.rotation = 0;

    // Grace period: no new pipes for 60 frames
    G.pipeTimer = -60;

    // Reset combo
    G.combo = 0;

    // Brief countdown then resume
    G.state = 'continuing';
    G.continueTimer = 30; // ~0.5s countdown

    hideAllOverlays();
  });
}
```

- [ ] **Step 2: Handle 'continuing' state in the update loop**

In the `update()` function, find the `if (G.state === 'dying')` block (around line 1511). After that block's closing (before the `if (G.state !== 'playing') return;` guard), add:

```js
  if (G.state === 'continuing') {
    G.continueTimer--;
    if (G.continueTimer <= 0) {
      G.state = 'playing';
      G.invincibleFrames = 30; // Brief invincibility after continue
      AudioSystem.startMusic();
    }
    return;
  }
```

- [ ] **Step 3: Add "GO!" text rendering during continue countdown**

In the `draw()` function, after drawing the ready screen text, add a block for the 'continuing' state:

```js
  if (G.state === 'continuing') {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 32px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GO!', w / 2, h / 2);
    ctx.restore();
  }
```

- [ ] **Step 4: Add doubleCoinsWithAd() function**

```js
function doubleCoinsWithAd() {
  AdSystem.showRewarded(function(completed) {
    if (!completed) return;
    const bonus = G.coinsEarned; // Double = add same amount again
    G.coins += bonus;
    G.coinsEarned += bonus;
    updateCoinDisplay();
    saveData();
    // Hide the button after use
    document.getElementById('goDoubleCoins').style.display = 'none';
    // Update coins display on game over screen
    document.getElementById('goCoins').innerHTML = '+' + G.coinsEarned + ' &#x1FA99;';
    showToast('Coins doubled! +' + bonus);
  });
}
```

- [ ] **Step 5: Modify death flow — extend timer for interstitials**

In `gameOver()` at line 1237, the death timer threshold is checked at line 1532 (`if (G.deathTimer >= 50)`). Change this to be dynamic:

```js
    const deathDuration = (G.adInterstitialCounter > 0 && (G.adInterstitialCounter + 1) % 4 === 0 && AdSystem.isInterstitialReady()) ? 90 : 50;
    if (G.deathTimer >= deathDuration) {
      showGameOverScreen();
    }
```

- [ ] **Step 6: Handle invincibility frames in collision check**

In the `update()` function where `checkCollision()` is called (around line 1711), wrap it:

```js
  if (G.invincibleFrames > 0) {
    G.invincibleFrames--;
  } else if (checkCollision()) {
    gameOver();
  }
```

Replace the existing bare `if (checkCollision()) { gameOver(); }` call.

- [ ] **Step 7: Update submitScoreToServer() to include new flags**

At `flappy_bert.html:2915-2932`, add the new fields to the fetch body:

```js
  body: JSON.stringify({
    telegram_id: user.id,
    first_name: user.first_name,
    username: user.username,
    score, level, coins_earned: coinsEarned,
    session_id: _gameSession,
    frames,
    duration,
    badges: G.earnedBadges,
    shieldUsed: G.shieldUsedThisGame,
    adContinueUsed: G.adContinueUsed,
  }),
```

- [ ] **Step 8: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(ads): add continue-after-death, double coins, interstitial timing, invincibility frames"
```

---

## Task 8: Shield Power-Up

**Files:**
- Modify: `flappy_bert.html:1192-1213` (addPipe — shield spawn)
- Modify: `flappy_bert.html:1215-1235` (checkCollision — shield activation)
- Modify: `flappy_bert.html:1670-1689` (bonus coin collection area — add shield pickup)
- Modify: `flappy_bert.html` draw function (shield rendering)

- [ ] **Step 1: Add shield spawn logic to addPipe()**

Replace the `hasCoin` line in `addPipe()` at `flappy_bert.html:1210` with:

```js
    hasCoin: false,
    hasShield: false,
    coinCollected: false,
    shieldCollected: false,
```

Then, right after `G.pipes.push(...)`, add spawn logic:

```js
  const pipe = G.pipes[G.pipes.length - 1];
  const roll = Math.random();
  if (roll < 0.3) {
    pipe.hasCoin = true;  // 30% chance coin
  } else if (roll < 0.3 + 0.7 * 0.08 && !G.hasShield && !G.shieldSpawnedThisGame) {
    pipe.hasShield = true;  // ~5.6% effective chance shield
    G.shieldSpawnedThisGame = true;
  }
```

- [ ] **Step 2: Add shield pickup logic**

After the bonus coin collection block (around line 1689), add:

```js
    // Shield pickup
    if (p.hasShield && !p.shieldCollected) {
      const shieldX = p.x + G.pipeWidth / 2;
      const shieldY = p.gapY + p.moveOffset + p.gapH / 2;
      const dist = Math.hypot(G.bert.x - shieldX, G.bert.y - shieldY);
      if (dist < 25) {
        p.shieldCollected = true;
        G.hasShield = true;
        AudioSystem.playCoin(); // Reuse coin sound for now
        G.particles.push({
          x: shieldX, y: shieldY,
          vx: 0, vy: -1.5,
          life: 30, maxLife: 30,
          text: 'SHIELD!',
          color: '#00aaff',
          size: 10,
        });
        try { navigator.vibrate && navigator.vibrate([20, 10, 20]); } catch(e) {}
      }
    }
```

- [ ] **Step 3: Add shield activation on collision**

Modify the collision handling. Replace the existing `if (checkCollision()) { gameOver(); }` (which was updated in Task 7 Step 6 to include invincibility) with:

```js
  if (G.invincibleFrames > 0) {
    G.invincibleFrames--;
  } else if (checkCollision()) {
    // Check if shield saves us (not ceiling hits)
    const isCeiling = G.bert.y - G.bertSize * 0.35 < 0;
    if (G.hasShield && !isCeiling) {
      // Shield absorbs hit
      G.hasShield = false;
      G.shieldUsedThisGame = true;
      G.shieldsUsedTotal++;
      G.invincibleFrames = 30;
      G.combo = 0; // Combo reset as penalty

      // Bounce to center of nearest pipe gap
      let bestGapY = (G.height - G.groundHeight) / 2;
      let bestDist = Infinity;
      for (const p of G.pipes) {
        const gapCenter = p.gapY + p.moveOffset + p.gapH / 2;
        const d = Math.abs(p.x - G.bert.x);
        if (d < bestDist) {
          bestDist = d;
          bestGapY = gapCenter;
        }
      }
      G.bert.y = bestGapY;
      G.bert.vy = 0;

      // Visual + haptic feedback
      G.shakeFrames = 10;
      G.shakeIntensity = 5;
      G.flashAlpha = 0.4;
      try { navigator.vibrate && navigator.vibrate([30, 20, 50]); } catch(e) {}

      // Shatter particles
      for (let i = 0; i < 12; i++) {
        G.particles.push({
          x: G.bert.x, y: G.bert.y,
          vx: (Math.random() - 0.5) * 6,
          vy: (Math.random() - 0.5) * 6,
          life: 25 + Math.random() * 15,
          maxLife: 40,
          color: '#00aaff',
          size: Math.random() * 3 + 1,
        });
      }

      // +5 coin survival bonus
      G.coins += 5;
      G.coinsEarned += 5;
      updateCoinDisplay();
      G.particles.push({
        x: G.bert.x, y: G.bert.y - 40,
        vx: 0, vy: -1,
        life: 30, maxLife: 30,
        text: 'SHIELD! +5',
        color: '#00aaff',
        size: 10,
      });

      // Check shield_breaker badge
      checkShieldBadge();
      saveData();
    } else {
      gameOver();
    }
  }
```

- [ ] **Step 4: Draw shield items in pipe gaps**

In the `draw()` function, find where bonus coins are drawn (search for `coinCollected` in the draw section). After the coin drawing block, add:

```js
    // Draw shield in pipe gap
    if (p.hasShield && !p.shieldCollected) {
      const sx = p.x + G.pipeWidth / 2;
      const sy = p.gapY + p.moveOffset + p.gapH / 2;
      const pulse = 1 + Math.sin(G.frameCount * 0.1) * 0.15;
      const r = 10 * pulse;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,170,255,0.2)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#00aaff';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🛡', sx, sy);
      ctx.restore();
    }
```

- [ ] **Step 5: Draw shield indicator when player has shield**

In the HUD drawing section (where score and coins are displayed on screen), add:

```js
  // Shield indicator
  if (G.hasShield && (G.state === 'playing' || G.state === 'ready')) {
    ctx.save();
    ctx.fillStyle = '#00aaff';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🛡', 8, 56);
    ctx.restore();
  }
```

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(shield): add shield power-up spawn, pickup, collision activation, and rendering"
```

---

## Task 9: Social Badges & Achievements

**Files:**
- Modify: `flappy_bert.html` — add BADGES array, checkBadges(), checkShieldBadge(), badge UI

- [ ] **Step 1: Add BADGES constant array**

After the STREAK_REWARDS constant (around line 649), add:

```js
const BADGES = [
  { id: 'rookie', name: 'Rookie', requirement: 'Score 10 in one game', abbr: 'RK', color: '#cd7f32', reward: 25, check: () => G.score >= 10 },
  { id: 'pipe_dodger', name: 'Pipe Dodger', requirement: 'Score 25', abbr: 'PD', color: '#c0c0c0', reward: 50, check: () => G.score >= 25 },
  { id: 'sky_king', name: 'Sky King', requirement: 'Score 50', abbr: 'SK', color: '#ffd700', reward: 100, check: () => G.score >= 50 },
  { id: 'legend', name: 'Legend', requirement: 'Score 100', abbr: 'LG', color: '#ff6b35', reward: 250, check: () => G.score >= 100 },
  { id: 'immortal', name: 'Immortal', requirement: 'Score 200', abbr: 'IM', color: '#ff3860', reward: 500, check: () => G.score >= 200 },
  { id: 'streak_master', name: 'Streak Master', requirement: '7-day login streak', abbr: 'SM', color: '#44d62c', reward: 150, check: () => G.dailyStreak >= 7 },
  { id: 'combo_king', name: 'Combo King', requirement: 'Hit 10x combo', abbr: 'CK', color: '#ffb800', reward: 100, check: () => G.bestCombo >= 10 },
  { id: 'close_call', name: 'Close Call', requirement: '20 near-misses in one game', abbr: 'CC', color: '#00e5ff', reward: 75, check: () => G.nearMissesThisGame >= 20 },
  { id: 'shield_breaker', name: 'Shield Breaker', requirement: 'Use 10 shields total', abbr: 'SB', color: '#8844ff', reward: 50, check: () => G.shieldsUsedTotal >= 10 },
];
```

- [ ] **Step 2: Add near-miss per-game tracking**

In the near-miss detection block (around line 1623-1633), after `G.nearMissesToday++;`, add:

```js
        G.nearMissesThisGame++;
```

- [ ] **Step 3: Add checkBadges() function**

After the BADGES array, add:

```js
function checkBadges() {
  const newlyEarned = [];
  for (const badge of BADGES) {
    if (G.earnedBadges.includes(badge.id)) continue;
    if (badge.check()) {
      G.earnedBadges.push(badge.id);
      G.coins += badge.reward;
      newlyEarned.push(badge.id);
    }
  }
  if (newlyEarned.length > 0) saveData();
  return newlyEarned;
}

function checkShieldBadge() {
  const badge = BADGES.find(b => b.id === 'shield_breaker');
  if (badge && !G.earnedBadges.includes('shield_breaker') && badge.check()) {
    G.earnedBadges.push('shield_breaker');
    G.coins += badge.reward;
    saveData();
    showToast('🏆 Shield Breaker unlocked! +' + badge.reward);
  }
}
```

- [ ] **Step 4: Check streak badge at daily login**

Find the daily streak check section (search for `streakClaimed` or `dailyStreak`). After the streak is incremented, add:

```js
    // Check streak badge
    checkBadges();
```

- [ ] **Step 5: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(badges): add 9 achievement badges with check logic, rewards, and game over popup"
```

---

## Task 10: Leaderboard Badge Rendering — `leaderboard-card.js`

**Files:**
- Modify: `leaderboard-card.js` — add `drawBadge()` helper, render badges in leaderboard rows

- [ ] **Step 1: Add BADGE_META constant and drawBadge() helper**

Near the top of `leaderboard-card.js` (after the existing colour constants), add:

```js
const BADGE_META = {
  rookie:         { abbr: 'RK', color: '#cd7f32' },
  pipe_dodger:    { abbr: 'PD', color: '#c0c0c0' },
  sky_king:       { abbr: 'SK', color: '#ffd700' },
  legend:         { abbr: 'LG', color: '#ff6b35' },
  immortal:       { abbr: 'IM', color: '#ff3860' },
  streak_master:  { abbr: 'SM', color: '#44d62c' },
  combo_king:     { abbr: 'CK', color: '#ffb800' },
  close_call:     { abbr: 'CC', color: '#00e5ff' },
  shield_breaker: { abbr: 'SB', color: '#8844ff' },
};

// Badge priority order (highest tier first)
const BADGE_PRIORITY = ['immortal', 'legend', 'sky_king', 'pipe_dodger', 'rookie', 'combo_king', 'close_call', 'streak_master', 'shield_breaker'];

function getHighestBadge(badgesJson) {
  try {
    const badges = typeof badgesJson === 'string' ? JSON.parse(badgesJson) : (badgesJson || []);
    for (const id of BADGE_PRIORITY) {
      if (badges.includes(id)) return BADGE_META[id];
    }
  } catch(e) {}
  return null;
}

function drawBadge(ctx, cx, cy, r, meta) {
  // Coloured circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = meta.color;
  ctx.fill();

  // 2-letter abbreviation
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${r}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.abbr, cx, cy + 1);
}
```

- [ ] **Step 2: Render badge next to player name in leaderboard rows**

In the `renderLeaderboardCard()` function, find where player names are drawn (search for `first_name` or the name text drawing). After the name is drawn, add badge rendering:

```js
      // Badge next to name
      const badgeMeta = getHighestBadge(entry.badges);
      if (badgeMeta) {
        const nameWidth = ctx.measureText(displayName).width;
        drawBadge(ctx, nameX + nameWidth + 14, y + ROW_H / 2, 8, badgeMeta);
      }
```

The exact insertion point depends on where `displayName` is drawn — find the `ctx.fillText` call for the player name and add this immediately after.

- [ ] **Step 3: Render badges in player stats card**

In `renderPlayerCard()`, add a badges section. After the stats grid, add:

```js
    // Badges row
    if (playerData.badges) {
      const badges = typeof playerData.badges === 'string' ? JSON.parse(playerData.badges) : (playerData.badges || []);
      if (badges.length > 0) {
        const badgeY = HEIGHT - 60;
        let badgeX = 30;
        for (const id of badges) {
          const meta = BADGE_META[id];
          if (meta) {
            drawBadge(ctx, badgeX, badgeY, 10, meta);
            badgeX += 28;
          }
        }
      }
    }
```

- [ ] **Step 4: Commit**

```bash
git add leaderboard-card.js
git commit -m "feat(leaderboard): render badge circles with abbreviations next to player names"
```

---

## Task 11: Integration — Wire Everything Together

**Files:**
- Modify: `flappy_bert.html` — final wiring and edge cases

- [ ] **Step 1: Add 'continuing' state to draw/update state checks**

Search for state checks that list valid states (e.g., `G.state === 'playing' || G.state === 'gameover' || G.state === 'dying'`). Add `'continuing'` where appropriate:

- Pipe rendering (line 1795): add `|| G.state === 'continuing'`
- Ground animation: add `|| G.state === 'continuing'`
- Bert rendering: ensure Bert is drawn during 'continuing' state

- [ ] **Step 2: Ensure score not submitted on initial death when continuing**

Modify `showGameOverScreen()` — the score submission calls (`submitScoreToServer` and `submitTournamentScore`) should only happen when the player is NOT going to continue. Since we can't know in advance, move score submission to happen only on the FINAL game over.

Approach: Remove `submitScoreToServer` and `submitTournamentScore` from `showGameOverScreen()`. Instead, add a `finalGameOver()` wrapper:

```js
function finalGameOver() {
  showGameOverScreen();
  submitScoreToServer(G.score, G.level, G.coinsEarned);
  submitTournamentScore(G.score, G.level, G.coinsEarned);
}
```

Change the death timer to call `finalGameOver()` instead of `showGameOverScreen()`:

```js
    if (G.deathTimer >= deathDuration) {
      finalGameOver();
    }
```

And remove the submit calls from inside `showGameOverScreen()`.

When the player continues and then dies again, `finalGameOver()` will be called on the second death with the preserved (higher) score.

- [ ] **Step 3: Keep session alive across ad continue**

The session should NOT be marked as `used` when the player continues. Since the client doesn't control this directly (the server marks it on score submission), this already works correctly — score is only submitted once at final death.

Verify: `_gameSession` is set in `requestGameSession()` at game start and is reused across the continue. No changes needed — just verify the flow.

- [ ] **Step 4: Verify complete game flow manually**

Test the following scenarios mentally / in browser:
1. Die → PLAY AGAIN → new game starts (no menu)
2. Die → game over shows rank nudge, best-score message
3. Shield spawns in ~5.6% of pipes, only once per game
4. Shield pickup shows indicator, absorbs one collision
5. Badges unlock at game over, popup shows
6. Ad buttons hidden (stub returns false) — graceful degradation
7. Prices in shop reflect new values

- [ ] **Step 5: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(integration): wire continue flow, score submission timing, state checks"
```

---

## Task 12: Final Polish & Cleanup

- [ ] **Step 1: Verify server starts without errors**

```bash
cd /opt/Flappy-Bert && node -e "const db = require('./db'); db.init(); console.log('DB OK');"
```

```bash
cd /opt/Flappy-Bert && timeout 3 node bot.js 2>&1 || true
```

Expected: No syntax errors. May fail on missing env vars — that's fine.

- [ ] **Step 2: Check for any console warnings or unused code**

Review all changes for:
- Functions referenced but not defined
- Variables referenced but not initialised
- Missing `hideAllOverlays` or `showOverlay` calls

- [ ] **Step 3: Update spec status**

In `docs/superpowers/specs/2026-03-20-engagement-phase1-design.md`, change:
```
**Status:** Design approved, pending implementation
```
to:
```
**Status:** Implemented
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 1 engagement improvements implementation"
```

- [ ] **Step 5: Push to GitHub**

```bash
git push origin main
```

Render will auto-deploy from the push.

---

## Dependency Graph

```
Task 1 (db.js) ──────┐
                      ├── Task 2 (bot.js) ── depends on Task 1
Task 3 (G fields) ────┤
                      ├── Task 4 (prices) ── independent
                      ├── Task 5 (game over) ── depends on Task 3, 6, 9
Task 6 (AdSystem) ────┤
                      ├── Task 7 (ad continue) ── depends on Task 6
Task 8 (shield) ──────┤── depends on Task 3
Task 9 (badges) ──────┤── depends on Task 3
Task 10 (lb render) ──┤── depends on Task 1
Task 11 (wiring) ─────┤── depends on Tasks 5, 7, 8, 9
Task 12 (polish) ─────┘── depends on all above
```

**Recommended execution order:** 1 → 2 → 3 → 4 → 6 → 8 → 9 → 5 → 7 → 10 → 11 → 12

Tasks 1+3+4+6 can run in parallel (independent files/sections). Tasks 8+9 can run in parallel after Task 3.
