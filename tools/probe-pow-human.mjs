// Orchestrator probe: does a HUMAN tapping actually change the outcome of push_of_war?
// Run A: human passive. Run B: human mashing Space. Same seed, no autoplay.
import { chromium } from "@playwright/test";

const seed = process.argv[2] ?? "7";
const URL = `http://localhost:5177/?seed=${seed}&audio=0&speed=1&minigame=push_of_war`;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const errors = [];

async function run(label, mash) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text().slice(0, 120)}`); });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  // NOTE: no autoplay() here — the human is a real (non-CPU) player.
  await page.evaluate((s) => {
    window.__SSP__.seed(Number(s));
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  }, seed);
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__SSP__.goto("minigame"));

  let result = null;
  const t0 = Date.now();
  let mashes = 0;
  let sawBoard = false;
  while (Date.now() - t0 < 40000) {
    if (mash) {
      // Real phone-style taps on the canvas (pointerdown -> ctx.input.pointer).
      await page.mouse.move(195, 620).catch(() => {});
      await page.mouse.down().catch(() => {});
      await page.mouse.up().catch(() => {});
      mashes++;
      await page.waitForTimeout(50);
    } else {
      await page.waitForTimeout(120);
    }
    const s = await page.evaluate(() => {
      const pow = window.__POW__ ?? null;
      const st = window.__SSP__?.state?.() ?? {};
      return { screen: st.screen, pow: pow ? { stepIndex: pow.stepIndex, crate: pow.crate, solo: pow.solo, endPath: pow.endPath, ranking: pow.ranking } : null };
    });
    if (s.screen === "board") sawBoard = true;
    if (s.pow && s.pow.endPath) { result = s.pow; break; }
    if (sawBoard) break;
  }
  await page.close();
  return { label, mashes, sawBoard, ...(result ?? { note: "no endPath" }) };
}

const passive = await run("A-passive", false);
const mashing = await run("B-mashing", true);
console.log("A_PASSIVE", JSON.stringify(passive));
console.log("B_MASHING", JSON.stringify(mashing));
console.log("HUMAN_TAPS_MATTER:", passive.endPath !== mashing.endPath || Math.abs((passive.crate ?? 0) - (mashing.crate ?? 0)) > 0.05);
console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 3) : "none");
await browser.close();
