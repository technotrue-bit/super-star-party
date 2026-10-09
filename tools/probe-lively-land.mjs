// Lively landing probe.
//
// 1. Budget: at each phone width, a ?lively=0 page and a ?lively=1 page
//    settle on the same seed-7 board. The lively page then fires landing
//    reactions (blue coins, red puffs, green sparkles) on inner-loop spaces
//    so the ring and the particle pool are on screen. Extra draw calls and
//    triangles (peak lively=1 minus idle lively=0, from renderer.info via
//    __SSP__.perf()) must stay within budget, and so must the worst-case
//    cost of every lively mesh (__SSP__.lively().budget).
// 2. Real landings: forced dice + autoplay until the bus reports landings.
//    The lively page must count them; the lively=0 page must not react.
//
//   node tools/probe-lively-land.mjs
//   SSP_URL=http://127.0.0.1:5177 node tools/probe-lively-land.mjs
//
// Prints a JSON summary. Exits 1 on a failed check or a page error.
// Frame ms is reported, not gated: headless software GL is too noisy.
import { chromium } from "@playwright/test";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const URL = `${BASE}/?seed=7&screen=board&audio=0`;
const WIDTHS = [
  [390, 844],
  [430, 932],
];
const BUDGET = { drawCalls: 6, triangles: 8000 };
const SETTLE_MS = 4000;
const LAND_TIMEOUT_MS = 90000;

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`FAIL ${msg}`);
};

async function open(browser, w, h, flag) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
  await page.goto(`${URL}&lively=${flag}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state?.().screen === "board", null, { timeout: 30000 });
  await page.waitForTimeout(SETTLE_MS);
  const cam = await settle(page);
  return { context, page, errors, cam };
}

/**
 * Wait for the human's dice phase with the party camera at rest, so both
 * pages render the same frame apart from the lively additions.
 */
async function settle(page) {
  let last = null;
  let still = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const st = await page.evaluate(() => {
      const s = window.__SSP__.state();
      const m = s.match ?? {};
      const who = m.players?.[m.currentPlayer];
      // CPU seats roll on their own; only the local seat's dice phase holds still.
      const local = who ? (who.controller ?? (m.currentPlayer === 0 ? "local" : "cpu")) === "local" : false;
      return { phase: m.phase, local, cam: JSON.stringify(s.camera?.pos ?? null) };
    });
    const ready = st.phase === "dice" && st.local && st.cam === last;
    still = ready ? still + 1 : 0;
    last = st.cam;
    if (still >= 4) return st.cam;
    await page.waitForTimeout(250);
  }
  return last;
}

/** perf() for `frames` consecutive frames, optionally after fire() in the same task. */
function sampleFrames(page, frames, fire) {
  return page.evaluate(
    ({ frames, fire }) =>
      new Promise((resolve) => {
        if (fire) {
          // Inner-loop spaces sit mid-frame in both phone layouts.
          window.__SSP__.livelyReact(30, "blue");
          window.__SSP__.livelyReact(35, "green");
          window.__SSP__.livelyReact(38, "red");
        }
        const out = [];
        const tick = () => {
          const p = window.__SSP__.perf();
          const l = window.__SSP__.lively();
          out.push({ calls: p.calls, triangles: p.triangles, avgMs: p.avgMs, particles: l.activeParticles });
          if (out.length >= frames) resolve(out);
          else requestAnimationFrame(tick);
        };
        // Skip the frame in flight so every sample is a whole frame.
        requestAnimationFrame(() => requestAnimationFrame(tick));
      }),
    { frames, fire }
  );
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function measureWidth(browser, w, h) {
  // One page at a time: two software-GL pages rendering at once skew the ms.
  const off = await open(browser, w, h, 0);
  const idleOff = await sampleFrames(off.page, 30, false);
  const offLively = await off.page.evaluate(() => window.__SSP__.lively());
  await off.context.close();
  const on = await open(browser, w, h, 1);
  const idleOn = await sampleFrames(on.page, 30, false);
  const peak = await sampleFrames(on.page, 4, true);
  const worst = (await on.page.evaluate(() => window.__SSP__.lively())).budget;
  // Slice 2's crowd has its own budget (probe-lively-shots); take its worst
  // case out of the delta so this stays the slice 1 budget.
  const crowd = (await on.page.evaluate(() => window.__SSP__.livelyCrowd?.()))?.budget ?? { drawCalls: 0, triangles: 0 };
  if (off.cam !== on.cam) fail(`${w}px: camera differs between pages (${off.cam} vs ${on.cam}); calls are not comparable`);

  const baseCalls = median(idleOff.map((s) => s.calls));
  const baseTris = median(idleOff.map((s) => s.triangles));
  const withFx = peak.filter((s) => s.particles > 0);
  const peakCalls = Math.max(...peak.map((s) => s.calls));
  const peakTris = Math.max(...peak.map((s) => s.triangles));
  const row = {
    width: w,
    height: h,
    lively0: { calls: baseCalls, triangles: baseTris, avgMs: idleOff[idleOff.length - 1].avgMs },
    lively1Idle: {
      calls: median(idleOn.map((s) => s.calls)),
      triangles: median(idleOn.map((s) => s.triangles)),
      avgMs: idleOn[idleOn.length - 1].avgMs,
    },
    lively1Peak: { calls: peakCalls, triangles: peakTris, particles: Math.max(...peak.map((s) => s.particles)) },
    extra: { calls: peakCalls - baseCalls - crowd.drawCalls, triangles: peakTris - baseTris - crowd.triangles },
    crowd,
    worstCase: worst,
    errors: [...off.errors, ...on.errors],
  };
  row.extraAvgMs = +(row.lively1Idle.avgMs - row.lively0.avgMs).toFixed(2);

  if (offLively.active) fail(`${w}px: lively=0 page has lively active`);
  if (!worst) fail(`${w}px: lively=1 page reports no lively budget`);
  if (withFx.length === 0) fail(`${w}px: no sampled frame had live particles`);
  if (row.extra.calls > BUDGET.drawCalls) fail(`${w}px: ${row.extra.calls} extra draw calls > ${BUDGET.drawCalls}`);
  if (row.extra.triangles > BUDGET.triangles) fail(`${w}px: ${row.extra.triangles} extra triangles > ${BUDGET.triangles}`);
  if (worst && worst.drawCalls > BUDGET.drawCalls) fail(`${w}px: worst-case ${worst.drawCalls} draw calls > ${BUDGET.drawCalls}`);
  if (worst && worst.triangles > BUDGET.triangles) fail(`${w}px: worst-case ${worst.triangles} triangles > ${BUDGET.triangles}`);
  if (row.errors.length) fail(`${w}px: page errors ${JSON.stringify(row.errors)}`);
  console.log(`${w}x${h} ${JSON.stringify(row)}`);
  await on.context.close();
  return row;
}

/** Force dice and autoplay until the board has seen `want` landings. */
async function playLandings(page, want) {
  return page.evaluate(
    ({ want, timeout }) =>
      new Promise((resolve) => {
        const api = window.__SSP__;
        const lands0 = api.lively().busLands;
        const spaces0 = JSON.stringify(api.state().match.players.map((p) => p.space));
        const t0 = performance.now();
        api.autoplay(true);
        const tick = () => {
          const st = api.state();
          // Keep a short forced roll queued so every turn lands quickly.
          if (st.match?.phase === "dice" && window.__forcedDice === undefined) api.rollDice(2);
          const l = api.lively();
          const moved = JSON.stringify(st.match.players.map((p) => p.space)) !== spaces0;
          const done = l.active ? l.busLands - lands0 >= want : moved && performance.now() - t0 > 3000;
          if (done || performance.now() - t0 > timeout) {
            api.autoplay(false);
            resolve({ lively: l, moved, ms: Math.round(performance.now() - t0) });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { want, timeout: LAND_TIMEOUT_MS }
  );
}

const browser = await chromium.launch();
const summary = { url: URL, budget: BUDGET, widths: [], landings: null, ok: false };
try {
  for (const [w, h] of WIDTHS) summary.widths.push(await measureWidth(browser, w, h));

  const [w, h] = WIDTHS[0];
  const on = await open(browser, w, h, 1);
  const onLand = await playLandings(on.page, 2);
  await on.context.close();
  const off = await open(browser, w, h, 0);
  const offLand = await playLandings(off.page, 2);
  await off.context.close();
  const pages = { on, off };
  summary.landings = {
    lively1: {
      busLands: onLand.lively.busLands,
      lands: onLand.lively.lands,
      hops: onLand.lively.hops,
      lastLand: onLand.lively.lastLand,
      ms: onLand.ms,
    },
    lively0: { active: offLand.lively.active, busLands: offLand.lively.busLands, moved: offLand.moved, ms: offLand.ms },
  };
  if (onLand.lively.busLands < 2) fail(`lively=1 saw ${onLand.lively.busLands} bus landings, want 2`);
  if (onLand.lively.hops < 2) fail(`lively=1 saw ${onLand.lively.hops} hop dips, want at least 2`);
  if (!onLand.lively.lastLand) fail("lively=1 has no lastLand");
  if (offLand.lively.active || offLand.lively.busLands !== 0) fail("lively=0 reacted to a landing");
  if (!offLand.moved) fail("lively=0 page never moved a player");
  const errs = [...pages.on.errors, ...pages.off.errors];
  if (errs.length) fail(`page errors during landings ${JSON.stringify(errs)}`);
} finally {
  await browser.close();
}

summary.ok = failures.length === 0;
summary.failures = failures;
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
