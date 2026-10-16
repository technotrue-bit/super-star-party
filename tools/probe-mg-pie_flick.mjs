// Probe: Pie Flick (swipe, 50 s, ffa).
// Runs the game with ?seed=7&autoplay=1&audio=0&minigame=pie_flick and asserts:
//   - the ranking has all 4 ids, and is identical on two Normal runs (same seed)
//   - the round lasts 30-60 s of game time (the game's own clock)
//   - no page errors
//   - the camera-lock probe passes (fixed camera, no shake)
//   - at Relaxed and at Challenge the round still ends with a full ranking, and the
//     Challenge winner's score is at least the Relaxed winner's
//   - a keyboard throw (arrow + held Space) and a REAL touch swipe (CDP touch events on the
//     .ssp-swipe layer) each launch exactly one pie in the swiped direction; a downward
//     flick and a tap launch none
// The sim is stepped with __SSP__.advance (60 Hz frames) so a slow headless GPU does not
// stretch the wall clock. Prints PASS or FAIL <reason>; exit code 1 on any failure.
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const ID = "pie_flick";
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
    if (phase === "") await page.getByText("START MINI GAME").click({ timeout: 300 }).catch(() => {});
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
  const tel = await page.evaluate(() => window.__PIEFLICK__ ?? null);
  await ctx.close();
  return { ranking: probe.ranking, frames, tel, errors };
}

const throwsOf = (tel) => (tel?.log ?? []).filter((l) => / L0 throw /.test(l));
const num = (line, key) => Number(new RegExp(`${key}=(-?[\\d.]+)`).exec(line)?.[1]);

/** A human round on the keyboard: arrow keys pick the direction, a held Space is the power. */
async function humanThrow() {
  const { page, ctx, errors } = await openRound(null, { autoplay: false });
  await page.evaluate(() => window.__SSP__.advance(30));
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down(" ");
  await page.waitForTimeout(650);
  await page.keyboard.up(" ");
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("ArrowUp");
  const tel = await page.evaluate(() => {
    window.__SSP__.advance(150);
    return window.__PIEFLICK__;
  });
  await ctx.close();
  return { tel, errors };
}

/**
 * A phone round: real touch events (CDP) on the swipe layer. A rightward-leaning swipe up must
 * throw one pie; a tap, and a flick downward, must throw none.
 */
async function touchSwipe() {
  const { page, ctx, errors } = await openRound(null, { autoplay: false, touch: true });
  const cdp = await ctx.newCDPSession(page);
  const layer = await page.evaluate(() => {
    const el = document.querySelector(".ssp-swipe");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, shown: getComputedStyle(el).display !== "none" };
  });
  if (!layer?.shown) fail("touch: no swipe layer on a swipe game");
  // This rig takes ~800 ms to deliver one touch event, so every event carries its own timestamp
  // (dt seconds after the last), which the pad reads from PointerEvent.timeStamp as on a phone.
  const send = (type, x, y, dt = 0.02) => {
    if (type === "touchStart") cdp.__t = Date.now() / 1000;
    cdp.__t += dt;
    return cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }], timestamp: cdp.__t });
  };
  const drag = async (x0, y0, x1, y1, steps, dt) => {
    await send("touchStart", x0, y0);
    for (let i = 1; i <= steps; i++) await send("touchMove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, dt);
    await send("touchEnd", x1, y1, dt);
  };
  const count = () => page.evaluate(() => (window.__PIEFLICK__?.log ?? []).filter((l) => / L0 throw /.test(l)).length);
  await page.evaluate(() => window.__SSP__.advance(30));

  // A tap and a downward flick: no throw.
  await send("touchStart", 195, 600);
  await send("touchEnd", 195, 600);
  await drag(195, 500, 195, 760, 4, 0.03);
  await page.evaluate(() => window.__SSP__.advance(20));
  const idle = await count();

  // A swipe up and to the right.
  await drag(195, 720, 255, 470, 5, 0.03);
  const tel = await page.evaluate(() => {
    window.__SSP__.advance(150);
    return window.__PIEFLICK__;
  });
  await ctx.close();
  return { tel, idle, errors };
}

const winnerScore = (r) => r.tel?.scores?.[r.ranking[0]] ?? -1;
const touchRes = await touchSwipe();
const tThrows = throwsOf(touchRes.tel);
console.log(`touch swipe: idle throws ${touchRes.idle}, then ${tThrows.length}: ${tThrows[0] ?? "none"}`);
if (touchRes.errors.length) fail(`page errors (touch): ${touchRes.errors[0]}`);
if (touchRes.idle !== 0) fail(`a tap or a downward flick threw ${touchRes.idle} pie(s)`);
if (tThrows.length !== 1) fail(`a real touch swipe threw ${tThrows.length} pies (want 1)`);
if (!(num(tThrows[0], "a") > 0.03)) fail(`a swipe leaning right threw at angle ${num(tThrows[0], "a")}`);
if (!(num(tThrows[0], "p") > 0.1)) fail(`a swipe threw with power ${num(tThrows[0], "p")}`);
if (process.env.PROBE_ONLY === "touch") {
  console.log("PASS touch only");
  await browser.close();
  process.exit(0);
}

const runs = {};
for (const [key, level] of [["a", null], ["b", null], ["relaxed", "relaxed"], ["challenge", "challenge"]]) {
  runs[key] = await playRound(level);
  const r = runs[key];
  console.log(`run ${key}: ranking=${JSON.stringify(r.ranking)} scores=${JSON.stringify(r.tel?.scores)} served=${JSON.stringify(r.tel?.served)} wrong=${JSON.stringify(r.tel?.wrong)} thrown=${JSON.stringify(r.tel?.thrown)} t=${r.tel?.tFinish?.toFixed(2)}`);
  const ids = [...r.ranking].sort((x, y) => x - y);
  if (JSON.stringify(ids) !== "[0,1,2,3]") fail(`ranking is not all 4 ids (${key}): ${JSON.stringify(r.ranking)}`);
  const secs = r.tel?.tFinish ?? 0;
  if (secs < 30 || secs > 60) fail(`round lasted ${secs.toFixed(1)} s of game time (${key})`);
  if (r.errors.length) fail(`page errors (${key}): ${r.errors[0]}`);
}
if (JSON.stringify(runs.a.ranking) !== JSON.stringify(runs.b.ranking)) fail(`ranking differs between runs: ${JSON.stringify(runs.a.ranking)} vs ${JSON.stringify(runs.b.ranking)}`);
if (JSON.stringify(runs.a.tel?.scores) !== JSON.stringify(runs.b.tel?.scores)) fail("scores differ between runs");
if (winnerScore(runs.challenge) < winnerScore(runs.relaxed)) {
  fail(`Challenge winner ${winnerScore(runs.challenge)} < Relaxed winner ${winnerScore(runs.relaxed)}`);
}
if (!(winnerScore(runs.a) >= 6)) fail(`the Normal winner served only ${winnerScore(runs.a)} (the CPU should serve a handful)`);

const human = await humanThrow();
const keyThrows = throwsOf(human.tel);
console.log(`human: thrown=${JSON.stringify(human.tel?.thrown)} ${keyThrows[0] ?? "no throw"}`);
if (human.errors.length) fail(`page errors (human): ${human.errors[0]}`);
if (keyThrows.length !== 1) fail(`Up+Right and a held Space threw ${keyThrows.length} pies (want 1)`);
if (!(num(keyThrows[0], "p") > 0.4 && num(keyThrows[0], "p") < 0.95)) fail(`a ~0.65 s Space hold threw with power ${num(keyThrows[0], "p")}`);
if (!(num(keyThrows[0], "a") > 0.1)) fail(`Up+Right threw at angle ${num(keyThrows[0], "a")}`);
await browser.close();

// The camera must not move because of input (fixed camera, no shake).
// It needs 40 samples in 6 s, which a loaded software-GL box can miss by one: allow one retry.
const camScript = join(dirname(new URL(import.meta.url).pathname), "probe-camera-lock.mjs");
let cam = spawnSync("node", [camScript, ID], { encoding: "utf8" });
process.stdout.write(cam.stdout);
if (cam.status !== 0 && /only \d+ samples/.test(cam.stdout)) {
  cam = spawnSync("node", [camScript, ID], { encoding: "utf8" });
  process.stdout.write(cam.stdout);
}
if (cam.status !== 0) fail("camera lock probe failed");

console.log(`PASS ${ID} winner relaxed=${winnerScore(runs.relaxed)} normal=${winnerScore(runs.a)} challenge=${winnerScore(runs.challenge)}`);
