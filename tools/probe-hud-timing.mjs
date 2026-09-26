// Debug: high-frequency HUD coin reader + timing analysis
import { chromium } from "@playwright/test";

const mgId = process.argv[2] ?? "balloon_pop";
const seed = Number(process.argv[3] ?? "7");
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });

await page.goto(`http://localhost:5177/?seed=${seed}&audio=0&speed=2&minigame=${mgId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });

await page.evaluate((s) => {
  window.__SSP__.seed(s);
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip","bounce","glimmer","tusk"],["Pip","Bounce","Glimmer","Tusk"]);
}, seed);

let launched = false;
for (let i = 0; i < 25; i++) {
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  await page.waitForTimeout(220);
  const scr = await page.evaluate(() => window.__SSP__.state().screen);
  if (scr === "minigame") { launched = true; break; }
}
if (!launched) { console.log("LAUNCH_FAILED"); await browser.close(); process.exit(2); }

const before = await page.evaluate(() =>
  (window.__SSP__.state().match?.players ?? []).map((p) => p.coins ?? p.coin ?? 0)
);
console.log("BEFORE:", JSON.stringify(before));

// Inject high-frequency reader: logs coin textContent + screen every 40ms
const readerCode = `
window.__hudLog = [];
window.__reader = setInterval(() => {
  const scr = (window.__SSP__?.state()?.screen ?? "?");
  const chips = document.querySelectorAll('[aria-label="coins"]');
  const vals = chips.length > 0 ? Array.from(chips, e => e.textContent || "") : [];
  if (chips.length > 0) {
    window.__hudLog.push({ scr, vals: vals.join(",") });
  }
}, 40);
`;
await page.evaluate(readerCode);

// Wait for minigame to finish + ceremony + board to appear
let lastScreen = "minigame";
let boardFrame = null;
for (let i = 0; i < 200; i++) {
  await page.waitForTimeout(100);
  const scr = await page.evaluate(() => window.__SSP__.state().screen);
  if (scr !== lastScreen) {
    console.log(`screen -> ${scr} at iter ${i}`);
    if (scr === "board" && !boardFrame) boardFrame = i;
    lastScreen = scr;
  }
  if (scr === "board" && boardFrame !== null && i - boardFrame > 35) break;
}

// Wait for settle
await page.waitForTimeout(3000);
const after = await page.evaluate(() =>
  (window.__SSP__.state().match?.players ?? []).map((p) => p.coins ?? p.coin ?? 0)
);
console.log("AFTER:", JSON.stringify(after));
console.log("DELTA:", JSON.stringify(before.map((v, i) => after[i] - v)));

// Read the high-frequency log
const log = await page.evaluate(() => window.__hudLog);
clearInterval(await page.evaluate(() => window.__reader));

// Show first 20 entries where screen changes
const transitions = log.filter((e) => {
  if (e.scr !== "board") return false;
  return true;
});
console.log("HUD_BOARD_READINGS:", JSON.stringify(transitions.slice(0, 25)));
console.log("TOTAL_READINGS:", log.length);
console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 3) : "none");
await browser.close();
