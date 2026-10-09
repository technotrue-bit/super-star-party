// Lively night probe: day -> dusk -> night, the LAST 5 marquee, and the lazy
// fireworks chunk (slice 3).
//
// Turns are reached with __SSP__.livelyNightTurn(n): it lights the board as if
// match.turn were n (cosmetic only, match state untouched), so turn 8 and 10
// of the 10-turn match take seconds instead of a full playthrough.
//
// 1. Off page (?lively=0): no time-of-day change, no marquee, no fireworks
//    request, even with the override at 10. Its minigame rig is the baseline.
// 2. Day page (?lively=1, turn 1): the board rig equals the off page's, and a
//    minigame opened from turn 1 gets the baseline rig.
// 3. Night page (?lively=1) at each phone width: turn 1 day, 5 dusk (no
//    fireworks yet), 6 (chunk fetched), 8 and 10 night. At 8 and 10 the hemi,
//    key, fog, and background differ from turn 1 (a); the fireworks chunk is
//    requested exactly once per page and never before the last five (b);
//    fireworks <= 2 draw calls, <= 256 instances, and the whole lively
//    renderer.info delta vs the off page stays in budget (c). Then a minigame
//    opened from the night board must get the baseline rig (d), and the
//    board after it must not fetch the chunk again.
// 4. Reduced motion: no fireworks chunk, marquee static.
//
//   node tools/probe-lively-night.mjs
//   SSP_BROWSER=webkit SSP_URL=http://127.0.0.1:5177 node tools/probe-lively-night.mjs
//
// Screenshots (day, dusk, night, last-5 fireworks at 390x844 and 430x932) go
// to SSP_SHOTS. Prints a JSON summary. Exits 1 on a failed check or a page error.
import { chromium, webkit } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const SHOTS = process.env.SSP_SHOTS ?? "/workspace/ssp-lively-s3-shots";
const BROWSER = (process.env.SSP_BROWSER ?? "chromium").toLowerCase();
const URL = `${BASE}/?seed=7&screen=board&audio=0`;
// Off/day/reduced-motion pages run fast; the night pages run at speed 1 so a
// burst lives ~1.8 s of wall clock and the screenshot can catch it.
const FAST = "&speed=4";
const WIDTHS = [
  [390, 844],
  [430, 932],
];
const FIREWORKS_RE = /\/fireworks(\.ts|-[\w-]+\.js)(\?|$)/;
// Whole lively delta over the plain board: slice 1 (6 calls) + crowd (2) + night (2).
const LIVELY_BUDGET = { drawCalls: 10, triangles: 20000 };
const FIREWORKS_BUDGET = { drawCalls: 1, instances: 256 };
// Slice 3's own group (string lights + fireworks), worst case.
const NIGHT_BUDGET = { drawCalls: 2, triangles: 1500 };
// Sparks that must be on screen (projected to NDC) when the fireworks shot is taken.
const MIN_IN_FRUSTUM = 20;

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`FAIL ${msg}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function open(browser, flag, w, h, opts = {}) {
  const { slow, ...ctxOpts } = opts;
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, ...ctxOpts });
  const page = await context.newPage();
  const errors = [];
  const fireworks = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
  page.on("request", (r) => {
    if (FIREWORKS_RE.test(r.url())) fireworks.push(r.url());
  });
  await page.goto(`${URL}&lively=${flag}${opts.slow ? "" : FAST}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state?.().screen === "board" && window.__SSP__?.livelyNight, null, { timeout: 30000 });
  await settle(page);
  return { context, page, errors, fireworks };
}

/** The human's dice phase with the camera at rest (same frame on every page). */
async function settle(page) {
  let last = null;
  let still = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const st = await page.evaluate(() => {
      const s = window.__SSP__.state();
      const m = s.match ?? {};
      return { phase: m.phase, local: m.currentPlayer === 0, cam: JSON.stringify(s.camera?.pos ?? null) };
    });
    const ready = st.phase === "dice" && st.local && st.cam === last;
    still = ready ? still + 1 : 0;
    last = st.cam;
    if (still >= 4) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const night = (page) => page.evaluate(() => window.__SSP__.livelyNight());

/** Poll livelyNight() until pred(n) holds. Returns false on timeout. */
async function waitNight(page, pred, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pred(await night(page))) return true;
    await page.waitForTimeout(150);
  }
  return false;
}
const rig = (page) => page.evaluate(() => window.__SSP__.sceneRig());
const marquee = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".ssp-last5");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, still: el.classList.contains("ssp-last5--still"), anim: getComputedStyle(el.querySelector(".ssp-last5__bulbs")).animationName };
  });

/** Set the lit turn and wait for the eased look to arrive. */
async function goTurn(page, turn) {
  await page.evaluate((t) => window.__SSP__.livelyNightTurn(t), turn);
  const t0 = Date.now();
  let n = null;
  // The ease runs on game time; a loaded box drops frames (dt clamps at 1/20 s),
  // so give it a long wall-clock window rather than a looser tolerance.
  while (Date.now() - t0 < 90000) {
    n = await night(page);
    if (!n.live) return n;
    if (n.live.turn === turn && Math.abs(n.live.progress - n.live.targetProgress) < 1e-3) return n;
    await page.waitForTimeout(150);
  }
  fail(`turn ${turn}: light never settled ${JSON.stringify(n?.live)}`);
  return n;
}

/** Max renderer.info over a few frames (fireworks come and go). */
function peakPerf(page, frames = 40) {
  return page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        let calls = 0;
        let triangles = 0;
        let k = 0;
        const step = () => {
          const p = window.__SSP__.perf();
          calls = Math.max(calls, p.calls);
          triangles = Math.max(triangles, p.triangles);
          if (++k >= frames) resolve({ calls, triangles });
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    frames
  );
}

/** Open a minigame from the board and return the shared scene rig once its lights are in. */
async function minigameRig(page, id) {
  await page.evaluate((id) => window.__SSP__.openMinigame(id), id);
  await page.waitForFunction(() => window.__SSP__.state().screen === "minigame" && !window.__SSP__.state().isWiping, null, { timeout: 30000 });
  // The arena adds its own hemi + key on build; wait for them.
  await page.waitForFunction(() => window.__SSP__.sceneRig().lights.length >= 4, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  return rig(page);
}

async function shoot(page, w, h, name) {
  const file = join(SHOTS, `night-${w}x${h}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

const pickRig = (n) => ({ hemi: n.live.hemi, key: n.live.key, fog: n.live.fog, background: n.live.background });

const browserType = BROWSER === "webkit" ? webkit : chromium;
const browser = await browserType.launch();
const summary = { url: URL, browser: BROWSER, shots: [], widths: [] };
mkdirSync(SHOTS, { recursive: true });

try {
  const [w0, h0] = WIDTHS[0];

  // ---- 1. off page: plain board, baseline minigame rig -----------------------------
  const off = await open(browser, 0, w0, h0);
  const offBoardRig = await rig(off.page);
  const offPerf = await peakPerf(off.page);
  const offNight = await off.page.evaluate(() => window.__SSP__.livelyNightTurn(10));
  await off.page.waitForTimeout(2500);
  const offBoardRig10 = await rig(off.page);
  if (offNight.active) fail("lively=0 created the night controller");
  if (!same(offBoardRig, offBoardRig10)) fail(`lively=0 rig changed with the override: ${JSON.stringify(offBoardRig10)}`);
  if (await marquee(off.page)) fail("lively=0 shows the LAST 5 marquee");
  await off.page.evaluate(() => window.__SSP__.livelyNightTurn(null));
  const catalog = await off.page.evaluate(() => window.__SSP__.state().minigameRules.catalog.map((c) => c.id));
  const mgId = process.env.SSP_MINIGAME ?? catalog[0];
  const baseRig = await minigameRig(off.page, mgId);
  if (off.fireworks.length) fail(`lively=0 fetched the fireworks chunk: ${off.fireworks}`);
  summary.off = { boardRig: offBoardRig, perf: offPerf, minigame: mgId, minigameRig: baseRig, fireworksRequests: off.fireworks.length };
  for (const e of off.errors) fail(`lively=0 page error ${e}`);
  await off.context.close();

  // ---- 2. day page: turn 1 board == plain board; turn 1 minigame rig ----------------
  const day = await open(browser, 1, w0, h0);
  const dayBoardRig = await rig(day.page);
  const dayNight = await night(day.page);
  if (!dayNight.active || dayNight.live.phase !== "day") fail(`turn 1 is not day: ${JSON.stringify(dayNight.live)}`);
  if (!same(dayBoardRig, offBoardRig)) fail(`turn 1 board rig differs from lively=0: ${JSON.stringify(dayBoardRig)}`);
  const dayMgRig = await minigameRig(day.page, mgId);
  if (!same(dayMgRig, baseRig)) fail(`turn 1 minigame rig differs from lively=0: ${JSON.stringify(dayMgRig)}`);
  if (day.fireworks.length) fail("turn 1 page fetched the fireworks chunk");
  for (const e of day.errors) fail(`day page error ${e}`);
  await day.context.close();

  // ---- 3. night pages ----------------------------------------------------------------
  for (const [w, h] of WIDTHS) {
    const tag = `${w}x${h}`;
    const row = { width: tag, turns: {}, fireworksRequests: 0 };
    const p = await open(browser, 1, w, h, { slow: true });
    const page = p.page;
    const t1 = await goTurn(page, 1);
    const t1Rig = pickRig(t1);
    row.turns[1] = { phase: t1.live.phase, ...t1Rig };
    summary.shots.push(await shoot(page, w, h, "day"));

    const t5 = await goTurn(page, 5);
    row.turns[5] = { phase: t5.live.phase, lampGlow: t5.live.lampGlow, marquee: t5.live.marquee };
    if (t5.live.phase !== "dusk") fail(`${tag} turn 5 phase ${t5.live.phase}`);
    if (t5.live.lampGlow <= 0) fail(`${tag} lamps not glowing at dusk`);
    await page.waitForTimeout(500);
    summary.shots.push(await shoot(page, w, h, "dusk"));
    if (p.fireworks.length) fail(`${tag} fireworks chunk fetched before the last five turns`);
    if (t5.live.marquee || (await marquee(page))) fail(`${tag} LAST 5 marquee shown on turn 5`);

    await goTurn(page, 6);
    if (!(await waitNight(page, (n) => n.chunk.loaded, 30000))) fail(`${tag} fireworks chunk never loaded on turn 6`);

    for (const turn of [8, 10]) {
      const n = await goTurn(page, turn);
      const r = pickRig(n);
      const differs = {
        hemi: !same(r.hemi, t1Rig.hemi),
        key: !same(r.key, t1Rig.key),
        fog: !same(r.fog, t1Rig.fog),
        background: r.background !== t1Rig.background,
      };
      for (const [k, v] of Object.entries(differs)) if (!v) fail(`${tag} turn ${turn} ${k} same as turn 1`);
      if (n.live.phase !== "night") fail(`${tag} turn ${turn} phase ${n.live.phase}`);
      if (!n.live.last5 || !n.live.marquee) fail(`${tag} turn ${turn} no LAST 5 marquee`);
      const nb = (await night(page)).budget;
      if (!nb || nb.drawCalls > NIGHT_BUDGET.drawCalls || nb.triangles > NIGHT_BUDGET.triangles) fail(`${tag} night group over budget ${JSON.stringify(nb)}`);
      const box = await marquee(page);
      if (box && (box.left < 0 || box.right > w)) fail(`${tag} marquee off screen ${JSON.stringify(box)}`);
      let shot = null;
      if (turn === 8) {
        summary.shots.push(await shoot(page, w, h, "night"));
      } else {
        // Wait for a burst the camera actually sees (shard centres projected to
        // NDC inside the frame, most in the upper half), shoot, and check the
        // sparks were still on screen after the capture. A few tries: the
        // follow camera may move between the check and the capture.
        for (let attempt = 0; attempt < 5 && !shot?.ok; attempt++) {
          const seen = await waitNight(page, (x) => {
            const f = x.live?.fireworks;
            return !!f && f.inFrustum >= MIN_IN_FRUSTUM && f.inUpperHalf >= MIN_IN_FRUSTUM / 2;
          });
          if (!seen) continue;
          const pre = (await night(page)).live.fireworks;
          const file = await shoot(page, w, h, "last5-fireworks");
          const post = (await night(page)).live.fireworks;
          shot = { attempt, pre: { inFrustum: pre.inFrustum, inUpperHalf: pre.inUpperHalf }, post: { inFrustum: post.inFrustum, inUpperHalf: post.inUpperHalf }, file };
          shot.ok = pre.inFrustum >= MIN_IN_FRUSTUM && post.inFrustum > 0;
        }
        if (!shot?.ok) fail(`${tag} no fireworks in the camera frustum at shot time ${JSON.stringify(shot)}`);
        else summary.shots.push(shot.file);
      }
      const fx = (await night(page)).live.fireworks;
      if (!fx || fx.drawCalls > FIREWORKS_BUDGET.drawCalls || fx.instances > FIREWORKS_BUDGET.instances) fail(`${tag} fireworks over budget ${JSON.stringify(fx)}`);
      row.turns[turn] = { phase: n.live.phase, ...r, lampGlow: n.live.lampGlow, differs, fireworks: fx, nightBudget: nb, marquee: box, shot };
    }

    // (c) whole lively delta at the same settled frame (390 only: the off page is 390).
    if (w === w0) {
      const onPerf = await peakPerf(page);
      const delta = { calls: onPerf.calls - offPerf.calls, triangles: onPerf.triangles - offPerf.triangles };
      row.perf = { on: onPerf, off: offPerf, delta };
      if (delta.calls > LIVELY_BUDGET.drawCalls || delta.triangles > LIVELY_BUDGET.triangles) fail(`${tag} lively delta over budget ${JSON.stringify(delta)}`);
    }

    // HUD clearance: the marquee must not overlap the chips, pause, or map buttons.
    const overlap = await page.evaluate(() => {
      const m = document.querySelector(".ssp-last5")?.getBoundingClientRect();
      if (!m) return [];
      const hits = [];
      for (const sel of [".ssp-hud-chip", ".ssp-pause-fab", ".ssp-map-fab", ".ssp-roll-wrap", ".ssp-item-bar"]) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || getComputedStyle(el).display === "none") continue;
          if (r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top) hits.push(sel);
        }
      }
      return hits;
    });
    if (overlap.length) fail(`${tag} marquee overlaps ${overlap.join(", ")}`);

    // (d) minigame after a night board == baseline
    if (w === w0) {
      const nightMgRig = await minigameRig(page, mgId);
      row.minigameRigSame = same(nightMgRig, baseRig);
      if (!row.minigameRigSame) fail(`${tag} minigame rig after night differs: ${JSON.stringify(nightMgRig)} vs ${JSON.stringify(baseRig)}`);
      // Back to the board: the cached chunk is reused, never fetched again.
      await page.evaluate(() => window.__SSP__.goto("board"));
      await page.waitForFunction(() => window.__SSP__.state().screen === "board", null, { timeout: 30000 });
      if (!(await waitNight(page, (n) => n.live?.fireworks != null))) fail(`${tag} fireworks not back on the board after the minigame`);
      row.backOnBoard = (await night(page)).live;
    }

    row.fireworksRequests = p.fireworks.length;
    if (p.fireworks.length !== 1) fail(`${tag} fireworks chunk requested ${p.fireworks.length} times: ${p.fireworks}`);
    row.chunk = (await night(page)).chunk;
    if (row.chunk.imports !== 1) fail(`${tag} fireworks import() ran ${row.chunk.imports} times`);
    for (const e of p.errors) fail(`${tag} page error ${e}`);
    summary.widths.push(row);
    await p.context.close();
  }

  // ---- 4. reduced motion --------------------------------------------------------------
  const rm = await open(browser, 1, w0, h0, { reducedMotion: "reduce" });
  const rmN = await goTurn(rm.page, 10);
  await rm.page.waitForTimeout(1500);
  const rmBox = await marquee(rm.page);
  summary.reducedMotion = { phase: rmN.live?.phase, marquee: rmBox, fireworksRequests: rm.fireworks.length };
  if (rm.fireworks.length) fail("reduced motion fetched the fireworks chunk");
  if (!rmBox || !rmBox.still || rmBox.anim !== "none") fail(`reduced motion marquee not static: ${JSON.stringify(rmBox)}`);
  if (rmN.live?.phase !== "night") fail("reduced motion: no lighting change");
  for (const e of rm.errors) fail(`reduced-motion page error ${e}`);
  await rm.context.close();
} catch (err) {
  fail(String(err?.stack ?? err).slice(0, 400));
} finally {
  await browser.close();
}

summary.ok = failures.length === 0;
summary.failures = failures;
console.log(JSON.stringify(summary, null, 1));
process.exit(failures.length ? 1 : 0);
