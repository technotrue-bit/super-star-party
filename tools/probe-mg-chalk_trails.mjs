// Probe: Chalk Trails (draw pad, 45 s, ffa gem collecting with a rain wash every 10 s).
// Runs the game with ?seed=7&autoplay=1&audio=0&minigame=chalk_trails and asserts:
//   - the ranking has all 4 ids, and is identical on two Normal runs (same seed)
//   - the ranking is by gems (most first) and the winner leads it
//   - the round lasts 30-60 s of game time (the game's own clock)
//   - the rain washes every path away at 10, 20, 30 and 40 s, and no snail moves while it sweeps
//   - no page errors
//   - the fixed-camera probe passes (the whole park is framed, no movement, no shake)
//   - at Relaxed and at Challenge the round still ends with a full ranking, and the Challenge
//     winner's gem count is at least the Relaxed winner's
//   - REAL touch on the draw layer (CDP touch events): a snail with no path stands still; a finger
//     stroke from the snail to a gem sends it there and it collects the gem; the page never
//     scrolls or zooms while drawing
//   - the mouse (desktop): a drag from the snail to a gem sends it there and it collects the gem
//   - the keyboard pen (hold Space, arrows move the cursor), on a virtual clock: a stroke makes
//     a path and the snail follows it
// Prints PASS or FAIL <reason>; exit code 1 on any failure.
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const ID = "chalk_trails";
const BASE = process.env.SSP_URL ?? "http://127.0.0.1:5177";
const fail = (msg) => {
  console.log(`FAIL ${msg}`);
  process.exit(1);
};

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });

/** Opens the game and runs the splash, countdown and practice to live play. Returns the page. */
async function openRound(level, { autoplay, touch = false }) {
  const ctx = touch
    ? await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
    : await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  if (level) await page.addInitScript((lv) => localStorage.setItem("ssp.cpuLevel", lv), level);
  await page.goto(`${BASE}/?seed=7&${autoplay ? "autoplay=1&" : ""}audio=0&minigame=${ID}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__SSP__.seed(7);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  });
  // The modules register one after another; give the whole list time to land.
  let known = false;
  for (let i = 0; i < 100 && !known; i++) {
    known = await page.evaluate((id) => (window.__SSP__.state().minigameRules?.catalog ?? []).some((m) => m.id === id), ID);
    if (!known) await page.waitForTimeout(300);
  }
  if (!known) {
    await page.close();
    fail("unknown minigame");
  }
  await page.evaluate((auto) => {
    if (auto) window.__SSP__.autoplay(true);
    window.__SSP__.goto("minigame");
  }, autoplay);

  // Through the intro card, the splash, the countdown, to live play.
  let phase = "";
  for (let i = 0; i < 400 && phase !== "play"; i++) {
    phase = await page.evaluate(() => window.__SSP__.mgProbe().phase);
    if (phase === "play") break;
    if (phase === "") await page.getByText("START MINI GAME").click({ timeout: 3000 }).catch(() => {});
    await page.evaluate(() => window.__SSP__.advance(30));
    await page.waitForTimeout(30);
  }
  if (phase !== "play") fail(`never reached play (phase=${phase || "none"}) level=${level ?? "normal"}`);
  return { page, ctx, errors };
}

async function playRound(level) {
  const { page, ctx, errors } = await openRound(level, { autoplay: true });
  // Step the live round in 10-frame chunks until the game calls finish.
  let frames = 0;
  let probe = null;
  while (frames < 60 * 100) {
    probe = await page.evaluate(() => {
      window.__SSP__.advance(10);
      return window.__SSP__.mgProbe();
    });
    frames += 10;
    if (probe.ranking) break;
  }
  if (!probe?.ranking) fail(`round never finished (level=${level ?? "normal"})`);
  const tel = await page.evaluate(() => JSON.parse(JSON.stringify(window.__CHALKTRAILS__ ?? null)));
  await ctx.close();
  return { ranking: probe.ranking, frames, tel, errors };
}

const readTel = (page) =>
  page.evaluate(() => {
    const t = window.__CHALKTRAILS__;
    const i = t.human;
    return {
      gems: t.gems[i], walked: t.walked[i], pathPts: t.pathPts[i], pathLeft: t.pathLeft[i], moving: t.moving[i],
      x: t.x[i], z: t.z[i], strokes: t.strokes, penDown: t.penDown, screen: JSON.parse(JSON.stringify(t.screen)),
      t: t.t, sweeping: t.sweeping,
    };
  });

/** A phone round: real touch events (CDP) on the draw layer. */
async function touchDraw() {
  const { page, ctx, errors } = await openRound(null, { autoplay: false, touch: true });
  const cdp = await ctx.newCDPSession(page);
  const layer = await page.evaluate(() => {
    const el = document.querySelector(".ssp-draw");
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: b.width, h: b.height, left: b.left, top: b.top, shown: getComputedStyle(el).display !== "none", touchAction: getComputedStyle(el).touchAction };
  });
  if (!layer?.shown) fail("touch: the draw layer is not shown");
  const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  const px = (n) => ({ x: layer.left + n[0] * layer.w, y: layer.top + n[1] * layer.h, id: 1 });
  const settle = () =>
    page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.__SSP__.advance(3);
    });

  await page.evaluate(() => window.__SSP__.advance(10));
  const idle0 = await readTel(page);
  // No stroke: the snail stands still.
  await page.evaluate(() => window.__SSP__.advance(60));
  const idle1 = await readTel(page);

  // Aim at the gem nearest the snail.
  const snail = idle1.screen.snail;
  const gems = idle1.screen.gems;
  if (!snail || !gems.length) fail("touch: no snail or gems on screen telemetry");
  let best = gems[0];
  for (const g of gems) if (Math.hypot(g[0] - snail[0], g[1] - snail[1]) < Math.hypot(best[0] - snail[0], best[1] - snail[1])) best = g;

  const steps = 10;
  await send("touchStart", [px(snail)]);
  await settle();
  for (let i = 1; i <= steps; i++) {
    await send("touchMove", [px([snail[0] + (best[0] - snail[0]) * (i / steps), snail[1] + (best[1] - snail[1]) * (i / steps)])]);
    await settle();
  }
  await send("touchEnd", [px(best)]);
  await settle();
  const drawn = await readTel(page);
  const scroll = await page.evaluate(() => ({ y: window.scrollY, x: window.scrollX, scale: window.visualViewport?.scale ?? 1 }));
  // Let the snail walk (a few seconds of game time, well inside the first 10 s).
  await page.evaluate(() => window.__SSP__.advance(60 * 4));
  const walked = await readTel(page);
  await ctx.close();
  return { layer, idle0, idle1, drawn, walked, scroll, errors };
}

/**
 * A human round on the keyboard. The pad counts REAL time, and a software-GL headless page
 * runs at a few frames a second, so the clock is replaced by a virtual one that moves only with
 * the sim: every advanced frame is exactly 1/60 s, key events carry that time.
 */
async function keyboardDraw() {
  const { page, ctx, errors } = await openRound(null, { autoplay: false });
  await page.evaluate(() => window.__SSP__.advance(10));
  const out = await page.evaluate(() => {
    const realNow = performance.now.bind(performance);
    let vnow = realNow();
    performance.now = () => vnow;
    const key = (type, k) => {
      const ev = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true });
      Object.defineProperty(ev, "timeStamp", { value: vnow });
      window.dispatchEvent(ev);
    };
    const step = (n) => {
      for (let i = 0; i < n; i++) {
        vnow += 1000 / 60;
        window.__SSP__.advance(1);
      }
    };
    const read = () => {
      const t = window.__CHALKTRAILS__;
      const i = t.human;
      return { walked: t.walked[i], pathPts: t.pathPts[i], strokes: t.strokes, penDown: t.penDown, pen: t.screen.pen ? [...t.screen.pen] : null, x: t.x[i], z: t.z[i] };
    };
    const t0 = read();
    // Arrows alone (no pen): nothing is drawn.
    key("keydown", "ArrowDown");
    step(20);
    key("keyup", "ArrowDown");
    step(2);
    const noPen = read();
    // Space is the pen: hold it and steer a short way. The human is the top-left corner, and the
    // cursor starts at the middle of the screen, so it goes left and up to stay in the corner.
    key("keydown", " ");
    step(2);
    key("keydown", "ArrowLeft");
    step(18);
    key("keyup", "ArrowLeft");
    key("keydown", "ArrowUp");
    step(18);
    const mid = read();
    key("keyup", "ArrowUp");
    key("keyup", " ");
    step(2);
    const lifted = read();
    // The snail follows the chalk.
    step(120);
    const after = read();
    performance.now = realNow;
    return { t0, noPen, mid, lifted, after };
  });
  await ctx.close();
  return { ...out, errors };
}

/** A desktop round: the mouse drags a chalk path (window pointer events, no touch layer). */
async function mouseDraw() {
  const { page, ctx, errors } = await openRound(null, { autoplay: false });
  await page.evaluate(() => window.__SSP__.advance(10));
  const vp = page.viewportSize();
  const t0 = await readTel(page);
  const snail = t0.screen.snail;
  const gems = t0.screen.gems;
  let best = gems[0];
  for (const g of gems) if (Math.hypot(g[0] - snail[0], g[1] - snail[1]) < Math.hypot(best[0] - snail[0], best[1] - snail[1])) best = g;
  const at = (n) => [n[0] * vp.width, n[1] * vp.height];
  await page.mouse.move(...at(snail));
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(...at([snail[0] + (best[0] - snail[0]) * (i / 10), snail[1] + (best[1] - snail[1]) * (i / 10)]));
    await page.evaluate(() => window.__SSP__.advance(3));
  }
  await page.mouse.up();
  await page.evaluate(() => window.__SSP__.advance(3));
  const drawn = await readTel(page);
  await page.evaluate(() => window.__SSP__.advance(60 * 4));
  const walked = await readTel(page);
  await ctx.close();
  return { drawn, walked, errors };
}

const touch = await touchDraw();
console.log(
  `touch draw: idle walked ${(touch.idle1.walked - touch.idle0.walked).toFixed(3)}; stroke made ${touch.drawn.pathPts} points (strokes ${touch.drawn.strokes}); after 4 s walked ${touch.walked.walked.toFixed(2)} units, gems ${touch.walked.gems}; page scroll ${JSON.stringify(touch.scroll)} touch-action ${touch.layer.touchAction}`,
);
if (touch.errors.length) fail(`page errors (touch): ${touch.errors[0]}`);
if (touch.idle1.walked - touch.idle0.walked > 1e-6) fail("a snail with no path moved");
if (!(touch.drawn.strokes >= 1 && touch.drawn.pathPts >= 3)) fail(`the touch stroke made no path (strokes ${touch.drawn.strokes}, points ${touch.drawn.pathPts})`);
if (!(touch.walked.walked > 0.8)) fail(`the snail did not follow the touch stroke (walked ${touch.walked.walked})`);
if (!(touch.walked.gems >= 1)) fail("the snail drew a path to the nearest gem and did not collect it");
if (touch.scroll.y !== 0 || touch.scroll.x !== 0 || touch.scroll.scale !== 1) fail(`drawing scrolled or zoomed the page ${JSON.stringify(touch.scroll)}`);
if (touch.layer.touchAction !== "none") fail(`the draw layer touch-action is ${touch.layer.touchAction} (want none)`);

const kb = await keyboardDraw();
console.log(
  `keyboard pen: arrows alone made ${kb.noPen.pathPts} points; Space+arrows made ${kb.lifted.pathPts} points (strokes ${kb.lifted.strokes}); pen ${JSON.stringify(kb.mid.pen)}; snail walked ${(kb.after.walked - kb.lifted.walked).toFixed(2)} units after`,
);
if (kb.errors.length) fail(`page errors (keyboard): ${kb.errors[0]}`);
if (kb.noPen.pathPts !== 0 || kb.noPen.strokes !== 0) fail("arrow keys alone drew a path");
if (!(kb.lifted.strokes >= 1 && kb.lifted.pathPts >= 3)) fail(`Space + arrows made no path (strokes ${kb.lifted.strokes}, points ${kb.lifted.pathPts})`);
if (!kb.mid.penDown) fail("the pen was not down while Space was held");
if (kb.lifted.penDown) fail("the pen stayed down after Space was released");
if (!(kb.after.walked - kb.lifted.walked > 0.5)) fail("the snail did not follow the keyboard stroke");

const mouse = await mouseDraw();
console.log(`mouse drag: stroke made ${mouse.drawn.pathPts} points (strokes ${mouse.drawn.strokes}); after 4 s walked ${mouse.walked.walked.toFixed(2)} units, gems ${mouse.walked.gems}`);
if (mouse.errors.length) fail(`page errors (mouse): ${mouse.errors[0]}`);
if (!(mouse.drawn.strokes >= 1 && mouse.drawn.pathPts >= 3)) fail(`the mouse drag made no path (strokes ${mouse.drawn.strokes}, points ${mouse.drawn.pathPts})`);
if (!(mouse.walked.gems >= 1)) fail("a mouse path to the nearest gem did not collect it");

const num = (v) => (typeof v === "number" ? v : NaN);
const top = (r) => num(r.tel?.gems?.[r.ranking[0]]);

const runs = {};
for (const [key, level] of [["a", null], ["b", null], ["relaxed", "relaxed"], ["challenge", "challenge"]]) {
  runs[key] = await playRound(level);
  const r = runs[key];
  console.log(`run ${key}: ranking=${JSON.stringify(r.ranking)} gems=${JSON.stringify(r.tel?.gems)} rains=${JSON.stringify(r.tel?.rains)} erased=${JSON.stringify(r.tel?.erased)} t=${r.tel?.tFinish?.toFixed(2)}`);
  const ids = [...r.ranking].sort((x, y) => x - y);
  if (JSON.stringify(ids) !== "[0,1,2,3]") fail(`ranking is not all 4 ids (${key}): ${JSON.stringify(r.ranking)}`);
  if (r.ranking[0] !== r.tel?.winner) fail(`the winner ${r.tel?.winner} does not lead the ranking ${JSON.stringify(r.ranking)} (${key})`);
  const gems = r.tel?.gems ?? [];
  for (let i = 1; i < r.ranking.length; i++) {
    if (gems[r.ranking[i - 1]] < gems[r.ranking[i]]) fail(`ranking ${JSON.stringify(r.ranking)} is not by gems ${JSON.stringify(gems)} (${key})`);
  }
  const secs = r.tel?.tFinish ?? 0;
  if (secs < 30 || secs > 60) fail(`round lasted ${secs.toFixed(1)} s of game time (${key})`);
  if (JSON.stringify(r.tel?.rains) !== "[10,20,30,40]") fail(`the rain came at ${JSON.stringify(r.tel?.rains)} (want 10, 20, 30, 40) (${key})`);
  if ((r.tel?.erased ?? []).length !== 4) fail(`the rain wash was not logged four times (${key})`);
  if (r.tel?.sweepWalked > 1e-6) fail(`snails walked ${r.tel.sweepWalked} units while the rain swept (${key})`);
  if (!(top(r) >= 6 && top(r) <= 60)) fail(`winner gems ${top(r)} is out of range (${key})`);
  if (r.errors.length) fail(`page errors (${key}): ${r.errors[0]}`);
}
// The rain really wiped something at least once: the CPUs had paths down when it came.
if (!runs.a.tel.erased.some((n) => n > 0)) fail("the rain never erased a path");
if (JSON.stringify(runs.a.ranking) !== JSON.stringify(runs.b.ranking)) fail(`ranking differs between runs: ${JSON.stringify(runs.a.ranking)} vs ${JSON.stringify(runs.b.ranking)}`);
if (JSON.stringify(runs.a.tel?.gems) !== JSON.stringify(runs.b.tel?.gems)) fail("gem counts differ between runs");
if (!(top(runs.challenge) >= top(runs.relaxed))) fail(`Challenge winner gems ${top(runs.challenge)} < Relaxed winner gems ${top(runs.relaxed)}`);
await browser.close();

// The camera must not move at all (the whole park is framed), whatever the keys do.
// It needs 40 samples in 6 s, which a loaded software-GL box can miss by one: allow one retry.
const camScript = join(dirname(new URL(import.meta.url).pathname), "probe-camera-lock.mjs");
const camEnv = { ...process.env, CAM_PROBE_MS: process.env.CAM_PROBE_MS ?? "14000" };
let cam = spawnSync("node", [camScript, ID], { encoding: "utf8", env: camEnv });
process.stdout.write(cam.stdout);
if (cam.status !== 0 && /only \d+ samples/.test(cam.stdout)) {
  cam = spawnSync("node", [camScript, ID], { encoding: "utf8", env: camEnv });
  process.stdout.write(cam.stdout);
}
if (cam.status !== 0) fail("camera lock probe failed");

console.log(`PASS ${ID} winner gems relaxed=${top(runs.relaxed)} normal=${top(runs.a)} challenge=${top(runs.challenge)}`);
