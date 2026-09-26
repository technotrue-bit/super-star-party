// Orchestrator: how much does the vignette ACTUALLY darken the screen? Isolate it by toggling.
// Corner-vs-centre luminance is confounded (dark sky top, bright grass bottom), so instead:
// screenshot mid-match, set the vignette element's opacity to 0, screenshot again, and diff.
// The difference IS the vignette's pixel contribution.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
await p.goto("http://localhost:5177/?seed=5&autoplay=1&audio=0&speed=2&minigame=push_of_war");
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await p.evaluate(() => {
  window.__SSP__.seed(5);
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
});
await p.waitForTimeout(700);
await p.evaluate(() => window.__SSP__.goto("minigame"));

// let the match run into a contested moment
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(250);
  const w = await p.evaluate(() => window.__POW__ ?? null);
  if (w && w.t > 12 && !w.endPath) break;
}

const found = await p.evaluate(() => {
  const el = Array.from(document.querySelectorAll("div")).find((d) => {
    const bg = getComputedStyle(d).backgroundImage || "";
    return bg.includes("radial-gradient");
  });
  if (!el) return null;
  window.__VIG__ = el;
  return { opacity: getComputedStyle(el).opacity, tag: el.tagName, z: getComputedStyle(el).zIndex };
});
console.log("vignette element:", JSON.stringify(found));

if (found) {
  await p.screenshot({ path: "tools/critic/frames/minigames/push_of_war/ESC/vig-on.png" });
  await p.evaluate(() => { window.__VIG__.style.opacity = "0"; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: "tools/critic/frames/minigames/push_of_war/ESC/vig-off.png" });
  await p.evaluate(() => { window.__VIG__.style.opacity = ""; });
  console.log("captured vig-on.png / vig-off.png");
  // isolate the vignette: hide the animated canvas so the screenshot shows ONLY the overlay gradient
  await p.evaluate(() => {
    const c = document.querySelector("canvas");
    if (c) c.style.visibility = "hidden";
    window.__VIG__.style.opacity = "";
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: "tools/critic/frames/minigames/push_of_war/ESC/vig-isolated.png" });
  await p.evaluate(() => {
    const c = document.querySelector("canvas");
    if (c) c.style.visibility = "visible";
  });
  console.log("captured vig-isolated.png (canvas hidden: the overlay alone)");
}
console.log("ERRORS:", errs.length ? errs.slice(0, 3) : "none");
await b.close();
