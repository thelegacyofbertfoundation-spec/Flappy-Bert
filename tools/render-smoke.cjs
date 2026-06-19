// render-smoke.cjs — composite the new sprites at game scale on the night-sky
// background using node-canvas (same drawImage API the game uses). Proves every
// asset is a valid drawable image and shows in-context cohesion.
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');

(async () => {
  const W = 480, H = 320, gndY = H - 50;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');

  // night sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0b0f28'); sky.addColorStop(1, '#1a1438');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  // a green pipe pair (mirrors drawPipe palette)
  const pipe = (x, gapTop, gapH) => {
    const g = ctx.createLinearGradient(x, 0, x + 60, 0);
    g.addColorStop(0, '#1a4a2a'); g.addColorStop(0.3, '#2a7a3a'); g.addColorStop(1, '#0a3a1a');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 60, gapTop);
    ctx.fillRect(x - 4, gapTop - 20, 68, 20);
    ctx.fillRect(x, gapTop + gapH, 60, gndY - gapTop - gapH);
    ctx.fillRect(x - 4, gapTop + gapH, 68, 20);
  };
  pipe(330, 90, 150);

  // ground
  ctx.fillStyle = '#2a1a0a'; ctx.fillRect(0, gndY, W, 50);
  ctx.fillStyle = '#5a8a3a'; ctx.fillRect(0, gndY, W, 2);

  const img = async (p) => { try { return await loadImage(p); } catch (e) { console.error('LOAD FAIL', p, e.message); return null; } };

  // Bert flap frame at game scale (draw box ~48x40 like the game)
  const flap = await img('assets/pixellab/bert-flap/frame_2.png');
  const status = {};
  if (flap) {
    const size = 44, halfS = size / 2;
    ctx.save(); ctx.translate(110, 150); ctx.rotate(-0.15);
    ctx.drawImage(flap, -halfS * 1.2, -halfS, size * 1.2, size);
    ctx.restore();
    status.bertFlap = `${flap.width}x${flap.height}`;
  } else status.bertFlap = 'FAIL';

  // tokens in the gap
  const drawAt = async (key, x, y, d) => {
    const im = await img(`assets/pixellab/${key}.png`);
    if (im) { ctx.drawImage(im, x - d / 2, y - d / 2, d, d); status[key] = `${im.width}x${im.height}`; }
    else status[key] = 'FAIL';
  };
  await drawAt('coin', 360, 130, 22);
  await drawAt('magnet', 360, 165, 26);
  await drawAt('frenzy', 360, 200, 26);
  await drawAt('shield', 250, 110, 26);

  // enemies (jeet scale2 size=28 -> 73px, hunter scale1 size=14 -> 36px)
  const jeet = await img('assets/pixellab/jeet.png');
  if (jeet) { const d = 28 * 2.6; ctx.drawImage(jeet, 200 - d / 2, 210 - d / 2, d, d); status.jeet = `${jeet.width}x${jeet.height}`; } else status.jeet = 'FAIL';
  const hunter = await img('assets/pixellab/hunter.png');
  if (hunter) { const d = 28 * 2.6; ctx.drawImage(hunter, 290 - d / 2, 250 - d / 2, d, d); status.hunter = `${hunter.width}x${hunter.height}`; } else status.hunter = 'FAIL';

  fs.writeFileSync('docs/verification/pixellab-flappy/INGAME-composite.png', cv.toBuffer('image/png'));
  console.log('asset load status:', JSON.stringify(status));
  const fails = Object.entries(status).filter(([, v]) => v === 'FAIL');
  console.log(fails.length ? `FAILURES: ${fails.map(f => f[0]).join(',')}` : 'ALL ASSETS LOADED + DREW OK');
})();
