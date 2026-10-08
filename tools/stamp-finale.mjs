import { chromium } from "@playwright/test";

const URL = "http://127.0.0.1:5177/?quickend=1&stamps=1&audio=0";
const NEED = ["STAMP STAR", "MINIGAME STAR", "COIN STAR"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));

let failed = false;
try {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state, null, { timeout: 20000 });
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 22000) {
    const text = await page.evaluate(() => document.getElementById("finale-banner")?.textContent ?? "");
    for (const label of NEED) {
      if (text.includes(label)) seen.add(label);
    }
    if (seen.size === NEED.length) break;
    await page.waitForTimeout(100);
  }
  const missing = NEED.filter((label) => !seen.has(label));
  console.log(`seen: ${[...seen].join(", ") || "(none)"}`);
  if (missing.length) {
    console.log(`missing: ${missing.join(", ")}`);
    failed = true;
  }
  if (errors.length) {
    console.log(`page errors: ${errors.join(" | ")}`);
    failed = true;
  }
} catch (err) {
  console.log(`probe failed: ${err}`);
  failed = true;
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
