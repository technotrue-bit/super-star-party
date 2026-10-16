/**
 * probe-practice-still.mjs — nobody moves before a minigame starts.
 *
 * Requires a dev server (SSP_URL, default http://127.0.0.1:5177).
 * Opens each contact game with __SSP__.openMinigame, holds the arrow keys and
 * presses TAP through the practice beat, and checks the local seat's model
 * never leaves its start spot before the phase reaches "play".
 *
 * Run: node tools/probe-practice-still.mjs
 * Exits non-zero when any check fails.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.SSP_URL ?? "http://127.0.0.1:5177";
const GAMES = ["bumper_balls", "coin_grab"];
/** Ground drift allowed before play. Idle fidgets lift y only. */
const STILL = 0.05;

const reasons = [];
function fail(message) {
  reasons.push(message);
  console.error(`FAIL: ${message}`);
}

function mirrorOf(id) {
  return id === "bumper_balls" ? "__BB__" : "__CG__";
}

async function seat0(page, id) {
  return page.evaluate((name) => {
    const seat = window[name]?.seats?.find((s) => s.id === 0);
    return seat ? { x: seat.model.x, z: seat.model.z } : null;
  }, mirrorOf(id));
}

async function phase(page) {
  return page.evaluate(() => document.body.dataset.mgPhase ?? "");
}

async function checkGame(page, id) {
  console.log(`\n${id}`);
  await page.goto(`${BASE}/?audio=0&fx=off&seed=7`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state?.()?.screen === "title", null, { timeout: 45000 });
  await page.evaluate((gameId) => window.__SSP__.openMinigame(gameId), id);
  await page.waitForFunction(
    (name) => window.__SSP__?.state?.()?.screen === "minigame" && window[name]?.seats?.length === 4,
    mirrorOf(id),
    { timeout: 45000 },
  );
  await page.waitForFunction(() => document.body.dataset.mgPhase === "practice", null, { timeout: 20000 });
  await page.waitForTimeout(150);
  const start = await seat0(page, id);
  if (!start) {
    fail(`${id}: no seat 0 in the mirror`);
    return;
  }

  let worst = 0;
  let samples = 0;
  const keys = ["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"];
  for (let i = 0; (await phase(page)) !== "play" && i < 400; i++) {
    const key = keys[Math.floor(i / 10) % keys.length];
    await page.keyboard.down(key);
    if (i % 6 === 0) await page.keyboard.press("Space");
    await page.waitForTimeout(40);
    await page.keyboard.up(key);
    if ((await phase(page)) === "play") break;
    const at = await seat0(page, id);
    if (!at) continue;
    samples++;
    worst = Math.max(worst, Math.hypot(at.x - start.x, at.z - start.z));
  }
  console.log(`   ${samples} samples before play, worst drift ${worst.toFixed(3)}`);
  if (samples === 0) fail(`${id}: practice beat never sampled`);
  if (worst > STILL) fail(`${id}: local seat moved ${worst.toFixed(3)} before the minigame started`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (const id of GAMES) await checkGame(page, id);
} finally {
  await browser.close();
}

if (reasons.length > 0) {
  console.error(`\n${reasons.length} check(s) failed`);
  process.exit(1);
}
console.log("\nOK: no seat moved before play");
