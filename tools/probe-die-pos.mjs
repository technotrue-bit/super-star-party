// Orchestrator: where is the die on screen? Read its world position + the live camera, compute a crop box.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto("http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=1");
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await p.evaluate(() => {
  window.__SSP__.seed(7);
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
});
for (let i = 0; i < 25; i++) {
  await p.evaluate(() => window.__SSP__.goto("board"));
  await p.waitForTimeout(200);
  if ((await p.evaluate(() => window.__SSP__.state().screen)) === "board") break;
}
await p.evaluate(() => window.__SSP__.rollDice(6));

let shot = false;
for (let i = 0; i < 120 && !shot; i++) {
  await p.waitForTimeout(120);
  const s = await p.evaluate(() => {
    const d = window.__DIE;
    const st = window.__SSP__.state();
    return {
      state: window.__DIE_STATE,
      diePos: d ? [d.position.x, d.position.y, d.position.z] : null,
      dieVisible: d ? d.visible : null,
      cam: st.camera,
      canvas: (() => { const c = document.querySelector("canvas"); return c ? { w: c.clientWidth, h: c.clientHeight } : null; })(),
    };
  });
  if (s.state === "resting" && s.dieVisible) {
    shot = true;
    console.log("DIE:", JSON.stringify(s));
    const f = "tools/critic/frames/dice/orch/rest-frame.png";
    await p.screenshot({ path: f });
    console.log("SHOT:", f);
  }
}
await b.close();
