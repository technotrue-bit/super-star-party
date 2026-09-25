// Orchestrator: verify the red-space sting by its real-time timeline (stall-proof) + one peak screenshot.
// A sub-500ms flash cannot be caught by screenshot racing (Playwright's ReadPixels stall), so we
// sample the effect's own state every 25ms and judge duration/peak from that, then snapshot the peak.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
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

// P1 starts on space 0; rolling 6 lands on space 6 = a red space (verified previously: coins 10 -> 7).
await p.evaluate(() => window.__SSP__.rollDice(6));

// start a 25ms sampler in the page itself so no round-trip latency hides the peak
await p.evaluate(() => {
  const log = [];
  const dom = document.querySelector(".ssp-flash");
  const t0 = performance.now();
  const id = setInterval(() => {
    const el = window.__SSP_FLASH;
    log.push({
      ms: Math.round(performance.now() - t0),
      peak: el ? el.peak : null,
      domOpacity: dom ? getComputedStyle(dom).opacity : null,
      bg: dom ? getComputedStyle(dom).backgroundColor : null,
    });
    if (performance.now() - t0 > 3000) { clearInterval(id); window.__STING_LOG = log; }
  }, 25);
});

let sawPeak = false;
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(100);
  const s = await p.evaluate(() => ({ flash: window.__SSP_FLASH ?? null, log: window.__STING_LOG ?? null }));
  if (s.flash && !sawPeak) {
    sawPeak = true;
    await p.screenshot({ path: "tools/critic/frames/economy/orch-red/sting-peak.png" });
    console.log("PEAK FRAME SAVED (captured while __SSP_FLASH was live)");
  }
  if (s.log) {
    const active = s.log.filter((r) => r.domOpacity !== null && parseFloat(r.domOpacity) > 0.05);
    console.log(`SAMPLES ${s.log.length} | frames over 5% opacity: ${active.length} (~${active.length * 25}ms)`);
    if (active.length) {
      const peak = Math.max(...active.map((r) => parseFloat(r.domOpacity)));
      const first = active[0].ms, last = active[active.length - 1].ms;
      console.log(`STING: first>5% at ${first}ms, last at ${last}ms => visible ~${last - first}ms | peak dom opacity ${peak}`);
      const trace = s.log.filter((_, idx) => idx % 6 === 0).map((r) => `${r.ms}:${r.domOpacity}`).join(" ");
      console.log("TRACE(every 150ms):", trace);
    } else {
      console.log("NO VISIBLE FLASH DETECTED in the dom opacity trace");
    }
    break;
  }
}
console.log("ERRORS:", errs.length ? errs.slice(0, 3) : "none");
await b.close();
