// Probe: Pick a Hero shows every hero on an iPhone-sized portrait screen.
//
// Cold load on a slow phone network: one screen chunk is held back so the
// main loop runs frames before the boot screen enters (the race behind the
// blank hero preview). Then the real path, title → Pick a Hero, and every hero
// in turn with the → key. For each hero:
//   - __SSP__.selectBounds(): the model's box sits inside its slot and no part
//     of it is outside the camera's near..far range (clipped);
//   - pixels: the slot is not just the empty backdrop colour.
// Prints PASS/FAIL per hero and exits 1 on any failure. Needs a dev build (or
// VITE_SSP_TEST=1) for selectBounds.
//
//   SSP_URL=http://127.0.0.1:5177 node tools/probe-hero-preview.mjs
//   env: SSP_SIZE=390x844  SSP_HOLD_MS=1500  SSP_SHOTS=dir  SSP_CHROMIUM=/path/to/chrome
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import fs from "node:fs";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const [W, H] = (process.env.SSP_SIZE ?? "390x844").split("x").map(Number);
const HOLD_MS = Number(process.env.SSP_HOLD_MS ?? 1500);
const SHOTS = process.env.SSP_SHOTS ?? "";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1";
// The scene's clear colour (palette.ink): what an empty hero slot shows.
const INK = [43, 29, 78];

const launch = { args: ["--disable-dev-shm-usage", "--disable-gpu", "--enable-unsafe-swiftshader"] };
if (process.env.SSP_CHROMIUM) {
  launch.executablePath = process.env.SSP_CHROMIUM;
  launch.args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"];
}
const browser = await chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: W, height: H }, userAgent: UA, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// Hold back one screen chunk (dev: /src/screens/partyLineup.ts, build: partyLineup-<hash>.js).
await page.route(/partyLineup[^/]*\.(ts|js)(\?|$)/, async (route) => {
  await new Promise((r) => setTimeout(r, HOLD_MS));
  await route.continue();
});

let failed = false;
const check = (name, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};

/** Share of slot pixels that are the bare backdrop colour. */
async function emptyShare(slot) {
  const png = PNG.sync.read(await page.screenshot());
  let ink = 0;
  let n = 0;
  for (let y = Math.ceil(slot.y); y < Math.floor(slot.y + slot.h); y += 2) {
    for (let x = Math.ceil(slot.x); x < Math.floor(slot.x + slot.w); x += 2) {
      const i = (png.width * y + x) * 4;
      n++;
      if (Math.abs(png.data[i] - INK[0]) + Math.abs(png.data[i + 1] - INK[1]) + Math.abs(png.data[i + 2] - INK[2]) < 24) ink++;
    }
  }
  return n ? ink / n : 1;
}

try {
  await page.goto(`${BASE}/?audio=0`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 60000 });
  await page.waitForTimeout(HOLD_MS + 1500);
  await page.evaluate(() => window.__SSP__.goto("select"));
  await page.waitForFunction(() => !!window.__SSP__.selectBounds?.(), null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const first = await page.evaluate(() => window.__SSP__.selectBounds());
  const seen = new Set();
  let key = first.hero.selected;
  while (!seen.has(key)) {
    seen.add(key);
    await page.waitForTimeout(600);
    const b = await page.evaluate(() => window.__SSP__.selectBounds());
    const box = b.hero.box;
    const s = b.slot;
    const inSlot = !!box && !!s && box.x >= s.x - 2 && box.y >= s.y - 2 && box.x + box.w <= s.x + s.w + 2 && box.y + box.h <= s.y + s.h + 2;
    const empty = box ? await emptyShare(box) : 1;
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hero-${key}.png` });
    check(`hero ${key}: in slot, not clipped, drawn`, inSlot && !b.hero.clipped && empty < 0.6,
      `box ${JSON.stringify(box)} clipped ${b.hero.clipped} empty ${(empty * 100).toFixed(0)}%`);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
    key = (await page.evaluate(() => window.__SSP__.selectBounds())).hero.selected;
  }
  check("every hero visited", seen.size >= 8, [...seen].join(","));
} catch (e) {
  check("probe ran", false, String(e).slice(0, 300));
}
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
