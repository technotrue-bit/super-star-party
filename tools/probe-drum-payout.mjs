// Orchestrator diagnostic: watch drum_solo's post-game for a payout (coins, screen, rank card text).
import { chromium } from "@playwright/test";

const seed = process.argv[2] ?? "7";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
await page.goto(`http://localhost:5177/?seed=${seed}&audio=1&speed=2&minigame=drum_solo`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate((s) => {
  window.__SSP__.seed(Number(s));
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, seed);
await page.evaluate(() => window.__SSP__.goto("minigame"));

const t0 = Date.now();
let prevCoins = null;
while (Date.now() - t0 < 40000) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const st = window.__SSP__.state();
    const src = st.match?.players ?? [];
    return {
      screen: st.screen,
      coins: src.map((p) => p.coins).join(","),
      results: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 220),
    };
  });
  const t = ((Date.now() - t0) / 1000).toFixed(1);
  if (s.coins !== prevCoins) { console.log(`t=${t}s COINS CHANGED -> ${s.coins}`); prevCoins = s.coins; }
  if (/results|wins|place|place|1\./i.test(s.results) && s.screen === "minigame") {
    console.log(`t=${t}s SCREEN=${s.screen} TEXT="${s.results.slice(0, 160)}"`);
  }
  if (s.screen === "board") { console.log(`t=${t}s back on board — coins final: ${s.coins}`); }
}
console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 3) : "none");
await browser.close();
