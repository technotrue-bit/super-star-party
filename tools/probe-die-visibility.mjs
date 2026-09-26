/**
 * probe-die-visibility.mjs — the blind critic's biggest gap was that the die is
 * "inconsistently invisible" (2 of 7 frames, including mid-roll). This measures,
 * per roll, whether the die is actually ON SCREEN and READABLE at phone size.
 *
 * Method: force a roll for each of the 4 players in turn (autoplay off), capture a
 * tight burst + a settled frame, and locate the die by its own signature — a warm
 * body blob containing several small white PIP blobs. That distinguishes it from
 * the board's red spaces (one icon each) and teal spaces (no pips).
 *
 * Reports per roll: die bbox in px, % of viewport width, pip count, and the state
 * machine's own view (__DIE_STATE) so "not visible" can be told apart from "not there".
 *
 * Run in the FOREGROUND from the repo dir:  node tools/probe-die-visibility.mjs
 */
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";

const OUT = "tools/critic/frames/dice/VISIBILITY";
fs.mkdirSync(OUT, { recursive: true });

const warm = (r, g, b) => r > 185 && g > 120 && b < 190 && r - b > 55;
const white = (r, g, b) => r > 218 && g > 218 && b > 208;

function findDie(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;
  const at = (x, y) => {
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const wm = new Uint8Array(W * H);
  const wh = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b] = at(x, y);
      wm[y * W + x] = warm(r, g, b) ? 1 : 0;
      wh[y * W + x] = white(r, g, b) ? 1 : 0;
    }
  const seen = new Uint8Array(W * H);
  let best = null;
  for (let y0 = 0; y0 < H; y0++)
    for (let x0 = 0; x0 < W; x0++) {
      const s = y0 * W + x0;
      if (!wm[s] || seen[s]) continue;
      const stack = [s];
      seen[s] = 1;
      let n = 0, minx = W, maxx = 0, miny = H, maxy = 0;
      while (stack.length) {
        const c = stack.pop();
        const cx = c % W, cy = (c / W) | 0;
        n++;
        if (cx < minx) minx = cx;
        if (cx > maxx) maxx = cx;
        if (cy < miny) miny = cy;
        if (cy > maxy) maxy = cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ns = ny * W + nx;
          if (wm[ns] && !seen[ns]) { seen[ns] = 1; stack.push(ns); }
        }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      if (n < 300 || n > 20000) continue;
      if (bw < 30 || bh < 30 || bw > 240 || bh > 240) continue;
      if (bw / bh < 0.45 || bw / bh > 2.2) continue;
      // count white pip blobs enclosed by this blob's bbox
      const seen2 = new Set();
      let pips = 0;
      for (let y = miny; y <= maxy; y++)
        for (let x = minx; x <= maxx; x++) {
          const s2 = y * W + x;
          if (!wh[s2] || seen2.has(s2)) continue;
          const st = [s2];
          seen2.add(s2);
          let m = 0;
          while (st.length) {
            const c = st.pop();
            const cx = c % W, cy = (c / W) | 0;
            m++;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = cx + dx, ny = cy + dy;
              if (nx < minx || ny < miny || nx > maxx || ny > maxy) continue;
              const ns = ny * W + nx;
              if (wh[ns] && !seen2.has(ns)) { seen2.add(ns); st.push(ns); }
            }
          }
          if (m >= 3 && m <= 140) pips++;
        }
      const score = pips * 1000 + n;
      if (!best || score > best.score) {
        best = { score, pips, n, bw, bh, minx, miny };
      }
    }
  return { W, H, best };
}

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto("http://localhost:5177/?seed=3&audio=0&autoplay=0", { waitUntil: "domcontentloaded" });

let live = false;
for (let i = 0; i < 30; i++) {
  live = await page.evaluate(() => (window.__SSP__?.state?.() ?? {}).screen === "board");
  if (live) break;
  await page.evaluate(() => window.__SSP__?.goto?.("board"));
  await page.waitForTimeout(400);
}
console.log("board live:", live);
await page.evaluate(() => window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"], 3));
await page.waitForTimeout(1500);

// Ride REAL autoplay rolls and key off the die's own state machine: whatever the
// state machine says is on screen is what we must be able to see.
await page.evaluate(() => { window.__SSP__.autoplay(true); });
const captures = [];
const seenStates = {};
const t0 = Date.now();
let last = null;
while (Date.now() - t0 < 45000) {
  const st = await page.evaluate(() => ({
    die: window.__DIE_STATE ?? null,
    phase: (window.__SSP__?.state?.() ?? {}).match?.phase ?? null,
    turn: (window.__SSP__?.state?.() ?? {}).match?.turn ?? null,
  }));
  seenStates[st.die] = (seenStates[st.die] ?? 0) + 1;
  if (st.die && st.die !== "hidden" && st.die !== last) {
    const shot = await page.screenshot();
    captures.push({ state: st.die, phase: st.phase, turn: st.turn, shot, at: Date.now() - t0 });
  }
  last = st.die;
  await page.waitForTimeout(110);
}
console.log(`sampled die states: ${JSON.stringify(seenStates)}`);

const rows = [];
let visible = 0;
for (let i = 0; i < captures.length; i++) {
  const c = captures[i];
  const d = findDie(c.shot);
  const ok = d.best && d.best.pips >= 2;
  if (ok) visible++;
  if (ok || i < 4) fs.writeFileSync(path.join(OUT, `cap-${String(i).padStart(2, "0")}-${c.state}.png`), c.shot);
  rows.push({ i, ...c, d: d.best ?? null });
}

console.log("\n  # | t(ms) | die state | best warm blob on screen");
for (const r of rows) {
  const info = r.d
    ? `${r.d.pips} pips, ${r.d.bw}x${r.d.bh}px at (${r.d.minx},${r.d.miny}) = ${(r.d.bw / 390 * 100).toFixed(1)}% of width`
    : "none found";
  console.log(`${String(r.i).padStart(3)} | ${String(r.at).padStart(6)} | ${String(r.state).padEnd(9)} | ${info}`);
}
console.log(`\ncaptures with the die VISIBLE and pips readable: ${visible}/${rows.length}`);

console.log("console errors:", errs.length ? JSON.stringify(errs.slice(0, 3)) : "none");
await b.close();
