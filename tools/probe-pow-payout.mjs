// Orchestrator probe: does push_of_war pay exactly +10 to the single winner (ranking[0])?
import { chromium } from "@playwright/test";

const seed = process.argv[2] ?? "5";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
await page.goto(`http://localhost:5177/?seed=${seed}&audio=0&speed=2&minigame=push_of_war`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });

const snap = () => page.evaluate(() => {
  const st = window.__SSP__.state();
  const src = st.match?.players ?? st.players ?? [];
  const players = src.map((p) => (Array.isArray(p) ? { id: p[0], coins: p[2] } : { id: p.id, coins: p.coins }));
  return { screen: st.screen, players, raw: src };
});

await page.evaluate((s) => {
  window.__SSP__.seed(Number(s));
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, seed);
const before = await snap();
await page.waitForTimeout(700); /* settle on board before navigating to minigame (proven boot pattern) */
await page.evaluate(() => window.__SSP__.goto("minigame"));

let after = null;
const t0 = Date.now();
let seenMinigame = false; // must actually ENTER the minigame before sampling "after"
while (Date.now() - t0 < 60000) {
  await page.waitForTimeout(300);
  const s = await snap();
  if (s.screen === "minigame") seenMinigame = true;
  if (seenMinigame && s.screen !== "minigame") {
    // The board screen registers the state provider on enter — let it land.
    await page.waitForTimeout(1600);
    after = await snap();
    break;
  }
}
console.log("BEFORE", JSON.stringify(before.players), "raw0:", JSON.stringify(before.raw?.[0]));
console.log("AFTER ", JSON.stringify(after?.players ?? null));
if (after && !after.players.length) {
  const keys = await page.evaluate(() => Object.keys(window.__SSP__.state() ?? {}));
  console.log("STATE_KEYS", JSON.stringify(keys));
}
if (before.players.length && after?.players?.length) {
  const deltas = after.players.map((p, i) => ({ id: p.id, delta: p.coins - before.players[i].coins }));
  const winners = deltas.filter((d) => d.delta > 0);
  console.log("DELTAS", JSON.stringify(deltas), "| winners:", winners.length, "| winner delta:", winners[0]?.delta);
}
console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 3) : "none");
await browser.close();
