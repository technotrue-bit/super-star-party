// Orchestrator: capture a TRUE mid-match frame (sim live, crate near centre) and read camera + mirror together.
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

let shots = 0;
for (let i = 0; i < 40 && shots < 2; i++) {
  await p.waitForTimeout(300);
  const s = await p.evaluate(() => {
    const st = window.__SSP__.state();
    return { live: !!window.__POW__ && !window.__POW__.endPath, t: window.__POW__?.t ?? -1, crate: window.__POW__?.crate ?? 9, cam: st.camera, dbg: window.__POW_DBG__ ?? null };
  });
  if (s.live && s.t > 1.5 && Math.abs(s.crate) < 0.35) {
    shots++;
    const f = `tools/critic/frames/minigames/push_of_war/orch/live-mid-${shots}.png`;
    await p.screenshot({ path: f });
    console.log(`SHOT ${f} powT=${s.t.toFixed(2)} crate=${s.crate.toFixed(3)} camPos=${JSON.stringify(s.cam?.pos)}`);
    if (s.dbg) {
      for (const c of s.dbg.chars) console.log(`   id${c.id} ${c.side} world=[${c.world}] screen=(${c.screen?.x},${c.screen?.y})`);
    }
  }
}
if (!shots) console.log("no live mid-match frame captured");
await b.close();
