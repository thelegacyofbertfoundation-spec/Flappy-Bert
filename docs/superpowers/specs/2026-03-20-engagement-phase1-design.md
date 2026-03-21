# Flappy Bert — Phase 1 Engagement Improvements

**Date:** 2026-03-20
**Status:** Implemented
**Scope:** Gameplay addictiveness, ad monetisation, progression hooks

## Overview

Phase 1 focuses on making the core gameplay loop more addictive before adding viral/social growth features in Phase 2. The goal: players keep playing longer per session and come back daily.

**Phase 2 (future):** Daily spin wheel, referral system with ongoing %, referral leaderboard, share-score improvements.

---

## 0. Prerequisite Spike: Ad SDK Compatibility

Before implementing ad integration, validate that the chosen ad SDK loads and renders correctly inside Telegram's in-app WebView browser. Telegram WebViews may have CSP restrictions, cookie limitations, or WebView configurations that block ad SDKs.

**Task:** Create a minimal test page that loads the Google AdSense/AdMob Web SDK and attempts to show a test ad inside the Telegram WebApp. If Google's SDK is blocked, evaluate alternatives (Yandex Ads, A-Ads, or a custom ad server).

**Fallback:** If no ad SDK works in Telegram WebView, the "watch ad" features degrade gracefully — buttons simply don't appear. All other Phase 1 features (instant replay, shield, badges, rebalance) work independently of ads.

---

## 1. Instant Replay & Game Over Flow

### Problem
Current flow from death to replaying requires 4+ taps through the menu. Too much friction.

### Design
**New flow:** Die -> death animation -> game over overlay with:
- **"PLAY AGAIN"** button — goes straight to ready screen, skips menu. One tap to replay.
- **"CONTINUE"** button (gold) — watch a rewarded ad to resume from where you died. Once per game max.

**Engagement messaging on game over screen:**
- "X away from your best!" or "NEW BEST!" — loss aversion / celebration
- "You're #N this week" or "X points behind #N" — competitive nudge from server leaderboard data

### Game Over Screen Layout (top to bottom)
1. Badge unlock popup (if earned) — animated, auto-dismisses after 2s
2. Medal + Score (existing, plus best-score messaging)
3. Rank nudge line
4. Coins earned + "Watch ad to double" button
5. Level + Combo stats
6. Two big buttons: PLAY AGAIN (primary) | CONTINUE (gold, rewarded ad)
7. Smaller row: Menu | Shop | Leaderboard

### Continue (Ad Resume) — Pipe Reset Algorithm
When the player continues via ad:
1. Remove all pipes within 2x `G.width` of Bert's x-position
2. Set a 60-frame (~1s) grace period where no new pipes spawn
3. Bert is placed at vertical center of the play area with zero velocity
4. A brief "GO!" countdown (0.5s) before gameplay resumes
5. Combo streak resets to 0. Score is preserved.

### Continue & Score Submission
- Do NOT submit score on the initial death if the player chooses to continue
- The original anti-cheat session remains valid (not marked `used`) until the final death
- Score is only submitted once — after the final death (whether the player continued or not)
- The score submission includes `adContinueUsed: true` flag so the server can adjust anti-cheat thresholds
- `G.adContinueUsed` is a transient boolean, reset in `startGame()`

---

## 2. Ad Integration

### Provider
Google AdSense / AdMob Web — requires validation spike (see Section 0).

### Rewarded Ads (opt-in)
- **Continue after death** — resume from death point, once per game
- **Double coins** — on game over screen, doubles that game's coin earnings

### Interstitial Ads (passive)
- Plays every **4th game over**
- Shows during death animation window — but ONLY extend the death timer from 50 frames to 90 frames (~1.5s) when an interstitial will actually play. Normal deaths remain at 50 frames.
- Counter tracked in transient `G.adInterstitialCounter` (resets on app close) — returning players don't hit an ad on first game
- Skippable after 5 seconds

### Loading & Fallback
- Pre-load next ad in background when each game starts
- If ad fails to load (network, blocker, etc.), skip gracefully
- "Watch ad" buttons only appear if an ad is ready
- Never block the player from playing

### AdSystem Object
New `AdSystem` object following the same pattern as the existing `AudioSystem`:
```
AdSystem {
  init()              — load SDK, set up ad slots
  preload()           — request next ad in background
  isRewardedReady()   — returns boolean
  isInterstitialReady() — returns boolean
  showRewarded(callback) — show rewarded ad, call callback on completion
  showInterstitial(callback) — show interstitial, call callback on dismiss
}
```

---

## 3. Shield Power-Up (In-Game Spawn)

### Spawn Rules
- ~8% chance per pipe, but only if the pipe does NOT already have a bonus coin. Shield replaces the coin slot — a pipe has either a coin (30%), a shield (8% of the remaining 70% = ~5.6% effective), or nothing.
- Only spawns if player has no active shield
- Maximum one shield per game from spawns

### Position
- Always spawns at the vertical center of the pipe gap (same position as bonus coins)
- On moving pipes, the shield moves with the gap

### Visual
- Glowing blue bubble/shield icon floating in pipe gap
- Pulse animation for visibility
- On pickup: "SHIELD!" text particle + shield indicator in screen corner

### Activation
- Automatic on hit (pipe or ground collision, not ceiling)
- Shield absorbs the hit and breaks (shatter particle effect)
- Bert bounces to center of nearest pipe gap (calculated from `G.pipes`)
- Brief invincibility (~30 frames / 0.5s) to prevent instant re-death
- Combo streak resets as penalty
- Screen flash + haptic feedback
- +5 coin survival bonus

### Anti-Cheat Integration
- Score submission includes `shieldUsed: boolean` flag
- Server-side `validateScore()` relaxes `MAX_SCORE_PER_SECOND` threshold by 20% when `shieldUsed` is true (shield saves extend run time)
- When both `shieldUsed` and `adContinueUsed` are true, threshold is relaxed by 50%

### Balance
- One shield max per game from spawns
- Cannot stack shields
- Does not protect against ceiling hits

---

## 4. Social Badges & Achievements

### Badge Definitions

| ID | Badge | Requirement | Icon Text | Coin Reward |
|----|-------|------------|-----------|-------------|
| rookie | Rookie | Score 10 in one game | RK | 25 |
| pipe_dodger | Pipe Dodger | Score 25 | PD | 50 |
| sky_king | Sky King | Score 50 | SK | 100 |
| legend | Legend | Score 100 | LG | 250 |
| immortal | Immortal | Score 200 | IM | 500 |
| streak_master | Streak Master | 7-day login streak | SM | 150 |
| combo_king | Combo King | Hit 10x combo | CK | 100 |
| close_call | Close Call | 20 near-misses in one game | CC | 75 |
| shield_breaker | Shield Breaker | Use 10 shields total | SB | 50 |

Phase 2 addition: `social_butterfly` — Refer 3 friends — 200 coins.

### Badge Icons — Rendering Strategy
Since `node-canvas` cannot render emojis (noted at leaderboard-card.js line 83), badge icons on server-rendered cards will use **procedurally drawn coloured circles with 2-letter text abbreviations** (e.g., gold circle with "SK" for Sky King). The style matches the existing medal drawing helpers. On the client HTML side, emojis can be used freely since browser rendering supports them.

### Display
- **Leaderboard (server card):** Highest-tier badge rendered as a coloured circle + abbreviation next to player name
- **Leaderboard (in-game HTML):** Highest badge shown as emoji next to name
- **Stats card:** All earned badges in a grid
- **Game over:** New badge earned = celebratory popup animation before score summary

### Badge Data Flow
- Client tracks `earnedBadges: string[]` in localStorage
- On score submission (`POST /api/score`), include `badges: string[]` in the request body
- Server stores badges in the `badges` column on the `players` table
- Server does NOT validate badge claims — client is source of truth (badges are cosmetic/social, not economic)

### Badge Check Timing
- Score-based badges: checked at game over
- Streak badge: checked at daily login
- Combo/near-miss badges: checked at game over
- Shield badge: checked when shield breaks (uses `shieldsUsedTotal` — see Data Model)

---

## 5. Coin Economy Rebalance

### Price Changes

| Item | Current | New | Rationale |
|------|---------|-----|-----------|
| 1.5x Multiplier (3 games) | 500 | 200 | Reachable after ~15-20 beginner games |
| 2x Multiplier (3 games) | 2500 | 750 | Aspirational but reachable |
| Neon skin | 50 | 50 | No change (starter skin) |
| Golden skin | 150 | 100 | More accessible |
| Shadow skin | 100 | 75 | Slight reduction |
| Ice skin | 120 | 90 | Slight reduction |
| Fire skin | 200 | 150 | Keep aspirational |
| Matrix skin | 250 | 200 | Slight reduction |
| Cosmic skin | 300 | 250 | Top-tier stays premium |

### New Coin Sources (Phase 1)
- Badge one-time rewards (25-500 coins)
- "Watch ad to double coins" on game over
- Shield-break survival bonus (+5 coins)

### Target
Beginners should hit their first skin purchase within ~10 games. First multiplier within ~15-20 games.

---

## 6. Data Model Changes

### Client-side — localStorage (`flappyBert`)
New persisted fields:
- `earnedBadges: string[]` — list of earned badge IDs
- `shieldsUsedTotal: number` — cumulative shield uses (for shield_breaker badge)

### Client-side — Transient Game State (`G` object)
New fields reset in `startGame()`:
- `G.hasShield: boolean` — whether player currently holds a shield
- `G.shieldUsedThisGame: boolean` — for anti-cheat flag
- `G.adContinueUsed: boolean` — for anti-cheat flag
- `G.nearMissesThisGame: number` — per-game counter for close_call badge
- `G.adInterstitialCounter: number` — counts games for interstitial timing (NOT reset per game, but NOT persisted — reset on app close)

### Server-side (SQLite)

**Migration:** Add to `db.js` init() function, after the `CREATE TABLE IF NOT EXISTS` block:
```js
try { db.exec("ALTER TABLE players ADD COLUMN badges TEXT DEFAULT '[]'"); } catch(e) {}
```
This is safe to run repeatedly — fails silently if column already exists.

**Score endpoint changes (`bot.js`):**
- `POST /api/score` accepts new optional fields: `badges`, `shieldUsed`, `adContinueUsed`
- `validateScore()` relaxes time-based thresholds when `shieldUsed` or `adContinueUsed` are true
- Player badges are stored on score submission

**Leaderboard queries:** Updated to `SELECT ... p.badges ...` so badge data is available for rendering.

---

## 7. Files Modified

### Phase 1 Changes
- **flappy_bert.html** — instant replay flow, shield spawns, badge system, ad integration (AdSystem object), coin rebalance, game over redesign, anti-cheat flags
- **bot.js** — accept `badges`/`shieldUsed`/`adContinueUsed` in score endpoint, adjust anti-cheat thresholds, store badges
- **db.js** — add `badges` column migration, update leaderboard queries to include badges
- **leaderboard-card.js** — render badge abbreviation circles next to player names (procedural drawing, no emojis)

### New Files
- None — all changes fit within existing files

---

## 8. Out of Scope (Phase 2)

- Daily spin wheel
- Referral system with ongoing %
- Referral leaderboard
- Social Butterfly badge
- Team/crew system
- Energy/lives system (explicitly rejected — game stays free-to-play unlimited)
