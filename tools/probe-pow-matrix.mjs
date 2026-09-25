// Orchestrator: matrix test — does push_of_war start at different speed params? (isolates refit vs speed)
import { chromium } from "@playwright/test";

const configs = [
  { label: "speed=1", url: "?seed=7&autoplay=1&audio=0&speed=1&minigame=push_of_war" },
  { label: "speed=2", url: "?seed=7&autoplay=1&audio=0&speed=2&minigame=push_of_war" },
  { label: "no speed", url: "?seed=7&autoplay=1&audio=0&minigame=push_of_war" },
];

for (const cfg of configs) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.goto("http://localhost:5177/" + cfg.url);
  await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await p.evaluate((s) => {
    window.__SSP__.seed(Number(s));
    window.__SSP__.autoplay(true);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  }, "7");
  for (let i = 0; i < 25; i++) {
    await p.evaluate(() => window.__SSP__.goto("minigame"));
    await p.waitForTimeout(180);
    const s = await p.evaluate(() => window.__SSP__.state().screen);
    if (s === "minigame") break;
  }
  let started = null, mgEl = null;
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => ({
      pow: window.__POW__ ?? null,
      dbg: !!window.__POW_DBG__,
      mgEl: document.querySelectorAll(".ssp-mg-count").length,
      screen: window.__SSP__.state().screen,
    }));
    if (r.pow && started === null) started = (i + 1) * 0.7;
    mgEl = r.mgEl;
    if (r.screen === "board") break;
  }
  console.log(`${cfg.label.padEnd(9)} -> sim started: ${started ? "yes @" + started.toFixed(1) + "s" : "NEVER"} | mgCount at end=${mgEl} | errs=${errs.length ? errs.slice(0, 2) : "none"}`);
  await b.close();
}
