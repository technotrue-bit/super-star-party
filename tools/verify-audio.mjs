/**
 * SSP audio verification harness.
 * ONE browser + ONE page per invocation. Captures [AUDIO_*] console fires and
 * samples window.__SSP__.state().audio in-page to extract duck curves + peaks.
 *
 * Usage: node tools/verify-audio.mjs <mode> [seed] [durMs]
 * Modes:
 *   title      title -> select -> board (clicks PLAY + START!, no autoplay)
 *   full       title -> select -> board, autoplay=1 (natural playthrough)
 *   star       startMatch + forced-dice route: loses on red, shops, buys star,
 *              hits grumpus (deterministic proof of lose/shop/star_fanfare/grumpus)
 *   finale     ?quickend=1 -> endMatch() -> finale (results music)
 *   shop       ?shop=1 inspection entry (SFX-only shop.buy)
 *   minigame   ?minigame=<id> forced minigame entry (seed in argv[3])
 *
 * Emits JSON between RESULT_JSON_START / RESULT_JSON_END markers on stdout.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const mode = process.argv[2] || "full";
const seed = Number(process.argv[3] ?? 5);
const dur = Number(process.argv[4] ?? (mode === "minigame" ? 45000 : mode === "finale" || mode === "shop" ? 22000 : 100000));
const mgId = process.argv[5]; // for "minigame" mode; for "star" mode: optional route e.g. "1,6"
const routeArg = process.argv[5];

const BASE = "http://localhost:5177";

function buildUrl() {
  const p = new URLSearchParams();
  p.set("audio", "1");
  p.set("seed", String(seed));
  p.set("speed", mode === "title" ? "2" : "5");
  if (mode === "minigame") {
    p.set("minigame", mgId);
  } else if (mode === "finale") {
    p.set("quickend", "1");
  } else if (mode === "shop") {
    p.set("shop", "1");
  }
  if (mode === "full" || mode === "star" || mode === "minigame" || mode === "finale" || mode === "shop") {
    p.set("autoplay", "1"); // auto-roll human (cpus always auto-roll); shops auto-close
  }
  // title: no autoplay (first-gesture + PLAY/START click; human-driven by design)
  return `${BASE}/?${p.toString()}`;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });

const fires = [];
const pageErrors = [];
const dbg = [];
page.on("console", (m) => {
  const t = m.text();
  const pm = t.match(/^\[AUDIO_(PLAY|STINGER|SFX)\] (\S+) t=([\d.]+)$/);
  if (pm) fires.push({ type: pm[1].toLowerCase(), id: pm[2], t: parseFloat(pm[3]) });
  if (t.startsWith("[audio] unknown")) pageErrors.push("UNKNOWN: " + t.slice(0, 300));
  if (t.startsWith("[DBG")) dbg.push(t.slice(0, 200));
});
page.on("pageerror", (e) => pageErrors.push("PAGEERR: " + e.message.slice(0, 300)));

await page.addInitScript(() => {
  window.__sspSamples = [];
  window.__sspSampler = null;
  window.__sspBaseT = null;
});

const url = buildUrl();
const res = await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });

// Install sampler post-navigation (re-init __sspSamples in the live window).
await page.evaluate(() => {
  window.__sspSamples = window.__sspSamples || [];
  window.__sspBaseT = performance.now();
  window.__sspSampler = setInterval(() => {
    try {
      const s = window.__SSP__.state();
      window.__sspSamples.push({
        t: +(performance.now() - window.__sspBaseT).toFixed(1),
        screen: s.screen,
        phase: s.match?.phase ?? "---",
        cp: s.match?.currentPlayer ?? -1,
        track: s.audio.track,
        duck: s.audio.duck,
        rms: s.audio.levels.rms,
        peak: s.audio.levels.peak,
      });
    } catch (e) {
      window.__sspSampleErrors = (window.__sspSampleErrors || []).concat(String(e));
    }
  }, 50);
});
const stopSampler = async () => {
  await page.evaluate(() => { if (window.__sspSampler) clearInterval(window.__sspSampler); });
};

async function isHumanTurn(timeout = 30000) {
  // The human's roll window = the ROLL button is visible AND enabled.
  // (beginDice enables it for the human only; CPUs leave it disabled.)
  // NB: match.phase === "dice" is set during the announce-banner pause too,
  // but the loop's own guard checks S.phase which only becomes "dice" once
  // beginDice runs — signalled by ROLL becoming enabled/visible.
  return page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll("button")];
      const roll = btns.find((b) => /ROLL/.test(b.textContent || ""));
      if (!roll || roll.disabled) return false;
      const d = window.getComputedStyle(roll);
      if (d && d.display === "none") return false;
      return true;
    },
    {},
    { timeout }
  );
}

async function forceRoll(face) {
  // Set forced die + click ROLL atomically. Works because autoplay is OFF here
  // (human waits at the roll button — a pollable, multi-frame window).
  await page.evaluate((f) => {
    window.__forcedDice = f; // eslint-disable-line @typescript-eslint/no-explicit-any
    const btns = [...document.querySelectorAll("button")];
    const btn = btns.find((b) => /ROLL/.test(b.textContent || ""));
    if (btn) (btn).click();
  }, face);
}

async function waitForNotHumanDice(timeout = 15000) {
  await page.waitForFunction(
    () => {
      const m = __SSP__.state().match;
      return !m || m.phase !== "dice" || m.currentPlayer !== 0;
    },
    {},
    { timeout }
  );
}

async function safeClickText(text) {
  return await page.evaluate((t) => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((b) => new RegExp(t, "i").test(b.textContent || ""));
    if (b) { (b).click(); return true; }
    return false;
  }, text);
}

// ---- scenario actions ----
if (mode === "title" || mode === "full") {
  await page.waitForTimeout(700);
  // Real first-gesture (pointerdown) -> title music. el.click() only fires 'click',
  // not 'pointerdown' which the title screen's first-gesture listener needs.
  await page.evaluate(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(600);
  const playOk = await safeClickText("PLAY");
  await page.waitForTimeout(800);
  await safeClickText("START");
  await page.waitForTimeout(1200);
} else if (mode === "star") {
  await page.waitForTimeout(600);
  // autoplay=1 (in URL) -> shops auto-close (no stall) and the every-frame
  // autoplayTick() hook rolls the human. We steer the human's die faces by
  // planting window.__forcedDice on the rising edge of the human's dice phase
  // (in-page 8ms interval: the hook consumes it at beginDice, after the
  // announce-banner pause, so there is no 1-frame race; CPUs are unaffected
  // because __forcedDice is deleted on consumption and only set when cp===0).
  // Route (speed 5): 0->1(blue,13c)->3(blue,16c)->6(red,-3,LOSE sting)->8(blue,16c)
  //   ->10(shop, auto-closes under autoplay)->11(blue,19c)->14(blue,22c)
  //   ->15(star BUY w/20 coins -> FANFARE)
  const route = routeArg ? String(routeArg).split(",").map(Number) : [1, 2, 3, 2, 2, 1, 3, 1];
  await page.evaluate((r) => {
    window.__route = r;
    window.__routeIdx = 0;
    window.__prevDice = false;
    window.__forcedDice = undefined;
    window.__forcedIv = setInterval(() => {
      let inDice = false;
      try {
        if (window.__routeIdx >= window.__route.length) {
          inDice = false;
          return;
        }
        const m = window.__SSP__.state().match;
        inDice = !!m && m.phase === "dice" && m.currentPlayer === 0;
        if (inDice !== window.__prevDice) {
          console.log("[DBG-EDGE] inDice=" + inDice + " cp=" + (m ? m.currentPlayer : -1) + " phase=" + (m ? m.phase : "none"));
        }
        if (inDice && !window.__prevDice) {
          window.__forcedDice = window.__route[window.__routeIdx];
          console.log("[DBG-FORCE] set face=" + window.__forcedDice + " idx=" + window.__routeIdx + " cp=" + (m.currentPlayer) + " phase=" + (m.phase));
          window.__routeIdx++;
        }
      } catch (e) {
        window.__dbgErr = (window.__dbgErr || "").concat("|").concat(String(e).slice(0, 120));
      }
      window.__prevDice = inDice;
    }, 8);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"]);
  }, route);
  try {
    await page.waitForTimeout(Math.max(10000, route.length * 9000 + 10000)); // enough for N turns + (N-1) minigames (speed 5)
  } catch (e) {
    pageErrors.push("star_wait: " + (e.message || String(e)));
  }
  await page.evaluate(() => { if (window.__forcedIv) clearInterval(window.__forcedIv); });
} else if (mode === "minigame") {
  await page.waitForTimeout(800);
  await page.evaluate((sd) => {
    window.__SSP__.seed(sd);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"]);
    // ?minigame=<id> (set in buildUrl) forces the entry via minigameScreen.enter()
  }, seed);
} else if (mode === "finale") {
  // ?quickend=1 -> endMatch() ~600ms after board-enter -> finale (results music).
  await page.waitForTimeout(800);
  await page.evaluate((sd) => { window.__SSP__.seed(sd); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"]); }, seed);
} else if (mode === "shop") {
  // ?shop=1 opens the gumball shop on board-enter (SFX + shop jingle).
  await page.waitForTimeout(800);
  await page.evaluate((sd) => { window.__SSP__.seed(sd); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"]); }, seed);
}

try {
  await page.waitForTimeout(dur);
} catch (e) {
  pageErrors.push("dur_wait: " + (e.message || String(e)));
}

let samples = [];
let sampleErrors = [];
let dbgErr = "";
try {
  samples = await page.evaluate(() => window.__sspSamples || []);
} catch (e) {
  pageErrors.push("samples: " + (e.message || e));
}
try {
  dbgErr = await page.evaluate(() => window.__dbgErr || "");
} catch (e) {
  pageErrors.push("dbgErr: " + (e.message || e));
}
if (dbgErr) pageErrors.push("DBGERR: " + dbgErr);
try {
  sampleErrors = await page.evaluate(() => window.__sspSampleErrors || []);
} catch (e) {
  pageErrors.push("sample_err: " + (e.message || e));
}

const STINGER_SPAN = { star_fanfare: 5.5, lose: 3.5, happening: 3.5, grumpus: 3.5, shop: 3.0 };

function buildResult() {
  const duckWindows = fires
    .filter((f) => f.type === "stinger")
    .map((f) => {
      const span = (STINGER_SPAN[f.id] ?? 3.0) * 1000;
      const win = samples.filter((s) => s.t >= f.t - 200 && s.t <= f.t + span + 600);
      const during = win.filter((s) => s.t >= f.t && s.t <= f.t + span);
      const minDuck = during.length ? Math.min(...during.map((s) => s.duck ?? 1)) : null;
      const dB = minDuck != null ? 20 * Math.log10(minDuck) : null;
      const maxPeakDuringSting = during.length
        ? Math.max(...during.map((s) => s.peak ?? 0))
        : null;
      const beforeDuck = win.filter((s) => s.t < f.t - 50).slice(-1)[0]?.duck ?? null;
      const afterDuck = win.filter((s) => s.t > f.t + span).slice(0, 1)[0]?.duck ?? null;
      return {
        id: f.id,
        fireT: +f.t.toFixed(1),
        span_s: span / 1000,
        beforeDuck: beforeDuck != null ? +beforeDuck.toFixed(4) : null,
        minDuck: minDuck != null ? +minDuck.toFixed(4) : null,
        duckMinDb: dB != null ? +dB.toFixed(1) : null,
        afterDuck: afterDuck != null ? +afterDuck.toFixed(4) : null,
        maxPeakDuringSting: maxPeakDuringSting != null
          ? +maxPeakDuringSting.toFixed(4)
          : null,
        nSamples: win.length,
        curve: win
          .filter((_, i) => i % 3 === 0)
          .slice(0, 30)
          .map((s) => ({
            t: s.t,
            duck: +(s.duck).toFixed(3),
            peak: +(s.peak).toFixed(3),
            track: s.track,
          })),
      };
    });

  const allPeaks = samples.map((s) => s.peak).filter((p) => p != null);
  const globalMaxPeak = allPeaks.length ? Math.max(...allPeaks) : null;

  return {
    mode,
    seed: Number(seed),
    url,
    ok: !!(res && res.status() === 200),
    fires,
    duckWindows,
    globalMaxPeak:
      globalMaxPeak != null ? +globalMaxPeak.toFixed(4) : null,
    peakBelowOne: globalMaxPeak != null ? globalMaxPeak < 1.0 : null,
    nSamples: samples.length,
    sampleErrors,
    errors: pageErrors,
    dbg,
  };
}

function emit() {
  const r = buildResult();
  fs.writeFileSync(
    `tools/probe-${mode}-${seed}.json`,
    JSON.stringify(r, null, 2)
  );
  console.log("RESULT_JSON_START");
  console.log(JSON.stringify(r));
  console.log("RESULT_JSON_END");
}

// Always emit results, even if the shell `timeout` sends SIGTERM.
process.on("SIGTERM", () => {
  try {
    emit();
  } catch (e) {
    console.error("emit-failed:", e);
  }
  process.exit(124);
});

emit();
await browser.close();
process.exit(0);