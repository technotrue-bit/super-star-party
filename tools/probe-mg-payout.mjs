// Orchestrator probe: does a minigame still PAY OUT +10 to exactly one winner? (guards against payout regressions)
import { chromium } from "@playwright/test";

const mgId = process.argv[2] ?? "balloon_pop";
const seed = process.argv[3] ?? "7";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
await page.goto(`http://localhost:5177/?seed=${seed}&audio=0&speed=2&minigame=${mgId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });

const snap = () => page.evaluate(() => {
  const st = window.__SSP__.state();
  const src = st.match?.players ?? [];
  return { screen: st.screen, players: src.map((p) => ({ id: p.id, coins: p.coins })) };
});

const auto = process.argv[4] !== "noauto";
await page.evaluate(({ s, auto }) => {
  window.__SSP__.seed(Number(s));
  if (auto) window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, { s: seed, auto });
// Screens register asynchronously in main.ts — goto() before registration is a no-op
// ("[screens] unknown screen"), which silently leaves the probe on the title screen.
let launched = false;
for (let i = 0; i < 25; i++) {
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  await page.waitForTimeout(220);
  const scr = await page.evaluate(() => window.__SSP__.state().screen);
  if (scr === "minigame") { launched = true; break; }
}
if (!launched) { console.log("LAUNCH_FAILED: screen never became \"minigame\" (registration race?)"); await browser.close(); process.exit(2); }

let after = null;
const t0 = Date.now();
while (Date.now() - t0 < 70000) {
  await page.waitForTimeout(300);
  const s = await snap();
  if (s.screen !== "minigame") {
    await page.waitForTimeout(5200); // let the results ceremony + payout land
    after = await snap();
    break;
  }
}
console.log("MG", mgId, "SEED", seed, "AFTER", JSON.stringify(after?.players ?? null));
const paid = (after?.players ?? []).filter((p) => p.coins > 10);
console.log("WINNERS:", paid.length, "| max coins:", Math.max(0, ...(after?.players ?? []).map((p) => p.coins)));
console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 3) : "none");
await browser.close();
