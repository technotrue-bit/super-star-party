// Probe: Row Row Rumble (twin, ~40 s, 2v2 canoe race).
// Runs the game with ?seed=7&autoplay=1&audio=0&minigame=row_rumble and asserts:
//   - the ranking has all 4 ids, and is identical on two Normal runs (same seed)
//   - the winning team's two ids lead the ranking
//   - the round lasts 30-60 s of game time (the game's own clock)
//   - no page errors
//   - the follow-camera probe passes (steady glide down-river, never backwards, no shake)
//   - at Relaxed and at Challenge the round still ends with a full ranking, and the
//     Challenge pace (race distance / winner's time) is at least the Relaxed pace
//   - the keyboard twin pad (Z/X): a good alternation lands strokes, the same side twice is a
//     stroke-less yaw kick, and mashing faster than 0.25 s lands nothing
//   - REAL touch (CDP touch events on the two twin buttons): a tap on each registers one press,
//     and two fingers at once (A held while B goes down, then A again while B is held) register
//     three presses, each finger tracked on its own
// The sim is stepped with __SSP__.advance (60 Hz frames) so a slow headless GPU does not
// stretch the wall clock. Prints PASS or FAIL <reason>; exit code 1 on any failure.
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ID = "row_rumble";
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
  const tel = await page.evaluate(() => window.__ROWRUMBLE__ ?? null);
  await ctx.close();
  return { ranking: probe.ranking, frames, tel, errors };
}

/**
 * A human round on the keyboard, driven inside single evaluates so the sim clock is exact:
 * the gap between two presses is the number of advanced frames / 60.
 */
async function keyboardRound() {
  const { page, ctx, errors } = await openRound(null, { autoplay: false });
  const out = await page.evaluate(() => {
    const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
    const tap = (k) => {
      key("keydown", k);
      key("keyup", k);
    };
    const adv = (n) => window.__SSP__.advance(n);
    const me = () => window.__ROWRUMBLE__.human;
    const read = () => {
      const t = window.__ROWRUMBLE__;
      const i = t.human;
      return { strokes: t.strokes[i], same: t.same[i], rushed: t.rushed[i], late: t.late[i], presses: t.presses[i], yaw: t.yaw[t.teamOf[i]] };
    };
    adv(30);
    const start = read();
    // Z, X, Z, X, Z with 0.4 s between presses: the first starts the rhythm, the rest are strokes.
    tap("z");
    adv(24);
    tap("x");
    adv(24);
    tap("z");
    adv(24);
    tap("x");
    adv(24);
    tap("z");
    adv(2);
    const good = read();
    // Mashing X, Z, X, Z every 6 frames (0.1 s) after a pause: faster than 0.25 s lands nothing.
    adv(60);
    const before = read();
    tap("x");
    adv(6);
    tap("z");
    adv(6);
    tap("x");
    adv(6);
    tap("z");
    adv(6);
    const mash = read();
    // Same side twice (arrow keys this time): a stroke-less yaw kick.
    adv(60);
    tap("ArrowLeft");
    adv(24);
    const afterOne = read();
    tap("ArrowLeft");
    adv(2);
    const afterTwo = read();
    return { human: me(), start, good, before, mash, afterOne, afterTwo };
  });
  await ctx.close();
  return { out, errors };
}

/**
 * A phone round: real touch events (CDP) on the two twin buttons. Each finger is its own
 * pointer, so A held while B goes down is two presses, not one.
 */
async function touchTwin() {
  const { page, ctx, errors } = await openRound(null, { autoplay: false, touch: true });
  const cdp = await ctx.newCDPSession(page);
  const rects = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, shown: getComputedStyle(el).display !== "none" };
    };
    return { a: r(".ssp-twin--a"), b: r(".ssp-twin--b") };
  });
  if (!rects.a?.shown || !rects.b?.shown) fail("touch: the two twin buttons are not shown");
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const pt = (which, id) => ({ x: rects[which].x, y: rects[which].y, id });
  const presses = () => page.evaluate(() => {
    window.__SSP__.advance(3);
    const t = window.__ROWRUMBLE__;
    return { n: t.presses[t.human], a: t.edges.a, b: t.edges.b };
  });
  await page.evaluate(() => window.__SSP__.advance(30));
  const p0 = await presses();

  // One finger taps A, then another taps B.
  await send("touchStart", [pt("a", 1)]);
  await send("touchEnd", [pt("a", 1)]);
  await page.evaluate(() => window.__SSP__.advance(24));
  await send("touchStart", [pt("b", 2)]);
  await send("touchEnd", [pt("b", 2)]);
  const p1 = await presses();

  // Two fingers: A goes down and stays; B goes down on top; A lifts and goes down again
  // (CDP touchEnd releases the points it lists).
  await page.evaluate(() => window.__SSP__.advance(24));
  await send("touchStart", [pt("a", 3)]);
  await send("touchStart", [pt("a", 3), pt("b", 4)]);
  await send("touchEnd", [pt("a", 3)]);
  await send("touchStart", [pt("b", 4), pt("a", 5)]);
  await send("touchEnd", [pt("b", 4), pt("a", 5)]);
  const p2 = await presses();
  await ctx.close();
  return { p0, p1, p2, errors };
}

const num = (v) => (typeof v === "number" ? v : NaN);
const pace = (r) => num(r.tel?.pace?.[r.tel?.winnerTeam]);

const touch = await touchTwin();
console.log(`touch twin: presses ${touch.p0.n} -> ${touch.p1.n} (two taps) -> ${touch.p2.n} (two fingers); edges a=${touch.p2.a} b=${touch.p2.b}`);
if (touch.errors.length) fail(`page errors (touch): ${touch.errors[0]}`);
if (touch.p1.n - touch.p0.n !== 2) fail(`a tap on A and a tap on B registered ${touch.p1.n - touch.p0.n} presses (want 2)`);
if (touch.p1.a - touch.p0.a !== 1 || touch.p1.b - touch.p0.b !== 1) fail("the taps did not land one on each button");
if (touch.p2.n - touch.p1.n !== 3) fail(`two fingers on A and B registered ${touch.p2.n - touch.p1.n} presses (want 3)`);
if (touch.p2.a - touch.p1.a !== 2 || touch.p2.b - touch.p1.b !== 1) fail("the two-finger presses did not split two on A and one on B");
if (process.env.PROBE_ONLY === "touch") {
  console.log("PASS touch only");
  await browser.close();
  process.exit(0);
}

const kb = await keyboardRound();
const k = kb.out;
console.log(`keyboard: start=${JSON.stringify(k.start)} good=${JSON.stringify(k.good)} mash=${JSON.stringify(k.mash)} one=${JSON.stringify(k.afterOne)} two=${JSON.stringify(k.afterTwo)}`);
if (kb.errors.length) fail(`page errors (keyboard): ${kb.errors[0]}`);
if (k.good.presses - k.start.presses !== 5) fail(`five Z/X taps registered ${k.good.presses - k.start.presses} presses`);
if (k.good.strokes - k.start.strokes < 3) fail(`a steady Z X Z X Z landed only ${k.good.strokes - k.start.strokes} strokes (want 3 or more)`);
if (k.mash.strokes !== k.before.strokes) fail(`mashing every 0.1 s landed ${k.mash.strokes - k.before.strokes} strokes (want 0)`);
if (k.mash.rushed - k.before.rushed < 2) fail(`mashing counted only ${k.mash.rushed - k.before.rushed} rushed presses`);
if (k.afterTwo.same !== k.afterOne.same + 1) fail("the same side twice did not count as a same-side press");
if (k.afterTwo.strokes !== k.afterOne.strokes) fail("the same side twice landed a stroke");
if (!(Math.abs(k.afterTwo.yaw - k.afterOne.yaw) > 0.05)) fail(`the same side twice turned the canoe by ${Math.abs(k.afterTwo.yaw - k.afterOne.yaw).toFixed(3)} rad`);

const runs = {};
for (const [key, level] of [["a", null], ["b", null], ["relaxed", "relaxed"], ["challenge", "challenge"]]) {
  runs[key] = await playRound(level);
  const r = runs[key];
  console.log(`run ${key}: ranking=${JSON.stringify(r.ranking)} winnerTeam=${r.tel?.winnerTeam} dist=${JSON.stringify(r.tel?.dist?.map((d) => Math.round(d)))} pace=${JSON.stringify(r.tel?.pace?.map((p) => Math.round(p * 100) / 100))} strokes=${JSON.stringify(r.tel?.strokes)} bumps=${JSON.stringify(r.tel?.bumps)} t=${r.tel?.tFinish?.toFixed(2)}`);
  const ids = [...r.ranking].sort((x, y) => x - y);
  if (JSON.stringify(ids) !== "[0,1,2,3]") fail(`ranking is not all 4 ids (${key}): ${JSON.stringify(r.ranking)}`);
  const win = r.tel?.teams?.[r.tel.winnerTeam] ?? [];
  if (JSON.stringify([...r.ranking.slice(0, 2)].sort()) !== JSON.stringify([...win].sort())) fail(`the winning team ${JSON.stringify(win)} does not lead the ranking ${JSON.stringify(r.ranking)} (${key})`);
  if (JSON.stringify([...(r.tel?.coinWinners ?? [])].sort()) !== JSON.stringify([...win].sort())) fail(`coinWinners ${JSON.stringify(r.tel?.coinWinners)} is not the winning team (${key})`);
  const secs = r.tel?.tFinish ?? 0;
  if (secs < 30 || secs > 60) fail(`round lasted ${secs.toFixed(1)} s of game time (${key})`);
  if (r.errors.length) fail(`page errors (${key}): ${r.errors[0]}`);
}
if (JSON.stringify(runs.a.ranking) !== JSON.stringify(runs.b.ranking)) fail(`ranking differs between runs: ${JSON.stringify(runs.a.ranking)} vs ${JSON.stringify(runs.b.ranking)}`);
if (JSON.stringify(runs.a.tel?.dist) !== JSON.stringify(runs.b.tel?.dist)) fail("distances differ between runs");
if (!(pace(runs.challenge) >= pace(runs.relaxed))) {
  fail(`Challenge pace ${pace(runs.challenge)} < Relaxed pace ${pace(runs.relaxed)}`);
}
await browser.close();

// The camera must glide down the river and never move because of input (no shake).
// It needs 40 samples in 6 s, which a loaded software-GL box can miss by one: allow one retry.
const camScript = join(dirname(fileURLToPath(import.meta.url)), "probe-camera-lock.mjs");
let cam = spawnSync("node", [camScript, ID], { encoding: "utf8" });
process.stdout.write(cam.stdout);
if (cam.status !== 0 && /only \d+ samples/.test(cam.stdout)) {
  cam = spawnSync("node", [camScript, ID], { encoding: "utf8" });
  process.stdout.write(cam.stdout);
}
if (cam.status !== 0) fail("camera lock probe failed");

console.log(`PASS ${ID} pace relaxed=${pace(runs.relaxed).toFixed(2)} normal=${pace(runs.a).toFixed(2)} challenge=${pace(runs.challenge).toFixed(2)} m/s`);
