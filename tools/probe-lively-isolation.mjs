// Lively isolation probe: seed 7 with ?lively=0 and ?lively=1 must play the
// same match. twin-seed only compares two identical pages, so a cosmetic
// draw from the gameplay rng would shift both and still pass. Here one page
// has every lively addition off, and the probe also compares the gameplay
// rng draw count at each turn:start / minigame:start / minigame:end.
//
//   node tools/probe-lively-isolation.mjs
//   SSP_TURNS=5 SSP_URL=http://127.0.0.1:5177 node tools/probe-lively-isolation.mjs
//
// Exits 1 on any mismatch, a missing turn, or a page error.
import { chromium } from "@playwright/test";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const TURNS = Math.max(1, Number(process.env.SSP_TURNS ?? 3));
// SSP_BOARD=downtown|carnival|random plays that board.
const boardQuery = process.env.SSP_BOARD ? `&board=${process.env.SSP_BOARD}` : "";
const URL = `${BASE}/?seed=7&screen=board&autoplay=1&audio=0&speed=4${boardQuery}`;
// About a minute a turn on a GitHub runner at speed 4 (twin-seed: ~9 min for 9).
const CAP_MS = Number(process.env.SSP_CAP_MS ?? TURNS * 110000 + 60000);

async function play(page, livelyFlag, label) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
  await page.goto(`${URL}&lively=${livelyFlag}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state && window.__SSP__?.rngTurnLog, null, { timeout: 20000 });
  await page.evaluate(() => {
    const log = [];
    let prev = null;
    const tick = () => {
      const st = window.__SSP__?.state?.() ?? {};
      const m = st.match ?? {};
      const ps = m.players ?? [];
      const row = {
        turn: m.turn ?? null,
        coins: ps.map((p) => p.coins),
        stars: ps.map((p) => p.stars),
        spaces: ps.map((p) => p.space),
        balloon: m.starBalloonPos ?? null,
        screen: st.screen ?? null,
      };
      if (row.turn != null && row.turn !== prev) {
        log.push(row);
        prev = row.turn;
      }
      requestAnimationFrame(tick);
    };
    window.__ISO_ENDS = log;
    requestAnimationFrame(tick);
  });

  const t0 = Date.now();
  let ends = [];
  let reported = 0;
  while (Date.now() - t0 < CAP_MS) {
    await page.evaluate(() => {
      const btn = document.querySelector("#mg-start-btn");
      if (btn) btn.click();
    });
    ends = await page.evaluate(() => window.__ISO_ENDS ?? []);
    const closed = ends.filter((row) => row.turn >= 2 && row.turn <= TURNS + 1);
    if (closed.length > reported) {
      reported = closed.length;
      console.log(`${label} turn ${reported} closed at ${Date.now() - t0}ms`);
    }
    if (closed.length >= TURNS) break;
    const screen = ends.length ? ends[ends.length - 1].screen : null;
    if (screen === "finale") break;
    await page.waitForTimeout(100);
  }
  // match.turn ticks over when the minigame round starts; the next
  // turn:start comes after the minigame. Wait for it so the last turn's
  // draw marks are complete.
  let marks = [];
  while (Date.now() - t0 < CAP_MS) {
    await page.evaluate(() => {
      const btn = document.querySelector("#mg-start-btn");
      if (btn) btn.click();
    });
    marks = await page.evaluate(() => window.__SSP__.rngTurnLog());
    if (marks.some((m) => m.event === "turn:start" && m.turn === TURNS + 1)) break;
    const screen = await page.evaluate(() => window.__SSP__.state().screen);
    if (screen === "finale") break;
    await page.waitForTimeout(100);
  }
  const lively = await page.evaluate(() => window.__SSP__.lively());
  return { ends, marks, lively, errors, ms: Date.now() - t0 };
}

const endOfTurn = (ends, turn) => ends.find((row) => row.turn === turn + 1) ?? null;
const pick = (row) => ({ coins: row.coins, stars: row.stars, balloon: row.balloon, spaces: row.spaces });
// Draw counts up to and including the turn:start that opens turn + 1.
function marksThrough(marks, turn) {
  const cut = marks.findIndex((m) => m.event === "turn:start" && m.turn === turn + 1);
  return cut < 0 ? null : marks.slice(0, cut + 1);
}

const browser = await chromium.launch();
const contextA = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const contextB = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const pageOff = await contextA.newPage();
const pageOn = await contextB.newPage();

let failed = false;
const summary = { url: URL, turns: TURNS, rows: [] };
try {
  const [off, on] = await Promise.all([play(pageOff, 0, "lively=0"), play(pageOn, 1, "lively=1")]);
  console.log(`lively=0 ${off.ms}ms errors ${off.errors.length}`);
  console.log(`lively=1 ${on.ms}ms errors ${on.errors.length}`);
  if (off.errors.length || on.errors.length) {
    console.log("page errors", JSON.stringify([...off.errors, ...on.errors]));
    failed = true;
  }
  if (off.lively.active) {
    console.log("lively=0 page still has lively code active");
    failed = true;
  }
  if (!on.lively.active || on.lively.busLands < 1) {
    console.log(`lively=1 page never reacted to a landing: ${JSON.stringify(on.lively)}`);
    failed = true;
  }
  for (let turn = 1; turn <= TURNS; turn++) {
    const a = endOfTurn(off.ends, turn);
    const b = endOfTurn(on.ends, turn);
    const ma = marksThrough(off.marks, turn);
    const mb = marksThrough(on.marks, turn);
    if (!a || !b || !ma || !mb) {
      console.log(`turn ${turn} missing off=${JSON.stringify(a)} on=${JSON.stringify(b)} marks off=${ma?.length} on=${mb?.length}`);
      failed = true;
      continue;
    }
    const rowSame = JSON.stringify(pick(a)) === JSON.stringify(pick(b));
    const drawsA = ma.map((m) => `${m.event}@${m.turn}:${m.draws}`);
    const drawsB = mb.map((m) => `${m.event}@${m.turn}:${m.draws}`);
    const drawsSame = JSON.stringify(drawsA) === JSON.stringify(drawsB);
    const draws = ma[ma.length - 1].draws;
    summary.rows.push({ turn, row: pick(a), draws, rowSame, drawsSame });
    console.log(
      `turn ${turn} ${JSON.stringify(pick(a))} draws=${draws} ` +
        `${rowSame ? "rows match" : "ROWS DIFFER " + JSON.stringify(pick(b))} ` +
        `${drawsSame ? "draws match" : "DRAWS DIFFER off=" + JSON.stringify(drawsA) + " on=" + JSON.stringify(drawsB)}`
    );
    if (!rowSame || !drawsSame) failed = true;
  }
  summary.ok = !failed;
  summary.landsOn = on.lively.busLands;
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
