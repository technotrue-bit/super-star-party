// Clean shop buy-probe: proves raw coin deduction + item count + disabled state.
// Boot pattern per spec: seed(7) -> startMatch -> goto('board') retry-verify.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT_DIR = "tools/critic/frames/economy/SHOP";
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
  await page.goto("http://localhost:5177/?audio=0&seed=7", { waitUntil: "domcontentloaded", timeout: 20000 });
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

  // BUY the Mushroom (price 5) — affordable from 10 coins
  const buyRes = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const buy = btns.find((b) => b.textContent === "BUY" && !b.disabled);
    if (!buy) return { result: "no-buyable-button", found: btns.map((b) => ({ txt: b.textContent, disabled: b.disabled })) };
    buy.click();
    return { result: "clicked-mushroom-buy" };
  });
  console.log("BUY:", JSON.stringify(buyRes));
  await sleep(900);
  await page.screenshot({ path: `${OUT_DIR}/shop-after-buy.png` });

  const after = await snap();
  console.log("AFTER_BUY:", JSON.stringify(after));

  // Inspect cards AFTER buy: does the mushroom card show owned state?
  const afterCards = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-item]"));
    return cards.map((c) => {
      const item = c.getAttribute("data-item");
      const btn = c.querySelector("button");
      return {
        item,
        buyText: btn?.textContent ?? null,
        buyDisabled: !!btn?.disabled,
        hasUnaffordable: !!c.querySelector(".ssp-shop__unaffordable"),
        fullText: (c.innerText || "").replace(/\s+/g, " ").slice(0, 150),
      };
    });
  });
  console.log("CARDS_AFTER_BUY:", JSON.stringify(afterCards, null, 2));

  // Verify unaffordable: Zappy costs 10, we should have 5 now
  const zappyState = await page.evaluate(() => {
    const cards = document.querySelectorAll("[data-item]");
    for (const c of cards) {
      if (c.getAttribute("data-item") === "zappy") {
        const btn = c.querySelector("button");
        return {
          item: "zappy",
          buyText: btn?.textContent ?? null,
          buyDisabled: !!btn?.disabled,
          hasUnaffordable: !!c.querySelector(".ssp-shop__unaffordable"),
          cardClass: c.className,
        };
      }
    }
    return { item: "zappy", notFound: true };
  });
  console.log("ZAPPY_UNAFFORDABLE:", JSON.stringify(zappyState));
  await page.screenshot({ path: `${OUT_DIR}/shop-unaffordable.png` });

  // Try clicking the disabled Zappy buy (should be refused)
  const refused = await page.evaluate(() => {
    const cards = document.querySelectorAll("[data-item]");
    for (const c of cards) {
      if (c.getAttribute("data-item") === "zappy") {
        const btn = c.querySelector("button");
        const before = window.__SSP__?.state().match?.players?.[0]?.coins;
        if (btn && !btn.disabled) { btn.click(); }
        const after = window.__SSP__?.state().match?.players?.[0]?.coins;
        return { clicked: !btn.disabled, coinsBefore: before, coinsAfter: after, unchanged: before === after };
      }
    }
    return { clicked: false };
  });
  console.log("REFUSED_BUY:", JSON.stringify(refused));

  // Close
  await page.evaluate(() => { const c = document.querySelector("button"); Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("CLOSE"))?.click(); });
  await sleep(500);
} catch (e) {
  console.log("PROBE_FAILED:", String(e).slice(0, 300));
}
console.log("ERRORS:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
