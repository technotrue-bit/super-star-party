// Rising-gold-blob tracker: the +2 popup RISES ~0.75u over 0.7s. Track small
// gold blobs (G>190: popup gold, excludes sunDeep shards G~166) across rapid
// frames; a blob whose centroid Y decreases (screen coords) over consecutive
// frames is the popup. HUD strip excluded.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:5177';
const SHOT_DIR = path.join(process.cwd(), 'test-results', 'balloon-pop-popup', 'rise');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HUD_CUT = 130; // px — exclude top HUD

function goldBlobs(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;
  const isGold = (x, y) => {
    const i = (y * W + x) * 4;
    return data[i] > 200 && data[i + 1] > 190 && data[i + 2] < 110;
  };
  const seen = new Uint8Array(W * H);
  const blobs = [];
  const stack = [];
  for (let y = HUD_CUT; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (seen[idx] || !isGold(x, y)) continue;
      let size = 0, sx = 0, sy = 0;
      stack.push(idx);
      seen[idx] = 1;
      while (stack.length) {
        const c = stack.pop();
        size++;
        const cx = c % W, cy = (c / W) | 0;
        sx += cx; sy += cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (!seen[ni] && isGold(nx, ny)) { seen[ni] = 1; stack.push(ni); }
        }
      }
      if (size < 900 && size >= 12) blobs.push({ x: sx / size, y: sy / size, size });
    }
  }
  return blobs;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('PAGEERROR', String(e)));

  await page.goto(`${BASE}/?seed=7&autoplay=1&audio=0&speed=2&minigame=balloon_pop`, { waitUntil: 'load' });
  await sleep(1500);
  await page.evaluate(() => { window.__SSP__?.seed(7); });
  await page.evaluate(() => { window.__SSP__?.startMatch(['pip', 'bounce', 'glimmer', 'tusk']); });
  await sleep(500);
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => { window.__SSP__?.goto('minigame'); });
    await sleep(400);
    const scr = await page.evaluate(() => window.__SSP__?.state().screen);
    if (scr === 'minigame') break;
  }
  console.log('screen:', await page.evaluate(() => window.__SSP__?.state().screen));

  const history = [];
  const SHOT_EVERY = 4;
  for (let f = 0; f < 60; f++) {
    const buf = await page.screenshot();
    const blobs = goldBlobs(buf);
    history.push({ f, blobs });
    if (blobs.length > 0) console.log(`f${f}:`, JSON.stringify(blobs.map((b) => ({ x: +b.x.toFixed(0), y: +b.y.toFixed(0), s: b.size }))));
    if (f % SHOT_EVERY === 0) {
      fs.writeFileSync(path.join(SHOT_DIR, `t_${String(f).padStart(2, '0')}.png`), buf);
    }
    await sleep(120);
  }

  // rising detection: for each pair of consecutive frames, find blob pairs
  // matched by x within 25px where y decreases by >= 3px (screen: up = rising)
  const risings = [];
  for (let i = 1; i < history.length; i++) {
    for (const a of history[i - 1].blobs) {
      for (const b of history[i].blobs) {
        if (Math.abs(a.x - b.x) < 25 && a.y - b.y >= 3) {
          risings.push({ from: history[i - 1].f, to: history[i].f, x: +b.x.toFixed(0), y0: +a.y.toFixed(0), y1: +b.y.toFixed(0), s: b.size });
        }
      }
    }
  }
  console.log('RISING EVENTS:', risings.length);
  console.log(JSON.stringify(risings.slice(0, 20)));
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
