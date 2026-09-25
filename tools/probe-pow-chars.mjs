// Orchestrator diagnostic: during a live push_of_war match, where are the 4 avatars in world space?
import { chromium } from "@playwright/test";

const seed = process.argv[2] ?? "7";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

await page.goto(`http://localhost:5177/?seed=${seed}&autoplay=1&audio=0&speed=2&minigame=push_of_war`);
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate((s) => {
  window.__SSP__.seed(Number(s));
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, seed);
// retry goto until the screen ACTUALLY changes (registration races otherwise)
let entered = false;
for (let i = 0; i < 25; i++) {
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  await page.waitForTimeout(200);
  const s = await page.evaluate(() => window.__SSP__.state().screen);
  if (s === "minigame") { entered = true; break; }
}
console.log("LAUNCHED:", entered);

let shots = 0;
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(900);
  const d = await page.evaluate(() => ({ dbg: window.__POW_DBG__ ?? null, pow: window.__POW__ ?? null }));
  if (!d.dbg) { console.log(`t${i} no __POW_DBG__ yet`); continue; }
  const line = d.dbg.chars.map((c) => c.missing ? `id${c.id}:MISSING`
    : `id${c.id}/${c.side} pos(${c.pos.join(",")}) vis=${c.vis} scale=${c.scale} inScene=${c.inScene}/${c.parentType}`).join(" | ");
  // capture ONLY at a clean mid-match moment: match live, crate near centre
  const mid = d.pow && !d.pow.endPath && typeof d.pow.crate === "number" && Math.abs(d.pow.crate) < 0.3 && (d.pow.t ?? 0) > 0.8;
  if (mid && shots < 2) {
    shots++;
    await page.screenshot({ path: `tools/critic/frames/minigames/push_of_war/orch/mid-match-${shots}.png` });
    console.log(`  -> saved mid-match-${shots}.png (t=${d.pow.t} crate=${d.pow.crate})`);
  }
  console.log(`t${i} step=${d.pow?.t ?? "?"} crate=${d.pow?.crate?.toFixed?.(3) ?? "?"} :: ${line}`);
}
console.log("ERRORS:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
