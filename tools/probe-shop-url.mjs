// Verify the ?shop=1 URL-param entry point still opens the themed stall.
import { chromium } from "@playwright/test";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push(String(e.message)));

await page.goto("http://localhost:5177/?shop=1&audio=0&seed=7", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });

// boardScreen.enter starts a default match when none exists; wait for board + shop
for (let i = 0; i < 40; i++) {
  const sc = await page.evaluate(() => window.__SSP__?.state()?.screen ?? "?");
  if (sc === "board") break;
  await sleep(250);
}
await sleep(1500); // let the 250ms setTimeout + render land

const res = await page.evaluate(() => {
  const shop = document.querySelector("[data-shop], .ssp-shop");
  return {
    shopPresent: !!shop,
    shopText: shop ? (shop.innerText || "").replace(/\s+/g, " ").slice(0, 160) : null,
    awning: !!document.querySelector(".ssp-shop__awning"),
    shopkeeper: !!document.querySelector(".ssp-shop__shopkeeper"),
    stallTitle: document.querySelector(".ssp-shop__stall-title")?.textContent ?? null,
  };
});
console.log("SHOP_URL:", JSON.stringify(res));

await page.screenshot({ path: "tools/critic/frames/economy/SHOP/shop-via-url.png" });

// close
await page.evaluate(() => {
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("CLOSE"))?.click();
});
await sleep(500);
console.log("ERRORS:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
