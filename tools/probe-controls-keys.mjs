// Probe: keyboard mapping for the new control pads, through the hidden control_lab minigame.
// For each pad (?minigame=control_lab&pad=<p>, desktop viewport) it drives real key and mouse
// input and reads the calls back from __SSP__.mgProbe().inputs:
//   hold  Space down 800 ms then up -> hold:1:0.00, hold:0:0.80 (+-0.1); a second hold ended by a
//         window blur (no keyup) still gives hold:0:...
//   swipe ArrowUp + Space held 500 ms -> one swipe:0.00:-1.00:<p>, 0 < p <= 1
//   twin  Z down/up then X down/up -> button:a:1, a:0, b:1, b:0
//   dial  E held 1 s -> about +1.5 turns (sum of the lab's dial deltas); Q -> negative
//   draw  mouse down, 10 moves, up -> draw:start, >=5 draw:move, draw:end
// It also checks the lab is absent from the MINIGAMES menu, using the selector the menu really
// renders (.ssp-mgm__card[data-mg-id=ID]) and proving that selector on balloon_pop.
// Prints PASS controls <pad> or FAIL controls <pad> ...; exit code 1 on any fail.
import { chromium } from "@playwright/test";

const PADS = process.argv.slice(2).length ? process.argv.slice(2) : ["hold", "swipe", "twin", "dial", "draw"];
const BASE = "http://127.0.0.1:5177/";
const TURN = Math.PI * 2;

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
let failed = false;

async function boot(url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 150)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__SSP__.seed(7);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  });
  await page.waitForTimeout(700);
  return page;
}

async function reachPlay(page) {
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  const t0 = Date.now();
  let phase = "";
  while (Date.now() - t0 < 60000) {
    phase = await page.evaluate(() => window.__SSP__.mgProbe().phase);
    if (phase === "play") return "play";
    if (phase === "vs-splash") await page.keyboard.press("Space");
    else if (phase === "") await page.getByText("START MINI GAME").click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  return phase || "none";
}

// On this headless rig a frame can take 200 ms and a key press takes a CDP round trip, so
// "800 ms" of wall clock between page.keyboard.down and .up is only roughly 800 ms. Record the
// browser's own timestamps for the key events and judge the pad against those.
async function recordKeys(page) {
  await page.evaluate(() => {
    window.__keyLog = [];
    for (const type of ["keydown", "keyup"]) {
      window.addEventListener(type, (e) => window.__keyLog.push({ type, key: e.key, t: e.timeStamp }), true);
    }
  });
}
// Seconds between the last keydown and keyup of this key, per the browser's timestamps.
async function heldFor(page, key) {
  return page.evaluate((k) => {
    const log = window.__keyLog.filter((e) => e.key === k);
    const up = log.filter((e) => e.type === "keyup").pop();
    const down = log.filter((e) => e.type === "keydown" && e.t < up.t).pop();
    return (up.t - down.t) / 1000;
  }, key);
}

const inputs = (page) => page.evaluate(() => [...window.__SSP__.mgProbe().inputs]);
const dialSum = (page) => page.evaluate(() => window.__CONTROL_LAB__?.dialSum ?? NaN);

async function check(pad, page) {
  await recordKeys(page);
  if (pad === "hold") {
    await page.keyboard.down("Space");
    await page.waitForTimeout(800);
    await page.keyboard.up("Space");
    await page.waitForTimeout(150);
    const a = await inputs(page);
    const m = a.length === 2 && a[0] === "hold:1:0.00" && /^hold:0:(\d+\.\d\d)$/.exec(a[1]);
    if (!m) return `Space hold gave ${JSON.stringify(a)}`;
    const real = await heldFor(page, " ");
    if (Math.abs(Number(m[1]) - real) > 0.1) return `Space held ${real.toFixed(2)} s but hold reported ${m[1]}`;
    if (Math.abs(real - 0.8) > 0.4) return `rig held Space ${real.toFixed(2)} s, nowhere near 0.8`;
    // Second run: the window loses focus mid-hold, so no keyup ever arrives.
    await page.keyboard.down("Space");
    await page.waitForTimeout(300);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.waitForTimeout(150);
    const b = (await inputs(page)).slice(2);
    if (b.length !== 2 || b[0] !== "hold:1:0.00" || !/^hold:0:\d+\.\d\d$/.test(b[1])) return `blur hold gave ${JSON.stringify(b)}`;
    await page.keyboard.up("Space");
    await page.waitForTimeout(150);
    const c = (await inputs(page)).slice(2);
    if (c.length !== 2) return `keyup after blur added input: ${JSON.stringify(c)}`;
    // A long hold is reported at the holdMax cap (default 1.5 s), not the raw time.
    const before = (await inputs(page)).length;
    await page.keyboard.down("Space");
    await page.waitForTimeout(2500);
    await page.keyboard.up("Space");
    await page.waitForTimeout(150);
    const d = (await inputs(page)).slice(before);
    const dm = d.length === 2 && /^hold:0:(\d+\.\d\d)$/.exec(d[1]);
    if (!dm) return `long hold gave ${JSON.stringify(d)}`;
    const longReal = await heldFor(page, " ");
    if (longReal < 2) return `rig held Space only ${longReal.toFixed(2)} s, cannot test the cap`;
    if (Number(dm[1]) > 1.5) return `Space held ${longReal.toFixed(2)} s reported ${dm[1]}, over the 1.50 cap`;
    return null;
  }
  if (pad === "swipe") {
    await page.keyboard.down("ArrowUp");
    await page.keyboard.down("Space");
    await page.waitForTimeout(500);
    await page.keyboard.up("Space");
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(150);
    const a = await inputs(page);
    const m = a.length === 1 && /^swipe:0\.00:-1\.00:(\d+\.\d\d)$/.exec(a[0]);
    if (!m) return `swipe gave ${JSON.stringify(a)}`;
    const p = Number(m[1]);
    if (!(p > 0 && p <= 1)) return `swipe power ${p} out of (0,1]`;
    return null;
  }
  if (pad === "twin") {
    await page.keyboard.down("z");
    await page.keyboard.up("z");
    await page.keyboard.down("x");
    await page.keyboard.up("x");
    await page.waitForTimeout(150);
    const a = await inputs(page);
    const want = ["button:a:1", "button:a:0", "button:b:1", "button:b:0"];
    if (JSON.stringify(a) !== JSON.stringify(want)) return `twin gave ${JSON.stringify(a)}`;
    return null;
  }
  if (pad === "dial") {
    const s0 = await dialSum(page);
    await page.keyboard.down("e");
    await page.waitForTimeout(1000);
    await page.keyboard.up("e");
    await page.waitForTimeout(150);
    const s1 = await dialSum(page);
    const turns = (s1 - s0) / TURN;
    const eSec = await heldFor(page, "e");
    if (Math.abs(turns - 1.5 * eSec) > 0.15 * eSec) return `E held ${eSec.toFixed(2)} s turned ${turns.toFixed(3)} turns, want ${(1.5 * eSec).toFixed(3)} +-10%`;
    if (Math.abs(eSec - 1) > 0.5) return `rig held E ${eSec.toFixed(2)} s, nowhere near 1`;
    await page.keyboard.down("q");
    await page.waitForTimeout(1000);
    await page.keyboard.up("q");
    await page.waitForTimeout(150);
    const s2 = await dialSum(page);
    const back = (s2 - s1) / TURN;
    const qSec = await heldFor(page, "q");
    if (!(back < 0 && Math.abs(back + 1.5 * qSec) <= 0.15 * qSec)) return `Q held ${qSec.toFixed(2)} s turned ${back.toFixed(3)} turns, want -${(1.5 * qSec).toFixed(3)} +-10%`;
    const a = await inputs(page);
    if (!a.length || !a.every((s) => s === "dial:+" || s === "dial:-")) return `dial inputs not dial:+/-: ${JSON.stringify(a.slice(0, 4))}`;
    if (a[0] !== "dial:+" || a[a.length - 1] !== "dial:-") return "dial sign order wrong (E first, Q last)";
    return null;
  }
  if (pad === "draw") {
    await page.mouse.move(400, 300);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(400 + i * 20, 300 + i * 8);
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
    await page.waitForTimeout(150);
    const a = await inputs(page);
    const moves = a.filter((s) => s === "draw:move").length;
    if (a[0] !== "draw:start" || a[a.length - 1] !== "draw:end" || moves < 5 || a.length !== moves + 2) {
      return `draw gave ${a.length} entries, ${moves} moves, first ${a[0]}, last ${a[a.length - 1]}`;
    }
    return null;
  }
  return `unknown pad ${pad}`;
}

for (const pad of PADS) {
  let why;
  let page;
  try {
    page = await boot(`${BASE}?seed=7&audio=0&minigame=control_lab&pad=${pad}`);
    const reached = await reachPlay(page);
    if (reached !== "play") why = `never reached play (phase=${reached})`;
    else why = await check(pad, page);
  } catch (e) {
    why = `threw ${String(e).slice(0, 200)}`;
  }
  if (why) failed = true;
  console.log(why ? `FAIL controls ${pad} ${why}` : `PASS controls ${pad}`);
  await page?.close();
}

// The lab is hidden: its card must not be in the MINIGAMES menu. The selector is the one the
// menu renders (a .ssp-mgm__card button with data-mg-id); balloon_pop proves it finds cards.
{
  let why;
  let page;
  try {
    page = await boot(`${BASE}?seed=7&audio=0`);
    await page.evaluate(() => window.__SSP__.goto("minigames"));
    await page.waitForSelector(".ssp-mgm__card", { timeout: 10000 });
    const found = await page.evaluate(() => ({
      pop: document.querySelector('.ssp-mgm__card[data-mg-id="balloon_pop"]') !== null,
      lab: document.querySelector('.ssp-mgm__card[data-mg-id="control_lab"]') !== null,
      cards: document.querySelectorAll(".ssp-mgm__card").length,
    }));
    if (!found.pop) why = "selector is wrong: balloon_pop card not found in the menu";
    else if (found.lab) why = "control_lab is in the MINIGAMES menu";
  } catch (e) {
    why = `threw ${String(e).slice(0, 200)}`;
  }
  if (why) failed = true;
  console.log(why ? `FAIL controls menu ${why}` : "PASS controls menu (control_lab hidden, balloon_pop found)");
  await page?.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
