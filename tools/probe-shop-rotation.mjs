// Gumball Shop rotation probe. Three autoplay pages play SSP_TURNS rounds:
// two on seed 7 must log the same restock sequence, one on seed 8 must
// differ somewhere. Seed 8 also puts each CPU one hop before shop 10 at the
// start of its turn (rounds 1-2) with spare coins, so CPUs really visit.
// Checked on every page:
//   - each shop stocks 3 distinct catalog keys, never the same set two rounds running
//   - every key has weight > 0 for its round's phase; Star Cannon only in its last 5 rounds
//   - each restock draws exactly 6 times from the core rng, one restock per round
//   - every CPU visit sold from the shop's current restock, and bought only from it
// Then the stall opens at 390x844 and 430x932 (touch, chromium + webkit):
// exactly the 3 stocked [data-item] cards, a [data-shop-restock] pill, no grid
// or popup scrolling, the first card inside the popup, CLOSE on screen.
//
//   node tools/probe-shop-rotation.mjs
//   SSP_URL=http://127.0.0.1:5193 SSP_SHOTS=/tmp/shots node tools/probe-shop-rotation.mjs
//
// Exits 1 on any failure or page error.
import { mkdirSync } from "node:fs";
import { chromium, webkit } from "@playwright/test";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const SHOTS = process.env.SSP_SHOTS ?? "";
const TURNS = Math.max(2, Number(process.env.SSP_TURNS ?? 4));
const PLAY = `screen=board&autoplay=1&audio=0&speed=4`;
// About a minute a turn on a GitHub runner at speed 4 (see twin-seed).
const CAP_MS = Number(process.env.SSP_CAP_MS ?? TURNS * 110000 + 60000);
// Space before shop 10 on the main lap: any roll passes or lands on the shop.
const BEFORE_SHOP = 9;
const PLACE_ROUNDS = 2;
const DRAWS_PER_RESTOCK = 6;

if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`FAIL ${msg}`);
};

async function play(page, seed, label, steer) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
  await page.goto(`${BASE}/?seed=${seed}&${PLAY}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state && window.__SSP__?.shopStock, null, { timeout: 45000 });
  if (steer) {
    // On each CPU turn start (phase "dice", before the roll), put it one hop
    // before the shop and top up its coins so it has something to afford.
    await page.evaluate(
      ({ before, rounds }) => {
        const seen = new Set();
        window.__ROT_PLACED = [];
        const tick = () => {
          const api = window.__SSP__;
          const m = api?.state?.()?.match;
          if (m && m.phase === "dice" && m.turn <= rounds) {
            const pid = m.currentPlayer;
            const key = `${m.turn}:${pid}`;
            const p = m.players?.[pid];
            if (p && p.controller === "cpu" && !seen.has(key)) {
              seen.add(key);
              api.placePlayer(pid, before);
              api.fundPlayer(pid, 40);
              window.__ROT_PLACED.push({ turn: m.turn, pid });
            }
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { before: BEFORE_SHOP, rounds: PLACE_ROUNDS }
    );
  }
  const t0 = Date.now();
  let reported = 0;
  let st = null;
  // Round TURNS closes when match.turn reaches TURNS + 1 (its restock runs
  // then); wait for that turn's start so the last minigame has finished.
  while (Date.now() - t0 < CAP_MS) {
    st = await page.evaluate(() => {
      const btn = document.querySelector("#mg-start-btn");
      if (btn) btn.click();
      const s = window.__SSP__.state();
      const marks = window.__SSP__.rngTurnLog();
      return {
        turn: s.match.turn,
        screen: s.screen,
        started: marks.filter((m) => m.event === "turn:start").map((m) => m.turn),
      };
    });
    const closed = Math.min(TURNS, st.turn - 1);
    if (closed > reported) {
      reported = closed;
      console.log(`${label} round ${reported} closed at ${Date.now() - t0}ms`);
    }
    if (st.started.includes(TURNS + 1) || st.screen === "finale") break;
    await page.waitForTimeout(100);
  }
  const data = await page.evaluate(() => ({
    shop: window.__SSP__.shopStock(),
    weights: window.__SSP__.shopWeights(),
    items: (window.__SSP__.itemState()?.catalog ?? []).map((d) => d.key),
    totalTurns: window.__SSP__.state().match.totalTurns,
    seats: window.__SSP__.state().match.players.map((p) => p.controller),
    placed: window.__ROT_PLACED ?? [],
  }));
  return { ...data, errors, last: st, ms: Date.now() - t0 };
}

function phaseOf(turn, total) {
  const p = (turn - 1) / Math.max(1, total - 1);
  return p < 1 / 3 ? 0 : p < 2 / 3 ? 1 : 2;
}

function checkRun(label, run, catalog) {
  const log = run.shop.restockLog;
  if (run.errors.length) fail(`${label} page errors ${JSON.stringify(run.errors)}`);
  if (!run.last || !run.last.started.includes(TURNS + 1)) fail(`${label} did not reach turn ${TURNS + 1} start: ${JSON.stringify(run.last)}`);
  // One restock per round, turns 1..TURNS+1 in order.
  const turns = log.map((e) => e.turn);
  const want = Array.from({ length: TURNS + 1 }, (_, i) => i + 1);
  if (JSON.stringify(turns.slice(0, TURNS + 1)) !== JSON.stringify(want)) fail(`${label} restock turns ${JSON.stringify(turns)}, want ${JSON.stringify(want)}`);
  const spaces = Object.keys(log[0]?.stock ?? {});
  if (spaces.length !== 2) fail(`${label} expected 2 shop spaces, got ${JSON.stringify(spaces)}`);
  for (const [i, e] of log.entries()) {
    const draws = e.drawsAfter - e.drawsBefore;
    if (draws !== DRAWS_PER_RESTOCK) fail(`${label} turn ${e.turn} restock drew ${draws}, want ${DRAWS_PER_RESTOCK}`);
    if (JSON.stringify(Object.keys(e.stock)) !== JSON.stringify(spaces)) fail(`${label} turn ${e.turn} shop spaces ${JSON.stringify(Object.keys(e.stock))}`);
    const phase = phaseOf(e.turn, run.totalTurns);
    const cannonOk = run.totalTurns - e.turn + 1 <= 5;
    for (const space of spaces) {
      const keys = e.stock[space] ?? [];
      if (keys.length !== 3 || new Set(keys).size !== 3) fail(`${label} turn ${e.turn} shop ${space} not 3 distinct: ${JSON.stringify(keys)}`);
      for (const k of keys) {
        if (!catalog.has(k)) fail(`${label} turn ${e.turn} shop ${space} unknown key ${k}`);
        if (!((run.weights[k]?.[phase] ?? 0) > 0)) fail(`${label} turn ${e.turn} shop ${space} ${k} has weight 0 in phase ${phase}`);
        if (k === "star_cannon" && !cannonOk) fail(`${label} turn ${e.turn} shop ${space} star_cannon before its last 5 rounds`);
      }
      const prev = log[i - 1];
      if (prev && prev.turn === e.turn - 1) {
        const a = [...(prev.stock[space] ?? [])].sort().join(",");
        const b = [...keys].sort().join(",");
        if (a === b) fail(`${label} shop ${space} repeated set at turns ${prev.turn}->${e.turn}: ${b}`);
      }
    }
  }
  const lastEntry = log[log.length - 1];
  if (lastEntry && (run.shop.round !== lastEntry.turn || JSON.stringify(run.shop.stock) !== JSON.stringify(lastEntry.stock))) {
    fail(`${label} live stock (round ${run.shop.round}) is not the last restock (turn ${lastEntry.turn})`);
  }
  // Every visit (CPU or autoplay human) sold from that round's restock for its space.
  for (const v of run.shop.visits) {
    const entry = log.filter((e) => e.turn <= v.turn).pop();
    const shown = entry?.stock[String(v.space)];
    if (!entry || entry.turn !== v.turn || JSON.stringify(shown) !== JSON.stringify(v.stock)) {
      fail(`${label} visit ${JSON.stringify(v)} stock is not restock turn ${v.turn} space ${v.space}: ${JSON.stringify(shown)}`);
    }
    if (v.bought !== null && !v.stock.includes(v.bought)) fail(`${label} visit bought ${v.bought} not on display ${JSON.stringify(v.stock)}`);
  }
}

function summarizeLog(log) {
  return log.map((e) => `t${e.turn}:${Object.entries(e.stock).map(([s, k]) => `${s}=${k.join("/")}`).join(" ")}`).join(" | ");
}

/* ---------------- gameplay runs ---------------- */

const browser = await chromium.launch();
const ctx = () => browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const [ctxA, ctxB, ctxC] = await Promise.all([ctx(), ctx(), ctx()]);
try {
  const [a, b, c] = await Promise.all([
    play(await ctxA.newPage(), 7, "seed7a", false),
    play(await ctxB.newPage(), 7, "seed7b", false),
    play(await ctxC.newPage(), 8, "seed8", true),
  ]);
  for (const [label, run] of [["seed7a", a], ["seed7b", b], ["seed8", c]]) {
    console.log(`${label} ${run.ms}ms errors ${run.errors.length} restocks ${run.shop.restockLog.length} visits ${run.shop.visits.length}`);
  }
  const catalog = new Set(a.items);
  if (catalog.size < 20) fail(`item catalog looks empty: ${catalog.size} keys`);
  for (const k of Object.keys(a.weights)) if (!catalog.has(k)) fail(`weight table key ${k} not in catalog`);
  checkRun("seed7a", a, catalog);
  checkRun("seed7b", b, catalog);
  checkRun("seed8", c, catalog);

  console.log(`seed7 stock ${summarizeLog(a.shop.restockLog)}`);
  console.log(`seed8 stock ${summarizeLog(c.shop.restockLog)}`);
  if (JSON.stringify(a.shop.restockLog) !== JSON.stringify(b.shop.restockLog)) {
    fail(`seed 7 pages logged different stock: ${summarizeLog(b.shop.restockLog)}`);
  } else console.log("seeded: seed7a == seed7b");
  const stocks = (run) => JSON.stringify(run.shop.restockLog.map((e) => e.stock));
  if (stocks(a) === stocks(c)) fail("seed 8 stock sequence equals seed 7");
  else console.log("seeded: seed8 differs from seed7");

  // A real CPU must have visited a shop and bought from the display.
  const cpuVisits = c.shop.visits.filter((v) => c.seats[v.pid] === "cpu");
  const cpuBuys = cpuVisits.filter((v) => v.bought !== null);
  console.log(`seed8 placed ${JSON.stringify(c.placed)}`);
  for (const v of cpuVisits) console.log(`seed8 cpu visit t${v.turn} p${v.pid} @${v.space} [${v.stock.join(", ")}] bought ${v.bought}`);
  if (cpuVisits.length < 1) fail("no CPU shop visit on the steered seed 8 page");
  if (cpuBuys.length < 1) fail("no CPU bought anything on the steered seed 8 page");
  const allVisits = [a, b, c].flatMap((r) => r.shop.visits);
  console.log(`visits checked ${allVisits.length} (cpu on seed8: ${cpuVisits.length}, bought ${cpuBuys.length})`);
} finally {
  await browser.close();
}

/* ---------------- stall layout on phones ---------------- */

// Wait until the popup card holds still for 10 frames (enter tween done).
async function settle(page) {
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector(".ssp-popup__card");
        if (!el) return resolve(false);
        let last = "";
        let still = 0;
        let frames = 0;
        const step = () => {
          const r = el.getBoundingClientRect();
          const key = [r.top, r.left, r.width, r.height].map((v) => v.toFixed(1)).join();
          still = key === last ? still + 1 : 0;
          last = key;
          if (still >= 10) return resolve(true);
          if (++frames > 240) return resolve(false);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    null,
    { timeout: 15000 }
  );
}

async function measure(page, space) {
  return page.evaluate((space) => {
    const card = document.querySelector(".ssp-popup__card");
    const grid = document.querySelector(".ssp-shop__grid");
    const cards = [...document.querySelectorAll("[data-item]")];
    const pill = document.querySelector("[data-shop-restock]");
    const close = document.querySelector("[data-shop-close]");
    const cr = card.getBoundingClientRect();
    const first = cards[0]?.getBoundingClientRect();
    const cl = close?.getBoundingClientRect();
    return {
      keys: cards.map((c) => c.dataset.item),
      stock: window.__SSP__.state().shop.stock[String(space)],
      pill: pill?.getAttribute("data-shop-restock") ?? null,
      gridSpace: grid?.getAttribute("data-shop-space") ?? null,
      gridOver: grid.scrollHeight - grid.clientHeight,
      cardOver: card.scrollHeight - card.clientHeight,
      card: [cr.top, cr.bottom].map(Math.round),
      first: first ? [first.top, first.bottom].map(Math.round) : null,
      close: cl ? [cl.left, cl.top, cl.right, cl.bottom].map(Math.round) : null,
      vw: innerWidth,
      vh: innerHeight,
    };
  }, space);
}

function checkLayout(label, r, space) {
  if (r.keys.length !== 3) fail(`${label} shows ${r.keys.length} [data-item] cards, want 3`);
  if (JSON.stringify(r.keys) !== JSON.stringify(r.stock)) fail(`${label} cards ${JSON.stringify(r.keys)} != stock ${JSON.stringify(r.stock)}`);
  if (!r.pill) fail(`${label} no [data-shop-restock]`);
  if (r.gridSpace !== String(space)) fail(`${label} grid data-shop-space ${r.gridSpace}, want ${space}`);
  // Whole pixels: a scrolling list is tens of px over, rounding is under 1.
  if (r.gridOver > 1) fail(`${label} grid scrolls by ${r.gridOver}px`);
  if (r.cardOver > 1) fail(`${label} popup card scrolls by ${r.cardOver}px`);
  if (!r.first || r.first[0] < r.card[0] || r.first[1] > r.card[1]) fail(`${label} first card ${JSON.stringify(r.first)} outside popup ${JSON.stringify(r.card)}`);
  if (!r.close || r.close[0] < 0 || r.close[1] < 0 || r.close[2] > r.vw || r.close[3] > r.vh) fail(`${label} CLOSE ${JSON.stringify(r.close)} outside ${r.vw}x${r.vh}`);
}

const VIEWPORTS = [
  [390, 844],
  [430, 932],
];
for (const [bname, btype] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  let b;
  try {
    b = await btype.launch();
  } catch (e) {
    if (bname === "chromium") throw e;
    console.log(`${bname} not available, skipped: ${String(e).split("\n")[0]}`);
    continue;
  }
  try {
    for (const [w, h] of VIEWPORTS) {
      const context = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: bname === "chromium" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
      await page.goto(`${BASE}/?seed=7&screen=board&audio=0`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__SSP__?.shopStock && window.__SSP__.state().match?.players?.length > 0, null, { timeout: 45000 });
      for (const space of [10, 21]) {
        const label = `${bname} ${w}x${h} shop ${space}`;
        await page.evaluate((s) => {
          window.__ROT_CLOSED = false;
          void window.__SSP__.openShop(0, s).then(() => (window.__ROT_CLOSED = true));
        }, space);
        await page.waitForSelector("[data-shop] [data-item]", { timeout: 10000 });
        await settle(page);
        const r = await measure(page, space);
        console.log(`${label} ${JSON.stringify(r)}`);
        checkLayout(label, r, space);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/shop-rotation-${bname}-${w}-shop${space}.png` });
        await page.click("[data-shop-close]");
        await page.waitForFunction(() => window.__ROT_CLOSED === true && !document.querySelector("[data-shop] [data-item]"), null, { timeout: 10000 });
      }
      if (errors.length) fail(`${bname} ${w}x${h} page errors ${JSON.stringify(errors)}`);
      await context.close();
    }
  } finally {
    await b.close();
  }
}

console.log(JSON.stringify({ ok: failures.length === 0, failures: failures.length, turns: TURNS }));
process.exit(failures.length ? 1 : 0);
