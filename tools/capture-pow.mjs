// Orchestrator capture: push_of_war frames across a match (splash, surge, buzzer, banner).
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/minigames/push_of_war/orch";
fs.mkdirSync(OUT, { recursive: true });
const seed = process.argv[2] ?? "5";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
await page.goto(`http://localhost:5177/?seed=${seed}&audio=0&speed=1&minigame=push_of_war`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate((s) => {
  window.__SSP__.seed(Number(s));
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, seed);
await page.waitForTimeout(600);
await page.evaluate(() => window.__SSP__.goto("minigame"));

const shots = [];
const marks = [5600, 6800, 8200, 9600, 11000, 12200, 13400, 14600, 15800, 17000];
let last = 0;
for (const ms of marks) {
  await page.waitForTimeout(Math.max(0, ms - last));
  last = ms;
  const f = `${OUT}/s${seed}-t${ms}.png`;
  await page.screenshot({ path: f });
  const pow = await page.evaluate(() => (window.__POW__ ? { t: window.__POW__.stepIndex, crate: window.__POW__.crate, endPath: window.__POW__.endPath } : null));
  shots.push({ ms, f, pow });
}
console.log("SHOTS", JSON.stringify(shots));
console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 3) : "none");
await browser.close();
