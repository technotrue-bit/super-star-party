// Rapid-capture frames to catch the +2 gold popup; report top candidates.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:5177';
const SHOT_DIR = path.join(process.cwd(), 'test-results', 'balloon-pop-popup', 'rapid');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function goldBlobStats(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;
  const isGold = (x, y) => {
    const i = (y * W + x) * 4;
    return data[i] > 180 && data[i + 1] > 130 && data[i + 2] < 120;
  };
  const seen = new Uint8Array(W * H);
  let small = 0, smallPx = 0;
  const stack = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (seen[idx] || !isGold(x, y)) continue;
      let size = 0;
      stack.push(idx);
      seen[idx] = 1;
      while (stack.length) {
        const c = stack.pop();
        size++;
        const cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (!seen[ni] && isGold(nx, ny)) { seen[ni] = 1; stack.push(ni); }
        }
      }
      if (size < 800 && size >= 15) { small++; smallPx += size; }
    }
  }
  return { small, smallPx };
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

  // rapid capture: 250ms apart for ~12s
  const results = [];
  for (let f = 0; f < 48; f++) {
    const p = path.join(SHOT_DIR, `r_${String(f).padStart(2, '0')}.png`);
    const buf = await page.screenshot({ path: p });
    const stats = goldBlobStats(buf);
    results.push({ f, ...stats, path: p });
    if (stats.smallPx > 150) console.log(`frame ${f}: small=${stats.small} smallPx=${stats.smallPx}`);
    await sleep(250);
  }
  results.sort((a, b) => b.smallPx - a.smallPx);
  console.log('TOP5:', JSON.stringify(results.slice(0, 5)));
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
