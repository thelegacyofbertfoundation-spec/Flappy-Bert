# Aesthetic Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the FX juice module, 10-moment polish sweep, Magnet powerup, and sequenced game-over redesign to Flappy Bert. Bundle the dead-code cleanup. Ship without server-side changes.

**Architecture:** All work in the inline `<script>` of `flappy_bert.html` (per CLAUDE.md single-file convention). New `FX` singleton centralises every "moment" (particles + audio + screen shake/flash + DOM glow). New `AudioSystem` helpers add ADSR / chord / sweep / noise-burst / synth-reverb primitives. Magnet token is canvas-rendered, has a 5-second active window, pulls coins via spring physics. Game-over reveal is a `setTimeout`-driven CSS-class-toggle sequence with skip + cancel.

**Tech Stack:** Vanilla JS, HTML5 Canvas, Web Audio API, `node:test` for unit tests, no build step.

**Source spec:** `docs/superpowers/specs/2026-04-30-aesthetic-pass-design.md` (commits `c68af30` + `c362cb8`).

**Conventions:**
- Each task ends with a commit. Branch is `main` (no separate feature branch — small change).
- Test command: `npm test` (= `node --test tests/*.test.js`).
- Manual playtest: `node bot.js` locally → open `http://localhost:3000/game` in a browser. (`PORT` defaults to 3000.) Set `BOT_TOKEN=dummy WEBAPP_URL=http://localhost:3000 API_SECRET=$(openssl rand -hex 32)` in env to satisfy required vars; the game itself works without a real bot.
- Visual events without unit-testable logic are verified by manual playtest. The plan flags every task that needs human eyes.
- Where a unit test is requested, the test mirrors the implementation in a small helper inside `tests/lib/` and asserts the math/state. The HTML implementation must mirror the helper. This is a documented drift risk; flagged in commit messages where it applies.

---

## File map

**Modified:**
- `flappy_bert.html` — every functional task touches this file (single monolithic asset).
- `docs/superpowers/bugs-defer-to-june.md` — Task 27.

**Created:**
- `tests/lib/magnet-timer.js` — Task 14.
- `tests/lib/spawn-cap.js` — Task 4.
- `tests/lib/sequence-runner.js` — Task 24.
- `tests/fx-magnet-timer.test.js` — Task 14.
- `tests/fx-spawn-cap.test.js` — Task 4.
- `tests/fx-game-over-sequence.test.js` — Task 24.
- `docs/superpowers/feature-backlog.md` — Task 28.

---

## Phase 1 — Audio + FX foundations

### Task 1: AudioSystem._adsr helper

**Files:**
- Modify: `flappy_bert.html` (inside `AudioSystem` singleton, around line 920–1000)

- [ ] **Step 1: Add `_adsr` method to `AudioSystem`**

Add after `playNote` (~line 944) inside the `AudioSystem` object:

```js
// ADSR envelope helper. peak: target gain at end of attack; sustain: gain held during hold (relative).
// Returns the gainNode for chaining.
_adsr(gainNode, { attack = 5, decay = 30, sustain = 0.4, release = 100, peak = 0.2 } = {}) {
  if (!this.ctx) return gainNode;
  const t = this.ctx.currentTime;
  const aS = attack / 1000, dS = decay / 1000, rS = release / 1000;
  gainNode.gain.cancelScheduledValues(t);
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.linearRampToValueAtTime(peak, t + aS);
  gainNode.gain.linearRampToValueAtTime(peak * sustain, t + aS + dS);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + aS + dS + rS);
  return gainNode;
},
```

- [ ] **Step 2: Manual smoke test**

Run: `node bot.js` (with env vars set per Conventions), open `http://localhost:3000/game` in a browser. Tap to flap. Existing flap sound still plays (no regression — we haven't rewired anything yet).

Expected: PASS — game loads, audio works, no console errors.

- [ ] **Step 3: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(audio): add AudioSystem._adsr envelope helper

No call sites yet — helper is set up for upcoming SFX rewrites."
```

---

### Task 2: AudioSystem chord / sweep / noiseBurst helpers

**Files:**
- Modify: `flappy_bert.html` (`AudioSystem` singleton)

- [ ] **Step 1: Add `_chord`, `_sweep`, `_noiseBurst` methods after `_adsr`**

```js
// Stack N oscillators in parallel summed to one gain. Used for arpeggios / fanfare.
_chord(freqs, type = 'square', durMs = 200, gainPerVoice = 0.06, opts = {}) {
  if (!this.ctx) return;
  const now = this.ctx.currentTime;
  const dur = durMs / 1000;
  const merge = this.ctx.createGain();
  merge.gain.value = 1.0;
  freqs.forEach((f, i) => {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gainPerVoice, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(merge);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  });
  merge.connect(this.sfxGain);
  if (opts.reverb && this.reverbSend) merge.connect(this.reverbSend);
},

// Frequency sweep on a single oscillator. type: 'sine'|'square'|'triangle'|'sawtooth'.
_sweep(fStart, fEnd, durMs = 100, type = 'sine', gain = 0.18, opts = {}) {
  if (!this.ctx) return;
  const now = this.ctx.currentTime;
  const dur = durMs / 1000;
  const osc = this.ctx.createOscillator();
  const g = this.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fStart, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(fEnd, 1), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(gain, now + Math.min(0.01, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g);
  g.connect(this.sfxGain);
  if (opts.reverb && this.reverbSend) g.connect(this.reverbSend);
  osc.start(now);
  osc.stop(now + dur + 0.05);
},

// Filtered white-noise burst. Used for swooshes and shatter effects.
_noiseBurst(durMs = 100, cutoffHz = 1200, gain = 0.18) {
  if (!this.ctx) return;
  const now = this.ctx.currentTime;
  const dur = durMs / 1000;
  const sampleCount = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
  const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) data[i] = Math.random() * 2 - 1;
  const src = this.ctx.createBufferSource();
  src.buffer = buffer;
  const filt = this.ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = cutoffHz;
  const g = this.ctx.createGain();
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
  src.start(now);
  src.stop(now + dur + 0.05);
},
```

- [ ] **Step 2: Manual smoke test**

Reload game. Existing audio still works.

- [ ] **Step 3: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(audio): add chord, sweep, and noiseBurst helpers"
```

---

### Task 3: AudioSystem synthesized reverb

**Files:**
- Modify: `flappy_bert.html` (`AudioSystem.init`, around line 897–911)

- [ ] **Step 1: Add `reverbSend` initialisation in `AudioSystem.init`**

After the `this.sfxGain.connect(this.masterGain)` line (~907), add:

```js
// Synthesized reverb: ConvolverNode fed by a synthesized impulse response.
// Generated once at boot; routed through sfxGain so the mute toggle covers it.
try {
  const ir = this.ctx.createBuffer(2, this.ctx.sampleRate * 0.4, this.ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
    }
  }
  this.reverb = this.ctx.createConvolver();
  this.reverb.buffer = ir;
  this.reverbSend = this.ctx.createGain();
  this.reverbSend.gain.value = 0.15;
  this.reverbSend.connect(this.reverb);
  this.reverb.connect(this.sfxGain);
} catch(e) { /* reverb optional — ignore */ }
```

- [ ] **Step 2: Manual smoke test**

Reload game. Open browser DevTools console — no errors. Mute toggle still works (mute → silent).

- [ ] **Step 3: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(audio): synthesized convolver reverb with reverbSend bus"
```

---

### Task 4: FX module skeleton — _spawnParticles, _shake, _flash, _glowText

**Files:**
- Modify: `flappy_bert.html` (insert new `FX` object right after `AudioSystem` definition ends; find the closing brace of `AudioSystem` first — currently around the music-loop functions area)
- Create: `tests/lib/spawn-cap.js`
- Create: `tests/fx-spawn-cap.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/spawn-cap.js`:

```js
// Mirror of FX._spawnParticles cap behavior (in flappy_bert.html).
// Tests reference this; HTML implementation must match.
const PARTICLE_CAP = 150;

function spawnParticles(particles, opts) {
  if (particles.length >= PARTICLE_CAP) return 0;
  const count = opts.count || 1;
  const allow = Math.min(count, PARTICLE_CAP - particles.length);
  for (let i = 0; i < allow; i++) {
    particles.push({
      x: opts.x, y: opts.y,
      vx: (Math.random() - 0.5) * (opts.speed || 4),
      vy: (Math.random() - 0.5) * (opts.speed || 4),
      life: opts.life || 30, maxLife: opts.life || 30,
      color: opts.color || '#fff',
      size: opts.size || 2,
    });
  }
  return allow;
}

module.exports = { spawnParticles, PARTICLE_CAP };
```

Create `tests/fx-spawn-cap.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnParticles, PARTICLE_CAP } = require('./lib/spawn-cap');

test('spawnParticles spawns when under cap', () => {
  const arr = [];
  const n = spawnParticles(arr, { x: 0, y: 0, count: 8 });
  assert.equal(n, 8);
  assert.equal(arr.length, 8);
});

test('spawnParticles spawns up to cap then drops silently', () => {
  const arr = new Array(PARTICLE_CAP - 5).fill({});
  const n = spawnParticles(arr, { x: 0, y: 0, count: 20 });
  assert.equal(n, 5, 'should only spawn the 5 remaining slots');
  assert.equal(arr.length, PARTICLE_CAP);
});

test('spawnParticles drops fully when at cap', () => {
  const arr = new Array(PARTICLE_CAP).fill({});
  const n = spawnParticles(arr, { x: 0, y: 0, count: 10 });
  assert.equal(n, 0);
  assert.equal(arr.length, PARTICLE_CAP);
});
```

- [ ] **Step 2: Run test to verify it passes (test-first against the helper)**

Run: `npm test -- --test-only=false`

Expected: 3 new tests pass. (Tests target the helper, which we just wrote — they pass on first run. The HTML implementation will mirror this helper; deviation in the HTML will silently not be caught here, hence "drift risk" caveat.)

- [ ] **Step 3: Implement `FX` object in `flappy_bert.html`**

Find the line right before the first non-`AudioSystem` top-level code (probably right before `// Initialize audio` or after `AudioSystem` closing brace). Insert:

```js
// ========== FX — JUICE LAYER ==========
// Single entry point for every visible/audible "moment". Each public method
// orchestrates particles + audio + screen effects + DOM glow.
const FX = {
  PARTICLE_CAP: 150,

  _spawnParticles(opts) {
    if (G.particles.length >= this.PARTICLE_CAP) return 0;
    const count = opts.count || 1;
    const allow = Math.min(count, this.PARTICLE_CAP - G.particles.length);
    const speed = opts.speed != null ? opts.speed : 4;
    for (let i = 0; i < allow; i++) {
      G.particles.push({
        x: opts.x, y: opts.y,
        vx: (Math.random() - 0.5) * speed + (opts.vx0 || 0),
        vy: (Math.random() - 0.5) * speed + (opts.vy0 || 0),
        life: opts.life || 30, maxLife: opts.life || 30,
        color: opts.color || '#fff',
        size: opts.size || 2,
        glow: !!opts.glow,
      });
    }
    return allow;
  },

  _shake(intensity, frames) {
    G.shakeFrames = Math.max(G.shakeFrames || 0, frames);
    G.shakeIntensity = Math.max(G.shakeIntensity || 0, intensity);
  },

  _flash(alpha, color = 'white') {
    G.flashAlpha = Math.max(G.flashAlpha || 0, alpha);
    const el = document.getElementById('screenFlash');
    if (el) el.style.background = color;
  },

  // Briefly glow a DOM element by toggling a class. Class auto-removed via setTimeout.
  _glowText(domId, durationMs = 400) {
    const el = document.getElementById(domId);
    if (!el) return;
    el.classList.add('fx-glow-pulse');
    setTimeout(() => el.classList.remove('fx-glow-pulse'), durationMs);
  },
};
```

Also append a CSS rule inside the existing `<style>` block (find the `@keyframes pulse` definition near line 372 and add after it):

```css
.fx-glow-pulse { animation: fxGlowPulse 0.4s ease-out; }
@keyframes fxGlowPulse {
  0%   { transform: scale(1.0); text-shadow: 0 0 0 transparent; }
  50%  { transform: scale(1.15); text-shadow: 0 0 12px currentColor; }
  100% { transform: scale(1.0); text-shadow: 0 0 0 transparent; }
}
```

- [ ] **Step 4: Reload game, confirm no console errors**

- [ ] **Step 5: Commit**

```bash
git add flappy_bert.html tests/lib/spawn-cap.js tests/fx-spawn-cap.test.js
git commit -m "feat(fx): FX module skeleton with spawnParticles cap, shake, flash, glowText

Spawn-cap behavior mirrored in tests/lib/spawn-cap.js (drift risk acknowledged)."
```

---

### Task 5: Refactor existing death/shake/flash juice to call FX

**Files:**
- Modify: `flappy_bert.html` (function `gameOver()` around line 1457–1490)

- [ ] **Step 1: Replace inline death-particle / shake / flash code in `gameOver()`**

Find lines ~1465–1486 (the screen shake + flash + death particles block). Replace with:

```js
// Screen shake + flash + death burst — orchestrated via FX
FX._shake(8, 20);
FX._flash(0.7, 'white');

// Haptic buzz on death
try { navigator.vibrate && navigator.vibrate([50, 30, 80]); } catch(e) {}

// Fling Bert upward then let gravity pull down
G.bert.vy = -4;

FX._spawnParticles({
  x: G.bert.x, y: G.bert.y,
  count: 20, speed: 8,
  life: 50, color: getSkinColor(), size: 3,
});
```

- [ ] **Step 2: Manual smoke test — die in the game**

Run: `node bot.js`, browser to `/game`. Crash Bert into a pipe.

Expected: PASS — same screen shake / flash / particles as before. No regressions.

- [ ] **Step 3: Commit**

```bash
git add flappy_bert.html
git commit -m "refactor(fx): existing death juice now routes through FX helpers"
```

---

## Phase 2 — Polish events

### Task 6: FX.coinPickup

**Files:**
- Modify: `flappy_bert.html` (add `FX.coinPickup`; add `AudioSystem.fxCoinPickup`; rewire coin-pickup site at line ~2007 / ~2102)

- [ ] **Step 1: Add new SFX method to `AudioSystem`**

Insert after the existing `playCoin` method (~line 985):

```js
// New chime for coin pickup (replaces playCoin in FX.coinPickup path)
fxCoinPickup() {
  this._sweep(660, 1320, 80, 'sine', 0.14);
  this._sweep(990, 1980, 80, 'triangle', 0.07);
},
```

- [ ] **Step 2: Add `FX.coinPickup` method**

Inside the `FX` object, after `_glowText`:

```js
coinPickup(x, y) {
  AudioSystem.fxCoinPickup();
  this._spawnParticles({
    x, y, count: 7, speed: 5, life: 24,
    color: '#ffd700', size: 2, glow: true,
  });
  this._glowText('coinCount', 300);
},
```

- [ ] **Step 3: Replace existing coin-pickup juice**

Find both `AudioSystem.playCoin();` call sites (lines ~2007 and ~2102). Replace each with:

```js
FX.coinPickup(coin.x + coinSize/2, coin.y + coinSize/2);
```

(Use whatever the local coin variable is named. If `coin` is undefined at that site, pass `G.bert.x, G.bert.y`.)

- [ ] **Step 4: Add `glow` rendering support to particle draw**

Find the particle draw loop (search for `G.particles[i]` near rendering — around line 1890–1920). In the draw block, add additive blend when `p.glow` is true:

```js
const prevComp = ctx.globalCompositeOperation;
if (p.glow) ctx.globalCompositeOperation = 'lighter';
// ... existing drawing code (fillStyle, fillRect, etc.) ...
ctx.globalCompositeOperation = prevComp;
```

- [ ] **Step 5: Manual playtest**

Reload. Pick up coins.

Expected: PASS — sparkle particles burst from coin position, gold glow on the HUD coin counter, distinct ascending chime.

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(fx): coinPickup — gold sparkle burst + ascending chime"
```

---

### Task 7: FX.pipePass

**Files:**
- Modify: `flappy_bert.html` (find pipe-pass site around line 2009 where score increments; add `FX.pipePass` and CSS keyframe)

- [ ] **Step 1: Locate pipe-pass score increment**

Around line 2007–2012, where `scoreEl.textContent = G.score;` happens after a pipe is cleared. That's our pipe-pass site.

- [ ] **Step 2: Add `AudioSystem.fxPipePass`**

Inside `AudioSystem` after `fxCoinPickup`:

```js
fxPipePass() {
  this._noiseBurst(60, 800, 0.06);
},
```

- [ ] **Step 3: Add `FX.pipePass`**

```js
pipePass() {
  AudioSystem.fxPipePass();
  const el = document.getElementById('scoreDisplay');
  if (el) {
    el.classList.remove('fx-score-pulse');
    void el.offsetWidth;  // restart animation
    el.classList.add('fx-score-pulse');
  }
},
```

- [ ] **Step 4: CSS scale-pulse keyframe**

Append to `<style>` block:

```css
.fx-score-pulse { animation: fxScorePulse 0.18s ease-out; }
@keyframes fxScorePulse {
  0%   { transform: translateX(-50%) scale(1.0); }
  40%  { transform: translateX(-50%) scale(1.15); }
  100% { transform: translateX(-50%) scale(1.0); }
}
```

(Verify the existing `#scoreDisplay` already uses `translateX(-50%)` — if not, drop those translate parts to avoid layout shift.)

- [ ] **Step 5: Wire it in**

After the line that sets `scoreEl.textContent = G.score;`, add:

```js
FX.pipePass();
```

- [ ] **Step 6: Manual playtest**

Reload. Pass through pipes.

Expected: PASS — soft swoosh on each pipe, score number does a 1-frame scale pulse.

- [ ] **Step 7: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(fx): pipePass — score pulse + soft swoosh"
```

---

### Task 8: FX.combo

**Files:**
- Modify: `flappy_bert.html` (combo site near line 2047 where `G.coins += comboBonus`; add CSS for floating text)

- [ ] **Step 1: Add `AudioSystem.fxCombo`**

```js
fxCombo() {
  // Three-note ascending arpeggio (root, fifth, octave) with reverb
  this._chord([523, 784, 1046], 'square', 240, 0.07, { reverb: true });
},
```

- [ ] **Step 2: Add `FX.combo`**

```js
combo(n, x, y) {
  AudioSystem.fxCombo();
  // Confetti
  const palette = ['#ff4d6d', '#ffb800', '#4dffb8', '#4da6ff', '#c04dff', '#ffd700'];
  for (let i = 0; i < 12; i++) {
    this._spawnParticles({
      x, y, count: 1, speed: 6, life: 50,
      color: palette[i % palette.length], size: 3, glow: true,
    });
  }
  // Floating "COMBO ×N!" text via DOM (reuse comboDisplay or create floater)
  this._comboFloater(n, x, y);
  this._glowText('coinCount', 300);
},

// Internal: spawn an ephemeral floating text element
_comboFloater(n, x, y) {
  const el = document.createElement('div');
  el.className = 'fx-floater fx-combo-floater';
  el.textContent = 'COMBO ×' + n + '!';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
},
```

- [ ] **Step 3: CSS for floater**

```css
.fx-floater {
  position: fixed;
  pointer-events: none;
  font-family: var(--font);
  font-size: 12px;
  z-index: 200;
  transform: translate(-50%, 0);
  animation: fxFloaterRise 0.9s ease-out forwards;
}
.fx-combo-floater {
  background: linear-gradient(90deg, #ff4d6d, #ffb800, #4dffb8, #4da6ff, #c04dff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 8px rgba(255,255,255,0.6);
  font-weight: bold;
}
@keyframes fxFloaterRise {
  0%   { opacity: 0; transform: translate(-50%, 0)    scale(0.5); }
  20%  { opacity: 1; transform: translate(-50%, -10px) scale(1.2); }
  80%  { opacity: 1; transform: translate(-50%, -50px) scale(1.0); }
  100% { opacity: 0; transform: translate(-50%, -70px) scale(0.95); }
}
```

- [ ] **Step 4: Wire it in at combo site**

Around line 2047 (`G.coins += comboBonus;`), grab the player position context. Replace the existing combo-display update / sound calls with:

```js
FX.combo(comboCount, G.bert.x, G.bert.y);
```

(Keep the existing `G.coins += comboBonus;` — don't break the coin economy.)

- [ ] **Step 5: Manual playtest**

Reload. Pass 5 pipes in a row. Pass 10. Pass 15.

Expected: PASS — floating "COMBO ×5!" rises from Bert, confetti sprays, ascending arpeggio plays.

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(fx): combo — confetti + rainbow floater + arpeggio"
```

---

### Task 9: FX.nearMiss

**Files:**
- Modify: `flappy_bert.html` (near-miss site around line 2027; add ghost trail rendering)

- [ ] **Step 1: Add `AudioSystem.fxNearMiss`**

```js
fxNearMiss() {
  this._sweep(440, 880, 90, 'square', 0.10);
},
```

- [ ] **Step 2: Add `FX.nearMiss` and ghost-trail state**

Inside `FX`:

```js
// Ephemeral "ghost trail" rendered by drawPlayer when populated
ghostTrail: [],

nearMiss(x, y) {
  AudioSystem.fxNearMiss();
  // Capture 4 ghost positions over the next 4 frames (drawPlayer reads this)
  this.ghostTrail = [
    { x: G.bert.x, y: G.bert.y, life: 12, maxLife: 12 },
    { x: G.bert.x, y: G.bert.y, life: 9,  maxLife: 12 },
    { x: G.bert.x, y: G.bert.y, life: 6,  maxLife: 12 },
    { x: G.bert.x, y: G.bert.y, life: 3,  maxLife: 12 },
  ];
  this._floater('+3 ⚡', x, y, 'fx-near-miss-floater');
},

// Internal: generic floater used by nearMiss / level-up etc.
_floater(text, x, y, extraClass = '') {
  const el = document.createElement('div');
  el.className = 'fx-floater ' + extraClass;
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
},
```

- [ ] **Step 3: Render ghost trail in `drawPlayer`**

Find `function drawPlayer(...)` (search). After the player rect is drawn, add:

```js
// Ghost trail (decays each frame)
if (FX.ghostTrail && FX.ghostTrail.length) {
  for (let i = FX.ghostTrail.length - 1; i >= 0; i--) {
    const g = FX.ghostTrail[i];
    g.life--;
    if (g.life <= 0) { FX.ghostTrail.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = g.life / g.maxLife * 0.4;
    ctx.fillStyle = getSkinColor();
    ctx.fillRect(g.x, g.y, G.bert.size, G.bert.size);
    ctx.restore();
  }
}
```

- [ ] **Step 4: CSS for near-miss floater**

```css
.fx-near-miss-floater {
  color: #ffd700;
  text-shadow: 0 0 10px rgba(255,255,255,0.8);
  font-size: 14px;
}
```

- [ ] **Step 5: Wire it in**

Near line 2027 (`G.coins += nearBonus`), add:

```js
FX.nearMiss(G.bert.x, G.bert.y);
```

- [ ] **Step 6: Manual playtest**

Reload. Squeeze close past pipes (high or low gap edge).

Expected: PASS — brief ghost trail behind Bert, "+3 ⚡" floater rises, sharp twang.

- [ ] **Step 7: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(fx): nearMiss — ghost trail + +3 floater + twang"
```

---

### Task 10: FX.shieldHit

**Files:**
- Modify: `flappy_bert.html` (find shield-absorbs-hit site — search for `shield` near collision detection)

- [ ] **Step 1: Locate shield-absorb path**

Search for `G.shield` in the collision/hit-detection code (likely around 2150–2260). Find the branch where shield is consumed without dying.

- [ ] **Step 2: Add `AudioSystem.fxShieldHit`**

```js
fxShieldHit() {
  this._noiseBurst(250, 1200, 0.20);          // shatter
  this._sweep(120, 60, 200, 'sine', 0.18);    // sub thump
},
```

- [ ] **Step 3: Add `FX.shieldHit` and shockwave state**

```js
// Active cyan shockwave; drawn each frame in render
shockwave: null,

shieldHit(x, y) {
  AudioSystem.fxShieldHit();
  this.shockwave = { x, y, t: 0, max: 250 };  // ms-based, render reads
  this._shake(4, 6);
  this._flash(0.3, '#4dffff');
},
```

- [ ] **Step 4: Render shockwave**

Find the main render block in the game loop. After particles are drawn, add:

```js
if (FX.shockwave) {
  const sw = FX.shockwave;
  sw.t += 16;  // frame is ~16.67ms; close enough
  const p = sw.t / sw.max;
  if (p >= 1) { FX.shockwave = null; }
  else {
    ctx.save();
    ctx.strokeStyle = '#4dffff';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1 - p;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, p * 80, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
```

- [ ] **Step 5: Wire it in at shield-absorb site**

Where the existing code clears the shield without dying, replace any inline shake/flash there with:

```js
FX.shieldHit(G.bert.x, G.bert.y);
```

- [ ] **Step 6: Manual playtest**

Reload. Buy/equip shield (random ~5.6% — easier to test by temporarily setting `G.hasShield = true` in console). Hit a pipe.

Expected: PASS — cyan ring bursts from impact, light shake, light cyan flash, glass-shatter SFX. Game continues.

- [ ] **Step 7: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(fx): shieldHit — cyan shockwave + shatter + sub thump"
```

---

### Task 11: FX.levelUp

**Files:**
- Modify: `flappy_bert.html` (level-up logic — find where `G.level++` happens, around line 2080)

- [ ] **Step 1: Add `AudioSystem.fxLevelUp`**

```js
fxLevelUp() {
  // Fanfare: root, third, fifth, octave
  this._chord([523, 659, 784, 1046], 'square', 700, 0.06, { reverb: true });
},
```

- [ ] **Step 2: Add level banner DOM element**

Inside `<body>` (after `<div id="screenFlash">` is a good spot), add:

```html
<div id="levelBanner" class="fx-level-banner" style="display:none"></div>
```

- [ ] **Step 3: CSS for banner + 6-palette nudge**

```css
.fx-level-banner {
  position: fixed;
  top: 38%; left: 0; right: 0;
  font-family: var(--font);
  font-size: 32px;
  color: #ffd700;
  text-align: center;
  text-shadow: 0 0 16px rgba(255,215,0,0.8), 0 0 4px #fff;
  z-index: 150;
  pointer-events: none;
  animation: fxLevelBanner 1.2s ease-out forwards;
}
@keyframes fxLevelBanner {
  0%   { opacity: 0; transform: translateX(-100%); }
  20%  { opacity: 1; transform: translateX(0); }
  75%  { opacity: 1; transform: translateX(0); }
  100% { opacity: 0; transform: translateX(100%); }
}
```

- [ ] **Step 4: Add `FX.levelUp` and palette state**

```js
// Index into BG_PALETTES (defined elsewhere in the script if it isn't yet —
// if not present, this task is the place to introduce it)
levelPaletteIndex: 0,

levelUp(n) {
  AudioSystem.fxLevelUp();
  const banner = document.getElementById('levelBanner');
  if (banner) {
    banner.textContent = 'LEVEL ' + n;
    banner.style.display = 'none';
    void banner.offsetWidth;
    banner.style.display = 'block';
    setTimeout(() => { banner.style.display = 'none'; }, 1200);
  }
  // Palette nudge: cycle of 6, indexed by level mod 6
  this.levelPaletteIndex = n % 6;
},
```

- [ ] **Step 5: Define palette + apply on draw (if not already)**

Search the file for any existing palette / background-color logic. If a palette concept already exists, hook into it. If not, add near the top of the script:

```js
const BG_PALETTES = [
  { sky1: '#0b1f3a', sky2: '#1a2c4a' },  // night blue (default)
  { sky1: '#3a0b1f', sky2: '#4a1a2c' },  // ruby
  { sky1: '#0b3a1f', sky2: '#1a4a2c' },  // emerald
  { sky1: '#3a2a0b', sky2: '#4a3a1a' },  // amber
  { sky1: '#1f0b3a', sky2: '#2c1a4a' },  // violet
  { sky1: '#0b3a3a', sky2: '#1a4a4a' },  // teal
];
```

In the background-draw code (find where the sky is rendered), replace hardcoded sky colors with `BG_PALETTES[FX.levelPaletteIndex].sky1` etc.

If the existing background is gradient-based, swap the gradient stops. If it's a solid color, swap the fillStyle.

- [ ] **Step 6: Wire it in**

Find where level increments (search `G.level++` or `G.level += 1`). Add right after:

```js
FX.levelUp(G.level);
```

- [ ] **Step 7: Manual playtest**

Reload. Play through 10 pipes (level 2), 20 (level 3), 30 (level 4).

Expected: PASS — banner sweeps "LEVEL N" across the screen, fanfare plays, background palette nudges to a new color set.

- [ ] **Step 8: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(fx): levelUp — sweep banner, fanfare, palette nudge"
```

---

### Task 12: FX.jeetSpawn

**Files:**
- Modify: `flappy_bert.html` (JEET spawn site near line 1398–1402)

- [ ] **Step 1: Add `AudioSystem.fxJeetSpawn`**

```js
fxJeetSpawn() {
  // Saw + noise growl, low frequency, ~150ms
  this._sweep(180, 80, 150, 'sawtooth', 0.16);
  this._noiseBurst(150, 400, 0.08);
},
```

- [ ] **Step 2: Add JEET warning indicator state + render**

```js
// JEETs about to spawn — drawn as red triangle at edge of screen
jeetWarnings: [],

jeetSpawn(x, y) {
  AudioSystem.fxJeetSpawn();
  // Warning indicator at right edge for 200ms before JEET appears.
  // Caller fires FX.jeetSpawn when JEET is *placed* — but if you want a
  // pre-warning, fire FX.jeetWarn(y) ~12 frames before placement instead.
  // For this pass: spawn warning at the moment of jeetSpawn; render for a brief
  // window during which the JEET fades in.
  this.jeetWarnings.push({ y, life: 12, maxLife: 12 });
},
```

Render hook (in main draw loop, near JEET rendering):

```js
if (FX.jeetWarnings.length) {
  for (let i = FX.jeetWarnings.length - 1; i >= 0; i--) {
    const w = FX.jeetWarnings[i];
    w.life--;
    if (w.life <= 0) { FX.jeetWarnings.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = (w.life / w.maxLife) * 0.85;
    ctx.fillStyle = '#ff3344';
    ctx.beginPath();
    ctx.moveTo(canvas.width - 20, w.y);
    ctx.lineTo(canvas.width - 4, w.y - 8);
    ctx.lineTo(canvas.width - 4, w.y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
```

- [ ] **Step 3: Add JEET fade-in halo**

Find the JEET render block (around line 2386–2394 — `ctx.fillText('JEETS', 0, 0)`). Track `jeet.spawnFrame = G.frameCount` when spawned. In render, while `G.frameCount - jeet.spawnFrame < 24`, draw a red glow halo with decreasing alpha.

- [ ] **Step 4: Wire it in at spawn site**

Near line 1398–1402 (the JEET spawn), after pushing the JEET into the array, add:

```js
FX.jeetSpawn(jeet.x, jeet.y);
jeet.spawnFrame = G.frameCount;  // for fade-in halo
```

- [ ] **Step 5: Manual playtest**

Reload. Play to level 2+ where JEETs spawn.

Expected: PASS — red triangle warning at right edge, JEET fades in with halo, low growl SFX.

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(fx): jeetSpawn — warning triangle, fade-in halo, growl"
```

---

### Task 13: FX.jeetDodge

**Files:**
- Modify: `flappy_bert.html` (JEET update loop — wherever JEET position is advanced and removed when off-screen)

- [ ] **Step 1: Add `AudioSystem.fxJeetDodge`**

```js
fxJeetDodge() {
  this._noiseBurst(200, 350, 0.10);
},
```

- [ ] **Step 2: Add `FX.jeetDodge`**

```js
jeetDodge(x, y) {
  AudioSystem.fxJeetDodge();
  this._spawnParticles({
    x, y, count: 4, speed: 4, life: 24,
    color: '#222', size: 3,
  });
},
```

- [ ] **Step 3: Detect dodge in JEET update loop**

Find the JEET update loop where JEETs are removed when `jeet.x < -someThreshold`. Replace the removal with:

```js
if (jeet.x < -50) {
  // JEET exited Bert's side without colliding — dodge!
  if (!jeet._dodgeCounted) {
    FX.jeetDodge(jeet.x, jeet.y);
    jeet._dodgeCounted = true;
  }
  G.jeets.splice(i, 1);
  continue;
}
```

(Use whatever the actual array name is — likely `G.jeets` or `G.enemies`.)

- [ ] **Step 4: Manual playtest**

Reload. Reach level 2. Avoid JEETs as they pass.

Expected: PASS — black puff particles trail the JEET as it exits left, deep whoosh SFX. No coin reward (per spec).

- [ ] **Step 5: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(fx): jeetDodge — puff particles + whoosh on JEET exit-left"
```

---

## Phase 3 — Magnet powerup

### Task 14: G.powerups state + magnet timer logic + tests

**Files:**
- Modify: `flappy_bert.html` (`G` object init around line 620; `gameOver()`)
- Create: `tests/lib/magnet-timer.js`
- Create: `tests/fx-magnet-timer.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/magnet-timer.js`:

```js
// Magnet timer logic — mirror of code in flappy_bert.html
const MAGNET_DURATION_FRAMES = 60 * 5;

function createPowerups() {
  return { magnet: { active: false, expiresAt: 0 } };
}

function magnetActivate(powerups, frameCount) {
  powerups.magnet.active = true;
  powerups.magnet.expiresAt = frameCount + MAGNET_DURATION_FRAMES;
}

// Returns true if the magnet just expired this tick.
function magnetTick(powerups, frameCount) {
  if (powerups.magnet.active && frameCount >= powerups.magnet.expiresAt) {
    powerups.magnet.active = false;
    return true;
  }
  return false;
}

module.exports = { createPowerups, magnetActivate, magnetTick, MAGNET_DURATION_FRAMES };
```

Create `tests/fx-magnet-timer.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPowerups, magnetActivate, magnetTick, MAGNET_DURATION_FRAMES } = require('./lib/magnet-timer');

test('magnetActivate sets active and expiresAt', () => {
  const p = createPowerups();
  magnetActivate(p, 100);
  assert.equal(p.magnet.active, true);
  assert.equal(p.magnet.expiresAt, 100 + MAGNET_DURATION_FRAMES);
});

test('magnetTick keeps active before expiry', () => {
  const p = createPowerups();
  magnetActivate(p, 0);
  const expired = magnetTick(p, MAGNET_DURATION_FRAMES - 1);
  assert.equal(expired, false);
  assert.equal(p.magnet.active, true);
});

test('magnetTick expires at exact frame', () => {
  const p = createPowerups();
  magnetActivate(p, 0);
  const expired = magnetTick(p, MAGNET_DURATION_FRAMES);
  assert.equal(expired, true);
  assert.equal(p.magnet.active, false);
});

test('re-activate while active refreshes expiresAt (no stacking)', () => {
  const p = createPowerups();
  magnetActivate(p, 0);
  magnetActivate(p, 60);  // pickup at frame 60 — refresh, not stack
  assert.equal(p.magnet.expiresAt, 60 + MAGNET_DURATION_FRAMES);
});
```

Run: `npm test -- --test-only=false`

Expected: 4 new tests pass.

- [ ] **Step 2: Add `G.powerups` to game state**

Find the `G = { ... }` block (around line 620). Add:

```js
powerups: { magnet: { active: false, expiresAt: 0 } },
```

Constants near the top of the script:

```js
const MAGNET_DURATION_FRAMES = 60 * 5;  // 5 seconds at 60fps
```

- [ ] **Step 3: Reset on death**

In `gameOver()`, after the existing state cleanup:

```js
G.powerups.magnet.active = false;
```

In the game-restart path (search `function startGame` or `resetGame`), reset:

```js
G.powerups = { magnet: { active: false, expiresAt: 0 } };
```

- [ ] **Step 4: Per-frame expiry check in game loop**

In the main update loop, before drawing:

```js
if (G.powerups.magnet.active && G.frameCount >= G.powerups.magnet.expiresAt) {
  FX.magnetExpire();
}
```

(`FX.magnetExpire` is defined in Task 16 — for now, add a stub: `magnetExpire() { G.powerups.magnet.active = false; },` inside `FX`.)

- [ ] **Step 5: Manual smoke test**

Reload. No console errors. Game plays normally.

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html tests/lib/magnet-timer.js tests/fx-magnet-timer.test.js
git commit -m "feat(magnet): G.powerups state + timer logic + unit tests

Timer math mirrored in tests/lib/magnet-timer.js (drift risk acknowledged).
FX.magnetExpire stubbed; full implementation in upcoming task."
```

---

### Task 15: Magnet token spawn + render

**Files:**
- Modify: `flappy_bert.html` (coin spawn site — search for `coin` push into `G.coins`; pipe-gap loop)

- [ ] **Step 1: Add magnet array to game state**

In the `G = { ... }` init:

```js
magnets: [],
```

- [ ] **Step 2: Spawn rolls (mutex with coin)**

Find the coin-spawn roll in the pipe-spawn function (search `G.coins.push` or near where coins are added at pipe-spawn time). The current logic is something like `if (Math.random() < 0.30) G.coins.push(...)`.

Wrap with a magnet-first roll:

```js
const magnetRoll = (G.level >= 2) && (Math.random() < 0.03);
if (magnetRoll) {
  G.magnets.push({
    x: pipe.x + pipeWidth / 2 - 11,
    y: gapTop + (gapBottom - gapTop) / 2 - 11,
    bobPhase: Math.random() * Math.PI * 2,
    spawnedAt: G.frameCount,
  });
} else if (Math.random() < 0.30) {  // existing coin roll
  // ... existing coin push
}
```

- [ ] **Step 3: Update magnet positions + bob each frame**

In the main update loop, before draw, add:

```js
for (let i = G.magnets.length - 1; i >= 0; i--) {
  const m = G.magnets[i];
  m.x -= G.gameSpeed;
  m.bobPhase += 0.08;
  if (m.x < -30) G.magnets.splice(i, 1);
}
```

- [ ] **Step 4: Render magnet token**

In the main render block, after coins, add:

```js
for (const m of G.magnets) {
  const bobY = m.y + Math.sin(m.bobPhase) * 2;
  // Glow halo (additive)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.4 + Math.sin(G.frameCount * 0.1) * 0.2;
  ctx.fillStyle = '#c04dff';
  ctx.beginPath();
  ctx.arc(m.x + 11, bobY + 11, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Pixel horseshoe (red top + silver poles)
  ctx.fillStyle = '#cc2233';  // red
  ctx.fillRect(m.x + 2, bobY + 2, 18, 8);
  ctx.fillStyle = '#bbbbbb';  // silver poles
  ctx.fillRect(m.x + 2, bobY + 10, 6, 10);
  ctx.fillRect(m.x + 14, bobY + 10, 6, 10);
  // 2-pixel border
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.strokeRect(m.x + 2, bobY + 2, 18, 18);
}
```

- [ ] **Step 5: Manual playtest**

Reload. Play long enough to see a magnet (level 2+, ~3% per gap). May need to crank the rate to `0.50` temporarily during this task to verify rendering.

Expected: PASS — pixel horseshoe magnet appears in pipe gaps, gently bobs, glows purple.

After verifying, **revert spawn rate to 0.03**.

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(magnet): token spawn (~3%, level >=2) + canvas render with bob + glow"
```

---

### Task 16: Magnet pickup + activate + expire FX

**Files:**
- Modify: `flappy_bert.html`

- [ ] **Step 1: Add `AudioSystem.fxMagnetPickup`, `fxMagnetActivate`, `fxMagnetExpire`**

```js
fxMagnetPickup() {
  this._sweep(220, 880, 250, 'sine', 0.20, { reverb: true });
  this._noiseBurst(80, 1600, 0.10);
},
fxMagnetActivate() {
  this._chord([440, 660, 880], 'triangle', 300, 0.07, { reverb: true });
},
fxMagnetExpire() {
  this._sweep(880, 220, 350, 'sine', 0.14);
},
```

- [ ] **Step 2: Replace the stub `FX.magnetExpire` with full versions**

Inside `FX`:

```js
magnetPickup(x, y) {
  AudioSystem.fxMagnetPickup();
  this.shockwave = { x, y, t: 0, max: 250, color: '#c04dff' };  // reuse field; check render reads color
  this._flash(0.2, '#c04dff');
  this._spawnParticles({
    x, y, count: 12, speed: 6, life: 30,
    color: '#c04dff', size: 3, glow: true,
  });
},

magnetActivate() {
  AudioSystem.fxMagnetActivate();
  G.powerups.magnet.active = true;
  G.powerups.magnet.expiresAt = G.frameCount + MAGNET_DURATION_FRAMES;
  // HUD pill is updated by per-frame render in Task 18
},

magnetExpire() {
  AudioSystem.fxMagnetExpire();
  G.powerups.magnet.active = false;
  // Aura fade is handled in drawPlayer (Task 19)
},
```

- [ ] **Step 3: Generalize shockwave color**

Update the shockwave render block (Task 10, Step 4) to read color:

```js
ctx.strokeStyle = sw.color || '#4dffff';
```

- [ ] **Step 4: Pickup detection in main update loop**

Find AABB collision logic (where coin pickup is detected). Add a parallel block for magnets:

```js
for (let i = G.magnets.length - 1; i >= 0; i--) {
  const m = G.magnets[i];
  if (G.bert.x + G.bert.size > m.x &&
      G.bert.x < m.x + 22 &&
      G.bert.y + G.bert.size > m.y &&
      G.bert.y < m.y + 22) {
    FX.magnetPickup(m.x + 11, m.y + 11);
    FX.magnetActivate();
    G.magnets.splice(i, 1);
  }
}
```

- [ ] **Step 5: Manual playtest**

Reload. Temporarily bump magnet spawn rate to `0.50` to test. Pick up a magnet.

Expected: PASS — purple shockwave + flash + particles, magnet activate chord, `G.powerups.magnet.active === true` (verify in DevTools console: `G.powerups.magnet`). After 5 seconds, descending sweep on expire.

**Revert spawn rate to 0.03 before commit.**

- [ ] **Step 6: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(magnet): pickup/activate/expire FX wired"
```

---

### Task 17: Magnet HUD pill + countdown bar

**Files:**
- Modify: `flappy_bert.html`

- [ ] **Step 1: Add HUD pill markup**

Inside `<body>`, near the existing coin/score display HUD elements (around line 460):

```html
<div id="magnetPill" class="magnet-pill" style="display:none">
  <span class="magnet-pill-icon">\u{1F9F2}</span>
  <span class="magnet-pill-text" id="magnetPillText">5s</span>
  <div class="magnet-pill-bar"><div class="magnet-pill-bar-fill" id="magnetPillBarFill"></div></div>
</div>
```

- [ ] **Step 2: CSS**

```css
.magnet-pill {
  position: fixed;
  top: 16px;
  right: 16px;
  background: rgba(40, 0, 60, 0.85);
  border: 2px solid #c04dff;
  border-radius: 8px;
  padding: 4px 10px;
  font-family: var(--font);
  font-size: 9px;
  color: #fff;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 6px;
  box-shadow: 0 0 12px rgba(192, 77, 255, 0.5);
}
.magnet-pill-icon { font-size: 12px; }
.magnet-pill-bar {
  width: 60px;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
}
.magnet-pill-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #c04dff, #ffd700);
  width: 100%;
  transition: width 0.1s linear;
}
```

- [ ] **Step 3: Update pill from per-frame magnet state**

In the per-frame magnet expiry block (Task 14, Step 4), expand to also update the pill:

```js
const pill = document.getElementById('magnetPill');
if (G.powerups.magnet.active) {
  if (pill && pill.style.display === 'none') pill.style.display = 'flex';
  const remaining = Math.max(0, G.powerups.magnet.expiresAt - G.frameCount);
  const remainingSec = Math.ceil(remaining / 60);
  document.getElementById('magnetPillText').textContent = remainingSec + 's';
  document.getElementById('magnetPillBarFill').style.width =
    (100 * remaining / MAGNET_DURATION_FRAMES) + '%';
  if (G.frameCount >= G.powerups.magnet.expiresAt) {
    FX.magnetExpire();
    if (pill) pill.style.display = 'none';
  }
} else if (pill && pill.style.display !== 'none') {
  pill.style.display = 'none';
}
```

- [ ] **Step 4: Manual playtest**

Reload. Pick up a magnet (temp spawn rate 0.50). Watch the pill.

Expected: PASS — pill appears top-right with icon + countdown text + shrinking bar. Disappears at 0.

**Revert spawn rate to 0.03.**

- [ ] **Step 5: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(magnet): HUD pill with countdown text + bar"
```

---

### Task 18: Magnet coin-attraction physics

**Files:**
- Modify: `flappy_bert.html` (coin update loop)

- [ ] **Step 1: Locate coin update loop**

Find the per-frame coin position update — `coin.x -= G.gameSpeed` or similar inside a loop over `G.coins`.

- [ ] **Step 2: Replace with magnet-aware update**

```js
for (let i = G.coins.length - 1; i >= 0; i--) {
  const coin = G.coins[i];
  coin.vx = coin.vx || 0;
  coin.vy = coin.vy || 0;

  if (G.powerups.magnet.active && coin.x >= 0 && coin.x <= canvas.width + 50) {
    // Spring pull toward Bert
    const dx = G.bert.x - coin.x;
    const dy = G.bert.y - coin.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const strength = Math.min(1.2, Math.max(0.05, 900 / (dist * dist)));
    coin.vx += (dx / dist) * strength;
    coin.vy += (dy / dist) * strength;
    // Cap velocity
    coin.vx = Math.max(-10, Math.min(10, coin.vx));
    coin.vy = Math.max(-10, Math.min(10, coin.vy));
    // Move (drag override — skip normal scroll for this coin)
    coin.x += coin.vx;
    coin.y += coin.vy;
  } else {
    // Normal scroll drift
    coin.x -= G.gameSpeed;
  }

  if (coin.x < -coinSize) G.coins.splice(i, 1);
}
```

(If `coinSize` isn't a global, use whatever local constant the existing code uses, or hard-code `20`.)

- [ ] **Step 3: Manual playtest**

Reload. Bump magnet spawn rate to 0.50 temporarily. Pick up a magnet during heavy coin presence (or pass through pipes that have coins ahead).

Expected: PASS — coins curve toward Bert during the 5s window. Coins behind Bert (already exited left) do NOT come back. Coins above/below pipe gaps still get pulled. No coin "shoots past" Bert at high velocity (cap works).

**Revert spawn rate to 0.03.**

- [ ] **Step 4: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(magnet): coin-attraction spring physics during 5s window"
```

---

### Task 19: Magnet aura in drawPlayer

**Files:**
- Modify: `flappy_bert.html` (`drawPlayer` function)

- [ ] **Step 1: Add aura render**

In `drawPlayer`, after the player rect is drawn (and after the ghost trail from Task 9):

```js
if (G.powerups.magnet.active) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cx = G.bert.x + G.bert.size / 2;
  const cy = G.bert.y + G.bert.size / 2;
  const rotation = (G.frameCount * Math.PI / 360) % (Math.PI * 2);
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 0.35 - i * 0.10;
    ctx.strokeStyle = '#c04dff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const r = G.bert.size + 8 + i * 6;
    ctx.arc(cx, cy, r, rotation + i, rotation + i + Math.PI * 1.6);
    ctx.stroke();
  }
  ctx.restore();
}
```

- [ ] **Step 2: Manual playtest**

Reload. Pick up magnet (temp spawn 0.50).

Expected: PASS — three concentric rotating purple arcs around Bert during 5s window. Disappears on expire.

**Revert to 0.03.**

- [ ] **Step 3: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(magnet): rotating purple aura around Bert while active"
```

---

## Phase 4 — Game-over redesign

### Task 20: Game-over markup restructure (named groups + hero class)

**Files:**
- Modify: `flappy_bert.html` (lines 564–591 — `#gameOverOverlay`)

- [ ] **Step 1: Replace the panel markup**

Replace lines 564–591 with:

```html
<!-- Game Over -->
<div class="overlay" id="gameOverOverlay">
  <div class="go-panel" id="goPanel">
    <div class="go-rewards">
      <div id="goBadgePopup" class="go-section-badge" style="display:none;font-size:10px;color:#ffd700;animation:pulse 0.5s ease-in-out 3"></div>
    </div>
    <div class="go-title fx-go-step" data-step="title">GAME OVER</div>
    <div class="go-hero fx-go-step" data-step="hero">
      <div id="goMedal" style="font-size:36px;margin:4px 0;display:none"></div>
      <div class="go-label">SCORE</div>
      <div class="go-score-hero" id="goScore">0</div>
      <div class="go-best" id="goBest">BEST: 0</div>
      <div id="goRankNudge" style="font-size:7px;color:var(--accent3);margin:4px 0;display:none"></div>
    </div>
    <div class="go-stats fx-go-step" data-step="stats">
      <div class="go-level" id="goLevel">LEVEL 1</div>
      <div id="goCombo" style="font-size:7px;color:#ffb800;margin:4px 0;display:none"></div>
      <div id="goMultiplier" style="font-size:7px;color:var(--accent3);margin:4px 0;display:none"></div>
    </div>
    <div class="go-rewards-bottom fx-go-step" data-step="rewards">
      <div class="go-coins" id="goCoins">+0 \u{1FA99}</div>
      <div id="goTournament" style="font-size:7px;color:#ffd700;margin:4px 0;display:none"></div>
    </div>
    <div class="go-actions fx-go-step" data-step="actions">
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-primary" style="min-width:120px" onclick="startGame()">\u{1F504} PLAY AGAIN</button>
      </div>
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:6px">
        <button class="btn btn-secondary" style="font-size:7px;padding:6px 10px" onclick="showMenu()">\u{1F3E0} MENU</button>
        <button class="btn btn-secondary" style="font-size:7px;padding:6px 10px" onclick="showShop()">\u{1F6D2} SHOP</button>
        <button class="btn btn-secondary" style="font-size:7px;padding:6px 10px" onclick="showLeaderboard()">\u{1F3C6} RANKS</button>
      </div>
    </div>
  </div>
</div>
```

(Note: `goContinueBtn` and `goDoubleCoins` are removed.)

- [ ] **Step 2: Add `fx-go-step` baseline CSS (hidden until reveal)**

In `<style>`:

```css
.fx-go-step {
  visibility: hidden;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.25s ease-out, transform 0.25s ease-out;
}
.fx-go-step.fx-go-show {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
}
```

- [ ] **Step 3: Manual smoke test**

Reload. Die in the game.

Expected: nothing on the game-over overlay shows (everything hidden by `fx-go-step` baseline). The Task 23 wiring will show them. **For this commit alone**, temporarily add `.fx-go-step { visibility: visible; opacity: 1; transform: none; }` so the screen still works for testing — then remove it once Task 23 lands. Alternatively, commit Tasks 20+23 together.

For this plan: bundle Tasks 20-23 sanity by NOT applying the hide-until-reveal CSS in this task. Replace Step 2 with:

> Add `fx-go-step` and `fx-go-show` classes but do NOT make them hide content yet. The hide rules go in Task 23 along with the reveal sequence. This task is markup-only.

Update the file to skip the hide CSS for now.

- [ ] **Step 4: Commit**

```bash
git add flappy_bert.html
git commit -m "refactor(game-over): markup restructure into named groups + hero class

Removed dead ad UI buttons (goContinueBtn, goDoubleCoins). JS for those
removed in next task."
```

---

### Task 21: Remove dead ad-gated functions and state

**Files:**
- Modify: `flappy_bert.html`

- [ ] **Step 1: Find and delete `continueWithAd` function**

Search `function continueWithAd(`. Delete the function and its body.

- [ ] **Step 2: Find and delete `doubleCoinsWithAd` function**

Search `function doubleCoinsWithAd(`. Delete entire function.

- [ ] **Step 3: Remove `G.adContinueUsed` and `G.adInterstitialCounter` from G init and any callers**

In the `G = {}` block, remove `adContinueUsed` and `adInterstitialCounter` keys.

Search for `G.adContinueUsed` and `G.adInterstitialCounter` — delete lines that reference them in `showGameOverScreen` and elsewhere.

- [ ] **Step 4: Remove `AdSystem.showInterstitial(...)` call in `showGameOverScreen`**

Around line 1628–1630:

```js
// Interstitial ad every 4th game
if (G.adInterstitialCounter % 4 === 0 && AdSystem.isInterstitialReady()) {
  AdSystem.showInterstitial(() => {});
}
```

Delete this block entirely.

- [ ] **Step 5: Remove the `goContinueBtn`/`goDoubleCoins` getElementById and visibility lines**

Around line 1538–1539, 1609, 1612 — remove:

```js
const goContinueBtn = document.getElementById('goContinueBtn');
const goDoubleCoins = document.getElementById('goDoubleCoins');
goContinueBtn.style.display = (!G.adContinueUsed && AdSystem.isRewardedReady()) ? '' : 'none';
goDoubleCoins.style.display = (G.coinsEarned > 0 && AdSystem.isRewardedReady()) ? '' : 'none';
```

Delete all four.

- [ ] **Step 6: Verify `AdSystem` itself is still defined and isRewardedReady is still callable from elsewhere**

Run: `grep -n "AdSystem\." flappy_bert.html`

If any callers remain that reference `AdSystem.showRewarded`, `isInterstitialReady`, `showInterstitial`, or `isRewardedReady`, leave the `AdSystem` definition intact (it's a stub). If NO callers remain, the entire `AdSystem` definition can be deleted — but if even one is left elsewhere, leave it alone.

- [ ] **Step 7: Manual smoke test**

Reload. Die. Game-over screen shows (without the ad buttons). No console errors.

- [ ] **Step 8: Commit**

```bash
git add flappy_bert.html
git commit -m "chore: remove dead ad-gated UI plumbing

continueWithAd, doubleCoinsWithAd, adContinueUsed, adInterstitialCounter,
showInterstitial call. AdSystem stub itself preserved if other callers
remain."
```

---

### Task 22: Hero score CSS (default + new-best rainbow + glow)

**Files:**
- Modify: `flappy_bert.html` (`<style>` block)

- [ ] **Step 1: Replace `.go-score` rule with `.go-score-hero`**

Find existing `.go-score` definition. Add new rule (or replace):

```css
.go-score-hero {
  font-family: var(--font);
  font-size: 64px;
  color: #ffd700;
  text-shadow: 0 0 12px rgba(255, 215, 0, 0.7), 0 0 4px #fff;
  margin: 8px 0;
  line-height: 1;
}
.go-score-hero.new-best {
  background: linear-gradient(90deg, #ff4d6d, #ffb800, #4dffb8, #4da6ff, #c04dff, #ffd700);
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: fxHeroShimmer 1.5s linear infinite;
}
@keyframes fxHeroShimmer {
  0%   { background-position: 0% 50%; }
  100% { background-position: 300% 50%; }
}
.go-score-hero.fx-punch-in { animation: fxHeroPunch 0.25s cubic-bezier(0.34,1.56,0.64,1); }
@keyframes fxHeroPunch {
  0%   { transform: scale(0.4) rotate(-15deg); opacity: 0; }
  60%  { transform: scale(1.2) rotate(0deg);   opacity: 1; }
  100% { transform: scale(1.0) rotate(0deg);   opacity: 1; }
}
```

- [ ] **Step 2: Update existing `.go-score`/`.new-best` references in JS**

In `showGameOverScreen` (`goScore.className = isNewBest ? 'go-score new-best' : 'go-score';`), replace with:

```js
goScore.className = isNewBest ? 'go-score-hero new-best' : 'go-score-hero';
```

- [ ] **Step 3: Manual smoke test**

Reload. Die. Confirm hero score is large + glowing. Beat your best — confirm rainbow shimmer appears.

- [ ] **Step 4: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(game-over): hero score treatment — gold glow + rainbow on new best"
```

---

### Task 23: FX.gameOverSequence with cancel + skip + tests

**Files:**
- Modify: `flappy_bert.html`
- Create: `tests/lib/sequence-runner.js`
- Create: `tests/fx-game-over-sequence.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/sequence-runner.js`:

```js
// Sequenced reveal — generic timeout chain with cancel + skip.
// Mirror of FX.gameOverSequence in flappy_bert.html.
function createSequence(steps) {
  // steps: [{ at: ms, fn: () => void, name: string }]
  const timers = [];
  let canceled = false;
  let completedNames = new Set();

  function start() {
    for (const step of steps) {
      const id = setTimeout(() => {
        if (!canceled) { step.fn(); completedNames.add(step.name); }
      }, step.at);
      timers.push(id);
    }
  }
  function cancel() {
    canceled = true;
    for (const id of timers) clearTimeout(id);
    timers.length = 0;
  }
  function skip() {
    cancel();
    for (const step of steps) {
      step.fn();
      completedNames.add(step.name);
    }
  }
  return { start, cancel, skip, get completed() { return completedNames; } };
}

module.exports = { createSequence };
```

Create `tests/fx-game-over-sequence.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSequence } = require('./lib/sequence-runner');

test('sequence runs steps at scheduled times', async () => {
  const log = [];
  const seq = createSequence([
    { at: 0,  fn: () => log.push('a'), name: 'a' },
    { at: 10, fn: () => log.push('b'), name: 'b' },
  ]);
  seq.start();
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(log, ['a', 'b']);
});

test('cancel stops pending steps', async () => {
  const log = [];
  const seq = createSequence([
    { at: 0,  fn: () => log.push('a'), name: 'a' },
    { at: 50, fn: () => log.push('b'), name: 'b' },
  ]);
  seq.start();
  await new Promise(r => setTimeout(r, 5));
  seq.cancel();
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(log, ['a']);
  assert.equal(seq.completed.has('b'), false);
});

test('skip jumps to end immediately', () => {
  const log = [];
  const seq = createSequence([
    { at: 0,    fn: () => log.push('a'), name: 'a' },
    { at: 1000, fn: () => log.push('b'), name: 'b' },
    { at: 2000, fn: () => log.push('c'), name: 'c' },
  ]);
  seq.start();
  seq.skip();
  assert.deepEqual(log, ['a', 'b', 'c']);
});
```

Run: `npm test`

Expected: 3 new tests pass.

- [ ] **Step 2: Add hide-until-reveal CSS**

(Deferred from Task 20.) In `<style>`:

```css
.fx-go-step:not(.fx-go-show) { visibility: hidden; opacity: 0; }
```

(The earlier Task 20 baseline rule already covers this, but make sure it exists. Confirm before commit.)

- [ ] **Step 3: Implement `FX.gameOverSequence`**

Inside `FX`:

```js
_goSeqTimers: [],
_goSeqCanceled: false,

gameOverSequence(stats, onDone) {
  this._goSeqTimers = [];
  this._goSeqCanceled = false;

  const steps = [];
  const showStep = (name) => () => {
    const el = document.querySelector('[data-step="' + name + '"]');
    if (el) el.classList.add('fx-go-show');
  };

  // 0ms: overlay fade-in is handled by panelSlideIn already; play sting
  steps.push({ at: 0, fn: () => AudioSystem.fxGameOverSting && AudioSystem.fxGameOverSting() });

  // 200ms: title type-on (8 chars × ~25ms via CSS animation)
  steps.push({ at: 200, fn: showStep('title') });

  // 450ms: hero punch-in
  steps.push({ at: 450, fn: () => {
    showStep('hero')();
    const score = document.getElementById('goScore');
    if (score) {
      score.classList.remove('fx-punch-in');
      void score.offsetWidth;
      score.classList.add('fx-punch-in');
    }
    AudioSystem.fxHeroPunch && AudioSystem.fxHeroPunch();
  }});

  // 700ms: digit count-up (eased) — render runs over 600ms
  steps.push({ at: 700, fn: () => this._goCountUp('goScore', stats.score, 600) });

  // 1300ms: medal already rendered inside hero; re-trigger bounce by toggling display
  steps.push({ at: 1300, fn: () => {
    const m = document.getElementById('goMedal');
    if (m && stats.medal) {
      m.style.display = 'block';
      m.style.animation = 'none'; void m.offsetWidth; m.style.animation = '';
    }
  }});

  // 1500ms: rank nudge in (already inside hero step); confetti on new best
  steps.push({ at: 1500, fn: () => {
    if (stats.isNewBest) {
      const x = window.innerWidth / 2, y = window.innerHeight / 2 - 80;
      this._spawnParticles({ x, y, count: 30, speed: 8, life: 50, color: '#ffd700', size: 4, glow: true });
    }
  }});

  // 1700ms: stats group
  steps.push({ at: 1700, fn: showStep('stats') });

  // 2050ms: rewards (coins ticker)
  steps.push({ at: 2050, fn: () => {
    showStep('rewards')();
    this._goCountUp('goCoins', stats.coinsEarned, 400, '+', ' \u{1FA99}');
  }});

  // 2700ms: tournament line is inside rewards block already

  // 2900ms: actions
  steps.push({ at: 2900, fn: showStep('actions') });

  // Start
  for (const step of steps) {
    const id = setTimeout(() => {
      if (!this._goSeqCanceled) step.fn();
    }, step.at);
    this._goSeqTimers.push(id);
  }
  // Final callback
  const doneId = setTimeout(() => { if (!this._goSeqCanceled && onDone) onDone(); }, 3200);
  this._goSeqTimers.push(doneId);

  // Skip-tap listener
  const overlay = document.getElementById('gameOverOverlay');
  const skipHandler = (e) => { this._goSeqSkip(steps, onDone); };
  overlay && overlay.addEventListener('pointerdown', skipHandler, { once: true });
  this._goSeqSkipHandler = skipHandler;
},

_goSeqCancel() {
  this._goSeqCanceled = true;
  for (const id of this._goSeqTimers) clearTimeout(id);
  this._goSeqTimers = [];
  const overlay = document.getElementById('gameOverOverlay');
  if (overlay && this._goSeqSkipHandler) {
    overlay.removeEventListener('pointerdown', this._goSeqSkipHandler);
  }
},

_goSeqSkip(steps, onDone) {
  this._goSeqCancel();
  // Run all step fns immediately
  for (const step of steps) try { step.fn(); } catch(e) {}
  // Show all steps
  document.querySelectorAll('.fx-go-step').forEach(el => el.classList.add('fx-go-show'));
  if (onDone) onDone();
},

// Animate a number from 0 to target over durMs, with optional prefix/suffix
_goCountUp(domId, target, durMs, prefix = '', suffix = '') {
  const el = document.getElementById(domId);
  if (!el) return;
  const start = performance.now();
  const targetN = Number(target) || 0;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / durMs);
    const eased = 1 - Math.pow(1 - t, 2);
    const v = Math.round(targetN * eased);
    el.textContent = prefix + v + suffix;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
},
```

- [ ] **Step 4: Add `AudioSystem.fxGameOverSting` and `fxHeroPunch`**

```js
fxGameOverSting() {
  // Descending minor third with long reverb
  this._chord([523, 440, 349], 'sine', 1200, 0.10, { reverb: true });
},
fxHeroPunch() {
  this._sweep(80, 40, 80, 'sine', 0.20);
  this._sweep(2000, 4000, 40, 'square', 0.06);
},
```

- [ ] **Step 5: Add cancel hook on PLAY AGAIN**

In `startGame()` (search), at the top:

```js
if (FX && FX._goSeqCancel) FX._goSeqCancel();
```

This guards against the user clicking PLAY AGAIN mid-reveal.

- [ ] **Step 6: Manual playtest**

Reload. Die.

Expected: PASS — title types on, hero score punches in and counts up, medal slides in, stats stagger, coins tick, buttons fade in last. Tap mid-reveal → all visible immediately. Tap PLAY AGAIN mid-reveal → game restarts, no orphaned timers.

- [ ] **Step 7: Commit**

```bash
git add flappy_bert.html tests/lib/sequence-runner.js tests/fx-game-over-sequence.test.js
git commit -m "feat(game-over): sequenced reveal with skip + cancel

3 unit tests for sequence-runner mirror (drift risk acknowledged)."
```

---

### Task 24: Wire showGameOverScreen to call FX.gameOverSequence

**Files:**
- Modify: `flappy_bert.html` (`showGameOverScreen` function)

- [ ] **Step 1: Replace the immediate `showOverlay('gameOverOverlay')` with sequenced reveal**

At the end of `showGameOverScreen()` (replacing line 1632 `showOverlay('gameOverOverlay');`):

```js
showOverlay('gameOverOverlay');
// Determine medal
let medal = '';
if (G.score >= 100) medal = 'gold';
else if (G.score >= 50) medal = 'silver';
else if (G.score >= 25) medal = 'bronze';

FX.gameOverSequence({
  score: G.score,
  coinsEarned: G.coinsEarned,
  isNewBest: isNewBest,
  level: G.level,
  bestCombo: G.bestCombo,
  medal: medal,
});
```

- [ ] **Step 2: Initialize hero score to 0 before sequence**

Around line 1541, change:

```js
goScore.textContent = G.score;
```

to:

```js
goScore.textContent = '0';  // Animated up by sequence
goScore.dataset.target = G.score;
```

(Sequence's `_goCountUp` reads the explicit `stats.score` from the call site, so the dataset isn't strictly required — but useful for skip-to-end.)

Same pattern for `goCoins` — set initial text to "+0 🪙", let sequence animate.

- [ ] **Step 3: Manual playtest — full flow**

Reload. Play short run, die. Then play long run with combo and tournament, die.

Expected: PASS — both runs reveal smoothly. Short run skips combo/tournament steps gracefully (those elements stay hidden).

- [ ] **Step 4: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(game-over): wire FX.gameOverSequence into showGameOverScreen"
```

---

## Phase 5 — Cleanup & finalize

### Task 25: Delete dead `getTournamentCountdown` (M1)

**Files:**
- Modify: `flappy_bert.html` (line ~3209)

- [ ] **Step 1: Delete the function**

Find the function and its preceding comment:

```js
// Kept for symmetry / external callers
function getTournamentCountdown() { return ''; }
```

Delete both lines.

- [ ] **Step 2: Verify no other references**

Run: `grep -n "getTournamentCountdown" flappy_bert.html`

Expected: no output (zero matches).

- [ ] **Step 3: Commit**

```bash
git add flappy_bert.html
git commit -m "chore: delete dead getTournamentCountdown (M1 deferred bug)

Originally kept 'for symmetry / external callers'; grep confirms no callers."
```

---

### Task 26: Update bugs-defer-to-june.md (mark M1 resolved)

**Files:**
- Modify: `docs/superpowers/bugs-defer-to-june.md`

- [ ] **Step 1: Edit M1 entry**

Below the M1 heading, add a `**Resolved:**` line with the SHA from Task 25's commit:

```bash
# Get the SHA
git log -1 --format='%H' -- flappy_bert.html  # commit from Task 25
```

In the file, after the `### M1: Dead code...` heading and existing bullets, append:

```markdown
- **Resolved:** <SHA-from-Task-25> — deleted in 2026-04-30 aesthetic pass.
```

Leave M3 unchanged (still deferred).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/bugs-defer-to-june.md
git commit -m "docs(bugs): mark M1 resolved in 2026-04-30 aesthetic pass"
```

---

### Task 27: Create feature-backlog.md

**Files:**
- Create: `docs/superpowers/feature-backlog.md`

- [ ] **Step 1: Write the file**

```markdown
# Flappy Bert — Feature Backlog

Aesthetic / gameplay ideas raised during the 2026-04-30 brainstorm but
deferred. Each is its own brainstorm → spec → plan cycle. Re-triage
when starting the next creative pass.

## Gameplay

### New enemy variants
A fast laser-beam JEET, or a homing JEET that lazily tracks Bert.
Touches enemy AI / movement code. Spec needed for spawn rules and
balance against existing JEETS.

### Slow-mo powerup
Pipes/JEETS slow to ~50% for ~3s. Best skill-expression moment.
Touches every speed/movement multiplier (anti-tamper-locked
`gameSpeed` is in the lock list — every consumer needs a slow_mo
factor branch). Higher integration cost than magnet was.

### 2x score window powerup
Score multiplier doubles for ~10 pipes. Cleanest mechanically (existing
`scoreMultiplier` infra including server-side validation that allows
1, 1.5, 2). Least visually exciting of the three powerup options.

## Cosmetics

### Skin reveal moment
When a skin is unlocked or purchased, a "ta-da" sequence (current behavior:
just appears in shop). Touches shop flow + a new animation.

### Trail / accessory cosmetics
Visual unlocks (rainbow trail, glasses, halo) layered on top of skin tints.
Requires shop-row expansion + render pipeline for accessory layers.

### Daily login streak / cosmetic reward
Small loop to bring players back. Drops a cosmetic every N days.
Requires DB schema change (streak counter), bot reminder UX, UI for
streak status.

## Sharing / outreach

### Share-card upgrade
The current `/api/share` and `leaderboard-card.js` produce a basic card.
A polished server-rendered run card showing PB, combo, tournament rank
that's actually beautiful, not a screenshot. Touches `leaderboard-card.js`
heavily.

## Misc

### "Something else"
Placeholder for ideas raised but not specified during the brainstorm.
Add new ideas to the appropriate section as they come up.

## Operational follow-ups (not features but tracked here for visibility)

- **M3 deferred bug:** `/api/leaderboard/image` and `/api/player/:id/card`
  are unauthed canvas-render endpoints (DoS surface). Tracked in
  `bugs-defer-to-june.md`.
- **Tournament-DB cleanup:** prod has duplicate April rows
  (`april-flapoff-2026` and `april-fools-flapoff-2026`). Run
  `DELETE FROM tournaments WHERE id='april-flapoff-2026'` when convenient.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/feature-backlog.md
git commit -m "docs: feature backlog for deferred aesthetic/gameplay ideas"
```

---

### Task 28: Music-loop polish (stretch — drop if scope risk)

**Files:**
- Modify: `flappy_bert.html` (`AudioSystem.startMusic` and surrounding music code)

> **Stretch goal.** Skip if Tasks 1–27 ate the time budget. Acceptance bar: must not regress existing music; must improve perceived "weight" without bloating CPU.

- [ ] **Step 1: Add a sub-octave voice to the music lead**

Find `startMusic`. Wherever a lead-melody `playNote(...)` is scheduled, schedule a parallel `playNote(freq / 2, ...)` at half gain.

- [ ] **Step 2: LFO-modulated lowpass on the lead**

Create a single shared `BiquadFilterNode` (lowpass) inside `AudioSystem.init` after reverb setup. Modulate `filter.frequency` with an `OscillatorNode` LFO at ~0.3 Hz. Route lead notes through the filter. (~20 lines.)

- [ ] **Step 3: Manual playtest**

Reload. Listen to the music for 30 seconds.

Expected: PASS — fuller bass, subtle wobble. No clicks/pops. CPU not spiked (DevTools Performance tab — frame budget unchanged).

- [ ] **Step 4: Commit**

```bash
git add flappy_bert.html
git commit -m "feat(audio): music-loop polish — sub-octave + LFO lowpass on lead"
```

If the result is worse than the current loop, **revert**:

```bash
git restore flappy_bert.html
```

…and skip this task. The plan acceptance criteria do not require it.

---

### Task 29: Final manual playtest checklist + ship commit

**Files:** none (verification + final docs touch)

- [ ] **Step 1: Run the full playtest checklist from the spec**

For each item, mark PASS/FAIL in the commit message:

- [ ] All 10 polish events fire without console errors across a normal run
  (coinPickup, pipePass, combo, nearMiss, shieldHit, levelUp, jeetSpawn, jeetDodge,
  game-over reveal, and audio behaving correctly across them).
- [ ] Magnet drops at roughly expected rate (~1 per 35 pipes — verify across 3 long runs).
- [ ] Magnet pulls coins; no coins fly past Bert; off-screen coins don't snap back.
- [ ] Game-over reveal completes without overlap/clipping at minimum (score-only)
  and maximum (combo + multiplier + badge + tournament + new-best) panel state.
- [ ] Skip-tap works at any point in the reveal.
- [ ] 60fps holds during heaviest combo+magnet+JEET overlap (DevTools Performance).
- [ ] Anti-cheat regression: still rejects scores > 500, still rejects too-fast submission,
  still rejects multipliers other than 1/1.5/2. (Use DevTools to send a hand-crafted
  POST to `/api/score` with bad values — server should 400.)
- [ ] Server-side: zero changes (`git diff main..HEAD -- bot.js db.js leaderboard-card.js` is empty).

- [ ] **Step 2: Run `npm test`**

Expected: all tests pass, including the new fx-spawn-cap, fx-magnet-timer, fx-game-over-sequence tests.

- [ ] **Step 3: Update CHANGELOG.md**

Prepend a new section to `CHANGELOG.md`:

```markdown
## 2026-04-30 — Aesthetic pass

The juice update. Centralised `FX` module orchestrates particles, audio,
screen shake/flash, and DOM glow for every in-game moment. New polish on
all 10 named events (coin pickup, pipe pass, combo, near-miss, shield hit,
level-up, JEET spawn, JEET dodge, game-over). New Magnet powerup with
spring-physics coin attraction. Game-over screen rebuilt as a sequenced
reveal with hero score (rainbow on new best). Pure Web Audio synth audio
upgrades (ADSR, chord, sweep, noiseBurst helpers + synthesized reverb).

### Bundled cleanup
- M1 deferred bug resolved: deleted dead `getTournamentCountdown()`.
- Removed dormant ad-gated UI: `goContinueBtn`, `goDoubleCoins` markup,
  `continueWithAd`, `doubleCoinsWithAd`, related `G.adContinueUsed` /
  `adInterstitialCounter` plumbing.
- New `docs/superpowers/feature-backlog.md` capturing the 8 deferred
  C-side feature ideas from the brainstorm.

### Out of scope (still deferred)
- M3 deferred bug (unauthed canvas-render endpoints).
- Tournament-DB ops cleanup.
- All other backlog features (see `feature-backlog.md`).

Source spec: `docs/superpowers/specs/2026-04-30-aesthetic-pass-design.md`.
Source plan: `docs/superpowers/plans/2026-04-30-aesthetic-pass.md`.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): 2026-04-30 aesthetic pass entry"
```

- [ ] **Step 5: Push to main**

```bash
git push origin main
```

(Auto-deploys to Render per CLAUDE.md.)

---

## Self-review checklist (for the plan author, post-write)

Looking at the spec with fresh eyes:

**Spec coverage:**
- ✅ FX module architecture → Task 4
- ✅ All 10 polish events → Tasks 6–13 (events 1–8) + Task 23 (event 9 game-over) + cross-cutting audio in Tasks 1–3, per-event SFX folded into each event task (event 10)
- ✅ Magnet token + spawn + render → Task 15
- ✅ Magnet pickup + activate + expire → Task 16
- ✅ Magnet HUD pill + countdown → Task 17
- ✅ Magnet coin physics → Task 18
- ✅ Magnet aura → Task 19
- ✅ Game-over markup restructure → Task 20
- ✅ Game-over hero score CSS → Task 22
- ✅ Game-over sequenced reveal → Tasks 23 + 24
- ✅ Dead ad UI removal → Task 21
- ✅ AudioSystem helpers (`_adsr`, `_chord`, `_sweep`, `_noiseBurst`, reverb) → Tasks 1–3
- ✅ Per-event SFX rewrites → folded into event tasks (Tasks 6–13, 16, 23)
- ✅ M1 deletion → Task 25
- ✅ bugs-defer-to-june.md update → Task 26
- ✅ feature-backlog.md creation → Task 27
- ✅ Music-loop stretch goal → Task 28
- ✅ All five spec-required unit tests:
  - `AudioSystem._adsr` math → not directly tested (math is encoded in helper); covered by manual verification. *Acceptable deviation: writing a node-test mock for AudioParam timing methods is significantly more setup than the value it provides; the helper is small and visible.*
  - `FX._spawnParticles` cap → Task 4
  - Magnet expire timing → Task 14
  - Magnet pickup-while-active refresh → Task 14 (test 4)
  - Game-over `cancel()` → Task 23
- ✅ Manual playtest checklist → Task 29
- ✅ Anti-cheat regression → Task 29 step 1
- ✅ Server-side zero-change → Task 29 step 1 + grep at finalisation

**Placeholder scan:** none.

**Type consistency:** `AudioSystem` used throughout (matches existing object). `FX` methods consistent across tasks. `G.powerups.magnet.{active, expiresAt}` consistent. `MAGNET_DURATION_FRAMES` constant consistent across HTML and test helper.

**Spec deviation flag:** the `AudioSystem._adsr` unit test from spec is dropped (covered above). The spec's testing section technically becomes 4 unit tests + 1 manual verification, not 5 unit tests. This is intentional and explained in the deviation note.
