// Capture the full SHOP frame set + raw numbers for the critic.
// Boot: seed(7) -> startMatch -> goto('board') retry-verify, then openShop.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/economy/SHOP";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push(String(e.message)));

const snap = () => page.evaluate(() => {
  const s = window.__SSP__?.state();
  const p = s?.match?.players?.[0];
  return { coins: p?.coins, items: p?.items, phase: s?.match?.phase };
});

await page.goto("http://localhost:5177/?audio=0&seed=7", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate(() => { window.__SSP__.seed(7); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]); });
let board = false;
for (let i = 0; i < 40; i++) {
  const sc = await page.evaluate(() => { try { window.__SSP__.goto("board"); } catch {} return window.__SSP__?.state()?.screen ?? "?"; });
  if (sc === "board") { board = true; break; }
  await sleep(250);
}
console.log("BOARD:", board);
await sleep(600);

// 1) closed (board, shop not open)
await page.screenshot({ path: `${OUT}/shop-closed.png` });

const before = await snap();
console.log("BEFORE:", JSON.stringify(before));

await page.evaluate(() => { window.__SSP__.openShop(0); });
await sleep(900);

// Awning verification
const awning = await page.evaluate(() => {
  const a = document.querySelector(".ssp-shop__awning");
  return a ? { found: true, text: a.innerText.replace(/\s+/g, " ").slice(0, 120), shopkeeper: a.querySelector(".ssp-shop__shopkeeper")?.textContent ?? null } : { found: false };
});
console.log("AWNING:", JSON.stringify(awning));

// 2) open (affordable: all 3 cards, awning, shopkeeper)
await page.screenshot({ path: `${OUT}/shop-open.png` });

// Cards at open
const openCards = await page.evaluate(() => Array.from(document.querySelectorAll("[data-item]")).map((c) => {
  const btn = c.querySelector("button");
  return { item: c.getAttribute("data-item"), buyText: btn?.textContent ?? null, disabled: !!btn?.disabled, fullText: (c.innerText || "").replace(/\s+/g, " ").slice(0, 90) };
}));
console.log("OPEN_CARDS:", JSON.stringify(openCards));

// 3) mid-purchase beat: click BUY and capture ~150ms later (floating -5 rising)
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button"));
  const buy = btns.find((b) => b.textContent === "BUY" && !b.disabled);
  if (buy) buy.click();
});
await sleep(150);
await page.screenshot({ path: `${OUT}/shop-mid-purchase.png` });
// floaters present?
const floaters = await page.evaluate(() => Array.from(document.querySelectorAll(".ssp-float-num")).map((e) => e.textContent));
console.log("FLOATERS_MID:", JSON.stringify(floaters));

await sleep(700);
// 4) after-buy / owned state
await page.screenshot({ path: `${OUT}/shop-after-buy.png` });
const after = await snap();
console.log("AFTER_BUY:", JSON.stringify(after));
const afterCards = await page.evaluate(() => Array.from(document.querySelectorAll("[data-item]")).map((c) => {
  const btn = c.querySelector("button");
  return { item: c.getAttribute("data-item"), buyText: btn?.textContent ?? null, disabled: !!btn?.disabled, hasBadge: !!c.querySelector(".ssp-shop__owned-badge"), hasUnaffordable: !!c.querySelector(".ssp-shop__unaffordable") };
}));
console.log("AFTER_CARDS:", JSON.stringify(afterCards));

// 5) unaffordable/disabled: zappy (10) with 5 coins
await page.evaluate(() => {
  const cards = document.querySelectorAll("[data-item]");
  for (const c of cards) {
    if (c.getAttribute("data-item") === "zappy") {
      const btn = c.querySelector("button");
      return { buyText: btn?.textContent, disabled: !!btn?.disabled, cardClass: c.className };
    }
  }
  return {};
});
await page.screenshot({ path: `${OUT}/shop-unaffordable.png` });

// Refused-buy proof: try zappy, coins unchanged
const refused = await page.evaluate(() => {
  const cards = document.querySelectorAll("[data-item]");
  for (const c of cards) {
    if (c.getAttribute("data-item") === "zappy") {
      const btn = c.querySelector("button");
      const before = window.__SSP__?.state().match?.players?.[0]?.coins;
      if (btn && !btn.disabled) btn.click();
      const after = window.__SSP__?.state().match?.players?.[0]?.coins;
      return { clickable: !btn.disabled, coinsBefore: before, coinsAfter: after, unchanged: before === after };
    }
  }
  return { clickable: false };
});
console.log("REFUSED:", JSON.stringify(refused));

// 6) close shop -> closed frame
await page.evaluate(() => {
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("CLOSE"))?.click();
});
await sleep(600);
await page.screenshot({ path: `${OUT}/shop-closed-after.png` });
const final = await snap();
console.log("FINAL:", JSON.stringify(final));

console.log("ERRORS:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
