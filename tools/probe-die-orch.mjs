// Orchestrator: capture the 3D die DURING a roll (tumble -> land) so the claim can be judged on pixels.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto("http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=1");
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await p.evaluate(() => {
  window.__SSP__.seed(7);
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
});
let onBoard = false;
for (let i = 0; i < 25; i++) {
  await p.evaluate(() => window.__SSP__.goto("board"));
  await p.waitForTimeout(200);
  if ((await p.evaluate(() => window.__SSP__.state().screen)) === "board") { onBoard = true; break; }
}
console.log("ON BOARD:", onBoard);

// force a known face so the landed numeral can be checked against the sim
await p.evaluate(() => window.__SSP__.rollDice(6));

let shots = 0;
const seen = [];
for (let i = 0; i < 120 && shots < 8; i++) {
  await p.waitForTimeout(120);
  const s = await p.evaluate(() => ({
    phase: window.__SSP__.state().match?.phase ?? null,
    die: window.__DIE_STATE ?? window.__DIE ?? null,
    dom: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 60),
  }));
  const dieStr = JSON.stringify(s.die).slice(0, 120);
  seen.push(`${s.phase}|${dieStr}`);
  if (!/hidden/.test(dieStr) || s.phase === "moving" || /tumble|landing|resting/i.test(dieStr)) {
    shots++;
    const f = `tools/critic/frames/dice/orch/orch-${shots}.png`;
    await p.screenshot({ path: f });
    console.log(`SHOT ${shots} ${f} phase=${s.phase} die=${dieStr}`);
  }
}
console.log("TIMELINE:", seen.slice(0, 14).join("  ||  ").slice(0, 700));
await b.close();
