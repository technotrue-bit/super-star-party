// Orchestrator probe: play a REAL full match (autoplay, speed=2) to its natural end
// and verify the board reaches the finale ceremony on its own (no debug hooks).
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/w5-natural-finale";
fs.mkdirSync(OUT, { recursive: true });

const seed = process.argv[2] ?? "7";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });

await page.goto(`http://localhost:5177/?seed=${seed}&autoplay=1&audio=0&speed=2`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate((s) => {
  window.__SSP__.seed(Number(s));
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, seed);
await page.waitForTimeout(1200);
await page.evaluate(() => window.__SSP__.goto("board"));

const seen = [];
let finale = null;
const t0 = Date.now();
for (let i = 0; i < 1400; i++) {
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => {
    const st = window.__SSP__?.state?.() ?? {};
    return { screen: st.screen, phase: st.phase, round: st.round, minigame: st.minigame, turn: st.turn };
  });
  const tag = `${s.screen}/${s.phase ?? "-"}/r${s.round ?? "-"}`;
  if (seen[seen.length - 1] !== tag) seen.push(tag);
  if (s.screen === "finale") {
    finale = { at: Math.round((Date.now() - t0) / 1000), state: s };
    break;
  }
  if (Date.now() - t0 > 11 * 60 * 1000) break;
}

if (finale) {
  await page.waitForTimeout(6000); // let the ceremony play through
  await page.screenshot({ path: `${OUT}/finale-natural.png` });
  const dom = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500));
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button, [role='button']")).map((b) => (b.innerText || "").trim()).filter(Boolean)
  );
  console.log("FINALESCREEN:", JSON.stringify({ finale, dom, buttons }));
} else {
  await page.screenshot({ path: `${OUT}/no-finale.png` });
  console.log("NO FINALE REACHED. last:", JSON.stringify(seen.slice(-6)));
}
console.log("TRANSITIONS:", seen.length, JSON.stringify(seen.slice(0, 10)));
console.log("ELAPSED_S:", Math.round((Date.now() - t0) / 1000));
console.log("ERRORS:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
