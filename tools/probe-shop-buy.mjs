// Clean shop buy-probe: proves raw coin deduction + item count + disabled state.
// Boot pattern per spec: seed(7) -> startMatch -> goto('board') retry-verify.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.SSP_URL ?? "http://localhost:5177";
const OUT_DIR = process.env.SSP_SHOTS ?? "tools/critic/frames/economy/SHOP";
let failed = false;
const fail = (m) => { console.log("FAIL:", m); failed = true; };
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push(e.message));

async function snap() {
  return page.evaluate(() => {
    const s = window.__SSP__?.state();
    const p = s?.match?.players?.[0];
    return { screen: s?.match?.phase, coins: p?.coins, items: p?.items, space: p?.space };
  });
}

try {
  await page.goto(`${BASE}/?audio=0&seed=7`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate(() => { window.__SSP__.seed(7); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]); });
  // RETRY-AND-VERIFY goto board
  let onBoard = false;
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => { try { window.__SSP__.goto("board"); } catch {} });
    const sc = await page.evaluate(() => window.__SSP__?.state()?.screen ?? "?");
    if (sc === "board") { onBoard = true; break; }
    await sleep(250);
  }
  console.log("ON_BOARD:", onBoard);

  const before = await snap();
  console.log("BEFORE:", JSON.stringify(before));

  await page.evaluate(() => { window.__SSP__.openShop(0); });
  await sleep(900);
  await page.screenshot({ path: `${OUT_DIR}/shop-open.png` });

  // Inspect the shop state: buttons, affordability, card text
  const inspect = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-item]"));
    return cards.map((c) => {
      const item = c.getAttribute("data-item");
      const btn = c.querySelector("button");
      return {
        item,
        buyText: btn?.textContent ?? null,
        buyDisabled: !!btn?.disabled,
        hasUnaffordable: !!c.querySelector(".ssp-shop__unaffordable"),
        cardClass: c.className,
        fullText: (c.innerText || "").replace(/\s+/g, " ").slice(0, 120),
      };
    });
  });
  console.log("CARDS_OPEN:", JSON.stringify(inspect, null, 2));

  const stock = await page.evaluate(() => window.__SSP__.shopStock().stock);
  console.log("STOCK:", JSON.stringify(stock));
  if (inspect.length !== 3) fail(`shop shows ${inspect.length} cards, want 3`);
  // Pick the first displayed, affordable, enabled item.
  const prices = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-item]")].map((c) => [c.getAttribute("data-item"), Number(c.getAttribute("data-price"))])));
  const pick = inspect.find((c) => !c.buyDisabled && prices[c.item] <= (before.coins ?? 0));
  if (!pick) throw new Error("no affordable item in displayed stock");
  const price = prices[pick.item];
  console.log("PICK:", pick.item, price);
  await page.click(`[data-item="${pick.item}"] button`);
  await sleep(900);
  await page.screenshot({ path: `${OUT_DIR}/shop-after-buy.png` });
  const after = await snap();
  console.log("AFTER_BUY:", JSON.stringify(after));
  if (after.coins !== before.coins - price) fail(`coins ${before.coins} -> ${after.coins}, expected -${price}`);
  const count = (a, k) => (a ?? []).filter((x) => x === k).length;
  if (count(after.items, pick.item) !== count(before.items, pick.item) + 1) fail(`item count for ${pick.item} did not rise by 1`);
  const card = await page.evaluate((k) => {
    const c = document.querySelector(`[data-item="${k}"]`);
    const btn = c?.querySelector("button");
    return { found: !!c, disabled: !!btn?.disabled, owned: !!c?.classList.contains("ssp-shop__card--owned") };
  }, pick.item);
  console.log("CARD_AFTER:", JSON.stringify(card));
  if (!card.found || !card.disabled || !card.owned) fail("bought card not shown disabled/owned");
  // Clicking the owned card's disabled button must not spend coins.
  await page.evaluate((k) => document.querySelector(`[data-item="${k}"] button`)?.click(), pick.item);
  const again = await snap();
  if (again.coins !== after.coins) fail("owned card charged coins again");
  await page.screenshot({ path: `${OUT_DIR}/shop-unaffordable.png` });
  await page.evaluate(() => { Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("CLOSE"))?.click(); });
  await sleep(500);
} catch (e) {
  console.log("PROBE_FAILED:", String(e).slice(0, 300));
  failed = true;
}
console.log("ERRORS:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
if (failed) process.exit(1);
console.log("PASS");
