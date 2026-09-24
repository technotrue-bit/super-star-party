// Orchestrator probe: does ?shop=1 crash the tab, and is __SSP__.openShop() safe?
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("crash", () => console.log("PAGE CRASHED"));

const t0 = Date.now();
try {
  await page.goto("http://localhost:5177/?shop=1&audio=0", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.waitForTimeout(3500);
  const s1 = await page.evaluate(() => {
    const shop = document.querySelector("[data-shop], .ssp-shop, [class*='shop']");
    return {
      screen: window.__SSP__?.state?.()?.screen ?? "?",
      shopPresent: !!shop,
      shopText: shop ? (shop.innerText || "").replace(/\s+/g, " ").slice(0, 220) : null,
      wipeCount: document.querySelectorAll(".ssp-wipe").length,
    };
  });
  console.log("SHOP_URL:", JSON.stringify(s1));
} catch (e) {
  console.log("SHOP_URL_FAILED:", String(e).slice(0, 200), "after", Math.round((Date.now() - t0) / 1000), "s");
}

// Direct API path
try {
  await page.goto("http://localhost:5177/?audio=0", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate(() => { window.__SSP__.seed(7); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]); });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__SSP__.goto("board"));
  await page.waitForTimeout(1500);
  const ok = await page.evaluate(() => { try { window.__SSP__.openShop(0); return "called"; } catch (e) { return "threw: " + String(e).slice(0, 120); } });
  await page.waitForTimeout(2500);
  const s2 = await page.evaluate(() => {
    const shop = document.querySelector("[data-shop], .ssp-shop, [class*='shop']");
    return { screen: window.__SSP__?.state?.()?.screen, shopPresent: !!shop, text: shop ? (shop.innerText || "").replace(/\s+/g, " ").slice(0, 200) : null };
  });
  console.log("OPENSHOP:", JSON.stringify({ ok, ...s2 }));
  await page.screenshot({ path: "tools/critic/frames/economy/orch/shop-direct.png" });
} catch (e) {
  console.log("OPENSHOP_FAILED:", String(e).slice(0, 200));
}

console.log("ERRORS:", errors.length ? errors.slice(0, 6) : "none");
await browser.close();
