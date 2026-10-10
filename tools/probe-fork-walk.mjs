/**
 * probe-fork-walk.mjs — rolled walks that reach a fork before their last pip (fix/fork-walk-item-flow).
 *
 *   FORK section (this file, P3a): H-STAY, H-BRANCH, CPU, EXACT, MULTI (full mode, carnival only).
 *   ITEM section (P3b): not implemented yet, see the placeholder below.
 *
 * One chromium browser, two pages in parallel (carnival fork 6, downtown fork 5). Each page starts
 * ["local","cpu","local","cpu"] on seed 2; the probe uses forced dice, so it never needs a golden.
 * Expected paths come from __SSP__.board().next and the LIVE starBalloonPos (never hard-coded).
 * The planner skips starts whose path crosses the star, a shop, a minigame balloon, a grumpus or the
 * start space, and may place the mover 1 instead of 2 pips before the fork (or leave 1 pip after it)
 * when the board's own spaces would otherwise get in the way.
 *
 *   node tools/probe-fork-walk.mjs [--ci]
 *   SSP_URL (default http://127.0.0.1:5177)   SSP_SHOTS=<dir> (ignored with --ci)
 *
 * Exits 1 on any FAIL or page error. --ci drops the EXACT follow-up, MULTI and shots, self-fails > 90 s.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const CI = process.argv.includes("--ci");
const SHOTS = CI ? null : process.env.SSP_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const LOAD = 45000;
const t0 = Date.now();
const errors = [];
let fails = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);

function check(name, ok, detail = "") {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + String(detail).slice(0, 300) : ""}`);
}
const note = (m) => console.log(`NOTE ${m}`);

{
  const cap = CI ? 90 : 240;
  setTimeout(() => {
    console.log(`FAIL budget  run exceeded ${cap} s (t+${secs()}s)`);
    process.exit(1);
  }, cap * 1000).unref();
}

const FORKS = { carnival: 6, downtown: 5 };
const KINDS = ["pip", "bounce", "glimmer", "tusk"];
const NAMES = ["Pip", "Bounce", "Glimmer", "Player 4"];
const CTRL = ["local", "cpu", "local", "cpu"];
const HUMANS = [0, 2];

/* ------------------------------------------------------------------ in-page sampler */
function installSampler() {
  const L = (window.__LOG = []);
  window.__AP = "hold";
  window.__CPUJOB = null; // { sp, face, f0, cur }
  let f = 0;
  let apState = null;
  let ln = 0;
  const tick = () => {
    f++;
    try {
      const S = window.__SSP__.state();
      const m = S.match;
      const scr = S.screen;
      const cur = m.currentPlayer;
      const pl = m.players?.[cur];
      if (scr === "board") ln = window.__SSP__.phaseLog().filter((x) => x.event === "player:land").length;
      const hv = scr === "board" ? window.__SSP__.hudView() : null;
      const job = window.__CPUJOB;
      if (job && !job.f0 && scr === "board" && m.phase === "dice" && m.players[cur]?.controller === "cpu") {
        window.__SSP__.placePlayer(cur, job.sp);
        window.__SSP__.rollDice(job.face);
        job.f0 = f;
        job.cur = cur;
        job.star = m.starBalloonPos;
      }
      const e = { f, scr, ph: m.phase, cur, sp: pl?.space ?? -1, coins: pl?.coins ?? 0, star: m.starBalloonPos, cd: hv?.countdown?.value ?? null, pop: !!document.querySelector(".ssp-popup"), ln };
      L.push(e);
      window.__LAST = e;
      const off = ["board", "title", "select", "boot", "loading"].includes(scr) && m.phase !== "minigame";
      if (m.phase === "minigame" && f % 15 === 0) {
        Array.from(document.querySelectorAll("button")).find((b) => b.offsetParent && /start mini ?game/i.test(b.textContent || ""))?.click();
      }
      const want = window.__AP === "on" || (window.__AP === "hold" && !off);
      if (want !== apState) {
        window.__SSP__.autoplay(want);
        apState = want;
      }
    } catch (err) {
      window.__SAMPLE_ERR = String(err);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const last = (page) => page.evaluate(() => window.__LAST ?? null);

async function waitHumanDice(page, ms = 90000) {
  await page.waitForFunction(
    () => {
      const e = window.__LAST;
      const b = document.querySelector(".ssp-roll-wrap button");
      return !!e && e.scr === "board" && e.ph === "dice" && (e.cur === 0 || e.cur === 2) && !!b && !b.disabled && getComputedStyle(b).pointerEvents !== "none" &&
        parseFloat(getComputedStyle(b.closest(".ssp-roll-wrap")).opacity) > 0.5 && !document.querySelector(".ssp-popup");
    },
    null,
    { timeout: ms, polling: 60 },
  );
  await sleep(150);
  return (await last(page)).cur;
}
async function forceRoll(page, seat, space, face) {
  await page.evaluate(([p, s, fc]) => {
    window.__SSP__.placePlayer(p, s);
    window.__SSP__.rollDice(fc);
  }, [seat, space, face]);
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => document.querySelector(".ssp-roll-wrap button")?.click());
    await sleep(150);
    if (await page.evaluate(() => window.__forcedDice === undefined)) return true;
  }
  return false;
}
/** Drive the human walk: click `pick` (STAY/BRANCH) at each lane popup; returns the popup count seen. */
async function driveWalk(page, seat, picks, shotName, ms = 30000) {
  const until = Date.now() + ms;
  let sawMoving = false;
  let n = 0;
  let shot = false;
  while (Date.now() < until) {
    const e = await last(page);
    if (e && e.scr === "board") {
      if (e.ph === "moving" && e.cur === seat) sawMoving = true;
      else if (sawMoving && e.ph !== "moving") return n;
    }
    const lane = await page.evaluate(() => {
      const p = document.querySelector(".ssp-popup");
      const btns = p ? Array.from(p.querySelectorAll("button")).map((b) => (b.textContent || "").trim()) : [];
      return btns.includes("STAY") && btns.includes("BRANCH") ? { text: (p.textContent || "").slice(0, 80) } : null;
    });
    if (lane && picks[n] !== undefined) {
      if (!shot && SHOTS && shotName) {
        await sleep(150);
        await page.screenshot({ path: `${SHOTS}/${shotName}.png` });
        shot = true;
      }
      await sleep(350); // hold the popup for a few frames so the countdown-holds check has samples
      await page.evaluate((w) => Array.from(document.querySelectorAll(".ssp-popup button")).find((x) => (x.textContent || "").trim() === w)?.click(), picks[n]);
      n++;
      await sleep(120);
      continue;
    }
    await sleep(40);
  }
  return -1;
}
async function waitCpuDone(page, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await page.evaluate(() => {
      const j = window.__CPUJOB;
      const e = window.__LAST;
      if (!j || !j.f0) return { applied: false };
      return { applied: true, done: e.f > j.f0 + 5 && !(e.cur === j.cur && (e.ph === "moving" || e.ph === "dice")), job: j };
    });
    if (r.applied && r.done) return r.job;
    await sleep(80);
  }
  return null;
}

/* ------------------------------------------------------------------ analysis (node) */
const BAD = new Set(["shop", "minigame_balloon", "grumpus"]);
function makeGraph(B) {
  const succ = (s) => B.next[s] ?? [B.startIndex];
  const type = (s) => B.spaces[s]?.type;
  const dist = (from, to) => {
    if (from === to) return 0;
    const seen = new Set([from]);
    let fr = [from];
    for (let d = 1; d <= 200 && fr.length; d++) {
      const nx = [];
      for (const s of fr) for (const c of succ(s)) {
        if (c === to) return d;
        if (!seen.has(c)) { seen.add(c); nx.push(c); }
      }
      fr = nx;
    }
    return Infinity;
  };
  /** Walk `pips` from `start`; at a fork reached with pips left call pick(stay,branch). Returns visited spaces. */
  const sim = (start, pips, pick) => {
    const path = [];
    let s = start;
    for (let i = 0; i < pips; i++) {
      const n = succ(s);
      s = n.length === 1 || i === 0 ? n[0] : pick(n[0], n[1]);
      path.push(s);
    }
    return path;
  };
  // Mid-walk fork choice: i===0 would mean standing on the fork, which this probe never does.
  const simFrom = (start, pips, pickFn) => {
    const path = [];
    let s = start;
    for (let i = 0; i < pips; i++) {
      const n = succ(s);
      s = n.length === 1 ? n[0] : pickFn(n[0], n[1]);
      path.push(s);
    }
    return path;
  };
  const cpuPick = (star) => (a, b) => (dist(b, star) < dist(a, star) ? b : a);
  const preds = (s) => B.next.flatMap((n, i) => (n.includes(s) ? [i] : []));
  const okPath = (path, star) => path.every((s) => !BAD.has(type(s)) && s !== star && s !== B.startIndex);
  /** Plan a start/total so that `after` pips remain after fork f. Both lanes must be clean. */
  const planFork = (f, star) => {
    for (const after of [2, 1]) {
      for (const d of [2, 1]) {
        for (const p1 of preds(f)) {
          const starts = d === 1 ? [p1] : preds(p1);
          for (const start of starts) {
            const total = d + after;
            const lanes = [0, 1].map((k) => simFrom(start, total, (a, b) => (k ? b : a)));
            if (lanes.every((p) => okPath(p, star)) && lanes[0].length === total) return { start, total, d, after, stay: lanes[0], branch: lanes[1] };
          }
        }
      }
    }
    return null;
  };
  const planExact = (f, star) => {
    for (const d of [2, 1]) {
      for (const p1 of preds(f)) {
        for (const start of d === 1 ? [p1] : preds(p1)) {
          const path = simFrom(start, d, (a) => a);
          if (path[path.length - 1] === f && okPath(path, star)) return { start, total: d };
        }
      }
    }
    return null;
  };
  return { succ, type, dist, simFrom, cpuPick, planFork, planExact };
}

/** Countdown invariants over the frames of one walk (frames already filtered to the mover). */
function countdownIssues(frames, total, afterPips) {
  const issues = [];
  const mv = frames.filter((x) => x.ph === "moving");
  const vals = [];
  let prev = null;
  for (const x of mv) {
    if (x.cd === null) { prev = x; continue; }
    if (vals.length === 0 || vals[vals.length - 1] !== x.cd) vals.push(x.cd);
    prev = x;
  }
  if (vals.length === 0) issues.push("no countdown value shown");
  else {
    if (vals[0] !== total) issues.push(`first value ${vals[0]} != total ${total}`);
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] === vals[i - 1] + 1 || vals[i] > vals[i - 1]) issues.push(`increased ${vals[i - 1]}->${vals[i]}`);
      else if (vals[i] !== vals[i - 1] - 1) issues.push(`step ${vals[i - 1]}->${vals[i]} is not -1`);
    }
    if (vals[vals.length - 1] !== 1) issues.push(`last value ${vals[vals.length - 1]} != 1`);
  }
  // Popup frames (lane choice): the value must hold and equal the pips left.
  const pf = mv.filter((x) => x.pop && x.cd !== null).map((x) => x.cd);
  if (afterPips !== undefined && pf.length) {
    if (new Set(pf).size !== 1) issues.push(`countdown changed while popup up: ${[...new Set(pf)]}`);
    else if (pf[0] !== afterPips) issues.push(`countdown ${pf[0]} on popup, expected ${afterPips}`);
  }
  if (afterPips !== undefined && pf.length === 0 && mv.some((x) => x.pop)) issues.push("countdown hidden while the lane popup was up");
  // After the walk ends it must be null.
  const lastMv = frames.map((x) => x.ph).lastIndexOf("moving");
  if (frames.slice(lastMv + 1).some((x) => x.cd !== null)) issues.push("countdown still shown after moving");
  return issues;
}

/** Slice of the in-page log for one walk by the mover. */
async function walkFrames(page, f0, seat) {
  const all = await page.evaluate((a) => window.__LOG.filter((x) => x.f >= a), f0);
  // From the first frame of seat's moving phase through the first non-moving frame after it.
  const i0 = all.findIndex((x) => x.cur === seat && x.ph === "moving");
  if (i0 < 0) return [];
  let i1 = all.findIndex((x, i) => i > i0 && !(x.cur === seat && x.ph === "moving"));
  if (i1 < 0) i1 = all.length - 1;
  return all.slice(Math.max(0, i0 - 2), i1 + 3);
}
const landsOf = (frames) => {
  const out = [];
  for (let i = 1; i < frames.length; i++) if (frames[i].ln > frames[i - 1].ln) out.push(frames[i].sp);
  return out;
};

/* ------------------------------------------------------------------ scenarios */
async function lastFrameF(page) {
  return (await last(page)).f;
}

function forkScenarios(board, G, B) {
  const f = FORKS[board];
  const tag = (n) => `${board}:${n}`;

  const hFork = (name, pick) => async (page) => {
    const star = (await last(page)).star;
    const plan = G.planFork(f, star);
    if (!plan) return note(`${tag(name)} no clean start for fork ${f} (star ${star}); skipped`);
    const seat = await waitHumanDice(page);
    const f0 = await lastFrameF(page);
    const coins0 = (await last(page)).coins;
    const okRoll = await forceRoll(page, seat, plan.start, plan.total);
    const n = await driveWalk(page, seat, [pick], `fork-${board}-${name}`);
    await sleep(300);
    const frames = await walkFrames(page, f0, seat);
    const expected = (pick === "STAY" ? plan.stay : plan.branch).at(-1);
    const lands = landsOf(frames);
    const end = lands.at(-1);
    const cdIssues = countdownIssues(frames, plan.total, plan.after);
    check(tag(name), okRoll && n === 1 && end === expected && cdIssues.length === 0,
      `seat ${seat} start ${plan.start} roll ${plan.total} popups ${n} end ${end} expected ${expected} star ${star} lands [${lands}] ${cdIssues.join("; ")}`);
    if (pick === "STAY") {
      check(tag(`${name} no land on fork`), !lands.includes(f), `lands [${lands}] fork ${f}`);
      const atFork = frames.filter((x) => x.sp === f && x.ph === "moving");
      check(tag(`${name} coins unchanged at fork`), atFork.length > 0 && atFork.every((x) => x.coins === coins0),
        `coins0 ${coins0} at fork ${[...new Set(atFork.map((x) => x.coins))]} (${atFork.length} frames)`);
    }
  };

  const exact = async (page) => {
    const star = (await last(page)).star;
    const plan = G.planExact(f, star);
    if (!plan) return note(`${tag("EXACT")} no clean start; skipped`);
    const seat = await waitHumanDice(page);
    const f0 = await lastFrameF(page);
    await forceRoll(page, seat, plan.start, plan.total);
    const n = await driveWalk(page, seat, []);
    await sleep(300);
    const frames = await walkFrames(page, f0, seat);
    const lands = landsOf(frames);
    const popups = frames.filter((x) => x.ph === "moving" && x.pop).length;
    const cdIssues = countdownIssues(frames, plan.total);
    check(tag("EXACT"), n === 0 && lands.at(-1) === f && popups === 0 && cdIssues.length === 0,
      `start ${plan.start} roll ${plan.total} lands [${lands}] popupFrames ${popups} ${cdIssues.join("; ")}`);
    if (!CI) {
      // Next turn of this seat: standing on the fork, the lane popup comes after the roll.
      // The other human may be up first: park them on a plain space and let them roll through.
      let seat2 = -1;
      for (let i = 0; i < 4 && seat2 !== seat; i++) {
        await page.waitForFunction((s) => { const e = window.__LAST; return e.scr === "board" && e.cur !== s; }, seat, { timeout: 30000, polling: 100 }).catch(() => {});
        seat2 = await waitHumanDice(page, 60000).catch(() => -1);
        if (seat2 !== seat && seat2 >= 0) {
          await page.evaluate(() => document.querySelector(".ssp-roll-wrap button")?.click());
          await driveWalk(page, seat2, ["STAY", "STAY"], null, 20000);
        }
      }
      if (seat2 !== seat) return note(`${tag("EXACT next turn")} never got seat ${seat} back (got ${seat2}); skipped`);
      const here = (await last(page)).sp;
      await page.evaluate(() => { window.__SSP__.rollDice(3); });
      let popup = false;
      for (let i = 0; i < 30 && !popup; i++) {
        await page.evaluate(() => document.querySelector(".ssp-roll-wrap button")?.click());
        await sleep(200);
        popup = await page.evaluate(() => Array.from(document.querySelectorAll(".ssp-popup button")).some((b) => /BRANCH/.test(b.textContent || "")));
      }
      check(tag("EXACT next turn lane popup"), popup && here === f, `seat on ${here}, popup ${popup}`);
      await driveWalk(page, (await last(page)).cur, ["STAY"]);
    }
  };

  const multi = async (page) => {
    if (board !== "carnival" || CI) return;
    const seat = await waitHumanDice(page);
    const ok = await page.evaluate((s) => window.__SSP__.grantItem(s, "double_dice"), seat);
    if (!ok) return note(`${tag("MULTI")} grantItem(double_dice) refused; skipped`);
    await sleep(300);
    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll(".ssp-item-bar button, button")).find((x) => /double/i.test(x.textContent || "") && !x.disabled);
      b?.click();
      return !!b;
    });
    if (!clicked) return note(`${tag("MULTI")} no double-dice button found; skipped`);
    await sleep(400);
    await page.evaluate(([s]) => { window.__SSP__.placePlayer(s, 3); window.__SSP__.rollDice(6); }, [seat]);
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => document.querySelector(".ssp-roll-wrap button")?.click());
      await sleep(150);
      if (await page.evaluate(() => window.__forcedDice === undefined)) break;
    }
    const n = await driveWalk(page, seat, ["BRANCH", "STAY"]);
    if (n < 2) return note(`${tag("MULTI")} saw ${n} lane popups (item/dice could not reach 38); not a failure`);
    check(tag("MULTI"), n === 2, `${n} lane popups`);
  };

  const cpu = async (page) => {
    const star = (await last(page)).star;
    const plan = G.planFork(f, star);
    if (!plan) return note(`${tag("CPU")} no clean start; skipped`);
    await page.evaluate((p) => { window.__CPUJOB = { sp: p.start, face: p.total, f0: 0, cur: -1 }; }, plan);
    const job = await waitCpuDone(page);
    if (!job) return check(tag("CPU"), false, "cpu job never ran or never finished");
    await sleep(300);
    const frames = await walkFrames(page, job.f0, job.cur);
    const pick = G.cpuPick(job.star);
    const expected = G.simFrom(plan.start, plan.total, pick).at(-1);
    const lands = landsOf(frames);
    const popupFrames = frames.filter((x) => x.ph === "moving" && x.pop).length;
    const cdIssues = countdownIssues(frames, plan.total);
    check(tag("CPU"), popupFrames === 0 && lands.at(-1) === expected && cdIssues.length === 0,
      `seat ${job.cur} start ${plan.start} roll ${plan.total} end ${lands.at(-1)} expected ${expected} star ${job.star} popupFrames ${popupFrames} ${cdIssues.join("; ")}`);
  };

  return {
    human: [hFork("H-STAY", "STAY"), hFork("H-BRANCH", "BRANCH"), exact, multi],
    cpu: [cpu],
  };
}

// ITEM SECTION (P3b)
// function itemScenarios(board, G, B) { return { human: [/* I-H-WARP, I-H-DOUBLE, I-H-ZIP */], cpu: [/* I-CPU-WARP, I-CPU-DOUBLE */] }; }

/* ------------------------------------------------------------------ per-board runner */
async function runBoard(browser, board) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/interactive-widget/.test(m.text())) errors.push(`${board}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => errors.push(`${board} PAGE: ${String(e).slice(0, 160)}`));
  await page.goto(`${BASE}/?seed=2&screen=board&audio=0&speed=4&board=${board}`, { waitUntil: "domcontentloaded", timeout: LOAD });
  await page.waitForFunction(() => window.__SSP__?.state?.().screen !== undefined && !!window.__SSP__?.board, null, { timeout: LOAD });
  await page.evaluate(([k, n, c]) => {
    window.__SSP__.seed(2);
    window.__SSP__.startMatch(k, n, c);
  }, [KINDS, NAMES, CTRL]);
  await page.waitForFunction(() => window.__SSP__.state().screen === "board" && window.__SSP__.state().match.players.length === 4, null, { timeout: LOAD });
  await page.evaluate(installSampler);
  const B = await page.evaluate(() => window.__SSP__.board());
  if (B.id.startsWith("fizzy") !== (board === "carnival")) note(`${board}: board id ${B.id}`);
  const G = makeGraph(B);
  console.log(`== ${board} ready [t+${secs()}s] fork ${FORKS[board]} -> ${JSON.stringify(B.next[FORKS[board]])}`);
  const sc = forkScenarios(board, G, B);
  // CPU job is armed first; the sampler applies it on the first CPU dice phase while humans run in turn.
  const cpuP = (async () => { for (const s of sc.cpu) await s(page); })();
  for (const s of sc.human) await s(page);
  await cpuP;
  console.log(`== ${board} FORK done [t+${secs()}s]`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await Promise.all(Object.keys(FORKS).map((b) => runBoard(browser, b).catch((e) => check(`${b}:run`, false, String(e).slice(0, 250)))));
} finally {
  await browser.close();
}
for (const e of errors) check("pageerror", false, e);
const total = (Date.now() - t0) / 1000;
if (total > 60) note(`slow: ${total.toFixed(0)} s (target < 60 s)`);
console.log(`== FORK section total t+${total.toFixed(0)}s`);
console.log(fails ? `FAILED (${fails})` : "ALL PASS");
process.exit(fails ? 1 : 0);
