// Probe: Crank Coaster (dial, 30-45 s, ffa lift-hill race).
// Runs the game with ?seed=7&autoplay=1&audio=0&minigame=crank_coaster and asserts:
//   - the ranking has all 4 ids, and is identical on two Normal runs (same seed)
//   - the winner leads the ranking, and is the first cart to the top (or the highest at the cap)
//   - the round lasts 30-60 s of game time (the game's own clock)
//   - no page errors
//   - the fixed-camera probe passes (the whole hill is framed, no movement, no shake)
//   - at Relaxed and at Challenge the round still ends with a full ranking, and the Challenge
//     winner's pace (turns per second of climbing) is at least the Relaxed winner's
//   - REAL touch on the wheel (CDP touch events circling .ssp-dial): clockwise raises the cart
//     by about the angle turned, counter-clockwise does nothing; then a hard fast spin (exact
//     PointerEvents on the same wheel, one chunk per sim frame) heats the crank and jams the
//     chain (no progress while jammed, then it frees again)
//   - the keyboard dial (E or Right forward, Q back), on a virtual clock: E raises the cart exactly
//     1.5 turns/s with no heat, Q does nothing
// Prints PASS or FAIL <reason>; exit code 1 on any failure.
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ID = "crank_coaster";
const BASE = process.env.SSP_URL ?? "http://127.0.0.1:5177";
const TURN = Math.PI * 2;
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
  const tel = await page.evaluate(() => window.__CRANKCOASTER__ ?? null);
  await ctx.close();
  return { ranking: probe.ranking, frames, tel, errors };
}

const readTel = (page) =>
  page.evaluate(() => {
    const t = window.__CRANKCOASTER__;
    const i = t.human;
    return {
      angle: t.angle[i], heat: t.heat[i], jam: t.jam[i], jams: t.jams[i], back: t.back[i], wasted: t.wasted[i],
      band: document.querySelector(".cc-gauge")?.getAttribute("data-band") ?? null,
      dials: t.dials, step: t.step,
    };
  });

/**
 * A human round on the keyboard. The pad counts REAL time (1.5 turns/s), and a software-GL headless
 * page runs at a few frames a second, so the clock is replaced by a virtual one that moves
 * only with the sim: every advanced frame is exactly 1/60 s, key events carry that time, and the
 * whole thing runs inside one evaluate so no real frame can slip in between.
 */
async function keyboardRound() {
  const { page, ctx, errors } = await openRound(null, { autoplay: false });
  await page.evaluate(() => window.__SSP__.advance(30));
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
      const t = window.__CRANKCOASTER__;
      const i = t.human;
      return { angle: t.angle[i], heat: t.heat[i], back: t.back[i], jams: t.jams[i] };
    };
    const t0 = read();
    // Q (turn back) for 1.2 s: nothing.
    key("keydown", "q");
    step(72);
    key("keyup", "q");
    step(2);
    const afterQ = read();
    // E for 2 s: forward at 1.5 turns/s.
    key("keydown", "e");
    step(120);
    key("keyup", "e");
    step(2);
    const afterE = read();
    // ArrowRight does the same as E.
    key("keydown", "ArrowRight");
    step(60);
    key("keyup", "ArrowRight");
    step(2);
    const afterArrow = read();
    performance.now = realNow;
    return { t0, afterQ, afterE, afterArrow };
  });
  await ctx.close();
  return { ...out, errors };
}

/**
 * A phone round: real touch events (CDP) circling the wheel. Clockwise raises the cart,
 * counter-clockwise does nothing, a hard fast spin jams the chain.
 */
async function touchDial() {
  const { page, ctx, errors } = await openRound(null, { autoplay: false, touch: true });
  const cdp = await ctx.newCDPSession(page);
  const w = await page.evaluate(() => {
    const el = document.querySelector(".ssp-dial");
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, shown: getComputedStyle(el).display !== "none" };
  });
  if (!w?.shown) fail("touch: the dial wheel is not shown");
  const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  const pt = (ang, r = 55) => ({ x: w.x + Math.cos(ang) * r, y: w.y + Math.sin(ang) * r, id: 1 });
  // After a touch, give the pad its frame to flush, then let the game take it.
  const settle = () =>
    page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.__SSP__.advance(4);
    });
  /** A finger around the wheel: dir +1 is clockwise on screen. `burst` moves go out together. */
  const circle = async (from, sweep, dir, stepDeg, burst = 1) => {
    const steps = Math.max(2, Math.round(sweep / ((stepDeg * Math.PI) / 180)));
    await send("touchStart", [pt(from)]);
    for (let i = 1; i <= steps; i += burst) {
      const batch = [];
      for (let j = i; j < Math.min(steps + 1, i + burst); j++) batch.push(send("touchMove", [pt(from + dir * sweep * (j / steps))]));
      await Promise.all(batch);
      if (burst === 1) await settle();
    }
    await send("touchEnd", [pt(from + dir * sweep)]);
    await settle();
  };

  await page.evaluate(() => window.__SSP__.advance(30));
  const t0 = await readTel(page);
  // Clockwise: one full turn in 15-degree steps.
  await circle(0, TURN, 1, 15);
  const cw = await readTel(page);
  // Counter-clockwise: one and a half turns the other way.
  await circle(Math.PI / 2, TURN * 1.5, -1, 15);
  const ccw = await readTel(page);
  // A fast hard spin. CDP touch events arrive far slower than a thumb (one per ~100 ms here), so
  // the speed is made exact instead: PointerEvents on the very same wheel, one 40-degree chunk per
  // sim frame (6.7 turns/s), each lifted so the pad hands it to the game at once.
  const spin = (chunks, stopAtJam) =>
    page.evaluate(
      ([n, stop]) => {
        const el = document.querySelector(".ssp-dial");
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        const ev = (type, a) =>
          el.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: "touch", bubbles: true, cancelable: true, clientX: cx + Math.cos(a) * 55, clientY: cy + Math.sin(a) * 55 }));
        let a = 0;
        let did = 0;
        for (let i = 0; i < n; i++) {
          ev("pointerdown", a);
          a += (40 * Math.PI) / 180;
          ev("pointermove", a);
          ev("pointerup", a);
          window.__SSP__.advance(1);
          did++;
          if (stop && window.__CRANKCOASTER__.jams[window.__CRANKCOASTER__.human] > 0) break;
        }
        return did;
      },
      [chunks, stopAtJam],
    );
  await spin(90, true);
  const jam = await readTel(page);
  // While it is jammed, cranking more gets nowhere.
  let held = null;
  if (jam.jam > 0) {
    await spin(20, false);
    held = await readTel(page);
  }
  // It frees after 1.5 s of game time and the gauge has cooled.
  await page.evaluate(() => window.__SSP__.advance(120));
  const freed = await readTel(page);
  await ctx.close();
  return { t0, cw, ccw, jam, held, freed, errors };
}

const num = (v) => (typeof v === "number" ? v : NaN);
const pace = (r) => num(r.tel?.pace?.[r.tel?.winner]);

const touch = await touchDial();
const dTurns = (touch.cw.angle - touch.t0.angle) / TURN;
console.log(
  `touch dial: clockwise turn raised ${dTurns.toFixed(2)} turns; counter-clockwise changed ${((touch.ccw.angle - touch.cw.angle) / TURN).toFixed(3)} turns (back ${(touch.ccw.back / TURN).toFixed(2)}); fast spin jams=${touch.jam.jams} heat=${touch.jam.heat.toFixed(2)} band=${touch.jam.band}; jammed angle ${touch.held ? (touch.held.angle - touch.jam.angle).toFixed(3) : "n/a"} rad; freed jam=${touch.freed.jam} heat=${touch.freed.heat.toFixed(2)}`,
);
if (touch.errors.length) fail(`page errors (touch): ${touch.errors[0]}`);
if (!(dTurns > 0.8 && dTurns < 1.2)) fail(`a clockwise turn of the wheel raised the cart by ${dTurns.toFixed(2)} turns (want about 1)`);
if (Math.abs(touch.ccw.angle - touch.cw.angle) > 0.2) fail(`counter-clockwise changed the cart by ${(touch.ccw.angle - touch.cw.angle).toFixed(2)} rad (want 0)`);
if (!(touch.ccw.back > TURN)) fail("counter-clockwise turning was not seen at all (back < 1 turn)");
if (touch.ccw.heat > 0.01) fail("slow cranking built heat");
if (!(touch.jam.jams >= 1)) fail("a hard fast spin never jammed the chain");
if (touch.jam.band !== "3") fail(`the heat gauge band is ${touch.jam.band} while jammed (want 3)`);
if (!touch.held || Math.abs(touch.held.angle - touch.jam.angle) > 0.05 * TURN) fail("the cart moved while the chain was jammed");
if (touch.freed.jam !== 0) fail("the chain never freed");
if (process.env.PROBE_ONLY === "touch") {
  console.log("PASS touch only");
  await browser.close();
  process.exit(0);
}

const kb = await keyboardRound();
const kTurns = (kb.afterE.angle - kb.afterQ.angle) / TURN;
const aTurns = (kb.afterArrow.angle - kb.afterE.angle) / TURN;
console.log(`keyboard: Q changed ${(kb.afterQ.angle - kb.t0.angle).toFixed(3)} rad (back ${(kb.afterQ.back / TURN).toFixed(2)} turns); E for 2 s raised ${kTurns.toFixed(2)} turns heat=${kb.afterE.heat.toFixed(2)}; ArrowRight for 1 s raised ${aTurns.toFixed(2)} turns`);
if (kb.errors.length) fail(`page errors (keyboard): ${kb.errors[0]}`);
if (Math.abs(kb.afterQ.angle - kb.t0.angle) > 0.01) fail("Q (turn back) moved the cart");
if (!(kb.afterQ.back > TURN)) fail("Q (turn back) was not seen at all");
if (!(kTurns > 2.8 && kTurns < 3.2)) fail(`E for 2 s raised the cart ${kTurns.toFixed(2)} turns (want 3.0, the keyboard dial is 1.5 turns/s)`);
if (!(aTurns > 1.35 && aTurns < 1.65)) fail(`ArrowRight for 1 s raised the cart ${aTurns.toFixed(2)} turns (want 1.5)`);
if (kb.afterArrow.heat > 0.01 || kb.afterArrow.jams > 0) fail("keyboard cranking at 1.5 turns/s built heat");

const runs = {};
for (const [key, level] of [["a", null], ["b", null], ["relaxed", "relaxed"], ["challenge", "challenge"]]) {
  runs[key] = await playRound(level);
  const r = runs[key];
  console.log(`run ${key}: ranking=${JSON.stringify(r.ranking)} winner=${r.tel?.winner} topped=${r.tel?.topped} turns=${JSON.stringify(r.tel?.turns?.map((d) => Math.round(d * 10) / 10))} jams=${JSON.stringify(r.tel?.jams)} peak=${JSON.stringify(r.tel?.peak)} pace=${JSON.stringify(r.tel?.pace)} t=${r.tel?.tFinish?.toFixed(2)}`);
  const ids = [...r.ranking].sort((x, y) => x - y);
  if (JSON.stringify(ids) !== "[0,1,2,3]") fail(`ranking is not all 4 ids (${key}): ${JSON.stringify(r.ranking)}`);
  if (r.ranking[0] !== r.tel?.winner) fail(`the winner ${r.tel?.winner} does not lead the ranking ${JSON.stringify(r.ranking)} (${key})`);
  if (r.tel?.coinWinners && JSON.stringify(r.tel.coinWinners) !== JSON.stringify([r.ranking[0]])) fail(`coinWinners ${JSON.stringify(r.tel.coinWinners)} is not just the winner (${key})`);
  const heights = r.tel?.angle ?? [];
  for (let i = 1; i < r.ranking.length; i++) {
    if (heights[r.ranking[i - 1]] < heights[r.ranking[i]] - 1e-6) fail(`ranking ${JSON.stringify(r.ranking)} is not by height (${key})`);
  }
  const secs = r.tel?.tFinish ?? 0;
  if (secs < 30 || secs > 60) fail(`round lasted ${secs.toFixed(1)} s of game time (${key})`);
  if (r.errors.length) fail(`page errors (${key}): ${r.errors[0]}`);
}
if (JSON.stringify(runs.a.ranking) !== JSON.stringify(runs.b.ranking)) fail(`ranking differs between runs: ${JSON.stringify(runs.a.ranking)} vs ${JSON.stringify(runs.b.ranking)}`);
if (JSON.stringify(runs.a.tel?.angle) !== JSON.stringify(runs.b.tel?.angle)) fail("heights differ between runs");
// Normal CPUs crank at about the keyboard dial's 1.5 turns/s (the winner a little above it); every
// level stays well under the 2.2 turns/s heat line.
if (!(pace(runs.a) > 1.35 && pace(runs.a) < 1.75)) fail(`Normal winner pace ${pace(runs.a)} turns/s is not near the keyboard's 1.5`);
for (const k of ["relaxed", "a", "challenge"]) if (!(pace(runs[k]) < 2.1)) fail(`${k} winner pace ${pace(runs[k])} is at the heat line`);
if (!(pace(runs.challenge) >= pace(runs.relaxed))) {
  fail(`Challenge winner pace ${pace(runs.challenge)} < Relaxed winner pace ${pace(runs.relaxed)}`);
}
await browser.close();

// The camera must not move at all (the whole hill is framed), whatever the keys do.
// It needs 40 samples in 6 s, which a loaded software-GL box can miss by one: allow one retry.
const camScript = join(dirname(fileURLToPath(import.meta.url)), "probe-camera-lock.mjs");
// A longer window (the round runs 36+ s) gives a loaded box its 40 samples.
const camEnv = { ...process.env, CAM_PROBE_MS: process.env.CAM_PROBE_MS ?? "14000" };
let cam = spawnSync("node", [camScript, ID], { encoding: "utf8", env: camEnv });
process.stdout.write(cam.stdout);
if (cam.status !== 0 && /only \d+ samples/.test(cam.stdout)) {
  cam = spawnSync("node", [camScript, ID], { encoding: "utf8", env: camEnv });
  process.stdout.write(cam.stdout);
}
if (cam.status !== 0) fail("camera lock probe failed");

console.log(`PASS ${ID} pace relaxed=${pace(runs.relaxed).toFixed(2)} normal=${pace(runs.a).toFixed(2)} challenge=${pace(runs.challenge).toFixed(2)} turns/s`);
