// Orchestrator: dump the raw push_of_war character projection (screen coords through the live camera).
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto("http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=1&minigame=push_of_war");
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await p.evaluate((s) => {
  window.__SSP__.seed(Number(s));
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, "7");
for (let i = 0; i < 25; i++) {
  await p.evaluate(() => window.__SSP__.goto("minigame"));
  await p.waitForTimeout(180);
  if ((await p.evaluate(() => window.__SSP__.state().screen)) === "minigame") break;
}
for (let i = 0; i < 6; i++) {
  await p.waitForTimeout(700);
  const d = await p.evaluate(() => window.__POW_DBG__ ?? null);
  if (!d) { console.log(`S${i} no mirror`); continue; }
  if (i >= 2) {
    for (const c of d.chars) {
      console.log(`S${i} id${c.id} ${c.side}: world=[${c.world}] screen=(${c.screen?.x},${c.screen?.y}) ndcZ=${c.screen?.ndcZ} camFov=${c.screen?.fov} meshes=${c.meshes}`);
    }
    console.log("---");
  }
}
await b.close();
