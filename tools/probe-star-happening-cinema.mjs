// Frame capture: star-buy ceremony (3.8s) + green happening staged beat.
// Resilient to page navigation / HMR context destruction.
// Usage: node tools/probe-star-happening-cinema.mjs [seed]
import { chromium } from "@playwright/test";
import fs from "node:fs";

const seed = Number(process.argv[2] ?? "7");
const OUT = "tools/critic/frames/board/STAR-HAPPENING";
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) { if (f.endsWith(".png")) fs.unlinkSync(`${OUT}/${f}`); }
for (const f of fs.readdirSync(OUT)) { if (f.endsWith(".json")) fs.unlinkSync(`${OUT}/${f}`); }

const errors = [];
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });

// Boot pattern (copy from probe-star.mjs)
await page.goto(`http://localhost:5177/?seed=${seed}&autoplay=1&audio=0&speed=2`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate((s) => {
  window.__SSP__.seed(s);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
}, seed);
await page.waitForTimeout(700);
let boardReady = false;
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.__SSP__.goto("board"));
  await page.waitForTimeout(300);
  const scr = await safeEval(() => window.__SSP__?.state?.()?.screen ?? "?");
  if (scr === "board") { boardReady = true; break; }
}
console.log("Board ready:", boardReady);
await page.evaluate(() => window.__SSP__.autoplay(true));

async function safeEval(fn) {
  try { return await page.evaluate(fn); }
  catch (e) { return null; }
}

async function captureBurst(prefix, count, intervalMs) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    const path = `${OUT}/${prefix}_${String(i).padStart(3, "0")}.png`;
    try { await page.screenshot({ path }); } catch { console.log("  screenshot failed at", i); break; }
    frames.push(path);
    await page.waitForTimeout(intervalMs);
  }
  return frames;
}

const GREEN_EVENTS = ["wind_ride", "coin_shower", "coin_tax", "spot_swap", "star_magnet", "lucky_penny", "banana_peel", "express_pass", "star_dance"];

async function snapshot() {
  return safeEval(() => {
    const s = window.__SSP__?.state?.() ?? {};
    const m = s.match ?? {};
    return {
      screen: s.screen, phase: m.phase, turn: m.turn, cur: m.currentPlayer,
      seed: s.rngSeed,
      players: (m.players ?? []).map((p) => ({ id: p.id, name: p.name, coins: p.coins, stars: p.stars, space: p.space })),
      events: m.events ?? [],
      cam: s.camera,
    };
  }) || { screen: "?", players: [], events: [], cam: null };
}

async function goldBannerVisible() {
  return safeEval(() => {
    const banners = Array.from(document.querySelectorAll(".ssp-fb-banner--gold")).filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && parseFloat(getComputedStyle(e).opacity) > 0.01;
    });
    return banners.map(e => (e.innerText || "").trim().slice(0, 40));
  }) || [];
}

async function greenBannerVisible() {
  return safeEval(() => {
    const banners = Array.from(document.querySelectorAll(".ssp-fb-banner--green")).filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && parseFloat(getComputedStyle(e).opacity) > 0.01;
    });
    return banners.map(e => (e.innerText || "").trim().slice(0, 40));
  }) || [];
}

async function vignetteVisible() {
  return safeEval(() => {
    const v = document.querySelector(".ssp-vignette");
    if (!v) return false;
    return parseFloat(getComputedStyle(v).opacity) > 0;
  }) || false;
}

const t0 = Date.now();
let starFound = false;
let happeningFound = false;
let lastStars = 0;
let seenEvents = new Set();

while (Date.now() - t0 < 300000 && (!starFound || !happeningFound)) {
  await page.waitForTimeout(100);
  const snap = await snapshot();
  if (!snap) { console.log("Page context lost, waiting..."); await page.waitForTimeout(1000); continue; }
  const totalStars = snap.players.reduce((a, p) => a + (p.stars ?? 0), 0);

  // STAR CEREMONY: detect via star count increase OR gold banner
  if (!starFound) {
    if (totalStars > lastStars) lastStars = totalStars;
    const gold = await goldBannerVisible();
    const vig = await vignetteVisible();
    if (totalStars > 0 || gold.length > 0) {
      starFound = true;
      console.log(`[t=${Math.round((Date.now()-t0)/1000)}s] STAR CEREMONY DETECTED: stars=${totalStars} goldBanners=${JSON.stringify(gold)} vignette=${vig}`);
      const detectionSnap = await snapshot();
      fs.writeFileSync(`${OUT}/star_ceremony_state.json`, JSON.stringify({
        detectedAt: Date.now() - t0, detection: detectionSnap,
      }, null, 2));
      await captureBurst("star_ceremony", 100, 38); // ~3.8s
      const postSnap = await snapshot();
      fs.writeFileSync(`${OUT}/star_ceremony_state.json`, JSON.stringify({
        detectedAt: Date.now() - t0, detection: detectionSnap, postCeremony: postSnap,
      }, null, 2));
    }
  }

  // GREEN HAPPENING: detect via new green event IDs in match.events
  if (!happeningFound && snap.events) {
    for (const e of snap.events) {
      if (GREEN_EVENTS.includes(e) && !seenEvents.has(e)) {
        seenEvents.add(e);
        console.log(`[t=${Math.round((Date.now()-t0)/1000)}s] Green happening event: ${e} turn=${snap.turn}`);
        const green = await greenBannerVisible();
        const vig = await vignetteVisible();
        console.log(`  greenBanner=${JSON.stringify(green)} vignette=${vig} cam=${JSON.stringify(snap.cam)}`);
        const detectionSnap = await snapshot();
        await captureBurst("green_hap", 60, 33); // ~2s
        const postSnap = await snapshot();
        fs.writeFileSync(`${OUT}/green_hap_${e}_state.json`, JSON.stringify({
          event: e, detectedAt: Date.now() - t0, detection: detectionSnap, postResolve: postSnap,
        }, null, 2));
        happeningFound = true;
        break;
      }
    }
  }

  if (snap.screen !== "board" && snap.screen !== "minigame") {
    console.log(`[t=${Math.round((Date.now()-t0)/1000)}s] Screen: ${snap.screen}`);
    if (snap.screen === "finale" || snap.screen === "title") { console.log("Game ended."); break; }
  }
  if (snap.phase === "ended") break;
}

console.log("\n=== SUMMARY ===");
console.log("Star ceremony found:", starFound);
console.log("Green happening found:", happeningFound);
const allFrames = fs.readdirSync(OUT).filter(f => f.endsWith(".png")).sort();
console.log("Total frames:", allFrames.length, "Star:", allFrames.filter(f=>f.startsWith("star")).length, "Hap:", allFrames.filter(f=>f.startsWith("green")).length);
console.log("ERRORS:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
