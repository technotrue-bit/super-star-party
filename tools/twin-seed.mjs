import { chromium } from "@playwright/test";

const URL = "http://127.0.0.1:5177/?seed=7&screen=board&autoplay=1&audio=0&speed=4";
const TURNS = 9;
const CAP_MS = 300000;

async function play(page) {
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
        screen: st.screen ?? null,
      };
      if (row.turn != null && row.turn !== prev) {
        log.push(row);
        prev = row.turn;
      }
      requestAnimationFrame(tick);
    };
    window.__TWIN_ENDS = log;
    requestAnimationFrame(tick);
  });

  const t0 = Date.now();
  let ends = [];
  while (Date.now() - t0 < CAP_MS) {
    await page.evaluate(() => {
      const btn = document.querySelector("#mg-start-btn");
      if (btn) btn.click();
    });
    ends = await page.evaluate(() => window.__TWIN_ENDS ?? []);
    const closed = ends.filter((row) => row.turn >= 2 && row.turn <= TURNS + 1);
    if (closed.length >= TURNS) break;
    const screen = ends.length ? ends[ends.length - 1].screen : null;
    if (screen === "finale") break;
    await page.waitForTimeout(100);
  }
  return { ends, errors, ms: Date.now() - t0 };
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
  const [a, b] = await Promise.all([play(pageA), play(pageB)]);
  console.log(`A ${a.ms}ms errors ${a.errors.length}`);
  console.log(`B ${b.ms}ms errors ${b.errors.length}`);
  if (a.errors.length || b.errors.length) {
    console.log("page errors", JSON.stringify([...a.errors, ...b.errors]));
    failed = true;
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
