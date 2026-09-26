/**
 * DOM probe: verify gold banner + toast + banner discipline during star ceremony.
 * Polls long enough to detect star purchase (can take ~120s at speed=2).
 */
import { chromium } from "@playwright/test";

const seed = 7;
const url = "http://localhost:5177/?seed=" + seed + "&autoplay=1&audio=0&speed=2";

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

page.on("console", (m) => {
  if (m.type() === "error") console.log("[ERR] " + m.text());
});

await page.goto(url);

// Wait for __SSP__
for (let i = 0; i < 60; i++) {
  const ready = await page.evaluate(() => !!(window["__SSP__"]));
  if (ready) break;
  await page.waitForTimeout(200);
}

await page.evaluate(() => {
  const s = window["__SSP__"];
  s.seed(7);
  s.autoplay(true);
  s.startMatch(["pip", "bounce", "glimmer", "tusk"], ["pip", "bounce", "glimmer", "tusk"]);
});

// Wait 700ms, then goto board
await page.waitForTimeout(700);
await page.evaluate(() => {
  window["__SSP__"].goto("board");
});
await page.waitForTimeout(500);
// Retry goto if screen didn't change
for (let attempt = 0; attempt < 5; attempt++) {
  const scr = await page.evaluate(() => (window["__SSP__"] && window["__SSP__"].state && window["__SSP__"].state().screen));
  if (scr === "board") break;
  console.log("Screen is: " + scr + " (attempt " + attempt + "), retrying goto...");
  await page.evaluate(() => { window["__SSP__"].goto("board"); });
  await page.waitForTimeout(500);
}

console.log("Board ready. Polling for star ceremony (up to 200s)...");

const t0 = Date.now();
let lastStars = 0;
let inCeremony = false;
let ceremonyStart = 0;
let checks = [];
let lastLog = 0;

for (let i = 0; i < 2000; i++) {
  const result = await page.evaluate(() => {
    var ssp = window["__SSP__"];
    var s = ssp && ssp.state ? ssp.state() : null;
    if (!s || !s.match || !s.match.players) return null;
    var totalStars = s.match.players.reduce((a, p) => a + (p.stars || 0), 0);

    var allBanners = Array.from(document.querySelectorAll(".ssp-fb-banner")).map(function(e) {
      var rect = e.getBoundingClientRect();
      return {
        text: (e.innerText || "").trim().slice(0, 40),
        classes: e.className.split(" ").filter(function(c) { return c.startsWith("ssp-fb-banner"); }),
        opacity: parseFloat(getComputedStyle(e).opacity) || 0,
        visible: rect.width > 0,
      };
    });

    var goldBanners = allBanners.filter(function(b) { return b.classes.includes("ssp-fb-banner--gold"); });

    var toastEls = Array.from(document.querySelectorAll(".ssp-fb-toast")).map(function(e) {
      var rect = e.getBoundingClientRect();
      return {
        text: (e.innerText || "").trim().slice(0, 40),
        opacity: parseFloat(getComputedStyle(e).opacity) || 0,
        visible: rect.width > 0,
      };
    });

    var vignetteEl = document.querySelector(".ssp-vignette");
    var vignette = vignetteEl ? {
      opacity: parseFloat(getComputedStyle(vignetteEl).opacity || "0"),
      color: getComputedStyle(vignetteEl).backgroundColor,
    } : null;

    var ceremonyState = window["__SSP_STAR_CEREMONY"] || null;

    // Count 3D objects on board (try via __SSP__ debug API)
    var meshCount = -1;
    try {
      var w = window["__SSP__"];
      if (w && w.world && typeof w.world.scene === "function") {
        var scene = w.world.scene();
        if (scene && scene.children) {
          meshCount = scene.children.length;
        }
      }
    } catch(e) { meshCount = -1; }

    return {
      totalStars: totalStars,
      allBanners: allBanners,
      goldBanners: goldBanners,
      toastEls: toastEls,
      vignette: vignette,
      ceremonyState: ceremonyState,
      phase: s.match ? s.match.phase : null,
      turn: s.match ? s.match.turn : null,
      cur: s.match ? s.match.cur : null,
      meshCount: meshCount,
    };
  });

  if (!result) { await page.waitForTimeout(100); continue; }

  const now = Date.now();
  const realT = now - t0;

  // Log progress every 10s
  if (realT - lastLog > 10000) {
    lastLog = realT;
    console.log("[t=" + realT + "ms] phase=" + result.phase + " turn=" + result.turn + " cur=" + result.cur + " stars=" + result.totalStars + " meshes=" + result.meshCount);
  }

  if (result.totalStars > lastStars) {
    lastStars = result.totalStars;
    inCeremony = true;
    ceremonyStart = realT;
    console.log("[t=" + realT + "ms] STAR PURCHASED! stars=" + result.totalStars + " phase=" + result.phase + " turn=" + result.turn);
    checks.push({ t: 0, ...result });
  } else if (inCeremony) {
    const elapsed = realT - ceremonyStart;
    if (elapsed < 4500) {
      checks.push({ t: elapsed, ...result });
    } else {
      break;
    }
  }

  await page.waitForTimeout(50);
}

console.log("\n=== RESULTS ===");
console.log("Total checks: " + checks.length);

if (checks.length === 0) {
  console.log("No ceremony detected! Game may not have reached star purchase.");
  await browser.close();
  process.exit(1);
}

for (let ci = 0; ci < checks.length; ci += 5) {
  const c = checks[ci];
  if (!c) continue;
  const bannerStr = (c.allBanners || []).map(function(b) { return b.text + "[" + (b.opacity || 0).toFixed(2) + "]"; }).join(" ") || "none";
  const toastStr = (c.toastEls || []).map(function(t) { return t.text + "[" + (t.opacity || 0).toFixed(2) + "]"; }).join(" ") || "none";
  const vigStr = c.vignette ? "op=" + (c.vignette.opacity || 0).toFixed(3) : "n/a";
  const cerStr = c.ceremonyState ? "active=" + c.ceremonyState.active + "t=" + c.ceremonyState.t : "null";
  console.log("t=" + c.t + "ms: gold=" + (c.goldBanners || []).length + " banners=[" + bannerStr + "] toasts=[" + toastStr + "] vignette=" + vigStr + " cer=" + cerStr + " meshes=" + c.meshCount);
}

// Summary
const goldFrames = checks.filter(c => (c.goldBanners || []).length > 0);
if (goldFrames.length > 0) {
  const g0 = goldFrames[0];
  console.log("\nGold banner visible: t=" + g0.t + "ms to t=" + goldFrames[goldFrames.length-1].t + "ms (" + goldFrames.length + " frames)");
  console.log("Gold banner text: " + g0.goldBanners[0].text + ", opacity: " + g0.goldBanners[0].opacity);
  console.log("Gold banner classes: " + g0.goldBanners[0].classes.join(" "));
} else {
  console.log("\nGold banner NOT found in any frame!");
}

const toastFrames = checks.filter(c => (c.toastEls || []).length > 0);
if (toastFrames.length > 0) {
  console.log("\nToast visible: t=" + toastFrames[0].t + "ms to t=" + toastFrames[toastFrames.length-1].t + "ms");
  console.log("Toast text: " + toastFrames[0].toastEls[0].text);
}

// Banner discipline
let violations = 0;
for (const c of checks) {
  const vb = (c.allBanners || []).filter(b => b.visible && b.opacity > 0.01);
  const vt = (c.toastEls || []).filter(t => t.visible && t.opacity > 0.01);
  if (vb.length > 1) {
    violations++;
    if (violations <= 3) console.log("VIOLATION at t=" + c.t + "ms: " + vb.length + " visible banners: " + vb.map(b => b.text).join(", "));
  }
  if (vb.length > 1 || (vb.length === 1 && vt.length > 1)) {
    if (violations <= 3) console.log("TOAST VIOLATION at t=" + c.t + "ms: " + vb.length + " banners + " + vt.length + " toasts");
  }
}
console.log("\nBanner discipline: " + violations + " violations (max 1 banner + 1 toast)");

// Vignette
const vigFrames = checks.filter(c => c.vignette && c.vignette.opacity > 0.01);
if (vigFrames.length > 0) {
  let maxOp = 0;
  for (const c of vigFrames) { if (c.vignette.opacity > maxOp) maxOp = c.vignette.opacity; }
  console.log("Vignette visible: t=" + vigFrames[0].t + "ms to t=" + vigFrames[vigFrames.length-1].t + "ms (max op=" + maxOp.toFixed(3) + ")");
}

// Ceremony state
const cerFrames = checks.filter(c => c.ceremonyState && c.ceremonyState.active);
console.log("\nCeremony active frames: " + cerFrames.length);

// Mesh count during ceremony
const meshDuringCeremony = checks.filter(c => c.meshCount > 0);
if (meshDuringCeremony.length > 0) {
  console.log("3D meshes during ceremony: min=" + Math.min(...meshDuringCeremony.map(c => c.meshCount)) + " max=" + Math.max(...meshDuringCeremony.map(c => c.meshCount)));
} else {
  console.log("3D meshes: unable to read (scene access issue)");
}

await browser.close();
