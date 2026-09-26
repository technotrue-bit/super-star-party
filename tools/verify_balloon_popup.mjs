// Live verification for balloon_pop floating score popup.
// Drives headless Chromium against the running dev server (localhost:5177).
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:5177';
const SHOT_DIR = path.join(process.cwd(), 'test-results', 'balloon-pop-popup');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const log = (...a) => console.log('[verify]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- connected components on the gold mask -------------------------------
// Balloons are big gold blobs (800+ px); a "+2" popup glyph is small
// (tens of px). Count small gold blobs per frame as popup evidence.
function goldBlobStats(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;
  const isGold = (x, y) => {
    const i = (y * W + x) * 4;
    return data[i] > 180 && data[i + 1] > 130 && data[i + 2] < 120;
  };
  const seen = new Uint8Array(W * H);
  let small = 0, large = 0, smallPx = 0;
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
      if (size >= 800) large++;
      else if (size >= 15) { small++; smallPx += size; }
    }
  }
  return { small, large, smallPx };
}

async function readMatch(page) {
  return page.evaluate(() => {
    const S = window.__SSP__;
    if (!S) return null;
    const st = S.state();
    const players = (st.match?.players ?? []).map((p) => ({ coins: p.coins, wins: p.minigameWins }));
    return { screen: st.screen, players };
  });
}

async function runTwin(page, label) {
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
  log(label, 'screen:', await page.evaluate(() => window.__SSP__?.state().screen));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // ---- twin A: capture frames mid-play ----
  await runTwin(page, 'twinA');
  const frameResults = [];
  const bestFrames = [];
  for (let f = 0; f < 12; f++) {
    await sleep(800);
    const shotPath = path.join(SHOT_DIR, `frame_${String(f).padStart(2, '0')}.png`);
    const buf = await page.screenshot({ path: shotPath });
    const stats = goldBlobStats(buf);
    frameResults.push({ frame: f, ...stats });
    log(`frame ${f}: smallGoldBlobs=${stats.small} largeGoldBlobs=${stats.large} smallGoldPx=${stats.smallPx}`);
    if (stats.small > 0) bestFrames.push({ f, ...stats, path: shotPath });
  }
  bestFrames.sort((a, b) => b.small - a.small || b.smallPx - a.smallPx);
  const visionPicks = bestFrames.slice(0, 2).map((b) => b.path);
  while (visionPicks.length < 2) visionPicks.push(path.join(SHOT_DIR, 'frame_00.png'));
  log('vision picks:', JSON.stringify(visionPicks));

  // wait for the round + ceremony to finish (poll up to 45s)
  let finalA = null;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const m = await readMatch(page);
    if (m && m.screen !== 'minigame') { finalA = m; break; }
  }
  if (!finalA) finalA = await readMatch(page);
  log('twinA final:', JSON.stringify(finalA));

  // ---- twin B: determinism check ----
  await runTwin(page, 'twinB');
  await sleep(12000);
  let finalB = null;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const m = await readMatch(page);
    if (m && m.screen !== 'minigame') { finalB = m; break; }
  }
  if (!finalB) finalB = await readMatch(page);
  log('twinB final:', JSON.stringify(finalB));

  log('consoleErrors:', consoleErrors.length, consoleErrors.slice(0, 5));
  log('frameResults:', JSON.stringify(frameResults));

  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
