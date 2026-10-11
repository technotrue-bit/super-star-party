/**
 * probe-hud.mjs — corner HUD cards, move countdown, Grand Prize distance hint (PR C).
 *
 *   A. countdown: forced walks (placePlayer + rollDice + the ROLL button) on the human seat, then
 *      natural autoplay turns. Per walk: first value == hops walked, cd + hopsDoneSoFar == start on
 *      every sampled frame, values run start..1, null at/after landing and outside "moving",
 *      never shown on a teleport / non-rolled walk. A roll that reaches a fork before its last pip
 *      pauses for the lane pick (STAY/BRANCH) and keeps counting across it; a Midway Whistle teleport
 *      returns to the dice phase (item bar greyed out) and a normal counted walk follows.
 *   B. prize hint: probe-side BFS over __SSP__.board().next (fork = min) == hint on every sampled
 *      dice/moving frame; "1 space" singular; 0 -> "On the Grand Prize Balloon!"; hidden otherwise;
 *      the hint follows a balloon move within 2 frames.
 *   C. ranks: pure __SSP__.hudRanks cases (ties) + a live forced tie in the DOM badges.
 *   D. layout at webkit 390x844 and 430x932: no overlaps, nothing in the centre box, cards and the
 *      YOU pill inside the viewport, no ellipsised card label.
 *
 *   SSP_URL=http://127.0.0.1:5199 [SSP_BOARD=carnival|downtown] [SSP_SHOTS=/workspace/ssp-hud-shots/probe]
 *     node tools/probe-hud.mjs
 *
 * Exits non-zero on any FAIL or page error. Needs a dev/CI build (debug hooks are gated).
 */
import { webkit } from "@playwright/test";
import fs from "node:fs";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5199").replace(/\/$/, "");
const SHOTS = process.env.SSP_SHOTS ?? "/workspace/ssp-hud-shots/probe";
const BOARD = process.env.SSP_BOARD === "downtown" ? "downtown" : "carnival";
const BQ = `&board=${BOARD}`;
const SFX = BOARD === "downtown" ? "-downtown" : "";
fs.mkdirSync(SHOTS, { recursive: true });
const LOAD = 60000;
const t0 = Date.now();
const rows = [];
const errors = [];

function check(name, ok, detail = "") {
  rows.push({ name, ok: !!ok, detail: String(detail).slice(0, 160) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + String(detail).slice(0, 240) : ""}`);
}
const note = (msg) => console.log(`NOTE ${msg}`);
const sect = (s) => console.log(`== ${s}  [t+${((Date.now() - t0) / 1000).toFixed(0)}s]`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

async function waitForServer(url, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`dev server at ${url} not ready`);
}
function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error" && !/interactive-widget/.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => errors.push(`${label} PAGE: ${String(e).slice(0, 160)}`));
}

const KINDS = ["pip", "bounce", "glimmer", "tusk"];
const NAMES = ["Pip", "Bounce", "Glimmer", "Player 4"];

async function boot(browser, w, h, tag, speed) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  watch(page, tag);
  await page.goto(`${BASE}/?audio=0&seed=2&speed=${speed}${BQ}`, { waitUntil: "domcontentloaded", timeout: LOAD });
  await page.waitForFunction(() => window.__SSP__?.state?.().screen === "title", null, { timeout: LOAD });
  await sleep(500);
  return page;
}
async function startMatch(page) {
  await page.evaluate(([k, n]) => {
    window.__SSP__.seed(2);
    window.__SSP__.startMatch(k, n);
  }, [KINDS, NAMES]);
  await page.waitForFunction(() => document.querySelectorAll("[data-hud-player]").length >= 4, null, { timeout: LOAD });
}

/* ------------------------------------------------------------------ in-page sampler (A/B/C) */
function installSampler() {
  const L = (window.__HUDLOG = []);
  window.__AP = "hold"; // hold: autoplay only off the board (minigames); on: always; off: never
  window.__APUNTIL = null; // when set: autoplay on until the balloon leaves this space, then hold
  window.__W0 = 0;
  let f = 0;
  let prevMv0 = false;
  let apState = null;
  const tick = () => {
    f++;
    try {
      const S = window.__SSP__.state();
      const m = S.match;
      const scr = S.screen;
      const cur = m.currentPlayer;
      const pl = m.players?.[cur];
      const hv = scr === "board" ? window.__SSP__.hudView() : null;
      const e = { f, scr, ph: m.phase, cur, sp: pl?.space ?? -1, star: m.starBalloonPos, cd: hv?.countdown?.value ?? null, sh: !!hv?.countdown?.rect, dom: (() => { const d = document.querySelector(".ssp-move-count"); return d && !d.hidden ? d.textContent : null; })(), hint: hv?.hint?.text ?? null, hv: !!hv };
      if (hv && f % 10 === 0) {
        const rk = window.__SSP__.hudRanks(hv.cards.map((c) => ({ stars: c.stars, coins: c.coins })));
        // Displayed coins tween, so also keep the rank of the true state values.
        const rs = window.__SSP__.hudRanks(m.players.map((p) => ({ stars: p.stars, coins: p.coins })));
        e.rk = hv.cards.map((c, i) => [c.id, c.rank, rk[i], c.rankText, rs[c.id]]);
      }
      L.push(e);
      window.__LAST = e;
      const mv0 = m.phase === "moving" && cur === 0 && scr === "board";
      if (mv0 && !prevMv0) window.__W0++;
      prevMv0 = mv0;
      if (window.__APUNTIL !== null && m.starBalloonPos !== window.__APUNTIL) {
        window.__APUNTIL = null;
        window.__AP = "hold";
      }
      // hold: autoplay drives the human only through minigames; on the board the probe owns the human's turn.
      const off = ["board", "title", "select", "boot", "loading"].includes(scr) && m.phase !== "minigame";
      if (m.phase === "minigame" && f % 15 === 0) {
        // The minigame intro waits for a tap even under autoplay.
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

const setAP = (page, mode) => page.evaluate((m) => { window.__AP = m; }, mode);
const last = (page) => page.evaluate(() => window.__LAST ?? null);

/** Human (seat 0) at a settled dice phase with a live ROLL button. */
async function waitHumanDice(page, ms = 90000) {
  await page.waitForFunction(
    () => {
      const e = window.__LAST;
      const b = document.querySelector(".ssp-roll-wrap button");
      return !!e && e.scr === "board" && e.ph === "dice" && e.cur === 0 && !!b && !b.disabled && getComputedStyle(b).pointerEvents !== "none" &&
        parseFloat(getComputedStyle(b.closest(".ssp-roll-wrap")).opacity) > 0.5 && !document.querySelector(".ssp-popup");
    },
    null,
    { timeout: ms, polling: 100 },
  );
  await sleep(250);
}
/** Place, force the face, press ROLL until the forced face is consumed. */
async function forceRoll(page, space, face) {
  await page.evaluate(([s, fc]) => {
    window.__SSP__.placePlayer(0, s);
    window.__SSP__.rollDice(fc);
  }, [space, face]);
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => document.querySelector(".ssp-roll-wrap button")?.click());
    await sleep(200);
    if (await page.evaluate(() => window.__forcedDice === undefined)) return true;
  }
  return false;
}
/** Drive the human walk: click lane buttons per plan, return when the walk is over. */
async function driveWalk(page, picks, ms = 45000) {
  const until = Date.now() + ms;
  let sawMoving = false;
  let n = 0;
  while (Date.now() < until) {
    const e = await last(page);
    if (e && e.scr === "board") {
      if (e.ph === "moving" && e.cur === 0) sawMoving = true;
      else if (sawMoving && !(e.ph === "moving")) return true;
    }
    const want = picks[n] ?? "STAY";
    const clicked = await page.evaluate((w) => {
      const b = Array.from(document.querySelectorAll(".ssp-popup button")).find((x) => (x.textContent || "").trim() === w);
      if (b) b.click();
      return !!b;
    }, want);
    if (clicked) n++;
    await sleep(80);
  }
  return false;
}

/* ------------------------------------------------------------------ analysis (node) */
function makeGraph(B) {
  const succ = (s) => B.next[s] ?? [B.startIndex];
  const dist = (from, to, cap) => {
    if (from === to) return 0;
    const seen = new Set([from]);
    let fr = [from];
    for (let d = 1; d <= cap && fr.length; d++) {
      const nx = [];
      for (const s of fr) for (const c of succ(s)) {
        if (c === to) return d;
        if (!seen.has(c)) { seen.add(c); nx.push(c); }
      }
      fr = nx;
    }
    return null;
  };
  const bfs = (from, to) => dist(from, to, 200);
  const hintText = (d) => (d === null ? null : d === 0 ? "On the Grand Prize Balloon!" : d === 1 ? "1 space to the Grand Prize Balloon" : `${d} spaces to the Grand Prize Balloon`);
  const expHint = (fr) => (fr.hv && fr.scr === "board" && (fr.ph === "dice" || fr.ph === "moving") ? hintText(bfs(fr.sp, fr.star)) : null);
  return { succ, dist, bfs, expHint };
}

/** Walk the frame log and check the countdown invariants. Returns { walks, issues }. */
function analyseCountdown(frames, G, B) {
  const issues = [];
  const walks = [];
  const isFork = (s) => (B.next[s] ?? []).length === 2;
  let prev = null;
  let seg = null;
  const issue = (fr, msg) => issues.push(`f${fr.f} P${fr.cur}: ${msg}`);

  const endSub = (fr) => {
    const sub = seg.sub;
    if (!sub) return;
    sub.endHops = seg.hops - sub.base;
    if (sub.last !== 1) issue(fr, `walk ended while the countdown still read ${sub.last}`);
    if (sub.endHops !== sub.start) issue(fr, `first value ${sub.start} but ${sub.endHops} hops walked`);
    seg.landed = true;
    seg.landSpace = seg.lastSp;
    seg.subs.push({ start: sub.start, hops: sub.endHops, last: sub.last });
    seg.sub = null;
  };
  const closeSeg = (fr) => {
    if (!seg) return;
    if (seg.sub) endSub(fr);
    walks.push({ cur: seg.cur, f0: seg.f0, startSpace: seg.startSpace, endSpace: seg.lastSp, landSpace: seg.landSpace, sawCd: !!seg.sawCd, hops: seg.hops, subs: seg.subs, tele: seg.tele, rolled: seg.rolled, landed: seg.landed });
    seg = null;
  };

  for (const fr of frames) {
    if (!fr.hv || fr.scr !== "board") {
      closeSeg(fr);
      prev = null;
      continue;
    }
    const mv = fr.ph === "moving";
    let hopD = 0;
    if (seg && fr.cur === seg.cur && fr.sp !== seg.lastSp) {
      const d = G.dist(seg.lastSp, fr.sp, 2);
      const tele = d === null;
      hopD = tele ? 1 : d;
      if (tele) {
        seg.tele = true;
        if (fr.cd !== null) issue(fr, `countdown ${fr.cd} shown on a hop ${seg.lastSp}->${fr.sp} (not a successor)`);
        // A landing whose space effect moves the token in the same update (grumpus, trap) looks like 16 -> 9 here:
        // the countdown reads 1 on the frame before and goes null on this one, which is the landing.
        const landingEffect = !!seg.sub && seg.sub.last === 1 && fr.cd === null;
        if (seg.sawCd && !seg.landed && !landingEffect) issue(fr, `countdown was shown before the teleport hop ${seg.lastSp}->${fr.sp}`);
      }
      seg.hops += hopD;
      seg.lastSp = fr.sp;
    }
    if (!mv) {
      if (fr.cd !== null) issue(fr, `countdown ${fr.cd} shown outside moving (phase ${fr.ph})`);
      closeSeg(fr);
      prev = fr;
      continue;
    }
    if (seg && seg.cur !== fr.cur) closeSeg(fr);
    if (!seg) {
      const sp0 = prev && prev.cur === fr.cur ? prev.sp : fr.sp;
      seg = { cur: fr.cur, f0: fr.f, star0: fr.star, startSpace: sp0, lastSp: sp0, hops: 0, sub: null, subs: [], landed: false, tele: false, rolled: !!prev && prev.ph === "dice" && prev.cur === fr.cur, gapHops: null };
      if (fr.sp !== sp0) {
        const d = G.dist(sp0, fr.sp, 2);
        if (d === null) seg.tele = true;
        seg.hops += d ?? 1;
        seg.lastSp = fr.sp;
        hopD = d ?? 1;
      }
    }
    if (!seg.rolled) {
      if (fr.cd !== null) issue(fr, `countdown ${fr.cd} shown on a non-rolled walk (teleport/effect)`);
      prev = fr;
      continue;
    }
    if (fr.cd !== null) {
      seg.sawCd = true;
      if (!fr.sh) issue(fr, `countdown ${fr.cd} not drawn (hop ${seg.lastSp}, star ${fr.star}); mover off-screen?`);
      else if (fr.dom !== String(fr.cd)) issue(fr, `countdown ${fr.cd} but the DOM number reads ${fr.dom}`);
      if (seg.landed) issue(fr, `countdown ${fr.cd} after landing`);
      if (seg.tele) issue(fr, `countdown ${fr.cd} on a segment with a teleport hop`);
      if (!seg.sub) {
        // Standing on a fork: the walk only starts after the lane pick, so nothing is walked before the first value.
        const base = seg.hops - hopD;
        if (base > 0) issue(fr, `first countdown frame came after ${base} hops were already walked`);
        seg.sub = { start: fr.cd + hopD, base, last: fr.cd, pauseHop: false };
      } else {
        const sub = seg.sub;
        const done = seg.hops - sub.base;
        if (fr.cd + done !== sub.start) issue(fr, `cd ${fr.cd} + hopsDone ${done} != start ${sub.start}`);
        if (fr.cd > sub.last) issue(fr, `cd went up ${sub.last} -> ${fr.cd}`);
        sub.last = fr.cd;
        sub.pauseHop = false;
      }
    } else if (seg.sub) {
      if (seg.sub.last === 1) endSub(fr);
      else {
        // Mid-walk null: only legal while the loop is paused on a fork lane choice, the Grand Prize Balloon offer or a shop.
        // (the balloon moves when the star is bought, so compare with where it stood when the walk began)
        const legit = isFork(fr.sp) || fr.sp === fr.star || fr.sp === seg.star0 || B.spaces[fr.sp]?.type === "shop";
        if (!legit) issue(fr, `countdown went null at ${seg.sub.last} on plain space ${fr.sp}`);
        if (hopD > 0) {
          if (seg.sub.pauseHop) issue(fr, `hopped ${hopD} while the countdown was hidden`);
          seg.sub.pauseHop = true;
        }
      }
    } else if (!seg.landed && !seg.tele && seg.hops > 0) {
      issue(fr, `countdown null with ${seg.hops} hops of a rolled walk already walked`);
    }
    prev = fr;
  }
  // A walk still in flight when the capture stopped is not judged.
  return { walks, issues };
}

/** Print the sampled frames around the first issue so a failure can be read without a rerun. */
function dumpAround(frames, issues, label) {
  for (const issue of issues.slice(0, 3)) {
    const f = Number(/^f(\d+)/.exec(issue)?.[1]);
    const i = frames.findIndex((e) => e.f === f);
    if (i < 0) continue;
    console.log(`   ${label} frames around ${issue}`);
    for (const e of frames.slice(Math.max(0, i - 6), i + 6)) console.log(`     f${e.f} ${e.scr} ph=${e.ph} P${e.cur} sp=${e.sp} star=${e.star} cd=${e.cd} drawn=${e.sh} dom=${e.dom}`);
  }
}

function checkHints(frames, G) {
  const bad = [];
  let shown = 0;
  const texts = new Set();
  for (let i = 1; i < frames.length; i++) {
    const fr = frames[i];
    if (!fr.hv) continue;
    if (fr.hint !== null) { shown++; texts.add(fr.hint); }
    // The hint is refreshed in board update(); a frame that straddles a space/phase change may show the previous frame's text.
    if (fr.hint !== G.expHint(fr) && fr.hint !== G.expHint(frames[i - 1])) bad.push(`f${fr.f} ph=${fr.ph} sp=${fr.sp} star=${fr.star}: "${fr.hint}" want "${G.expHint(fr)}"`);
  }
  return { bad, shown, texts };
}
function checkRanksLog(frames) {
  const bad = [];
  let n = 0;
  let prevState = {};
  for (const fr of frames) {
    if (!fr.rk) continue;
    n++;
    for (const [id, got, want, text, st] of fr.rk) {
      const ord = got === 1 ? "1st" : got === 2 ? "2nd" : got === 3 ? "3rd" : `${got}th`;
      // The badge follows the true values at the last refreshHud; the digits shown tween toward them.
      const okRank = got === want || got === st || got === prevState[id];
      if (!okRank || text !== ord) bad.push(`f${fr.f} P${id}: badge ${got}/"${text}" dom-want ${want} state-want ${st}`);
    }
    prevState = Object.fromEntries(fr.rk.map((r) => [r[0], r[4]]));
  }
  return { bad, n };
}

/* ------------------------------------------------------------------ scenario planner */
function planner(B, star) {
  const SAFE = new Set(["blue", "green", "red"]);
  const isFork = (s) => B.next[s].length === 2;
  const ok = (s) => SAFE.has(B.spaces[s].type) && s !== star && s !== B.startIndex;
  /** Full walk of `face` hops: each fork stood on before the last hop takes the next entry of `picks` (0 STAY, 1 BRANCH; default STAY). */
  const sim = (start, face, picks = []) => {
    let cur = start;
    let pi = 0;
    const path = [];
    const passed = [];
    for (let i = 0; i < face; i++) {
      if (isFork(cur)) {
        if (i > 0) passed.push(cur);
        cur = B.next[cur][picks[pi++] ?? 0];
      } else cur = B.next[cur][0];
      path.push(cur);
    }
    return { path, subs: [face], landing: cur, passed };
  };
  const clean = (s, r) => r && r.path.every(ok);
  const find = (pred, faces) => {
    for (let s = 0; s < B.next.length; s++) for (const f of faces) {
      for (const pick of [0, 1]) {
        const r = sim(s, f, [pick, pick]);
        if (clean(s, r) && pred(s, r, f)) return { start: s, face: f, pick, ...r };
      }
    }
    return null;
  };
  const forks = B.next.map((r, i) => (r.length === 2 ? i : -1)).filter((i) => i >= 0);
  const out = [];
  const normal = find((s, r) => !r.passed.length && r.path.every((p) => !isFork(p)) && !isFork(s), [4, 5, 3]);
  if (normal) out.push({ name: "normal walk", ...normal, picks: [] });
  // Pass through fork f mid-roll: start on a plain space, fork strictly before the last pip, the pick chooses the lane.
  for (const f of forks.slice(0, 1)) {
    for (const pick of [0, 1]) {
      let hit = null;
      for (let s = 0; s < B.next.length && !hit; s++) for (const face of [5, 6, 4, 3]) {
        if (isFork(s)) continue;
        const r = sim(s, face, [pick]);
        if (r.passed.length === 1 && r.passed[0] === f && !isFork(r.landing) && r.path.every(ok)) { hit = { start: s, face, pick, ...r }; break; }
      }
      if (hit) out.push({ name: `pass through fork ${f}, ${pick ? "BRANCH" : "STAY"}`, ...hit, picks: [pick ? "BRANCH" : "STAY"], through: true });
    }
  }
  for (const f of forks.slice(0, 1)) {
    for (const pick of [0, 1]) {
      let hit = null;
      for (const face of [4, 3, 5, 2]) {
        const r = sim(f, face, [pick]);
        if (!r.passed.length && r.path.every(ok)) { hit = { start: f, face, pick, ...r }; break; }
      }
      if (hit) out.push({ name: `standing on fork ${f}, ${pick ? "BRANCH" : "STAY"}`, ...hit, picks: [pick ? "BRANCH" : "STAY"], standing: true });
    }
  }
  return { out, forks, sim, ok, isFork };
}

/* ================================================================== main */
await waitForServer(`${BASE}/`);
const browser = await webkit.launch();

// ---------------------------------------------------------------- C1 pure ranks
sect(`C1. pure ranks (${BOARD})`);
{
  const page = await boot(browser, 390, 844, "C1", 1);
  const rk = (rows2) => page.evaluate((r) => window.__SSP__.hudRanks(r), rows2);
  const r = (s, c) => ({ stars: s, coins: c });
  const cases = [
    ["[3/20,3/20,3/10,1/50]", [r(3, 20), r(3, 20), r(3, 10), r(1, 50)], [1, 1, 3, 4]],
    ["all equal", [r(1, 5), r(1, 5), r(1, 5), r(1, 5)], [1, 1, 1, 1]],
    ["[2/0,1/99]", [r(2, 0), r(1, 99)], [1, 2]],
    ["[0/5,0/5,0/9]", [r(0, 5), r(0, 5), r(0, 9)], [2, 2, 1]],
    ["coins break star ties", [r(2, 4), r(2, 7), r(0, 99), r(2, 7)], [3, 1, 4, 1]],
    ["three-way tie then last", [r(5, 5), r(5, 5), r(5, 5), r(0, 0)], [1, 1, 1, 4]],
    ["single", [r(0, 0)], [1]],
  ];
  for (const [name, input, want] of cases) {
    const got = await rk(input);
    check(`C1 ${name}`, J(got) === J(want), `${J(got)} want ${J(want)}`);
  }
  await page.context().close();
}

// ---------------------------------------------------------------- C2 live forced tie
sect(`C2. live tie (${BOARD})`);
{
  const page = await boot(browser, 390, 844, "C2", 1);
  await page.evaluate(installSampler);
  await startMatch(page);
  await sleep(1500);
  const read = () => page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-hud-player]")).map((c) => {
      const b = c.querySelector(".ssp-hud-chip__rank");
      return { id: Number(c.getAttribute("data-hud-player")), text: (b?.textContent ?? "").trim(), rank: Number(b?.dataset.rank ?? 0) };
    }).sort((a, b) => a.id - b.id));
  await page.evaluate(() => {
    const want = [[3, 20], [3, 20], [3, 10], [1, 50]];
    const m = window.__SSP__.state().match;
    want.forEach(([st, co], i) => {
      window.__SSP__.giveStars(i, st - m.players[i].stars);
      window.__SSP__.fundPlayer(i, co - m.players[i].coins);
    });
  });
  const tied = await page.evaluate(() => window.__SSP__.state().match.players.map((p) => [p.stars, p.coins]));
  check("C2 forced stars/coins applied", J(tied) === J([[3, 20], [3, 20], [3, 10], [1, 50]]), J(tied));
  // The cards redraw on the game's own refreshHud (the next hop landing / turn start), so roll the human and wait for it.
  await waitHumanDice(page);
  await page.evaluate(() => window.__SSP__.rollDice(1));
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__forcedDice === undefined)); i++) {
    await page.evaluate(() => document.querySelector(".ssp-roll-wrap button")?.click());
    await sleep(200);
  }
  // When the human moves first (seed 2 since PR F's start draw shifts the turn-order
  // rolls), its own landing changes coins and breaks the tie before any refresh
  // shows it. Wait for the landing, then force the tie again; the next mover's
  // hop landings refresh the cards.
  await page.waitForFunction(() => { const m = window.__SSP__.state().match; return m.currentPlayer !== 0; }, null, { timeout: 30000, polling: 50 }).catch(() => {});
  await page.evaluate(() => {
    const want = [[3, 20], [3, 20], [3, 10], [1, 50]];
    const m = window.__SSP__.state().match;
    want.forEach(([st, co], i) => {
      window.__SSP__.giveStars(i, st - m.players[i].stars);
      window.__SSP__.fundPlayer(i, co - m.players[i].coins);
    });
  });
  const how = "after the game's next HUD refresh";
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("[data-hud-player]")).map((c) => (c.querySelector(".ssp-hud-chip__rank")?.textContent ?? "").trim()).join() === "1st,1st,3rd,4th",
    null,
    { timeout: 30000, polling: 30 },
  ).catch(() => {});
  const got = await read();
  check("C2 DOM badges 1st,1st,3rd,4th", J(got.map((g) => g.text)) === J(["1st", "1st", "3rd", "4th"]), `${how} ${J(got.map((g) => g.text))}`);
  check("C2 data-rank 1,1,3,4", J(got.map((g) => g.rank)) === J([1, 1, 3, 4]), J(got.map((g) => g.rank)));
  const cards = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("[data-hud-player]"));
    return { n: cs.length, you: cs.filter((c) => c.hasAttribute("data-you")).map((c) => c.getAttribute("data-hud-player")), pills: cs.filter((c) => { const p = c.querySelector(".ssp-hud-chip__you"); return p && !p.hidden && getComputedStyle(p).display !== "none"; }).length };
  });
  check("C2 4 cards, YOU on seat 0 only", cards.n === 4 && J(cards.you) === J(["0"]) && cards.pills === 1, J(cards));
  await page.context().close();
}

// ---------------------------------------------------------------- A/B forced scenarios
async function abRun() {
  sect(`A/B. forced walks + hint (${BOARD})`);
  const page = await boot(browser, 390, 844, "A", 6);
  await page.evaluate(installSampler);
  await startMatch(page);
  const B = await page.evaluate(() => window.__SSP__.board());
  const G = makeGraph(B);
  const star0 = await page.evaluate(() => window.__SSP__.state().match.starBalloonPos);
  const plan = planner(B, star0);
  note(`board ${B.id}: ${B.size} spaces, forks [${plan.forks.join(",")}], star ${star0}, ${plan.out.length} scenarios`);
  const hasForks = plan.forks.length > 0;
  check("A scenarios found (normal walk)", plan.out.some((s) => s.name === "normal walk"));
  if (hasForks) {
    check("A scenarios found (pass through fork, STAY)", plan.out.some((s) => s.through && s.picks[0] === "STAY"));
    check("A scenarios found (pass through fork, BRANCH)", plan.out.some((s) => s.through && s.picks[0] === "BRANCH"));
    check("A scenarios found (standing on fork)", plan.out.some((s) => s.standing));
  } else note("A board has no forks: fork scenarios skipped");
  note("A5 a second mid-roll lane choice is not scripted: one fork per roll is enough to show the countdown holding across the popup");

  const runs = [];
  for (const sc of plan.out) {
    try {
      await waitHumanDice(page);
    } catch {
      const dg = await page.evaluate(() => ({
        e: window.__LAST,
        screen: window.__SSP__.state().screen,
        ap: window.__AP,
        popups: Array.from(document.querySelectorAll(".ssp-popup, .ssp-shop")).map((p) => (p.textContent || "").trim().slice(0, 80)),
        btns: Array.from(document.querySelectorAll("button")).filter((b) => b.offsetParent).map((b) => (b.textContent || "").trim().slice(0, 20)).slice(0, 8),
        frames: window.__HUDLOG.length,
      }));
      check(`A ${sc.name}: human reached the dice phase`, false, J(dg));
      break;
    }
    const idx = (await page.evaluate(() => window.__HUDLOG.length)) - 1;
    const rolled = await forceRoll(page, sc.start, sc.face);
    const done = rolled && (await driveWalk(page, sc.picks));
    check(`A ${sc.name}: walk ran (${sc.start} +${sc.face}${sc.picks.length ? " " + sc.picks.join(",") : ""})`, rolled && done, `rolled=${rolled} done=${done} ${J(await last(page))}`);
    runs.push({ sc, idx });
    note(`t+${((Date.now() - t0) / 1000).toFixed(0)}s: ${sc.name} done`);
  }

  // A6 teleport: Midway Whistle from the item bar, then the normal counted roll (one item per turn).
  let teleported = false;
  let a6 = null;
  try {
    // The item bar is rebuilt when the turn arms the dice, so the whistle goes in during the CPUs' turns.
    // Two whistles: the used one must stay listed (greyed) after the first is spent.
    const granted = await page.evaluate(() => window.__SSP__.grantItem(0, "warp_whistle") && window.__SSP__.grantItem(0, "warp_whistle"));
    await waitHumanDice(page);
    const idx = (await page.evaluate(() => window.__HUDLOG.length)) - 1;
    const clicked = await page.evaluate(() => {
      const b = document.querySelector('.ssp-item-bar [data-item-use="warp_whistle"]');
      if (b) b.click();
      return !!b;
    });
    const lands0 = await page.evaluate(() => window.__SSP__.phaseLog().filter((x) => x.event === "player:land").length);
    check("A6 whistle granted and item button present", !!granted && clicked, `granted=${granted} button=${clicked}`);
    if (granted && clicked) {
      for (let i = 0; i < 40 && !teleported; i++) {
        await sleep(150);
        const log = await page.evaluate((s) => window.__HUDLOG.slice(s).some((e) => e.ph === "moving" && e.cur === 0), idx);
        if (log) teleported = true;
      }
      check("A6 whistle teleport started (phase moving)", teleported);
      if (teleported) {
        // The teleport no longer ends the turn: back to the pre-roll dice phase, ROLL live, item bar greyed out.
        let back = true;
        try { await waitHumanDice(page, 30000); } catch { back = false; }
        const st = await page.evaluate(() => ({
          ph: window.__SSP__.state().match.phase,
          cur: window.__SSP__.state().match.currentPlayer,
          sp: window.__SSP__.state().match.players[0].space,
          btns: Array.from(document.querySelectorAll(".ssp-item-bar button")).map((b) => [b.disabled, b.getAttribute("data-item-used")]),
        }));
        check("A6 whistle: back to dice phase with ROLL enabled, same player", back && st.ph === "dice" && st.cur === 0, J({ back, ...st }));
        check("A6 whistle: item bar greyed out (disabled, data-item-used=1)", st.btns.length > 0 && st.btns.every(([d, u]) => d && u === "1"), J(st.btns));
        if (back) {
          const face = 3;
          const idx2 = (await page.evaluate(() => window.__HUDLOG.length)) - 1;
          const rolled = await forceRoll(page, st.sp, face);
          const done = rolled && (await driveWalk(page, []));
          const lands = (await page.evaluate(() => window.__SSP__.phaseLog().filter((x) => x.event === "player:land").length)) - lands0;
          check(`A6 whistle: counted walk followed (${st.sp} +${face})`, rolled && done, `rolled=${rolled} done=${done} ${J(await last(page))}`);
          check("A6 whistle: exactly two player:land (teleport hop + walk end)", lands === 2, `${lands} lands`);
          a6 = { dest: st.sp, face, idx: idx2 };
        }
      }
    }
  } catch (err) {
    check("A6 whistle flow", false, String(err).slice(0, 160));
  }

  // B: explicit 0 / 1 / balloon-move frames
  const hintNow = () => page.evaluate(() => window.__SSP__.hudView()?.hint?.text ?? null);
  let dReady = true;
  try { await waitHumanDice(page); } catch { dReady = false; }
  const star = await page.evaluate(() => window.__SSP__.state().match.starBalloonPos);
  if (dReady) {
    await page.evaluate((s) => window.__SSP__.placePlayer(0, s), star);
    await sleep(500);
    check("B hint 0 -> 'On the Grand Prize Balloon!'", (await hintNow()) === "On the Grand Prize Balloon!", J(await hintNow()));
    const pred = B.next.findIndex((row, i) => row.includes(star) && i !== star);
    await page.evaluate((s) => window.__SSP__.placePlayer(0, s), pred);
    await sleep(500);
    check("B hint 1 -> '1 space to the Grand Prize Balloon'", (await hintNow()) === "1 space to the Grand Prize Balloon", `${J(await hintNow())} (pred ${pred})`);
    // Balloon move: fund, stand one before the balloon, roll 1, let autoplay buy.
    const f = await page.evaluate(() => { window.__SSP__.fundPlayer(0, 60); return window.__SSP__.state().match.players[0].coins; });
    check("B funded for a star", f >= 10, `coins ${f}`);
    const mark = (await page.evaluate(() => window.__HUDLOG.length)) - 1;
    await page.evaluate((s) => { window.__AP = "on"; window.__APUNTIL = s; }, star);
    const rolled = await forceRoll(page, pred, 1);
    let moved = false;
    for (let i = 0; i < 160 && !moved; i++) {
      await sleep(250);
      moved = await page.evaluate((s) => window.__LAST?.star !== s, star);
    }
    await sleep(600);
    await setAP(page, "hold");
    check("B balloon moved after the buy", rolled && moved, `rolled=${rolled} moved=${moved}`);
    const log = await page.evaluate((s) => window.__HUDLOG.slice(s), mark);
    const ci = log.findIndex((e) => e.star !== star);
    if (ci >= 0) {
      const fr = log[Math.min(log.length - 1, ci + 2)];
      check("B hint matches the new balloon within 2 frames", fr.hint === G.expHint(fr), `f${fr.f} "${fr.hint}" want "${G.expHint(fr)}" star ${star}->${fr.star}`);
    }
  } else check("B balloon scenario: human reached dice", false);

  const log = await page.evaluate(() => window.__HUDLOG);
  note(`A/B sampled ${log.length} frames, sampler error: ${await page.evaluate(() => window.__SAMPLE_ERR ?? "none")}`);
  const { walks, issues } = analyseCountdown(log, G, B);
  dumpAround(log, issues, "A/B");
  check("A countdown invariants over all sampled frames", issues.length === 0, `${issues.length} issues: ${issues.slice(0, 4).join(" | ")}`);
  const rolledWalks = walks.filter((w) => w.rolled && w.subs.length);
  check("A natural + forced rolled walks seen", rolledWalks.length >= runs.length, `${rolledWalks.length} rolled walks, ${walks.length} segments`);
  for (const { sc, idx } of runs) {
    const fromF = log[idx]?.f ?? 0;
    const w = walks.find((x) => x.f0 > fromF && x.cur === 0 && x.rolled && x.startSpace === sc.start && x.subs.length);
    const gotSubs = w ? w.subs.map((s) => s.start) : null;
    check(`A ${sc.name}: first value == hops walked, lands ${sc.landing}`, !!w && J(gotSubs) === J(sc.subs) && w.landSpace === sc.landing && w.landed, `subs ${J(gotSubs)} want ${J(sc.subs)}, landed at ${w?.landSpace}`);
    if (sc.standing) {
      const first = log.findIndex((e) => e.f >= (w?.f0 ?? 0) && e.cur === 0 && e.ph === "moving" && e.sp === sc.start && e.scr === "board");
      const hiddenDuringChoice = first >= 0 && log[first].cd === null;
      check(`A ${sc.name}: hidden during the lane choice`, hiddenDuringChoice, J(log[first]));
    }
  }
  if (teleported) {
    const tw = walks.filter((w) => w.cur === 0 && w.tele && !w.sawCd);
    check("A6 whistle teleport never showed a countdown", tw.length > 0, `${tw.length} teleport walks without a number`);
  }
  if (a6) {
    const fromF = log[a6.idx]?.f ?? 0;
    const w = walks.find((x) => x.f0 > fromF && x.cur === 0 && x.rolled && x.startSpace === a6.dest && x.subs.length);
    check(`A6 whistle: countdown ${a6.face}..1 from the destination ${a6.dest}`, !!w && J(w.subs.map((s) => s.start)) === J([a6.face]) && w.landed && !w.tele, `walk ${J(w)}`);
  }
  const hn = checkHints(log, G);
  check("B hint == probe BFS on every dice/moving frame, hidden otherwise", hn.bad.length === 0 && hn.shown > 50, `${hn.shown} shown frames, ${hn.bad.length} bad: ${hn.bad.slice(0, 3).join(" | ")}`);
  const sing = [...hn.texts].filter((t) => /^1 spaces?/.test(t));
  check("B singular text only for 1", sing.every((t) => t === "1 space to the Grand Prize Balloon") && ![...hn.texts].some((t) => /^1 spaces/.test(t)), J([...hn.texts].slice(0, 6)));
  const rkl = checkRanksLog(log);
  check("C3 DOM ranks == competitionRanks on sampled frames", rkl.bad.length === 0 && rkl.n > 20, `${rkl.n} samples, ${rkl.bad.length} bad: ${rkl.bad.slice(0, 3).join(" | ")}`);
  await page.context().close();
}

// ---------------------------------------------------------------- A natural autoplay turns
async function naturalRun() {
  sect(`A. natural autoplay turns (${BOARD})`);
  const page = await boot(browser, 390, 844, "An", 6);
  await page.evaluate(installSampler);
  await setAP(page, "on");
  await startMatch(page);
  const B = await page.evaluate(() => window.__SSP__.board());
  const G = makeGraph(B);
  const until = Date.now() + 100000;
  let w0 = 0;
  while (Date.now() < until) {
    w0 = await page.evaluate(() => window.__W0);
    if (w0 >= 3) break;
    await sleep(500);
  }
  await sleep(1500);
  const log = await page.evaluate(() => window.__HUDLOG);
  const { walks, issues } = analyseCountdown(log, G, B);
  dumpAround(log, issues, "natural");
  const human = walks.filter((w) => w.cur === 0 && w.rolled && w.subs.length);
  check("A natural: 3 human autoplay walks seen", w0 >= 3 && human.length >= 3, `W0=${w0}, ${human.length} human rolled walks, ${walks.length} total`);
  check("A natural: countdown invariants (all players, all frames)", issues.length === 0, `${log.length} frames, ${issues.length} issues: ${issues.slice(0, 4).join(" | ")}`);
  const hn = checkHints(log, G);
  check("B natural: hint == BFS on every frame", hn.bad.length === 0, `${hn.shown} shown, ${hn.bad.length} bad: ${hn.bad.slice(0, 3).join(" | ")}`);
  const rkl = checkRanksLog(log);
  check("C3 natural: DOM ranks == competitionRanks", rkl.bad.length === 0, `${rkl.n} samples ${rkl.bad.slice(0, 2).join(" | ")}`);
  await page.context().close();
}

// ---------------------------------------------------------------- D layout
function layoutSampler() {
  const fresh = () => ({ frames: 0, bannerFrames: 0, diceFrames: 0, moveFrames: 0, fabFrames: 0, cdFrames: 0, viol: {}, labels: {}, ellipsis: {}, maxBannerBottom: 0 });
  window.__D = fresh();
  window.__DRESET = () => { window.__D = fresh(); };
  const hit = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (r, w, h) => r.x >= -1 && r.y >= -1 && r.x + r.w <= w + 1 && r.y + r.h <= h + 1;
  const tick = () => {
    const D = window.__D;
    const v = (name, detail) => { const o = (D.viol[name] ??= { n: 0, first: detail }); o.n++; };
    try {
      const S = window.__SSP__.state();
      const hv = S.screen === "board" ? window.__SSP__.hudView() : null;
      if (hv) {
        D.frames++;
        const W = hv.viewport.w, H = hv.viewport.h;
        const ph = S.match.phase;
        if (hv.banners.length) D.bannerFrames++;
        if (ph === "dice" && S.match.currentPlayer === 0) D.diceFrames++;
        if (ph === "moving") D.moveFrames++;
        if (hv.chrome.mapFab) D.fabFrames++;
        if (hv.countdown?.rect) D.cdFrames++;
        for (const b of hv.banners) D.maxBannerBottom = Math.max(D.maxBannerBottom, b.y + b.h);
        const cs = hv.cards, c = hv.chrome;
        cs.forEach((a, i) => {
          for (let j = i + 1; j < cs.length; j++) if (hit(a.rect, cs[j].rect)) v("card/card", `${a.id}&${cs[j].id}`);
          for (const b of hv.banners) if (hit(a.rect, b)) v("card/banner", `card ${a.id} ${JSON.stringify(a.rect)} banner ${JSON.stringify(b)}`);
          if (hv.hint && hit(a.rect, hv.hint.rect)) v("card/hint", `card ${a.id} ${JSON.stringify(a.rect)} hint ${JSON.stringify(hv.hint.rect)}`);
          for (const k of ["roll", "itemBar", "pause", "mapFab", "toast"]) if (hit(a.rect, c[k])) v(`card/${k}`, `card ${a.id} ${JSON.stringify(a.rect)} ${k} ${JSON.stringify(c[k])}`);
          for (const p of c.pads) if (hit(a.rect, p)) v("card/pad", `card ${a.id}`);
          if (hit(a.rect, hv.centre)) v("card/centre", `card ${a.id} ${JSON.stringify(a.rect)}`);
          if (!inside(a.rect, W, H)) v("card outside viewport", `card ${a.id} ${JSON.stringify(a.rect)}`);
          if (a.pillRect && !inside(a.pillRect, W, H)) v("YOU pill outside viewport", JSON.stringify(a.pillRect));
          if (hv.countdown?.rect && hit(a.rect, hv.countdown.rect)) v("countdown/card", `card ${a.id} ${JSON.stringify(a.rect)} cd ${JSON.stringify(hv.countdown.rect)}`);
        });
        if (hv.hint) {
          for (const b of hv.banners) if (hit(hv.hint.rect, b)) v("hint/banner", `hint ${JSON.stringify(hv.hint.rect)} banner ${JSON.stringify(b)}`);
          if (hit(hv.hint.rect, hv.centre)) v("hint/centre", JSON.stringify(hv.hint.rect));
          if (hit(hv.hint.rect, c.mapFab)) v("hint/mapFab", JSON.stringify(hv.hint.rect));
          if (hit(hv.hint.rect, c.pause)) v("hint/pause", JSON.stringify(hv.hint.rect));
          if (!inside(hv.hint.rect, W, H)) v("hint outside viewport", JSON.stringify(hv.hint.rect));
        }
        for (const b of hv.banners) if (hit(b, hv.centre)) v("banner/centre", `banner ${JSON.stringify(b)}`);
        if (cs.length && c.pads.length) v("pads with cards", String(c.pads.length));
        // Label ellipsis: every card name must show in full.
        document.querySelectorAll(".ssp-hud-chip").forEach((chip) => {
          const n = chip.querySelector(".ssp-hud-chip__name");
          if (!n) return;
          const t = (n.textContent || "").trim();
          D.labels[t] = true;
          if (n.scrollWidth > n.clientWidth) D.ellipsis[t] = `${n.scrollWidth}>${n.clientWidth}`;
        });
      }
    } catch (err) {
      D.err = String(err);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function layoutRun() {
const pageD = await boot(browser, 390, 844, "D", 1);
await pageD.evaluate(layoutSampler);
for (const [w, h] of [[390, 844], [430, 932]]) {
  sect(`D. layout ${w}x${h} (${BOARD})`);
  const page = pageD;
  await page.evaluate(() => window.__SSP__.goto("title"));
  await page.waitForFunction(() => window.__SSP__.state().screen === "title", null, { timeout: LOAD });
  await page.setViewportSize({ width: w, height: h });
  await sleep(600);
  await page.evaluate(() => window.__DRESET());
  await startMatch(page);
  const tag = `D${w}`;
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}${SFX}-${w}x${h}.png` });
  try {
    await page.waitForFunction(() => window.__D.bannerFrames > 3, null, { timeout: 20000, polling: 50 });
    await shot("banner");
  } catch {
    check(`${tag} turn-start banner seen`, false);
  }
  try {
    await page.waitForFunction(
      () => {
        const hv = window.__SSP__.hudView();
        const b = document.querySelector(".ssp-roll-wrap button");
        return !!hv && hv.banners.length === 0 && !!hv.chrome.mapFab && !!hv.hint && !!b && !b.disabled && window.__SSP__.state().match.phase === "dice";
      },
      null,
      { timeout: 30000, polling: 100 },
    );
    await sleep(600);
    await shot("hud");
    const rolled = await forceRoll(page, 0, 6);
    check(`${tag} forced roll`, rolled);
    // Shoot with hops still to go: the screenshot takes a while and the number is gone once the walk lands.
    await page.waitForFunction(() => { const c = window.__SSP__.hudView()?.countdown; return !!c?.rect && c.value >= 3; }, null, { timeout: 20000, polling: 30 });
    await shot("move");
    await driveWalk(page, [], 30000);
    await sleep(1500);
  } catch (err) {
    check(`${tag} dice/walk phases reached`, false, String(err).slice(0, 120));
  }
  const D = await page.evaluate(() => window.__D);
  check(`${tag} sampled banner, dice, map-fab and walk frames`, D.bannerFrames > 10 && D.diceFrames > 10 && D.fabFrames > 10 && D.moveFrames > 10 && D.cdFrames > 5, `frames ${D.frames} banner ${D.bannerFrames} dice ${D.diceFrames} fab ${D.fabFrames} move ${D.moveFrames} cd ${D.cdFrames}`);
  const names = [
    "card/card", "card/banner", "card/hint", "hint/banner", "card/roll", "card/itemBar", "card/pause", "card/mapFab", "card/toast", "card/pad",
    "card/centre", "hint/centre", "banner/centre", "card outside viewport", "YOU pill outside viewport", "hint outside viewport", "hint/mapFab", "hint/pause",
    "countdown/card", "pads with cards",
  ];
  for (const n of names) check(`${tag} ${n}`, !D.viol[n], D.viol[n] ? `${D.viol[n].n}x first ${D.viol[n].first}` : "");
  check(`${tag} no card label is ellipsised`, Object.keys(D.ellipsis).length === 0, J(D.ellipsis));
  const seen = Object.keys(D.labels);
  check(`${tag} saw the long labels (Glimmer, Bounce, Player 4)`, ["Glimmer", "Bounce", "Player 4"].every((n) => seen.includes(n)), J(seen));
  check(`${tag} no sampler error`, !D.err, D.err ?? "");
}
await pageD.context().close();
}

// The three long runs are independent pages, so they overlap to stay inside the time budget.
await Promise.all([abRun(), naturalRun(), layoutRun()]);

await browser.close();

check("no console / page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = rows.filter((r) => !r.ok);
console.log(`\n| result | check |\n|---|---|`);
for (const r of rows) console.log(`| ${r.ok ? "PASS" : "FAIL"} | ${r.name} |`);
console.log(`\n${BOARD}: ${rows.length - failed.length}/${rows.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (errors.length) console.log("errors:\n  " + errors.slice(0, 10).join("\n  "));
process.exit(failed.length || errors.length ? 1 : 0);
