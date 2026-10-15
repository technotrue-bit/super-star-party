// Probe: Slingshot Summit (hold + steer, 45 s, ffa).
// Runs the game with ?seed=7&autoplay=1&audio=0&minigame=slingshot_summit and asserts:
//   - the ranking has all 4 ids, and is identical on two Normal runs (same seed)
//   - the round lasts 30-60 s of game time (the game's own clock, plus the frame count)
//   - no page errors
//   - the camera-lock probe passes (fixed camera, no shake)
//   - at Relaxed and at Challenge the round still ends with a full ranking, and the
//     Challenge winner's score is at least the Relaxed winner's
// The sim is stepped with __SSP__.advance (60 Hz frames) so a slow headless GPU does not
// stretch the wall clock. Prints PASS or FAIL <reason>; exit code 1 on any failure.
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const ID = "slingshot_summit";
const BASE = process.env.SSP_URL ?? "http://127.0.0.1:5177";
const fail = (msg) => {
  console.log(`FAIL ${msg}`);
  process.exit(1);
};

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });

/** Opens the game and runs the splash, countdown and practice to live play. Returns the page. */
async function openRound(level, { autoplay }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  if (level) await page.addInitScript((lv) => localStorage.setItem("ssp.cpuLevel", lv), level);
  await page.goto(`${BASE}/?seed=7&autoplay=1&audio=0&minigame=${ID}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__SSP__.seed(7);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  });
  // The modules register one after another; give the whole list time to land.
  let known = false;
  for (let i = 0; i < 100 && !known; i++) {
    known = await page.evaluate((id) => (window.__SSP__.state().minigameRules?.catalog ?? []).some((m) => m.id === id), ID);
    if (!known) await page.waitForTimeout(300);
  }
  if (!known) {
    await page.close();
    fail("unknown minigame");
  }
  await page.evaluate((auto) => {
    if (auto) window.__SSP__.autoplay(true);
    window.__SSP__.goto("minigame");
  }, autoplay);

  // Through the intro card, the splash, the countdown, to live play.
  let phase = "";
  for (let i = 0; i < 400 && phase !== "play"; i++) {
    phase = await page.evaluate(() => window.__SSP__.mgProbe().phase);
    if (phase === "play") break;
    if (phase === "") await page.getByText("START MINI GAME").click({ timeout: 300 }).catch(() => {});
    await page.evaluate(() => window.__SSP__.advance(30));
    await page.waitForTimeout(30);
  }
  if (phase !== "play") fail(`never reached play (phase=${phase || "none"}) level=${level ?? "normal"}`);
  return { page, errors };
}

async function playRound(level) {
  const { page, errors } = await openRound(level, { autoplay: true });

  // Step the live round in 10-frame chunks until the game calls finish.
  let frames = 0;
  let probe = null;
  while (frames < 60 * 90) {
    probe = await page.evaluate(() => {
      window.__SSP__.advance(10);
      return window.__SSP__.mgProbe();
    });
    frames += 10;
    if (probe.ranking) break;
  }
  if (!probe?.ranking) fail(`round never finished (level=${level ?? "normal"})`);
  const tel = await page.evaluate(() => window.__SLINGSHOT__ ?? null);
  await page.close();
  return { ranking: probe.ranking, frames, tel, errors };
}

/** A human round: arrow keys aim, Space is the hold. One shot, read back from the game's log. */
async function humanShot() {
  const { page, errors } = await openRound(null, { autoplay: false });
  await page.evaluate(() => window.__SSP__.advance(30));
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.evaluate(() => window.__SSP__.advance(30));
  await page.keyboard.down(" ");
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__SSP__.advance(20));
  await page.keyboard.up(" ");
  const tel = await page.evaluate(() => {
    window.__SSP__.advance(120);
    return window.__SLINGSHOT__;
  });
  await page.close();
  return { tel, errors };
}

const winnerScore = (r) => r.tel?.scores?.[r.ranking[0]] ?? -1;
const runs = {};
for (const [key, level] of [["a", null], ["b", null], ["relaxed", "relaxed"], ["challenge", "challenge"]]) {
  runs[key] = await playRound(level);
  const r = runs[key];
  console.log(`run ${key}: ranking=${JSON.stringify(r.ranking)} scores=${JSON.stringify(r.tel?.scores)} fives=${JSON.stringify(r.tel?.fives)} frames=${r.frames} t=${r.tel?.tFinish?.toFixed(2)}`);
  const ids = [...r.ranking].sort((x, y) => x - y);
  if (JSON.stringify(ids) !== "[0,1,2,3]") fail(`ranking is not all 4 ids (${key}): ${JSON.stringify(r.ranking)}`);
  const secs = r.tel?.tFinish ?? 0;
  if (secs < 30 || secs > 60) fail(`round lasted ${secs.toFixed(1)} s of game time (${key})`);
  if (r.errors.length) fail(`page errors (${key}): ${r.errors[0]}`);
}
if (JSON.stringify(runs.a.ranking) !== JSON.stringify(runs.b.ranking)) fail(`ranking differs between runs: ${JSON.stringify(runs.a.ranking)} vs ${JSON.stringify(runs.b.ranking)}`);
if (JSON.stringify(runs.a.tel?.scores) !== JSON.stringify(runs.b.tel?.scores)) fail("scores differ between runs");
if (winnerScore(runs.challenge) < winnerScore(runs.relaxed)) {
  fail(`Challenge winner ${winnerScore(runs.challenge)} < Relaxed winner ${winnerScore(runs.relaxed)}`);
}

const human = await humanShot();
const fire = (human.tel?.log ?? []).find((l) => / L0 fire /.test(l));
console.log(`human: shots=${JSON.stringify(human.tel?.shots)} ${fire ?? "no shot"}`);
if (human.errors.length) fail(`page errors (human): ${human.errors[0]}`);
if (!fire) fail("a Space hold did not fire the human's slingshot");
const charge = Number(/c=([\d.]+)/.exec(fire)?.[1]);
const aim = Number(/aim=(-?[\d.]+)/.exec(fire)?.[1]);
if (!(charge > 0.35 && charge < 0.85)) fail(`a ~0.7 s hold made charge ${charge} (want about 0.58)`);
if (!(aim > 0.15 && aim < 0.45)) fail(`three ArrowRight taps made aim ${aim} (want about 0.36)`);
await browser.close();

// The camera must not move because of input (fixed camera, no shake).
const cam = spawnSync("node", [join(dirname(new URL(import.meta.url).pathname), "probe-camera-lock.mjs"), ID], { encoding: "utf8" });
process.stdout.write(cam.stdout);
if (cam.status !== 0) fail("camera lock probe failed");

console.log(`PASS ${ID} winner relaxed=${winnerScore(runs.relaxed)} normal=${winnerScore(runs.a)} challenge=${winnerScore(runs.challenge)}`);
