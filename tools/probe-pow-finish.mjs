// Orchestrator: does the push_of_war finish actually stage a ceremony, and does it last?
// Samples the minigame's own telemetry across the finish (no frame-racing), plus a screenshot
// of the banner frame for vision, and prints the sim's end state for twin comparison.
import { chromium } from "@playwright/test";

const seed = Number(process.argv[2] ?? 7);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
await p.goto(`http://localhost:5177/?seed=${seed}&autoplay=1&audio=0&speed=2&minigame=push_of_war`);
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
// proven boot sequence (from probe-pow-orch.mjs): seed + autoplay + startMatch, THEN goto minigame.
// Without startMatch the minigame screen has no players to build and nothing ever runs.
await p.evaluate((sd) => {
  window.__SSP__.seed(Number(sd));
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, seed);
await p.waitForTimeout(700);
await p.evaluate(() => window.__SSP__.goto("minigame"));

let inGame = false;
for (let i = 0; i < 40 && !inGame; i++) {
  await p.waitForTimeout(250);
  const st = await p.evaluate(() => ({ screen: window.__SSP__.state().screen, pow: !!window.__POW__ }));
  inGame = st.screen === "minigame" || st.pow;
}
if (!inGame) { console.log("FAILED TO ENTER MINIGAME"); await b.close(); process.exit(1); }

// sample through the whole run; capture the finish
let bannerShot = false;
let finishSeen = null;
const t0 = Date.now();
let last = null;
for (let i = 0; i < 260; i++) {
  await p.waitForTimeout(100);
  const s = await p.evaluate(() => {
    const w = window.__POW__ ?? null;
    const st = window.__SSP__.state();
    return {
      screen: st.screen,
      endPath: w?.endPath ?? null,
      winReason: w?.winReason ?? null,
      postGameT: w?.postGameT ?? null,
      ceremonyMs: w?.ceremonyMs ?? null,
      vignette: w?.vignette ?? null,
      crateEmissive: w?.crateEmissive ?? null,
      crate: w?.crate ?? null,
      rank: w?.ranking ?? null,
      ends: (window.__POW__?.audioLog ?? []).filter((a) => a.event === "finish-climax").length,
    };
  });
  last = s;
  if (s.endPath && !finishSeen) {
    finishSeen = { at: Date.now() - t0, ...s };
    console.log(`FINISH at ${finishSeen.at}ms: path=${s.endPath} reason=${s.winReason} ceremonyMs=${s.ceremonyMs}`);
  }
  // capture on the WIN banner itself: read the on-screen text and only shoot when it names the winner
  // (a fixed postGameT captured the outgoing POWER SURGE banner instead).
  if (s.endPath && !bannerShot) {
    const txt = await p.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 240));
    // capture the CEREMONY window: win banner up, results card not yet — the two overlapping
    // is itself the defect critics keep naming ("cuts straight to the results card").
    if (/WINS/i.test(txt) && !/RESULTS/i.test(txt)) {
      bannerShot = true;
      await p.screenshot({ path: "tools/critic/frames/minigames/push_of_war/FINISH/ceremony-frame.png" });
      console.log(`WIN BANNER FRAME at postGameT=${s.postGameT} vignette=${s.vignette} crateEmissive=${s.crateEmissive}`);
      console.log(`  on-screen text: ${txt.slice(0, 160)}`);
    }
  }
  if (finishSeen && s.screen !== "minigame") {
    console.log(`returned to ${s.screen} after ${Date.now() - t0}ms (ceremony held ~${Date.now() - t0 - finishSeen.at}ms)`);
    break;
  }
}
console.log("LAST:", JSON.stringify(last));
console.log("ERRORS:", errs.length ? errs.slice(0, 3) : "none");
await b.close();
