// Orchestrator: is the push_of_war vignette actually visible, or stacked behind the game?
// Lists every fixed full-screen gradient overlay with its z-index, live opacity and inline value,
// plus the canvas stacking, and what the game's own telemetry reports for the vignette.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto("http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=2&minigame=push_of_war");
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await p.evaluate(() => {
  window.__SSP__.seed(7);
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
});
await p.waitForTimeout(700);
await p.evaluate(() => window.__SSP__.goto("minigame"));
await p.waitForTimeout(6000);

const info = await p.evaluate(() => {
  const c = document.querySelector("canvas");
  const overlays = Array.from(document.querySelectorAll("div")).map((d) => {
    const cs = getComputedStyle(d);
    return { d, cs };
  }).filter(({ cs }) => cs.position === "fixed" && (cs.backgroundImage || "").includes("gradient"))
    .map(({ d, cs }) => ({
      z: cs.zIndex,
      liveOpacity: cs.opacity,
      inlineOpacity: d.style.opacity || "(none)",
      bg: (d.style.backgroundImage || cs.backgroundImage).slice(0, 64),
      pointerEvents: cs.pointerEvents,
    }));
  return {
    canvas: c ? { z: getComputedStyle(c).zIndex, pos: getComputedStyle(c).position, w: c.width, h: c.height } : null,
    overlays,
    powVignette: window.__POW__?.vignette ?? null,
    powCrateEmissive: window.__POW__?.crateEmissive ?? null,
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
