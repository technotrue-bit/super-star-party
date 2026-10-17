// Match-opening probe: a menu-style start plays the flyover, the line-up, the
// "How does this board work?" prompt (with its tour), the order-block roll,
// then deals the starting coins and begins turn 1 in roll order.
//
//   node tools/probe-opening.mjs            (carnival; SSP_BOARD=downtown or cruise for the others)
//
// Uses ?intro=1 to force the opening on a URL-direct board. Checks:
//   - coins are 0 for everyone until the opening ends, then settings.startCoins
//   - the tour opens, steps with NEXT, and closes with SKIP
//   - HIT! shows for the human; every block is hit (CPUs hit their own)
//   - order rolls are all different and turnOrder sorts them high to low
//   - the first turn starts with the 1st player; zero page errors
import { chromium } from "@playwright/test";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const board = process.env.SSP_BOARD ? `&board=${process.env.SSP_BOARD}` : "";
const URL = `${BASE}/?seed=7&screen=board&audio=0&fx=off&intro=1${board}`;
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${msg}`);
  if (!ok) fails.push(msg);
};

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const btn = (re) => page.locator("button", { hasText: re }).first();
  const match = () => page.evaluate(() => window.__SSP__.state().match);

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ssp-intro-skip", { timeout: 60000 });
  check((await match()).players.every((p) => p.coins === 0), "flyover plays with empty purses");
  await page.mouse.click(10, 300); // skip the flyover

  await btn(/yes, show me/i).waitFor({ timeout: 60000 });
  check(true, "line-up asks how the board works");
  await btn(/yes, show me/i).click();
  await btn(/^next$/i).waitFor({ timeout: 20000 });
  const first = await page.locator(".ssp-opening").innerText();
  await btn(/^next$/i).click();
  await page.waitForTimeout(400);
  const second = await page.locator(".ssp-opening").innerText();
  check(first !== second && /\d+ \/ \d+/.test(second), "tour steps to its next card");
  await btn(/^skip$/i).click();

  await btn(/^hit!$/i).waitFor({ timeout: 30000 });
  check(true, "HIT! is offered to the human");
  check((await match()).phase !== "dice", "no turn starts during the roll");
  await btn(/^hit!$/i).click();

  await page.waitForFunction(() => window.__SSP__.state().match.phase === "dice", null, { timeout: 90000 });
  const m = await match();
  const rolls = m.orderRolls;
  check(new Set(rolls).size === rolls.length, `order numbers all differ (${rolls.join(",")})`);
  const sorted = [...m.turnOrder].every((pid, i, a) => i === 0 || rolls[a[i - 1]] > rolls[pid]);
  check(sorted, `turn order runs high to low (${m.turnOrder.join(",")})`);
  check(m.currentPlayer === m.turnOrder[0], "the 1st player takes turn 1");
  check(m.startCoinsDealt && m.players.every((p) => p.coins === 10), `starting coins dealt after the roll (${m.players.map((p) => p.coins).join(",")})`);
  check(!(await page.locator(".ssp-opening").count()), "opening overlay removed");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close();
}
console.log(fails.length ? `FAIL (${fails.length})` : "PASS: the match opening plays end to end");
process.exit(fails.length ? 1 : 0);
