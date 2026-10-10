/**
 * Probe: the Grand Prize Balloon start / relocation rule and its "THE STAR MOVED!" beat (PR F).
 *   A. static rule, both boards: board().prizeSpots == probe-side derivation; carnival 32, downtown 39.
 *   B. seeded placement: start in prizeSpots, not within 2 hops of the start, same seed twice equal, spread.
 *   C. relocation after a buy: new != old, in prizeSpots, not within 2 hops of the buyer; tier fallbacks.
 *   D. beat: MOVED goes active only after the ceremony, banner in the DOM, balloon shot, 1.6 +- 0.1 s.
 *   E. hint follows the new balloon within 2 frames.
 *   F. star scale during the ceremony (390x844, plus 430x932 in full mode).
 * Full mode also sweeps every Downtown candidate with the balloon on it into $SSP_SHOTS/downtown-sweep.
 *
 *   SSP_URL=http://127.0.0.1:5203 SSP_SHOTS=dir node tools/probe-star-move.mjs [--ci]
 *   --ci: one load at ?speed=8&lively=1 on the carnival (+ one extra navigation for the Downtown rule), 5 seeds.
 *   SSP_WEBKIT=1 uses webkit (chromium otherwise).
 */
import { chromium, webkit } from "@playwright/test";
import fs from "node:fs";

const CI = process.argv.includes("--ci");
const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5203").replace(/\/$/, "");
const SHOTS = process.env.SSP_SHOTS ?? "/tmp/ssp-star-move";
const LOAD = 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0;
const fails = [];
const errors = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fails.push(`${name}${detail ? ` :: ${detail}` : ""}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` :: ${detail}` : ""}`);
}
const note = (s) => console.log(`     ${s}`);
const J = (x) => JSON.stringify(x);

/* ------------------------------------------------------------------ graph (probe side) */
function graph(B) {
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
  const near = (x, n = 2) => {
    const out = new Set();
    for (let s = 0; s < B.size; s++) if ((dist(x, s, n) ?? 99) <= n || (dist(s, x, n) ?? 99) <= n) out.add(s);
    return out;
  };
  const derive = () => {
    const reach = new Set([B.startIndex]);
    const q = [B.startIndex];
    while (q.length) for (const c of B.next[q.shift()] ?? []) if (!reach.has(c)) { reach.add(c); q.push(c); }
    const preds = new Map();
    for (const p of reach) for (const c of B.next[p] ?? []) preds.set(c, (preds.get(c) ?? new Set()).add(p));
    return [...reach]
      .filter((s) => s !== B.startIndex && B.spaces[s]?.type !== "shop" && (B.next[s]?.length ?? 0) <= 1 && (preds.get(s)?.size ?? 0) < 2)
      .sort((a, b) => a - b);
  };
  const hintText = (d) => (d === null ? null : d === 0 ? "On the Grand Prize Balloon!" : d === 1 ? "1 space to the Grand Prize Balloon" : `${d} spaces to the Grand Prize Balloon`);
  const expHint = (fr) => (fr && fr.hv && fr.scr === "board" && (fr.ph === "dice" || fr.ph === "moving") ? hintText(dist(fr.sp, fr.star, 200)) : null);
  return { dist, near, derive, expHint };
}

/* ------------------------------------------------------------------ page helpers */
const launcher = process.env.SSP_WEBKIT ? webkit : chromium;
let browser = await launcher.launch();
let relaunches = 0;
/** The headless browser has died mid-run under box load; relaunch it so one crash does not end the sweep. */
async function alive() {
  if (browser.isConnected()) return;
  relaunches++;
  note(`browser died, relaunch #${relaunches}`);
  browser = await launcher.launch();
}

async function open(w, h, query) {
  await alive();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`PAGE: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/interactive-widget/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  await page.goto(`${BASE}/?${query}&audio=0&screen=board`, { waitUntil: "domcontentloaded", timeout: LOAD });
  await ready(page);
  return page;
}
const ready = (page) => page.waitForFunction(() => window.__SSP__?.state?.()?.match?.players?.length, null, { timeout: LOAD });
const info = (page) => page.evaluate(() => ({ B: window.__SSP__.board(), star: window.__SSP__.state().match.starBalloonPos }));

/** In-page sampler: holds autoplay off while the human is at the dice, records one frame per rAF while __REC. */
function installSampler() {
  window.__HOLD = true;
  window.__REC = false;
  window.__LOG = [];
  let ap = null;
  let f = 0;
  const tick = () => {
    f++;
    try {
      const S = window.__SSP__.state();
      const m = S.match;
      if (m.phase === "minigame" && f % 15 === 0) Array.from(document.querySelectorAll("button")).find((b) => b.offsetParent && /start mini ?game/i.test(b.textContent || ""))?.click();
      window.__ATDICE = S.screen === "board" && m.phase === "dice" && m.currentPlayer === 0;
      const want = window.__HOLD ? !window.__ATDICE : !!window.__APON;
      if (want !== ap) { window.__SSP__.autoplay(want); ap = want; }
      if (window.__REC) {
        const cur = m.currentPlayer;
        const hv = S.screen === "board" ? window.__SSP__.hudView() : null;
        const cer = globalThis.__SSP_STAR_CEREMONY;
        const mv = globalThis.__SSP_STAR_MOVED;
        const sh = window.__SSP__.livelyShots();
        window.__LOG.push({
          f, scr: S.screen, ph: m.phase, cur, sp: m.players[cur]?.space ?? -1, star: m.starBalloonPos, hv: !!hv, hint: hv?.hint?.text ?? null,
          cer: cer?.active ? cer.t : null, mv: mv?.active ? mv.t : null,
          ban: mv?.active ? document.body.innerText.includes("THE STAR MOVED!") : false,
          shk: sh.active, shb: sh.byKind?.balloon ?? 0, tr: globalThis.__SSP_STAR_TRAVEL?.active ? { ...globalThis.__SSP_STAR_TRAVEL } : null,
          p0: m.players[0]?.space,
        });
      }
    } catch (e) { window.__ERR = String(e); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function waitHumanDice(page) {
  await page.waitForFunction(() => {
    const b = document.querySelector(".ssp-roll-wrap button");
    return window.__ATDICE && b && !b.disabled && !document.querySelector(".ssp-popup");
  }, null, { timeout: 120000, polling: 100 });
  await sleep(500);
}

/**
 * Seat 0 one step before the balloon, funded, forced roll of 1, then autoplay buys. Returns the frame log from the
 * roll to the end of the reveal beat. `setStar` first moves the balloon (dev hook) so a branch space can be tested.
 */
async function buyScenario(page, G, B, { setStar = null, shotTag = null } = {}) {
  await waitHumanDice(page);
  if (setStar !== null) await page.evaluate((s) => window.__SSP__.placeBalloon(s), setStar);
  const star = await page.evaluate(() => window.__SSP__.state().match.starBalloonPos);
  const preds = B.next.map((row, i) => [row, i]).filter(([row, i]) => i !== star && row.length === 1 && row[0] === star).map(([, i]) => i);
  if (!preds.length) return { error: `no single-exit predecessor of ${star}` };
  const pred = preds[0];
  await page.evaluate((p) => { window.__SSP__.placePlayer(0, p); window.__SSP__.fundPlayer(0, 60); }, pred);
  await sleep(1200);
  await page.evaluate(() => { window.__LOG = []; window.__REC = true; window.__SSP__.rollDice(1); window.__HOLD = false; window.__APON = false; });
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => document.querySelector(".ssp-roll-wrap button")?.click());
    await sleep(200);
    if (await page.evaluate(() => window.__forcedDice === undefined)) break;
  }
  await page.evaluate(() => { window.__APON = true; });
  const shots = shotTag ? { [`${shotTag}-ceremony`]: [1.2, false] } : {};
  const t0 = Date.now();
  let sawMv = false;
  while (Date.now() - t0 < 45000) {
    const c = await page.evaluate(() => ({ cer: globalThis.__SSP_STAR_CEREMONY, mv: globalThis.__SSP_STAR_MOVED }));
    for (const [k, v] of Object.entries(shots)) if (!v[1] && c.cer?.active && c.cer.t >= v[0]) { v[1] = true; await page.screenshot({ path: `${SHOTS}/${k}.png` }); }
    if (c.mv?.active) { sawMv = true; if (shotTag && !shots[`${shotTag}-moved`]) { shots[`${shotTag}-moved`] = [0, true]; await page.screenshot({ path: `${SHOTS}/${shotTag}-moved.png` }); } }
    if (sawMv && !c.mv?.active) break;
    await sleep(40);
  }
  await sleep(300);
  const log = await page.evaluate(() => { window.__REC = false; return window.__LOG; });
  await page.evaluate(() => { window.__HOLD = true; window.__APON = false; });
  const end = await page.evaluate(() => window.__SSP__.state().match.starBalloonPos);
  if (!log.length) note(`sampler error: ${await page.evaluate(() => window.__ERR)}`);
  return { star, pred, end, log, sawMv };
}

function analyse(tag, r, G, B, { speed, lively }) {
  if (r.error) { check(`${tag} scenario`, false, r.error); return; }
  const { star: old, end, log } = r;
  check(`C ${tag} balloon relocated (${old}->${end})`, end !== old && r.sawMv, `end ${end} sawMv ${r.sawMv}`);
  check(`C ${tag} new in prizeSpots`, B.prizeSpots.includes(end));
  const buyer = old; // the buy happens on the balloon space (roll of 1 from its predecessor)
  const nr = G.near(buyer);
  check(`C ${tag} new not within 2 hops of buyer ${buyer}`, !nr.has(end), `near ${[...nr].join(",")}`);
  // D
  const lastCer = log.map((e) => e.cer !== null).lastIndexOf(true);
  const firstMv = log.findIndex((e) => e.mv !== null);
  check(`D ${tag} MOVED starts only after the ceremony ends`, lastCer >= 0 && firstMv > lastCer, `lastCer ${lastCer} firstMv ${firstMv}`);
  check(`D ${tag} banner "THE STAR MOVED!" in the DOM`, log.some((e) => e.ban));
  // The last write (t >= 1.6) flips active off, so the largest sampled t sits one rAF step short of the end.
  const mvT = log.map((e) => e.mv).filter((t) => t !== null);
  const mvMax = Math.max(0, ...mvT);
  const step = Math.max(0, ...mvT.slice(1).map((t, i) => t - mvT[i]));
  check(`D ${tag} beat lasts 1.6 +- 0.1 board s`, mvMax < 1.6 + 0.1 && mvMax + step >= 1.6 - 0.1, `max t ${mvMax}, frame step ${step.toFixed(2)}`);
  if (lively && speed <= 6) {
    const before = log[0]?.shb ?? 0;
    check(`D ${tag} balloon shot runs during the beat`, log.some((e) => e.mv !== null && e.shk === "balloon") && Math.max(...log.map((e) => e.shb)) > before, `byKind.balloon ${before} -> ${Math.max(...log.map((e) => e.shb))}`);
  } else note(`D ${tag} balloon-shot check skipped (speed ${speed} > 6)`);
  // E: within 2 frames of the change the hint reads the distance to the NEW balloon (or the previous frame's, as probe-hud allows)
  const ci = log.findIndex((e) => e.star !== old);
  if (ci >= 0) {
    // the change lands mid-beat where the HUD hint may legitimately be hidden; check the first frames where it is derivable
    const win = log.slice(ci, ci + 3);
    const ok = win.some((fr, i) => fr.hint === G.expHint(fr) || fr.hint === G.expHint(log[ci + i - 1]));
    const later = log.slice(ci).find((fr) => G.expHint(fr) !== null && fr.hv);
    const okLater = later ? later.hint === G.expHint(later) || later.hint === G.expHint(log[log.indexOf(later) - 1]) : true;
    check(`E ${tag} hint follows the new balloon within 2 frames`, ok && okLater, `win ${J(win.map((w) => [w.hint, G.expHint(w), w.ph, w.sp, w.star]))} later ${J(later && [later.hint, G.expHint(later)])}`);
  } else check(`E ${tag} star changed in the log`, false);
  return log;
}

function scaleChecks(tag, log, innerH, limit = 0.2) {
  const tr = log.map((e) => e.tr).filter(Boolean);
  check(`F ${tag} travel samples seen`, tr.length > 0, "no __SSP_STAR_TRAVEL.active frames");
  if (!tr.length) return;
  const hover = tr.filter((t) => t.phase === "hover");
  check(`F ${tag} hover phase seen`, hover.length > 0, J([...new Set(tr.map((t) => t.phase))]));
  // The "out" phase is the star leaving the hero (it shrinks on purpose), so the scale window is every other phase.
  const bad = tr.filter((t) => t.phase !== "out" && t.heroH > 0 && (t.span / t.heroH < 0.7 || t.span / t.heroH > 1.4));
  check(`F ${tag} 0.7 <= span/heroH <= 1.4`, bad.length === 0, J(bad.slice(0, 2)));
  const low = hover.filter((t) => !(t.y > t.headTop));
  check(`F ${tag} hover y > headTop`, low.length === 0, J(low.slice(0, 2)));
  const wide = tr.filter((t) => !(Math.abs(t.dx) < 0.6) && t.phase === "hover");
  check(`F ${tag} dx < 0.6 at hover`, wide.length === 0, J(wide.slice(0, 2)));
  const tall = tr.filter((t) => t.screenH > limit * innerH);
  check(`F ${tag} screenH <= ${limit} x innerHeight`, tall.length === 0, J(tall.slice(0, 2)));
  note(`F ${tag} sample: ${J(hover[Math.floor(hover.length / 2)] ?? tr[0])}`);
}

/* ------------------------------------------------------------------ parts */
const speedQ = CI ? "speed=8" : "speed=6";
const boards = CI ? ["carnival"] : (process.env.SSP_BOARDS ?? "carnival,downtown").split(",");

// A: static rule. Needs a page per board (the board is chosen at load).
const infoByBoard = {};
async function partA() {
  console.log("A. static rule");
  const want = { carnival: 32, downtown: 39 };
  for (const b of CI ? ["carnival", "downtown"] : boards) {
    const page = await open(390, 844, `seed=1&lively=1&${speedQ}&board=${b}`);
    const { B, star } = await info(page);
    infoByBoard[b] = { B, star };
    const G = graph(B);
    const d = G.derive();
    check(`A ${b} prizeSpots == probe derivation`, J(d) === J(B.prizeSpots), `got ${J(B.prizeSpots)} want ${J(d)}`);
    check(`A ${b} count ${want[b]}`, B.prizeSpots.length === want[b], `${B.prizeSpots.length}`);
    if (b === "carnival") {
      const out = [0, 10, 6, 38, 18, 32, 20, 21, 22, 23, 24, 25];
      check("A carnival excludes 0,10,6,38,18,32,20-25", out.every((s) => !B.prizeSpots.includes(s)), out.filter((s) => B.prizeSpots.includes(s)).join(","));
    }
    if (!CI || b === "carnival") infoByBoard[b].page = page;
    else await page.context().close();
  }
}

// B: seeded placement by navigation.
async function partB(b) {
  console.log(`B. seeded placement (${b})`);
  const { B } = infoByBoard[b];
  const G = graph(B);
  const seeds = Array.from({ length: CI ? 5 : 20 }, (_, i) => i + 1);
  const vals = [];
  const startOf = async (seed) => {
    if (infoByBoard[b].page.isClosed() || !browser.isConnected()) infoByBoard[b].page = await open(390, 844, `seed=${seed}&lively=1&${speedQ}&board=${b}`);
    const page = infoByBoard[b].page;
    await page.goto(`${BASE}/?seed=${seed}&screen=board&audio=0&lively=1&${speedQ}&board=${b}`, { waitUntil: "domcontentloaded", timeout: LOAD });
    await ready(page);
    return page.evaluate(() => ({ star: window.__SSP__.state().match.starBalloonPos, start: window.__SSP__.board().startIndex }));
  };
  for (const s of seeds) {
    const { star, start } = await startOf(s);
    vals.push(star);
    check(`B ${b} seed ${s}: ${star} in prizeSpots and not within 2 hops of start`, B.prizeSpots.includes(star) && !G.near(start).has(star));
  }
  const again = await startOf(seeds[0]);
  check(`B ${b} same seed twice -> same start`, again.star === vals[0], `${again.star} vs ${vals[0]}`);
  if (!CI) check(`B ${b} >= 6 distinct starts over 20 seeds`, new Set(vals).size >= 6, `${new Set(vals).size}: ${vals.join(",")}`);
}

// tier fallbacks, pure (any loaded page)
async function partTier(b) {
  const { B } = infoByBoard[b];
  const page = infoByBoard[b].page;
  const spots = B.prizeSpots;
  const res = await page.evaluate(([spots, ex]) => {
    const out = [];
    for (let i = 0; i < 20; i++) out.push(window.__SSP__.prizePickPreview(ex, spots, i / 20));
    const x = spots.find((s) => s !== ex);
    const nearAllButX = spots.filter((s) => s !== x && s !== ex);
    return { all: out, one: window.__SSP__.prizePickPreview(ex, nearAllButX, 0.5), x };
  }, [spots, spots[3]]);
  check(`C ${b} near = all spots -> tier 2, never returns exclude`, res.all.every((p) => p.tier === 2 && p.to !== spots[3]), J(res.all.find((p) => p.tier !== 2 || p.to === spots[3])));
  check(`C ${b} one-candidate case picks it at tier 1 (tier 3 only if nothing else)`, res.one.candidates.length === 1 && res.one.to === res.x && res.one.tier === 1, J(res.one));
  check(`C ${b} tier 3 never appears with real spots`, res.all.every((p) => p.tier !== 3));
}

// C-F: buys
async function partBuys(b, seeds) {
  console.log(`C-F. relocation + beat (${b}, seeds ${seeds.join(",")})`);
  const { B } = infoByBoard[b];
  const G = graph(B);
  let first = true;
  for (const seed of seeds) {
    const r = await runBuy(390, 844, `seed=${seed}&lively=1&${speedQ}&board=${b}`, G, B, { shotTag: first ? `${b}-seed${seed}-390` : null });
    note(`seed ${seed} done at ${((Date.now() - T0) / 1000).toFixed(0)}s`);
    const log = analyse(`${b} seed ${seed}`, r, G, B, { speed: CI ? 8 : 6, lively: 1 });
    if (log && first) { scaleChecks(`${b} 390x844`, log, 844); first = false; }
  }
  if (!CI && b === "downtown") {
    for (const star of [34, 42]) {
      if (!B.prizeSpots.includes(star)) { note(`downtown branch space ${star} not a prize spot, skipped`); continue; }
      const r = await runBuy(390, 844, `seed=3&lively=1&${speedQ}&board=downtown`, G, B, { setStar: star });
      analyse(`downtown fork-branch buy on ${star}`, r, G, B, { speed: 6, lively: 1 });
    }
  }
}

async function partScale430() {
  console.log("F. 430x932");
  const { B } = infoByBoard.carnival;
  const G = graph(B);
  const r = await runBuy(430, 932, `seed=2&lively=1&${speedQ}&board=carnival`, G, B, { shotTag: "carnival-430" });
  if (r.log) scaleChecks("carnival 430x932", r.log, 932);
  else check("F 430 scenario", false, r.error);
}

/** One buy scenario on a fresh page; retries once if the browser or page dies. */
async function runBuy(w, h, query, G, B, opts) {
  let err = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let page = null;
    try {
      page = await open(w, h, query);
      await page.evaluate(installSampler);
      return await buyScenario(page, G, B, opts);
    } catch (e) {
      err = String(e).slice(0, 200);
      note(`scenario attempt ${attempt + 1} failed: ${err}`);
    } finally {
      await page?.context().close().catch(() => {});
    }
  }
  return { error: err };
}

async function sweep() {
  console.log("Downtown candidate sweep");
  const dir = `${SHOTS}/downtown-sweep`;
  fs.mkdirSync(dir, { recursive: true });
  const { B } = infoByBoard.downtown;
  const page = await open(390, 844, "seed=5&lively=1&speed=6&board=downtown");
  await page.evaluate(installSampler);
  await waitHumanDice(page);
  let n = 0;
  for (const s of B.prizeSpots) {
    await page.evaluate((sp) => { window.__SSP__.placeBalloon(sp); window.__SSP__.placePlayer(0, sp); }, s);
    await sleep(900);
    await page.screenshot({ path: `${dir}/${s}.png` });
    n++;
  }
  check(`sweep ${n} screenshots saved`, n === B.prizeSpots.length && fs.readdirSync(dir).length >= n);
  await page.context().close();
}

try {
  await partA();
  for (const b of boards) {
    if (!infoByBoard[b]?.page) continue;
    await partB(b);
    await partTier(b);
  }
  if (CI) {
    await partBuys("carnival", [1]);
  } else {
    for (const b of boards) await partBuys(b, [1, 2, 3, 4, 5, 6, 7, 8]);
    if (boards.includes("carnival")) await partScale430();
    if (boards.includes("downtown")) await sweep();
  }
} catch (e) {
  check("probe ran to completion", false, String(e).slice(0, 300));
}

for (const e of errors.slice(0, 5)) console.log(`PAGEERR ${e}`);
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const total = pass + fails.length;
console.log(fails.length ? `FAIL ${fails.length}/${total}\n${fails.map((f) => ` - ${f}`).join("\n")}` : `PASS ${pass}/${total}`);
console.log(`elapsed ${((Date.now() - T0) / 1000).toFixed(1)}s`);
await browser.close().catch(() => {});
process.exit(fails.length ? 1 : 0);
