#!/usr/bin/env node
// pl-gen.mjs — lean PixelLab.ai generator for Flappy-Bert.
//
// Reuses bert-mmo's PURE lib (body builders, png/zip helpers) but uses FLAPPY's
// OWN neon palette as color_image guidance and does NOT run the bert-mmo
// master-palette art-gate (that conforms to the MMO's palette — wrong here).
// Saves raw PNG(s) + a scaled contact sheet for the vision-judge loop.
//
// Key: PIXELLAB_API_KEY env, else /opt/bert-mmo/scripts/.pixellab.key.
//
// Usage:
//   node tools/pl-gen.mjs balance
//   node tools/pl-gen.mjs sprite "<description>" --name jeet --size 48 [--guidance 8] [--no-palette] [--out <dir>]
//   node tools/pl-gen.mjs animate "<description>" "<action>" --from assets/base-bert.png --frames 4 --name bert-flap [--out <dir>]
//
// Output dir defaults to docs/verification/pixellab-flappy/<name>/.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as PL from '/opt/bert-mmo/scripts/lib/pixellab.mjs';

const KEY = (process.env.PIXELLAB_API_KEY
  || readFileSync('/opt/bert-mmo/scripts/.pixellab.key', 'utf8')).trim();
const H = { Authorization: `Bearer ${KEY}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Flappy-Bert palette (CSS :root vars + Bert fur/hoodie + pipes + bg) ----
const FLAPPY_HEXES = [
  '#ff6b35', '#ffb800', '#00e5ff', '#ffd700', '#44d62c', '#ff3860', '#8844ff', '#ff88ff',
  '#b07040', '#a06830', '#4488bb', '#2a7a3a', '#1a4a2a', '#5a8a3a',
  '#0b0f28', '#0e1230', '#181c2e', '#e8e8f0', '#222222',
];
const PAL_B64 = PL.paletteColorImage(
  { ramps: { flappy: FLAPPY_HEXES }, meta: { swatchesPerRamp: 10 } }, 8,
).toString('base64');

async function post(path, body) {
  const r = await fetch(PL.BASE + path, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}
// GETs are idempotent -> retry through PixelLab's flaky 5xx. POST is never retried
// (a create that already succeeded would double-charge a generation).
async function get(path, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(PL.BASE + path, { headers: H });
    if (r.ok) return r.json();
    last = `${r.status}: ${(await r.text()).slice(0, 160)}`;
    if (r.status < 500) break;
    await sleep(1500 * (i + 1));
  }
  throw new Error(`GET ${path} -> ${last}`);
}
async function waitJob(id, label = 'job', maxMs = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(3000);
    const st = await get(PL.ENDPOINTS.job(id));
    if (st.status !== 'processing') {
      console.log(`  ${label}: ${st.status} (${Math.round((Date.now() - t0) / 1000)}s)`);
      return st;
    }
  }
  throw new Error(`${label}: job ${id} timed out`);
}

function flags(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-palette') opt.noPalette = true;
    else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  return { pos, opt };
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const outDir = (opt, name) =>
  resolve(opt.out || join('docs/verification/pixellab-flappy', slug(name)));

function writeSheet(dir, rawBufs) {
  const imgs = rawBufs.map((b) => PL.decodePng(b));
  const maxDim = Math.max(...imgs.map((i) => Math.max(i.width, i.height)));
  const scale = Math.max(1, Math.round(96 / maxDim));
  writeFileSync(join(dir, 'sheet.png'), PL.contactSheet(imgs, { cols: imgs.length, scale }));
  console.log(`  -> sheet.png (${imgs.length} img, ${scale}x)`);
}

async function cmdBalance() {
  const b = await get(PL.ENDPOINTS.balance);
  console.log('subscription:', JSON.stringify(b.subscription), '| usd:', b.credits.usd);
}

async function cmdSprite(pos, opt) {
  const description = pos[0];
  if (!description) throw new Error('sprite: need "<description>"');
  const size = +(opt.size || 48);
  const name = opt.name || slug(description);
  const dir = outDir(opt, name);
  mkdirSync(dir, { recursive: true });
  console.log(`sprite "${description}" @ ${size}px -> ${dir}`);
  const resp = await post(PL.ENDPOINTS.sprite, PL.bodyForSprite({
    description, size,
    guidance: opt.guidance ? +opt.guidance : 8,
    paletteB64: opt.noPalette ? undefined : PAL_B64,
  }));
  const raw = Buffer.from(resp.image.base64, 'base64');
  const file = join(dir, `${name}.png`);
  writeFileSync(file, raw);
  const d = PL.decodePng(raw);
  console.log(`  -> ${file}  ${d.width}x${d.height}`);
  writeSheet(dir, [raw]);
}

async function cmdAnimate(pos, opt) {
  const description = pos[0];
  const action = pos[1];
  if (!description || !action) throw new Error('animate: need "<description>" "<action>"');
  const name = opt.name || slug(`${description}-${action}`);
  const dir = outDir(opt, name);
  mkdirSync(dir, { recursive: true });
  console.log(`animate "${description}" / "${action}" -> ${dir}`);
  let firstPng;
  if (opt.from) firstPng = readFileSync(resolve(opt.from));
  else {
    const s = await post(PL.ENDPOINTS.sprite, PL.bodyForSprite({
      description, size: Math.max(64, +(opt.size || 64)), paletteB64: PAL_B64,
    }));
    firstPng = Buffer.from(s.image.base64, 'base64');
  }
  let fi = PL.decodePng(firstPng);
  if (fi.width < 64 || fi.height < 64) {
    const k = Math.ceil(64 / Math.min(fi.width, fi.height));
    fi = PL.scaleNearest(fi, k);
    firstPng = PL.encodePng(fi.width, fi.height, fi.rgba);
    console.log(`  upscaled first frame ${k}x -> ${fi.width}x${fi.height}`);
  }
  const resp = await post(PL.ENDPOINTS.animate, PL.bodyForAnimate({
    firstFrameB64: firstPng.toString('base64'), action, frames: +(opt.frames || 4),
  }));
  const job = await waitJob(resp.background_job_id, 'animate');
  const imgs = (job.last_response?.images || []).map((im) => Buffer.from(im.base64, 'base64'));
  if (!imgs.length) throw new Error('animate: job returned no frames');
  imgs.forEach((buf, i) => writeFileSync(join(dir, `frame_${i}.png`), buf));
  const d0 = PL.decodePng(imgs[0]);
  console.log(`  -> ${imgs.length} frames  ${d0.width}x${d0.height}`);
  writeSheet(dir, imgs);
}

const { pos, opt } = flags(process.argv.slice(3));
const cmd = process.argv[2];
const run = { balance: () => cmdBalance(), sprite: () => cmdSprite(pos, opt), animate: () => cmdAnimate(pos, opt) }[cmd];
if (!run) { console.error('cmd: balance | sprite | animate'); process.exit(1); }
run().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
