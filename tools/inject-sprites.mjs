// inject-sprites.mjs — embed the PixelLab base64 sprites + Image setup into
// flappy_bert.html right after the existing bertSprite definition. Idempotent.
import { readFileSync, writeFileSync } from 'node:fs';

const b64 = (f) => 'data:image/png;base64,' + readFileSync(f).toString('base64');
const HTML = 'flappy_bert.html';
const MARK = '// ===== PixelLab aesthetic pass';

let html = readFileSync(HTML, 'utf8');
if (html.includes(MARK)) { console.log('already injected — skipping'); process.exit(0); }

const flap = [0, 1, 2, 3, 4].map((i) => b64(`assets/pixellab/bert-flap/frame_${i}.png`));
const spr = ['jeet', 'hunter', 'magnet', 'frenzy', 'shield', 'coin']
  .map((k) => `    ${k}: '${b64(`assets/pixellab/${k}.png`)}'`).join(',\n');

const block = `
${MARK} (2026-06-19) — animated Bert + enemy/powerup sprites; each renders behind its prior fallback =====
const BERT_FLAP_B64 = [
  '${flap.join("',\n  '")}'
];
const bertFlapFrames = BERT_FLAP_B64.map((s) => { const im = new Image(); im.src = s; return im; });
function bertFlapReady() { for (const im of bertFlapFrames) if (!(im.complete && im.naturalWidth > 0)) return false; return true; }
function bertFlapIndex() { return Math.floor((G.frameCount || 0) / 5) % bertFlapFrames.length; }
const PL_SPR = {};
{
  const _d = {
${spr}
  };
  for (const k in _d) { const im = new Image(); im.src = _d[k]; PL_SPR[k] = im; }
}
function plReady(k) { const im = PL_SPR[k]; return !!(im && im.complete && im.naturalWidth > 0); }
// ===== end PixelLab aesthetic pass =====
`;

const anchor = 'bertSprite.src = SPRITE_B64;';
if (!html.includes(anchor)) throw new Error('anchor not found: ' + anchor);
html = html.replace(anchor, anchor + '\n' + block);
writeFileSync(HTML, html);
console.log('injected sprite block:', flap.length, 'flap frames +', 6, 'sprites');
