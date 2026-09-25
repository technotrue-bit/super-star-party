// Orchestrator: why does push_of_war stop running after the layout refit? Capture every error channel.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const logs = [];
p.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
p.on("pageerror", (e) => logs.push(`PAGEERROR: ${e.message}`));

await p.goto("http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=1&minigame=push_of_war");
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await p.evaluate((s) => {
  window.__SSP__.seed(Number(s));
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, "7");

let launched = false;
for (let i = 0; i < 25; i++) {
  await p.evaluate(() => window.__SSP__.goto("minigame"));
  await p.waitForTimeout(200);
  const s = await p.evaluate(() => window.__SSP__.state().screen);
  if (s === "minigame") { launched = true; break; }
}
console.log("LAUNCHED:", launched);

for (let i = 0; i < 5; i++) {
  await p.waitForTimeout(1200);
  const st = await p.evaluate(() => ({
    screen: window.__SSP__.state().screen,
    dbg: window.__POW_DBG__ ?? null,
    pow: window.__POW__ ?? null,
    dom: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 100),
    mgCount: document.querySelectorAll(".ssp-mg-count").length,
    canvas: document.querySelectorAll("canvas").length,
  }));
  console.log(`@${((i + 1) * 1.2).toFixed(1)}s screen=${st.screen} canvas=${st.canvas} mgCount=${st.mgCount} dbg=${st.dbg ? "YES" : "no"} pow=${st.pow ? "t" + st.pow.t : "no"}`);
  if (st.dbg) console.log("   chars:", JSON.stringify(st.dbg.chars).slice(0, 380));
  else console.log("   dom:", st.dom.slice(0, 90));
}
console.log("LOGS:", logs.filter((l) => /error|PAGEERROR|warn/i.test(l)).slice(0, 6));
await b.close();
