import { chromium } from "@playwright/test";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
// SSP_BOARD=downtown|carnival|random plays that board (default: none = saved rule / carnival).
const boardQuery = process.env.SSP_BOARD ? `&board=${process.env.SSP_BOARD}` : "";
const URL = `${BASE}/?seed=7&screen=board&autoplay=1&audio=0&speed=4${boardQuery}`;
const TURNS = 9;
// A GitHub runner matched turns 1–8, then both pages hit a 300s cap during
// turn 9. Nine minutes lets that turn finish. Speed stays 4: past five
// sim steps per frame, a faster speed does not shorten the minigames.
const CAP_MS = 540000;

async function play(page, label) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state, null, { timeout: 20000 });
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
        board: m.boardId ?? null,
        screen: st.screen ?? null,
      };
      if (row.turn != null && row.turn !== prev) {
        log.push(row);
        prev = row.turn;
      }
      requestAnimationFrame(tick);
    };
    window.__TWIN_ENDS = log;
    // PR F: every Grand Prize position change, with the current player's space at that frame.
    const moves = [];
    let prevB = null;
    const watch = () => {
      const m = window.__SSP__?.state?.()?.match ?? {};
      const b = m.starBalloonPos;
      if (m.players?.length && b != null && b >= 0) {
        if (prevB === null) moves.push({ start: b });
        else if (b !== prevB) moves.push({ from: prevB, to: b, turn: m.turn, cur: m.currentPlayer, at: m.players[m.currentPlayer]?.space });
        prevB = b;
      }
      requestAnimationFrame(watch);
    };
    window.__TWIN_MOVES = moves;
    requestAnimationFrame(watch);
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
    ends = await page.evaluate(() => window.__TWIN_ENDS ?? []);
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
  // PR F checks, evaluated in-page with the dev hooks (no extra page load).
  const star = await page.evaluate(() => {
    const S = window.__SSP__;
    const b = S.board();
    const moves = window.__TWIN_MOVES ?? [];
    const nearOf = (sp) => S.prizeNear?.(sp) ?? null;
    return { prizeSpots: b.prizeSpots, startIndex: b.startIndex, nearStart: nearOf(b.startIndex), moves: moves.map((mv) => (mv.at == null ? mv : { ...mv, nearBuyer: nearOf(mv.at) })) };
  });
  return { ends, errors, ms: Date.now() - t0, star };
}

function endOfTurn(ends, turn) {
  return ends.find((row) => row.turn === turn + 1) ?? null;
}

function same(a, b) {
  return (
    JSON.stringify(a.coins) === JSON.stringify(b.coins) &&
    JSON.stringify(a.stars) === JSON.stringify(b.stars) &&
    a.balloon === b.balloon &&
    JSON.stringify(a.spaces) === JSON.stringify(b.spaces)
  );
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const pageA = await context.newPage();
const pageB = await context.newPage();

let failed = false;
try {
  const [a, b] = await Promise.all([play(pageA, "A"), play(pageB, "B")]);
  console.log(`A ${a.ms}ms errors ${a.errors.length}`);
  console.log(`B ${b.ms}ms errors ${b.errors.length}`);
  if (a.errors.length || b.errors.length) {
    console.log("page errors", JSON.stringify([...a.errors, ...b.errors]));
    failed = true;
  }
  const boards = [...new Set([...a.ends, ...b.ends].filter((r) => r.coins.length > 0).map((r) => r.board).filter(Boolean))];
  const want = process.env.SSP_BOARD === "downtown" ? "downtown" : process.env.SSP_BOARD === "carnival" ? "fizzy-fairground" : null;
  console.log(`board ${JSON.stringify(boards)}${want ? ` expected ${want}` : ""}`);
  if (boards.length !== 1 || (want && boards[0] !== want)) failed = true;
  {
    // PR F: seeded start on an eligible space away from start; every relocation
    // lands on a prize spot not within 2 hops of the player who moved it.
    // A Balloon Tug pulls it onto the user's own space (to === at), which is exempt.
    const { prizeSpots, nearStart, moves } = a.star;
    const start = moves[0]?.start;
    const okStart = prizeSpots.includes(start) && Array.isArray(nearStart) && !nearStart.includes(start);
    console.log(`balloon start ${start} ${okStart ? "ok" : "BAD"} (in prizeSpots, not within 2 hops of start)`);
    if (!okStart) failed = true;
    const rel = moves.slice(1);
    for (const mv of rel) {
      const tug = mv.to === mv.at;
      const ok = tug || (prizeSpots.includes(mv.to) && Array.isArray(mv.nearBuyer) && !mv.nearBuyer.includes(mv.to));
      console.log(`balloon move turn ${mv.turn} ${mv.from}->${mv.to} by seat ${mv.cur} at ${mv.at}${tug ? " (Balloon Tug)" : ""} ${ok ? "ok" : "BAD (near the mover or not a prize spot)"}`);
      if (!ok) failed = true;
    }
    console.log(`balloon moves ${rel.length} ${rel.length >= 1 ? "ok" : "BAD (expected at least one relocation in " + TURNS + " turns)"}`);
    if (rel.length < 1) failed = true;
  }
  for (let turn = 1; turn <= TURNS; turn++) {
    const left = endOfTurn(a.ends, turn);
    const right = endOfTurn(b.ends, turn);
    if (!left || !right) {
      console.log(`turn ${turn} missing A=${JSON.stringify(left)} B=${JSON.stringify(right)}`);
      failed = true;
      continue;
    }
    const row = {
      coins: left.coins,
      stars: left.stars,
      balloon: left.balloon,
      spaces: left.spaces,
    };
    console.log(`turn ${turn} ${JSON.stringify(row)} ${same(left, right) ? "match" : "DIFFER " + JSON.stringify({ coins: right.coins, stars: right.stars, balloon: right.balloon, spaces: right.spaces })}`);
    if (!same(left, right)) failed = true;
  }
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
