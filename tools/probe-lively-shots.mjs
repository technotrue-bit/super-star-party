// Lively shots probe: camera swoops and the crowd must never gate the turn loop.
//
// 1. Timing: seed 7 autoplays with ?lively=0 and ?lively=1, both with
//    ?fixedstep=1 so every frame advances the same game time. Match start
//    and minigames run on wall-clock timers, so each round is anchored at
//    its first turn:start; from there every beat (turn:start, dice:roll,
//    dice:land, player:land, match.phase changes) up to the minigame must
//    land on the same frame offset in both runs (a), and no turn may start
//    later with lively on (c).
// 2. Triggers: a fresh lively=1 page waits in the human's dice phase and
//    emits each trigger event on the bus; a shot of that kind must fire (b).
//    Then a burst of four events checks the queue stays bounded.
// 3. Crowd: worst-case crowd budget (__SSP__.livelyCrowd()) and the
//    renderer.info delta (perf()) between the settled lively=0/1 pages.
//
//   node tools/probe-lively-shots.mjs
//   SSP_TURNS=3 SSP_URL=http://127.0.0.1:5177 node tools/probe-lively-shots.mjs
//
// Prints a JSON summary. Exits 1 on a failed check or a page error.
import { chromium } from "@playwright/test";

const BASE = (process.env.SSP_URL ?? process.env.BASE ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const TURNS = Math.max(1, Number(process.env.SSP_TURNS ?? 2));
const RUN_URL = `${BASE}/?seed=7&screen=board&autoplay=1&audio=0&speed=4&fixedstep=1`;
const IDLE_URL = `${BASE}/?seed=7&screen=board&audio=0`;
const CAP_MS = Number(process.env.SSP_CAP_MS ?? TURNS * 150000 + 60000);
const TOL_FRAMES = Number(process.env.SSP_TOL_FRAMES ?? 0);
const CROWD_BUDGET = { drawCalls: 2, triangles: 6000 };
const TRIGGERS = [
  ["star", "star:buy", { player: 0, star: 1, total: 0, bought: 1, spent: 0 }],
  ["balloon", "star:balloon_moved", { from: 0, to: 12, by: 0 }],
  ["happening", "happening:event", { player: 0, eventId: "probe", label: "PROBE" }],
  ["jackpot", "stamp:jackpot", { player: 0, amount: 0 }],
  ["hug", "squeeze:hug", { space: 0, players: [0, 1], coins: 0 }],
  ["last5", "turn:start", null], // turn filled in from match.totalTurns
];

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`FAIL ${msg}`);
};

async function open(browser, url, w = 390, h = 844) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.phaseLog && window.__SSP__?.livelyShots, null, { timeout: 30000 });
  return { context, page, errors };
}

/** Autoplay until round TURNS + 1 starts (or the finale). */
async function run(browser, flag, label) {
  const { context, page, errors } = await open(browser, `${RUN_URL}&lively=${flag}`);
  const t0 = Date.now();
  let log = [];
  let reported = 0;
  while (Date.now() - t0 < CAP_MS) {
    await page.evaluate(() => document.querySelector("#mg-start-btn")?.click());
    log = await page.evaluate(() => window.__SSP__.phaseLog());
    const rounds = new Set(log.filter((m) => m.event === "turn:start").map((m) => m.turn));
    if (rounds.size > reported) {
      reported = rounds.size;
      console.log(`${label} round ${Math.max(...rounds)} started at ${Date.now() - t0}ms`);
    }
    if (rounds.has(TURNS + 1)) break;
    if ((await page.evaluate(() => window.__SSP__.state().screen)) === "finale") break;
    await page.waitForTimeout(150);
  }
  const shots = await page.evaluate(() => window.__SSP__.livelyShots());
  const crowd = await page.evaluate(() => window.__SSP__.livelyCrowd());
  await context.close();
  return { log, shots, crowd, errors, ms: Date.now() - t0 };
}

/** Beats of one round, as frame offsets from its first turn:start, up to the minigame. */
function roundBeats(log, turn) {
  const start = log.findIndex((m) => m.event === "turn:start" && m.turn === turn);
  if (start < 0) return null;
  const f0 = log[start].frame;
  const t0 = log[start].t;
  const out = [];
  for (let i = start; i < log.length; i++) {
    const m = log[i];
    if (m.event === "minigame:start" || m.event === "phase:minigame" || m.turn !== turn) break;
    out.push({ ev: m.event, p: m.player, df: m.frame - f0, dt: +(m.t - t0).toFixed(3) });
  }
  return out;
}

/** Wait for the local seat's dice phase with the camera still. */
async function settle(page) {
  let last = null;
  let still = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
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

async function triggers(browser) {
  const { context, page, errors } = await open(browser, `${IDLE_URL}&lively=1`);
  const out = { settled: await settle(page), fired: {}, burst: null, perf: null, crowd: null };
  out.perf = await page.evaluate(() => window.__SSP__.perf());
  for (const [kind, event, payload] of TRIGGERS) {
    const before = await page.evaluate(() => window.__SSP__.livelyShots());
    await page.evaluate(
      ({ event, payload }) => {
        const m = window.__SSP__.state().match;
        const body = payload ?? { turn: m.totalTurns - 4, player: m.currentPlayer };
        window.__SSP__.emit(event, body);
      },
      { event, payload }
    );
    let fired = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const s = await page.evaluate(() => window.__SSP__.livelyShots());
      if (s.byKind[kind] > before.byKind[kind]) fired = true;
      if (fired && s.active === null && s.queued === 0) break;
      await page.waitForTimeout(100);
    }
    out.fired[kind] = fired;
  }
  // Burst: four triggers in one task. Shots start on the next render frame, so
  // two queue and the two oldest drop; a frame later one is playing.
  const pre = await page.evaluate(() => window.__SSP__.livelyShots());
  out.burst = await page.evaluate(() => {
    const e = window.__SSP__.emit;
    e("star:buy", { player: 0, star: 1, total: 0, bought: 1, spent: 0 });
    e("stamp:jackpot", { player: 0, amount: 0 });
    e("squeeze:hug", { space: 0, players: [0, 1], coins: 0 });
    e("star:balloon_moved", { from: 0, to: 12, by: 0 });
    return window.__SSP__.livelyShots();
  });
  out.burst.newDrops = out.burst.dropped - pre.dropped;
  await page.waitForTimeout(200);
  out.burst.next = await page.evaluate(() => window.__SSP__.livelyShots());
  out.crowd = await page.evaluate(() => window.__SSP__.livelyCrowd());
  await context.close();
  return { ...out, errors };
}

async function offBaseline(browser) {
  const { context, page, errors } = await open(browser, `${IDLE_URL}&lively=0`);
  await settle(page);
  const perf = await page.evaluate(() => window.__SSP__.perf());
  const shots = await page.evaluate(() => window.__SSP__.livelyShots());
  const crowd = await page.evaluate(() => window.__SSP__.livelyCrowd());
  await context.close();
  return { perf, shots, crowd, errors };
}

const browser = await chromium.launch();
const summary = { url: RUN_URL, turns: TURNS, rounds: [], turnStarts: [] };
try {
  const [off, on] = await Promise.all([run(browser, 0, "lively=0"), run(browser, 1, "lively=1")]);
  console.log(`lively=0 ${off.ms}ms, lively=1 ${on.ms}ms`);
  for (const r of [off, on]) if (r.errors.length) fail(`page errors ${JSON.stringify(r.errors)}`);
  if (off.shots.enabled || off.shots.wired || off.crowd.active) fail(`lively=0 created shots/crowd: ${JSON.stringify([off.shots, off.crowd.active])}`);

  // (a) same beats on the same frames, (c) no turn starts later with lively on
  for (let turn = 1; turn <= TURNS; turn++) {
    const a = roundBeats(off.log, turn);
    const b = roundBeats(on.log, turn);
    if (!a || !b || a.length === 0) {
      fail(`round ${turn} missing off=${a?.length} on=${b?.length}`);
      continue;
    }
    const sig = (xs) => xs.map((x) => `${x.ev}/${x.p}@${x.df}`);
    const same = JSON.stringify(sig(a)) === JSON.stringify(sig(b));
    if (!same) {
      const i = sig(a).findIndex((s, k) => s !== sig(b)[k]);
      fail(`round ${turn} beats differ at #${i}: off=${sig(a)[i]} on=${sig(b)[i]}`);
    }
    const starts = (xs) => xs.filter((x) => x.ev === "turn:start");
    const sa = starts(a);
    const sb = starts(b);
    for (let k = 0; k < Math.max(sa.length, sb.length); k++) {
      const row = { turn, player: sa[k]?.p ?? sb[k]?.p, offFrame: sa[k]?.df ?? null, onFrame: sb[k]?.df ?? null };
      summary.turnStarts.push(row);
      if (row.offFrame == null || row.onFrame == null) fail(`round ${turn} turn ${k} start missing`);
      else if (row.onFrame > row.offFrame + TOL_FRAMES) fail(`round ${turn} player ${row.player} starts ${row.onFrame - row.offFrame} frames late with lively on`);
    }
    summary.rounds.push({ turn, beats: a.length, frames: a[a.length - 1].df, sameFrames: same });
    console.log(`round ${turn}: ${a.length} beats over ${a[a.length - 1].df} frames, ${same ? "same frames" : "FRAMES DIFFER"}`);
  }
  summary.runShots = on.shots;

  // (b) every trigger fires a shot; the queue stays bounded
  const [trig, base] = await Promise.all([triggers(browser), offBaseline(browser)]);
  for (const r of [trig, base]) if (r.errors.length) fail(`page errors ${JSON.stringify(r.errors)}`);
  if (!trig.settled) fail("trigger page never settled in the dice phase");
  for (const [kind] of TRIGGERS) if (!trig.fired[kind]) fail(`no ${kind} shot fired`);
  if (trig.burst.queued !== 2 || trig.burst.newDrops !== 2 || !trig.burst.next.active || trig.burst.next.queued > 1) fail(`burst not bounded: ${JSON.stringify(trig.burst)}`);
  summary.triggers = trig.fired;
  summary.burst = { queued: trig.burst.queued, dropped: trig.burst.newDrops, nextActive: trig.burst.next.active, nextQueued: trig.burst.next.queued };

  // crowd cost
  const budget = trig.crowd.budget;
  if (!budget) fail("crowd missing on the lively=1 page");
  else if (budget.drawCalls > CROWD_BUDGET.drawCalls || budget.triangles > CROWD_BUDGET.triangles) fail(`crowd over budget ${JSON.stringify(budget)}`);
  summary.crowd = {
    budget,
    perfOn: { calls: trig.perf.calls, triangles: trig.perf.triangles, avgMs: trig.perf.avgMs },
    perfOff: { calls: base.perf.calls, triangles: base.perf.triangles, avgMs: base.perf.avgMs },
    note: "perf delta = all lively additions (slice 1 + 2) in the settled dice frame; budget = crowd alone, worst case",
  };
} catch (err) {
  fail(String(err?.stack ?? err).slice(0, 400));
} finally {
  await browser.close();
}
summary.ok = failures.length === 0;
summary.failures = failures;
console.log(JSON.stringify(summary));
process.exit(failures.length ? 1 : 0);
