// Orchestrator probe: full minigame lifecycle timeline WITH the VS splash (splash -> countdown -> play -> results -> board).
import { chromium } from "@playwright/test";

const id = process.argv[2] ?? "drum_solo";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)); });

await page.goto(`http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=2&minigame=${id}`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate(() => { window.__SSP__.seed(7); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]); });
await page.waitForTimeout(700);
const t0 = Date.now();
await page.evaluate(() => window.__SSP__.goto("minigame"));

const timeline = [];
let last = "";
while (Date.now() - t0 < 90000) {
  await page.waitForTimeout(120);
  const s = await page.evaluate(() => ({
    screen: window.__SSP__?.state?.()?.screen ?? "?",
    splash: !!document.querySelector(".ssp-vs-root"),
    count: (document.querySelector(".ssp-mg-count")?.innerText || "").trim().slice(0, 6),
    ceremony: !!document.querySelector("[class*='ceremony'], .ssp-rank, [class*='rank-card']"),
  }));
  const tag = `${s.screen}|splash:${s.splash}|count:${s.count}|ceremony:${s.ceremony}`;
  if (tag !== last) {
    timeline.push(`${Math.round((Date.now() - t0) / 100) / 10}s  ${tag}`);
    last = tag;
  }
  if (s.screen === "board" && timeline.length > 5) break;
}
console.log("TIMELINE:\n" + timeline.join("\n"));
console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 4) : "none");
await browser.close();
