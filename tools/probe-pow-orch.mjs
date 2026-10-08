// Orchestrator probe (independent of the builder's probe-pow.mjs): push_of_war winners across seeds + a twin pair.
import { chromium } from "@playwright/test";

const seeds = (process.argv[2] ?? "1,2,3").split(",");
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)); });

async function run(seed) {
  await page.goto(`http://localhost:5177/?seed=${seed}&autoplay=1&audio=0&speed=2&minigame=push_of_war`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate((s) => { window.__SSP__.seed(Number(s)); window.__SSP__.autoplay(true); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]); }, seed);
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  const t0 = Date.now();
  let out = null;
  let started = false;
  while (Date.now() - t0 < 70000) {
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => {
      document.querySelector("#mg-start-btn")?.click();
      const pow = window.__POW__ ?? null;
      const st = window.__SSP__?.state?.() ?? {};
      const players = (st.match?.players ?? []).map((p) => (Array.isArray(p) ? { id: p[0], stars: p[1], coins: p[2] } : { id: p.id, stars: p.stars, coins: p.coins }));
      return { screen: st.screen, pow: pow ? { stepIndex: pow.stepIndex, crate: pow.crate, solo: pow.solo, endPath: pow.endPath, ranking: pow.ranking } : null, players };
    });
    if (s.screen === "minigame") started = true;
    if (s.pow && s.pow.endPath) { out = { seed, ...s.pow, players: s.players }; break; }
    if (started && s.screen === "board") { out = { seed, note: "returned to board with no endPath", players: s.players }; break; }
  }
  if (!out) out = { seed, note: "no endPath", endPath: null };
  out.__side = out.endPath;
  return out;
}

const results = [];
for (const seed of seeds) { const r = await run(seed); results.push(r); console.log("SEED", seed, JSON.stringify(r)); }

const solo = results.filter((r) => r && r.endPath === "solo-win").length;
const trio = results.filter((r) => r && r.endPath === "trio-win").length;
const to = results.filter((r) => r && r.endPath === "timeout").length;
const steps = results.filter((r) => r && r.stepIndex).map((r) => r.stepIndex).sort((x, y) => x - y);
const crossings = results.filter((r) => r && r.stepIndex && r.stepIndex < 481).length;
const buzzer = results.filter((r) => r && r.stepIndex >= 481);
const margins = buzzer.map((r) => Math.abs(r.crate ?? 0)).sort((a, b) => a - b);
const secs = steps.map((s) => (s / 60).toFixed(1));
console.log(`MARGINS ${margins.map((m) => m.toFixed(3)).join(" ")}`);
console.log(`CROSSINGS ${crossings}/${results.length} | buzzerMargins min/med/max=${margins[0]?.toFixed(3) ?? "-"}/${margins[Math.floor(margins.length/2)]?.toFixed(3) ?? "-"}/${margins[margins.length-1]?.toFixed(3) ?? "-"}`);
console.log(`SUMMARY n=${results.length} soloWins=${solo} (${Math.round((100 * solo) / Math.max(1, results.length))}%) trioWins=${trio} timeouts=${to} steps[min/med/max]=${steps[0] ?? "-"}/${steps[Math.floor(steps.length / 2)] ?? "-"}/${steps[steps.length - 1] ?? "-"} secs=${secs[0] ?? "-"}..${secs[secs.length - 1] ?? "-"}`);

const twinA = await run(seeds[0]);
const twinB = await run(seeds[0]);
const strip = (o) => (o ? { seed: o.seed, stepIndex: o.stepIndex, crate: o.crate, solo: o.solo, endPath: o.endPath, ranking: o.ranking } : null);
const same = JSON.stringify(strip(twinA)) === JSON.stringify(strip(twinB));
console.log("TWIN_MATCH:", same, "| A:", JSON.stringify(strip(twinA)), "| B:", JSON.stringify(strip(twinB)));
console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 4) : "none");
const missingEnd = [...results, twinA, twinB].some((r) => !r || r.endPath == null);
if (missingEnd || !same || errors.length) process.exitCode = 1;
await browser.close();
