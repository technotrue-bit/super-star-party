// Probe: minigame cameras do not move because of input.
// For each id: start the round with real key input (no autoplay), wait for the
// "play" phase, then sample mgProbe().cam every 50 ms for 6 s while mashing Space
// and holding an arrow key. Fixed-camera games must stay put (< 0.001); Cake Dash
// may follow the race but with no step over 0.35 and no reversal over 0.05.
// A page error during the round fails the game too. Prints PASS camera <id> or FAIL camera <id> ...; exit code 1 on any fail.
import { chromium } from "@playwright/test";

const DEFAULT_IDS = ["balloon_pop", "coin_cannon", "push_of_war", "memory_match", "drum_solo", "pipe_puzzle", "quick_draw", "cake_dash", "slingshot_summit", "pie_flick", "row_rumble", "crank_coaster", "chalk_trails"];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_IDS;
// Follow-camera races: the course axis index into cam [x, y, z] and the direction of travel.
// The step limit is a speed: 0.35 world units per 50 ms (7 units/s), measured against the
// real time between samples so a slow headless frame rate does not fail a steady glide.
const FOLLOW = new Map([
  ["cake_dash", { axis: 0, dir: 1 }],
  ["row_rumble", { axis: 2, dir: -1 }],
]);
const SAMPLE_MS = 50;
const SAMPLE_FOR_MS = Number(process.env.CAM_PROBE_MS ?? 6000);
const MIN_SAMPLES = 40;

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
let failed = false;

async function probe(id) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)));
  try {
    await page.goto(`http://127.0.0.1:5177/?seed=7&audio=0&minigame=${id}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
    const hasHook = await page.evaluate(() => typeof window.__SSP__.mgProbe === "function");
    if (!hasHook) return `FAIL camera ${id} mgProbe is undefined`;
    await page.evaluate(() => {
      window.__SSP__.seed(7);
      window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__SSP__.goto("minigame"));

    // Press START on the intro card, skip the VS splash with Space, then wait through
    // the countdown and practice beat.
    const t0 = Date.now();
    let phase = "";
    while (Date.now() - t0 < 60000) {
      phase = await page.evaluate(() => window.__SSP__.mgProbe().phase);
      if (phase === "play") break;
      if (phase === "vs-splash") await page.keyboard.press("Space");
      else if (phase === "") await page.getByText("START MINI GAME").click({ timeout: 500 }).catch(() => {});
      await page.waitForTimeout(150);
    }
    if (phase !== "play") return `FAIL camera ${id} never reached play (phase=${phase || "none"})`;

    // Sample while mashing Space and holding an arrow key. Key events go straight to
    // the page, in the same evaluate that reads the camera, so the loop stays near 50 ms.
    const samples = [];
    const stamps = [];
    // Sample for SAMPLE_FOR_MS, and past it until MIN_SAMPLES are in (a slow runner can fall
    // one short: row_rumble once got 39), up to three windows.
    const tEnd = Date.now() + SAMPLE_FOR_MS;
    const tCap = Date.now() + 3 * SAMPLE_FOR_MS;
    let n = 0;
    let endPhase = "play";
    while (Date.now() < tEnd || (samples.length < MIN_SAMPLES && Date.now() < tCap)) {
      const arrow = n % 40 < 20 ? "ArrowRight" : "ArrowLeft";
      const p = await page.evaluate(({ arrow, held }) => {
        const key = (type, k, repeat = false) => window.dispatchEvent(new KeyboardEvent(type, { key: k, repeat, bubbles: true, cancelable: true }));
        key("keydown", " ");
        key("keyup", " ");
        key("keydown", arrow, held);
        return window.__SSP__.mgProbe();
      }, { arrow, held: n % 20 !== 0 });
      if (p.phase !== "play") { endPhase = p.phase; break; }
      samples.push(p.cam);
      stamps.push(Date.now());
      n++;
      await page.waitForTimeout(SAMPLE_MS);
    }
    if (samples.length < MIN_SAMPLES) return `FAIL camera ${id} only ${samples.length} samples (phase ${endPhase})`;

    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (FOLLOW.has(id)) {
      const { axis, dir } = FOLLOW.get(id);
      let maxStep = 0;
      let maxAlong = -Infinity;
      let maxBack = 0;
      for (let i = 0; i < samples.length; i++) {
        if (i) {
          // Scale to the nominal sample period so the limit reads as a speed.
          const per = Math.max(1, stamps[i] - stamps[i - 1]) / SAMPLE_MS;
          maxStep = Math.max(maxStep, dist(samples[i], samples[i - 1]) / Math.max(1, per));
        }
        const along = samples[i][axis] * dir;
        maxAlong = Math.max(maxAlong, along);
        maxBack = Math.max(maxBack, maxAlong - along);
      }
      const ok = maxStep <= 0.35 && maxBack <= 0.05 && errors.length === 0;
      return `${ok ? "PASS" : "FAIL"} camera ${id} maxStep=${maxStep.toFixed(4)} maxBack=${maxBack.toFixed(4)} samples=${samples.length}${errors.length ? " page errors: " + errors.join(" | ") : ""}`;
    }
    let maxSpread = 0;
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) maxSpread = Math.max(maxSpread, dist(samples[i], samples[j]));
    }
    const ok = maxSpread < 0.001 && errors.length === 0;
    return `${ok ? "PASS" : "FAIL"} camera ${id} maxStep=${maxSpread.toFixed(5)} samples=${samples.length}${errors.length ? " page errors: " + errors.join(" | ") : ""}`;
  } catch (e) {
    return `FAIL camera ${id} ${String(e).slice(0, 160)}`;
  } finally {
    await page.close();
  }
}

for (const id of ids) {
  const line = await probe(id);
  console.log(line);
  if (!line.startsWith("PASS")) failed = true;
}
await browser.close();
process.exit(failed ? 1 : 0);
