// Carnival hash parity: plays seed 7 (SSP_SEED) on one page and records, per turn
// boundary, an FNV-1a hash of the full match snapshot (controllers folded,
// `boardId` dropped so main and the board-registry branch compare equal),
// plus the synchronous rng draw marks (turn:start / minigame:start/end).
//
//   SSP_GOLDEN_OUT=file   write the record (run this on main for the baseline)
//   SSP_GOLDEN=file       compare against a saved record; exit 1 on any diff
//   SSP_BOARD=id          append &board=id (default: none = carnival)
//   SSP_TURNS=n           turns to record (default 6)
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const TURNS = Number(process.env.SSP_TURNS ?? 6);
const board = process.env.SSP_BOARD ? `&board=${process.env.SSP_BOARD}` : "";
const SEED = Number(process.env.SSP_SEED ?? 7);
const URL = `${BASE}/?seed=${SEED}&screen=board&autoplay=1&audio=0&speed=4${board}`;
const CAP_MS = 480000;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
let rec;
try {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state, null, { timeout: 45000 });
  await page.evaluate(() => {
    const fnv = (t) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return (h >>> 0).toString(16).padStart(8, "0");
    };
    const log = [];
    let prev = null;
    const tick = () => {
      const m = window.__SSP__?.state?.()?.match;
      if (m && m.turn !== prev) {
        prev = m.turn;
        const c = JSON.parse(JSON.stringify(m));
        delete c.boardId;
        for (const p of c.players) p.controller = p.controller === "cpu" ? "cpu" : "local";
        log.push({ turn: m.turn, hash: fnv(JSON.stringify(c)), coins: m.players.map((p) => p.coins), spaces: m.players.map((p) => p.space), balloon: m.starBalloonPos, boardId: m.boardId ?? null });
      }
      requestAnimationFrame(tick);
    };
    window.__GOLD = log;
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  let rows = [];
  let finale = false;
  while (Date.now() - t0 < CAP_MS) {
    await page.evaluate(() => document.querySelector("#mg-start-btn")?.click());
    rows = await page.evaluate(() => window.__GOLD);
    if (rows.filter((r) => r.turn >= 2).length >= TURNS) break;
    if ((await page.evaluate(() => window.__SSP__.state().screen)) === "finale") { finale = true; break; }
    await page.waitForTimeout(100);
  }
  const marks = await page.evaluate(() => window.__SSP__.rngTurnLog?.() ?? []);
  const last = rows.length ? rows[rows.length - 1].turn : 0;
  rec = { finale, url: URL, turns: rows.filter((r) => r.turn <= TURNS + 1), marks: marks.filter((m) => m.turn <= Math.min(TURNS, last - 1)), ms: Date.now() - t0 };
} finally {
  await browser.close();
}
for (const r of rec.turns) console.log(`turn ${r.turn} ${r.hash} board=${r.boardId} coins=${r.coins} @${r.spaces} balloon=${r.balloon}`);
console.log(`rng marks ${rec.marks.length}, ${rec.ms}ms, page errors ${errors.length}`);
let failed = errors.length > 0 || (!rec.finale && rec.turns.filter((r) => r.turn >= 2).length < TURNS);
console.log(`finale reached: ${rec.finale}`);
if (errors.length) console.log("page errors", JSON.stringify(errors));
if (process.env.SSP_GOLDEN_OUT) writeFileSync(process.env.SSP_GOLDEN_OUT, JSON.stringify(rec, null, 1));
if (process.env.SSP_GOLDEN) {
  const gold = JSON.parse(readFileSync(process.env.SSP_GOLDEN, "utf8"));
  for (const g of gold.turns) {
    const r = rec.turns.find((x) => x.turn === g.turn);
    const ok = r && r.hash === g.hash;
    console.log(`golden turn ${g.turn} ${g.hash} vs ${r?.hash ?? "missing"} ${ok ? "same" : "DIFFER"}`);
    if (!ok) failed = true;
  }
  const a = JSON.stringify(gold.marks), b = JSON.stringify(rec.marks.slice(0, gold.marks.length));
  console.log(`golden rng marks ${gold.marks.length} ${a === b ? "same" : "DIFFER"}`);
  if (a !== b) failed = true;
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
