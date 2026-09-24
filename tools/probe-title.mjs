// Orchestrator probe: verify the W4 title screen flows end-to-end.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/w4-title/orch";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

const state = () => page.evaluate(() => ({
  screen: window.__SSP__?.state?.()?.screen ?? "?",
  buttons: Array.from(document.querySelectorAll("button, .ssp-btn, [role='button']")).map((b) => (b.innerText || "").trim()).filter(Boolean).slice(0, 12),
}));

await page.goto("http://localhost:5177/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const t0 = await state();
await page.screenshot({ path: `${OUT}/1-title.png` });
console.log("TITLE:", JSON.stringify(t0));

async function clickText(txt) {
  const ok = await page.evaluate((t) => {
    const els = Array.from(document.querySelectorAll("button, .ssp-btn, [role='button']"));
    const el = els.find((e) => {
      const text = (e.innerText || "").trim();
      return text === t || text.startsWith(t);
    });
    if (!el) return false;
    el.click();
    return true;
  }, txt);
  await page.waitForTimeout(900);
  return ok;
}

console.log("click PLAY:", await clickText("PLAY"));
const t1 = await state();
await page.screenshot({ path: `${OUT}/2-after-play.png` });
console.log("AFTER PLAY:", JSON.stringify(t1));

await page.evaluate(() => window.__SSP__.goto("title"));
await page.waitForTimeout(900);
console.log("click HOW TO PLAY:", await clickText("HOW TO PLAY"));
const t2 = await state();
const rules = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400));
await page.screenshot({ path: `${OUT}/3-howto.png` });
console.log("AFTER HOWTO:", JSON.stringify(t2));
console.log("HOWTO TEXT:", rules.slice(0, 260));

await page.evaluate(() => window.__SSP__.goto("title"));
await page.waitForTimeout(900);
console.log("click SETTINGS:", await clickText("SETTINGS"));
const t3 = await state();
const sliders = await page.evaluate(() => Array.from(document.querySelectorAll("input[type=range]")).map((i) => ({ v: i.value, id: i.id || i.name })));
await page.screenshot({ path: `${OUT}/4-settings.png` });
console.log("AFTER SETTINGS:", JSON.stringify({ ...t3, sliders }));

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
