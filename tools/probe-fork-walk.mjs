/**
 * probe-fork-walk.mjs — rolled walks that reach a fork before their last pip (fix/fork-walk-item-flow).
 *
 *   FORK section (this file, P3a): H-STAY, H-BRANCH, CPU, EXACT, MULTI (full mode, carnival only).
 *   ITEM section (P3b): I-H-WARP, I-H-DOUBLE, I-H-ZIP, I-CPU-WARP, I-CPU-DOUBLE (grants via the sampler's
 *   __GRANTQ hook at turn:start, so items arrive during the announce beat).
 *
 * One chromium browser, six small (480x360) pages per board in parallel (carnival fork 6, downtown fork 5),
 * one scenario group each. Each page starts ["local","cpu","local","cpu"] on seed 2; the probe uses forced
 * dice, so it never needs a golden. Grand Prize / shop popups are answered so no scenario blocks the next.
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
  let tsN = 0;
  window.__GRANTQ = []; // { tag, kind: "human"|"cpu", items: [...] } applied at the next matching turn:start
  window.__GRANTED = {};
  const tick = () => {
    f++;
    try {
      const S = window.__SSP__.state();
      const m = S.match;
      const scr = S.screen;
      const cur = m.currentPlayer;
      const pl = m.players?.[cur];
      if (scr === "board") ln = window.__SSP__.phaseLog().filter((x) => x.event === "player:land").length;
      if (scr === "board") {
        const tsC = window.__SSP__.phaseLog().filter((x) => x.event === "turn:start").length;
        if (tsC !== tsN) {
          tsN = tsC;
          const kind = pl?.controller === "cpu" ? "cpu" : "human";
          const gi = window.__GRANTQ.findIndex((g) => g.kind === kind);
          if (gi >= 0) {
            const g = window.__GRANTQ.splice(gi, 1)[0];
            const before = [...(pl.items ?? [])];
            const oks = (g.items ?? []).map((k) => window.__SSP__.grantItem(cur, k));
            if (g.place !== undefined) window.__SSP__.placePlayer(cur, g.place);
            window.__GRANTED[g.tag] = { cur, f, before, oks };
          }
        }
      }
      const hv = scr === "board" ? window.__SSP__.hudView() : null;
      const job = window.__CPUJOB;
      if (job && !job.f0 && scr === "board" && m.phase === "dice" && m.players[cur]?.controller === "cpu") {
        window.__SSP__.placePlayer(cur, job.sp);
        window.__SSP__.rollDice(job.face);
        job.f0 = f;
        job.cur = cur;
        job.star = m.starBalloonPos;
      }
      const e = { f, scr, ph: m.phase, cur, sp: pl?.space ?? -1, coins: pl?.coins ?? 0, star: m.starBalloonPos, cd: hv?.countdown?.value ?? null, iu: !!m.itemUsedThisTurn, ld: [...(m.lastDice ?? [])], pop: !!document.querySelector(".ssp-popup"), ln };
      L.push(e);
      window.__LAST = e;
      if (f % 10 === 0 && scr === "board") {
        // Grand Prize / shop popups are not what this probe tests: PASS / leave so they cannot block the next scenario.
        const pp = document.querySelector(".ssp-popup");
        const bs = pp ? Array.from(pp.querySelectorAll("button")) : [];
        const txt = bs.map((b) => (b.textContent || "").trim());
        if (!(txt.includes("STAY") && txt.includes("BRANCH"))) {
          if (txt.includes("PASS")) bs[txt.indexOf("PASS")].click();
          else if (pp?.querySelector(".ssp-shop") && bs.length) bs[bs.length - 1].click();
        }
      }
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
/** Two dice, forced one at a time: rollDice(a), ROLL, wait for ROLL to come back, rollDice(b), ROLL. */
async function forceRoll2(page, seat, space, a, b) {
  const press = async () => {
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => document.querySelector(".ssp-roll-wrap button")?.click());
      await sleep(150);
      if (await page.evaluate(() => window.__forcedDice === undefined)) return true;
    }
    return false;
  };
  await page.evaluate(([p, s, fc]) => { window.__SSP__.placePlayer(p, s); window.__SSP__.rollDice(fc); }, [seat, space, a]);
  if (!(await press())) return false;
  // Autoplay (on for every seat) presses ROLL the moment the between-rolls pause ends, so the second face must
  // be armed now, before the first die lands, not after waiting for ROLL to come back.
  await page.evaluate((fc) => window.__SSP__.rollDice(fc), b);
  return press();
}
/** Queue a grant for the next human turn:start, wait for the item button, return the seat (or -1). */
async function grantWait(page, tg, items, key, ms = 40000) {
  // A human turn that already began has missed its announce beat: spend it on a 1-pip roll so the
  // grant lands on the next human turn instead of waiting behind an idle seat.
  const e0 = await last(page);
  const preQueued = await page.evaluate((t) => window.__GRANTQ.some((g) => g.tag === t) || !!window.__GRANTED[t], tg);
  if (!preQueued && e0 && e0.scr === "board" && (e0.cur === 0 || e0.cur === 2) && e0.ph === "dice") {
    const seat = await waitHumanDice(page, 15000).catch(() => -1);
    if (seat >= 0) {
      const sp = await page.evaluate(() => window.__SSP__.board().next.findIndex((n, i) => n.length === 1 && window.__SSP__.board().next[n[0]]?.length === 1 && i !== window.__SSP__.board().startIndex));
      await forceRoll(page, seat, sp, 1);
      await driveWalk(page, seat, ["STAY"], null, 15000);
    }
  }
  if (!preQueued) await page.evaluate(([t, it]) => window.__GRANTQ.push({ tag: t, kind: "human", items: it }), [tg, items]);
  let ok = false;
  let until = Date.now() + ms;
  while (!ok && Date.now() < until) {
    // Minigames / results between turns do not count against the budget.
    const ee = await last(page);
    if (ee && (ee.scr !== "board" || ee.ph === "minigame")) until = Math.max(until, Date.now() + 15000);
    ok = await page.waitForFunction(
      ([t, k]) => !!window.__GRANTED[t] && !!document.querySelector(`.ssp-item-bar [data-item-use="${k}"]`) && !document.querySelector(".ssp-popup"),
      [tg, key], { timeout: 5000, polling: 60 },
    ).then(() => true, () => false);
    if (!ok && !(await page.evaluate((t) => !!window.__GRANTED[t], tg)) && (await last(page))?.scr === "board") {
      // Still queued: a human turn must have started before the push. Spend it, the grant lands on the next one.
      const seat = await waitHumanDice(page, 1500).catch(() => -1);
      if (seat >= 0) {
        const sp = await page.evaluate(() => { const b = window.__SSP__.board(); return b.next.findIndex((n, i) => n.length === 1 && b.next[n[0]].length === 1 && i !== b.startIndex); });
        await forceRoll(page, seat, sp, 1);
        await driveWalk(page, seat, ["STAY"], null, 15000);
      }
    }
  }
  await sleep(100);
  if (!ok) {
    const dbg = await page.evaluate((t) => ({ g: window.__GRANTED[t], q: window.__GRANTQ.length, last: window.__LAST, btns: Array.from(document.querySelectorAll(".ssp-item-bar button")).map((b) => b.getAttribute("data-item-use")), pop: document.querySelector(".ssp-popup")?.textContent?.slice(0, 60) }), tg);
    note(`grantWait ${tg} failed ${JSON.stringify(dbg)}`);
  }
  return ok ? await page.evaluate((t) => window.__GRANTED[t].cur, tg) : -1;
}
const clickItem = (page, key) => page.evaluate((k) => document.querySelector(`.ssp-item-bar [data-item-use="${k}"]`)?.click(), key);
const itemBtn = (page, key) => page.evaluate((k) => {
  const b = document.querySelector(`.ssp-item-bar [data-item-use="${k}"]`);
  return b ? { disabled: !!b.disabled || b.getAttribute("aria-disabled") === "true", used: b.getAttribute("data-item-used") === "1" } : null;
}, key);
async function grantAndClick(page, tg, items, key) {
  const seat = await grantWait(page, tg, items, key);
  if (seat >= 0) await clickItem(page, key);
  return seat;
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
  const isFork = (s) => succ(s).length > 1;
  /** Walk of `len` pips from s that never meets a fork (start included), a bad space, the star or the start space. */
  const cleanPath = (s, len, star) => {
    if (isFork(s)) return null;
    const path = simFrom(s, len, (a) => a);
    return okPath(path, star) && !path.slice(0, -1).some(isFork) ? path : null;
  };
  const cleanStart = (len, star) => {
    for (let s = 0; s < B.spaces.length; s++) if (s !== star && s !== B.startIndex && cleanPath(s, len, star)) return s;
    return -1;
  };
  /** Like cleanPath but a fork may be crossed (the probe then clicks STAY = first successor). */
  const walkPath = (s, len, star) => {
    const path = simFrom(s, len, (a) => a);
    return okPath(path, star) ? path : null;
  };
  /** Like walkPath but a shop may be passed (the sampler leaves it); only the landing space must be plain. */
  const looseWalk = (s, len, star) => {
    const path = simFrom(s, len, (a) => a);
    const okMid = path.slice(0, -1).every((x) => (!BAD.has(type(x)) || type(x) === "shop") && x !== star && x !== B.startIndex);
    const end = path.at(-1);
    return okMid && !BAD.has(type(end)) && end !== star && end !== B.startIndex ? path : null;
  };
  return { looseWalk, succ, type, dist, simFrom, cpuPick, planFork, planExact, cleanPath, cleanStart, walkPath };
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
      // A turn starting ON the fork shows the lane popup after the roll. Whichever human is up next is
      // placed on the fork during its announce beat, so no seat rotation is waited for.
      const tg = `${board}-exact-fork`;
      await page.evaluate(([t, p]) => window.__GRANTQ.push({ tag: t, kind: "human", place: p }), [tg, f]);
      const placed = await page.waitForFunction((t) => !!window.__GRANTED[t], tg, { timeout: 40000, polling: 60 }).then(() => true, () => false);
      const seat2 = placed ? await waitHumanDice(page, 20000).catch(() => -1) : -1;
      if (seat2 < 0) return check(tag("EXACT next turn lane popup"), false, `placed ${placed}, no human dice phase within 20 s`);
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
    // Two dice are forced one at a time: rollDice(a), ROLL, wait for the button, rollDice(b), ROLL.
    const path = G.simFrom(3, 12, (a, b) => b); // BRANCH at every fork
    const k = path.indexOf(38);
    if (k < 0 || k + 2 > 12) return note(`${tag("MULTI")} 38 not reachable from 3 with pips left (index ${k}); skipped`);
    const total = k + 2; // k+1 pips reach 38, one is left
    const [a, b] = total > 6 ? [6, total - 6] : [total - 1, 1];
    const seat = await grantAndClick(page, `${board}-multi`, ["double_dice"], "double_dice");
    if (seat < 0) return check(tag("MULTI"), false, "double_dice could not be granted or clicked");
    await waitHumanDice(page, 20000);
    const f0 = await lastFrameF(page);
    await forceRoll2(page, seat, 3, a, b);
    const n = await driveWalk(page, seat, ["BRANCH", "STAY"]);
    const frames = await walkFrames(page, f0, seat);
    const ld = (await last(page)).ld;
    const ph = frames.map((x) => `${x.cur}:${x.ph}@${x.sp}${x.pop ? "!" : ""}`).filter((x, i, arr) => i === 0 || x !== arr[i - 1]).join(" ");
    check(tag("MULTI"), n === 2 && ld.length === 2 && ld[0] + ld[1] === total, `${n} lane popups, dice ${a}+${b}=${total}, lastDice [${ld}], lands [${landsOf(frames)}] frames: ${ph}`.slice(0, 290));
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

/* ITEM SECTION (P3b) */
function itemScenarios(board, G, B) {
  const tag = (n) => `${board}:${n}`;
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  /** Frames of `seat`'s turn since f0, split into runs of consecutive moving frames (+2 frames of tail). */
  const segments = async (page, f0, seat) => {
    const all = (await page.evaluate((a) => window.__LOG.filter((x) => x.f >= a), f0)).filter((x) => x.cur === seat);
    const segs = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].ph !== "moving") continue;
      let j = i;
      while (j + 1 < all.length && all[j + 1].ph === "moving") j++;
      segs.push(all.slice(i, j + 3));
      i = j;
    }
    return { all, segs };
  };

  const warp = async (page) => {
    const tg = `${board}-i-warp`;
    const seat = await grantWait(page, tg, ["warp_whistle", "zappy"], "warp_whistle");
    if (seat < 0) {
      const dbg = await page.evaluate((t) => ({ g: window.__GRANTED[t], last: window.__LAST, btns: Array.from(document.querySelectorAll(".ssp-item-bar button")).map((b) => b.getAttribute("data-item-use")), pop: document.querySelector(".ssp-popup")?.textContent?.slice(0, 60) }), tg);
      return check(tag("I-H-WARP"), false, `items not granted / whistle button never appeared ${JSON.stringify(dbg)}`);
    }
    const star = (await last(page)).star;
    const before = await itemBtn(page, "zappy");
    const coins0 = (await last(page)).coins;
    const f0 = await lastFrameF(page);
    await clickItem(page, "warp_whistle");
    await page.waitForFunction(([a, s]) => window.__LOG.some((x) => x.f >= a && x.cur === s && x.ph === "moving"), [f0, seat], { timeout: 15000, polling: 40 }).catch(() => {});
    await waitHumanDice(page, 20000).catch(() => {});
    const { all, segs } = await segments(page, f0, seat);
    const tele = segs[0] ?? [];
    const e1 = await last(page);
    const dest = e1.sp;
    const zap = await itemBtn(page, "zappy");
    await page.evaluate(() => document.querySelector('.ssp-item-bar [data-item-use="zappy"]')?.click());
    await sleep(300);
    const e2 = await last(page);
    const teleOk = tele.filter((x) => x.ph === "moving").every((x) => x.cd === null) && tele.length > 0;
    check(tag("I-H-WARP teleport then roll available"), teleOk && e1.ph === "dice" && e1.cur === seat && e1.iu,
      `moving frames ${tele.length}, cd null ${teleOk}, ph ${e1.ph} cur ${e1.cur} (seat ${seat}) itemUsed ${e1.iu} dest ${dest}`);
    check(tag("I-H-WARP zappy greyed"), !!before && !before.disabled && !!zap && zap.disabled && zap.used && e2.coins === e1.coins && e2.ph === "dice",
      `before ${JSON.stringify(before)} after ${JSON.stringify(zap)} coins ${e1.coins}->${e2.coins} ph ${e2.ph}`);
    if (e1.coins !== coins0) {
      const shared = await page.evaluate(([d, c]) => window.__SSP__.state().match.players.some((p, i) => i !== c && p.space === d), [dest, seat]);
      note(`${tag("I-H-WARP")} coins changed across the teleport itself: ${coins0} -> ${e1.coins} (dest ${dest}, type ${B.spaces[dest]?.type}${shared ? "; squeeze:hug, landed on an occupied space (settings.squeezeCoins)" : ""})`);
    }
    let face = 0;
    for (const k of [3, 4, 2, 5, 1, 6]) if (G.walkPath(dest, k, star) || G.looseWalk(dest, k, star)) { face = k; break; }
    if (!face) return note(`${tag("I-H-WARP")} no clean walk from whistle destination ${dest}; roll part skipped`);
    const expected = (G.walkPath(dest, face, star) ?? G.looseWalk(dest, face, star)).at(-1);
    const f1 = await lastFrameF(page);
    const ok = await forceRoll(page, seat, dest, face);
    await driveWalk(page, seat, ["STAY"]);
    await sleep(300);
    const frames = await walkFrames(page, f1, seat);
    const lands = landsOf(frames);
    const cd = countdownIssues(frames, face);
    check(tag("I-H-WARP roll walk from destination"), ok && lands.length === 1 && lands[0] === expected && cd.length === 0,
      `from ${dest} roll ${face} lands [${lands}] expected ${expected} ${cd.join("; ")}`);
  };

  /** Shared body of the two human roll-modifier scenarios. */
  const modifier = (name, key, dice, expectedTotal) => async (page) => {
    const seat = await grantAndClick(page, `${board}-${name}`, [key], key);
    if (seat < 0) return check(tag(name), false, `${key} could not be granted or clicked`);
    await sleep(120);
    const barLeft = await page.evaluate(() => document.querySelectorAll(".ssp-item-bar [data-item-use]").length);
    await waitHumanDice(page, 20000);
    const star = (await last(page)).star;
    const start = G.cleanStart(expectedTotal, star);
    if (start < 0) return note(`${tag(name)} no clean ${expectedTotal}-pip walk; skipped`);
    const expected = G.cleanPath(start, expectedTotal, star).at(-1);
    const f0 = await lastFrameF(page);
    const ok = dice.length === 2 ? await forceRoll2(page, seat, start, dice[0], dice[1]) : await forceRoll(page, seat, start, dice[0]);
    await driveWalk(page, seat, ["STAY"]);
    await sleep(300);
    const frames = await walkFrames(page, f0, seat);
    const lands = landsOf(frames);
    const ld = (await last(page)).ld;
    const cd = countdownIssues(frames, expectedTotal);
    check(tag(name), ok && barLeft === 0 && lands.length === 1 && lands[0] === expected && cd.length === 0 && (dice.length !== 2 || (ld.length === 2 && sum(ld) === expectedTotal)),
      `bar buttons after click ${barLeft}, start ${start} dice [${dice}] lastDice [${ld}] lands [${lands}] expected ${expected} ${cd.join("; ")}`);
  };

  /** CPU seat with only `key` in its bag: observe the whole turn. */
  const cpuItem = (name, key, verify) => async (page) => {
    const tg = `${board}-${name}`;
    await page.evaluate(([t, k]) => window.__GRANTQ.push({ tag: t, kind: "cpu", items: [k] }), [tg, key]);
    const g = await page.waitForFunction((t) => window.__GRANTED[t] ?? null, tg, { timeout: 60000, polling: 60 }).then((h) => h.jsonValue(), () => null);
    if (!g) return check(tag(name), false, `cpu grant never applied ${JSON.stringify(await page.evaluate(() => ({ q: window.__GRANTQ, g: window.__GRANTED, last: window.__LAST, ts: window.__SSP__.phaseLog().filter((x) => x.event === "turn:start").length })))}`);
    if (g.before.length) return note(`${tag(name)} cpu bag was not empty (${g.before}); item pick is random, skipped`);
    const done = await page.waitForFunction(([s, a]) => window.__LAST.f > a + 5 && window.__LAST.cur !== s, [g.cur, g.f], { timeout: 45000, polling: 60 }).then(() => true, () => false);
    await sleep(150);
    const { all, segs } = await segments(page, g.f, g.cur);
    const next = await last(page);
    await verify(g.cur, all, segs, done, next);
  };
  const phases = (all) => all.map((x) => x.ph).filter((p, i, a) => i === 0 || p !== a[i - 1]);
  const hasSeq = (arr, seq) => { let i = 0; for (const x of arr) if (x === seq[i]) i++; return i === seq.length; };

  const cpuWarp = cpuItem("I-CPU-WARP", "warp_whistle", async (seat, all, segs, done, next) => {
    const ph = phases(all);
    const [tele, walk] = [segs[0] ?? [], segs[1] ?? []];
    const ld = all.at(-1)?.ld ?? [];
    const cd = walk.length ? countdownIssues(walk, sum(ld)) : ["no counted walk"];
    const iuOk = all.filter((x) => x.ph === "moving" || x.ph === "space-effect").every((x) => x.iu);
    check(tag("I-CPU-WARP"), done && hasSeq(ph, ["dice", "moving", "dice", "moving"]) && tele.filter((x) => x.ph === "moving").every((x) => x.cd === null) &&
      ld.length === 1 && cd.length === 0 && iuOk && next.iu === false,
      `phases ${ph} tele frames ${tele.length} lastDice [${ld}] itemUsed-in-turn ${iuOk} next-turn itemUsed ${next.iu} ${cd.join("; ")}`);
  });
  const cpuDouble = cpuItem("I-CPU-DOUBLE", "double_dice", async (seat, all, segs, done, next) => {
    const ld = all.at(-1)?.ld ?? [];
    const walk = segs[0] ?? [];
    const cd = walk.length ? countdownIssues(walk, sum(ld)) : ["no walk"];
    check(tag("I-CPU-DOUBLE"), done && ld.length === 2 && cd.length === 0 && next.iu === false,
      `lastDice [${ld}] sum ${sum(ld)} walk frames ${walk.length} next-turn itemUsed ${next.iu} ${cd.join("; ")}`);
  });

  return {
    warp, cpuWarp, cpuDouble,
    dbl: modifier("I-H-DOUBLE", "double_dice", [3, 2], 5),
    zip: modifier("I-H-ZIP", "golden_dash", [2], 7),
  };
}

/* ------------------------------------------------------------------ per-board runner */
async function runBoard(browser, board, group) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 360 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/interactive-widget/.test(m.text())) errors.push(`${board}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => errors.push(`${board} PAGE: ${String(e).slice(0, 160)}`));
  await page.goto(`${BASE}/?seed=2&screen=board&audio=0&speed=4&board=${board}`, { waitUntil: "domcontentloaded", timeout: LOAD });
  await page.waitForFunction(() => window.__SSP__?.state?.().screen !== undefined && !!window.__SSP__?.board, null, { timeout: LOAD });
  // Sampler first, so a grant queued for the group's first human scenario lands on seat 0's opening turn:start.
  await page.evaluate(installSampler);
  const pre = { itemA: { tag: `${board}-i-warp`, items: ["warp_whistle", "zappy"] }, itemB: { tag: `${board}-I-H-ZIP`, items: ["golden_dash"] }, itemC: { tag: `${board}-I-H-DOUBLE`, items: ["double_dice"] } }[group];
  if (pre) await page.evaluate((g) => window.__GRANTQ.push({ kind: "human", ...g }), pre);
  await page.evaluate(([k, n, c]) => {
    window.__SSP__.seed(2);
    window.__SSP__.startMatch(k, n, c);
  }, [KINDS, NAMES, CTRL]);
  await page.waitForFunction(() => window.__SSP__.state().screen === "board" && window.__SSP__.state().match.players.length === 4, null, { timeout: LOAD });
  const B = await page.evaluate(() => window.__SSP__.board());
  if (B.id.startsWith("fizzy") !== (board === "carnival")) note(`${board}: board id ${B.id}`);
  const G = makeGraph(B);
  console.log(`== ${board} ready [t+${secs()}s] fork ${FORKS[board]} -> ${JSON.stringify(B.next[FORKS[board]])}`);
  const fk = forkScenarios(board, G, B);
  const it = itemScenarios(board, G, B);
  // CPU job is armed first; the sampler applies it on the first CPU dice phase while humans run in turn.
  const plan = {
    forkA: { human: fk.human.slice(0, 1), cpu: fk.cpu },
    forkC: { human: fk.human.slice(1, 2), cpu: [] },
    forkB: { human: fk.human.slice(2), cpu: [it.cpuWarp] },
    itemA: { human: [it.warp], cpu: [] },
    itemB: { human: [it.zip], cpu: [it.cpuDouble] },
    itemC: { human: [it.dbl], cpu: [] },
  }[group];
  const cpuP = (async () => { for (const s of plan.cpu) await s(page); })();
  for (const s of plan.human) await s(page);
  // Human scenarios are done: let autoplay take the human seats so an idle seat cannot stall the CPU job.
  await page.evaluate(() => { window.__AP = "on"; });
  await cpuP;
  console.log(`== ${board}/${group} done [t+${secs()}s]`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  const jobs = Object.keys(FORKS).flatMap((b) => ["forkA", "forkB", "forkC", "itemA", "itemB", "itemC"].map((g) => [b, g]));
  await Promise.all(jobs.map(([b, g]) => runBoard(browser, b, g).catch((e) => check(`${b}/${g}:run`, false, String(e).slice(0, 250)))));
} finally {
  await browser.close();
}
for (const e of errors) check("pageerror", false, e);
const total = (Date.now() - t0) / 1000;
if (total > 60) note(`slow: ${total.toFixed(0)} s (target < 60 s)`);
console.log(`== FORK section total t+${total.toFixed(0)}s`);
console.log(fails ? `FAILED (${fails})` : "ALL PASS");
process.exit(fails ? 1 : 0);
