// Orchestrator: read the LIVE camera state during a push_of_war match (no source edits needed).
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
  await p.waitForTimeout(800);
  const s = await p.evaluate(() => {
    const st = window.__SSP__.state();
    return { screen: st.screen, cam: st.camera, pow: window.__POW__ ?? null, dom: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 70) };
  });
  const powT = s.pow ? `powT=${s.pow.t} crate=${(s.pow.crate ?? 0).toFixed(3)}` : "pow=none";
  console.log(`S${i} screen=${s.screen} camPos=${JSON.stringify(s.cam?.pos)} fov=${s.cam?.fov} ${powT}`);
  if (i === 2) await p.screenshot({ path: "tools/critic/frames/minigames/push_of_war/orch/mid-verify.png" });
}
console.log("shot: tools/critic/frames/minigames/push_of_war/orch/mid-verify.png");
await b.close();
