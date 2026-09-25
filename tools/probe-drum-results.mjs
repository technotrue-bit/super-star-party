// Orchestrator diagnostic: what happens in drum_solo's final 4 seconds? (raw DOM + coins + screen)
import { chromium } from "@playwright/test";

const seed = process.argv[2] ?? "7";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); if (m.type() === "warning") errors.push("WARN " + m.text().slice(0, 200)); });
await page.goto(`http://localhost:5177/?seed=${seed}&audio=0&speed=1&minigame=drum_solo`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate((s) => {
  window.__SSP__.seed(Number(s));
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, seed);
await page.evaluate(() => window.__SSP__.goto("minigame"));

const t0 = Date.now();
while (Date.now() - t0 < 26000) {
  await page.waitForTimeout(1000);
  const t = (Date.now() - t0) / 1000;
  if (t < 8) continue;
  const s = await page.evaluate(() => {
    const st = window.__SSP__.state();
    const src = st.match?.players ?? [];
    return {
      screen: st.screen,
      coins: src.map((p) => p.coins).join(","),
      text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
    };
  });
  console.log(`t=${t.toFixed(1)}s screen=${s.screen} coins=${s.coins} :: ${s.text}`);
}
console.log("LOGS:", errors.length ? [...new Set(errors)].slice(0, 5) : "none");
await browser.close();
