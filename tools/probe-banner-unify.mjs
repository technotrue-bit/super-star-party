/**
 * probe-banner-unify.mjs — verifies two fixes on the running board:
 *
 *  1. BANNER SINGLE-CHANNEL: hud.showBanner() is routed through the shared queue,
 *     so at most ONE banner is on screen at a time (toasts are a separate, smaller
 *     channel pinned to the bottom of the screen). Samples every 50ms across a full
 *     turn and counts SIMULTANEOUSLY VISIBLE (opacity > 0.5) banners and toasts.
 *
 *  2. SHOP MODAL SUPPRESSION: while the stall is open, the board chrome (ROLL!,
 *     pause FAB, player chips) is neither visible nor tappable. Checked with
 *     computed styles AND elementFromPoint hit-testing.
 *
 * Run in the FOREGROUND from the repo dir:  node tools/probe-banner-unify.mjs
 */
import { chromium } from "@playwright/test";

const URL = "http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=2&screen=board";

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

await page.goto(URL, { waitUntil: "domcontentloaded" });

// goto(screen) races async screen registration — retry until the board is really live.
let ok = false;
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(() => (window.__SSP__?.state?.() ?? {}).screen ?? null);
  if (st === "board") { ok = true; break; }
  await page.evaluate(() => window.__SSP__?.goto?.("board"));
  await page.waitForTimeout(400);
}
console.log("board live:", ok);
if (!ok) { await b.close(); process.exit(1); }

/* ---------- 1. banner concurrency across a full turn ---------- */
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < 42000) {
  const s = await page.evaluate(() => {
    const vis = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      return parseFloat(cs.opacity) > 0.5;
    };
    const pick = (sel, kind) =>
      Array.from(document.querySelectorAll(sel))
        .filter(vis)
        .map((e) => ({ kind, text: (e.textContent || "").trim().slice(0, 42) }));
    return {
      t: performance.now(),
      items: [
        ...pick(".ssp-fb-banner", "banner"),
        ...pick(".ssp-hud-banner", "hud-banner"),
        ...pick(".ssp-fb-toast", "toast"),
      ],
      screen: (window.__SSP__?.state?.() ?? {}).screen ?? null,
    };
  });
  if (s.items.length) samples.push(s);
  await page.waitForTimeout(50);
}

let maxBanners = 0, maxToasts = 0, maxAll = 0;
const offenders = [];
for (const s of samples) {
  const banners = s.items.filter((i) => i.kind !== "toast").length;
  const toasts = s.items.filter((i) => i.kind === "toast").length;
  if (banners > maxBanners) maxBanners = banners;
  if (toasts > maxToasts) maxToasts = toasts;
  if (s.items.length > maxAll) maxAll = s.items.length;
  if (banners > 1) offenders.push({ t: Math.round(s.t), texts: s.items.map((i) => `${i.kind}:${i.text}`) });
}
const hudBanners = samples.flatMap((s) => s.items.filter((i) => i.kind === "hud-banner")).length;
console.log(`samples with visible feedback: ${samples.length}`);
console.log(`MAX SIMULTANEOUS BANNERS: ${maxBanners}   (was 2 before the single-channel fix)`);
console.log(`MAX SIMULTANEOUS TOASTS:  ${maxToasts}`);
console.log(`MAX SIMULTANEOUS TOTAL:   ${maxAll}`);
console.log(`banners still going through the HUD channel: ${hudBanners} (0 = fully unified)`);
if (offenders.length) console.log("dual-banner windows:", JSON.stringify(offenders.slice(0, 5)));
else console.log("dual-banner windows: NONE");

/* ---------- 2. shop modal suppression (fresh page, shop open at boot) ---------- */
const page2 = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs2 = [];
page2.on("console", (m) => { if (m.type() === "error") errs2.push(m.text()); });

await page2.goto("http://localhost:5177/?seed=7&audio=0&autoplay=0&screen=board&shop=1",
                 { waitUntil: "domcontentloaded" });

let shopOpen = false;
for (let i = 0; i < 30; i++) {
  shopOpen = await page2.evaluate(() => !!document.querySelector(".ssp-shop"));
  if (shopOpen) break;
  await page2.waitForTimeout(300);
}

const readChrome = () =>
  page2.evaluate(() => {
    const probe = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, present: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return {
        sel, present: true,
        opacity: +parseFloat(cs.opacity).toFixed(3),
        visibility: cs.visibility,
        pointerEvents: cs.pointerEvents,
        hitIsSelf: !!hit && (hit === el || el.contains(hit)),
        hitClass: hit ? String(hit.className).slice(0, 44) : null,
        rect: { w: Math.round(r.width), h: Math.round(r.height), cx, cy },
      };
    };
    return {
      roll: probe(".ssp-roll-wrap"),
      pause: probe(".ssp-pause-fab"),
      hud: probe(".ssp-hud"),
      shop: probe(".ssp-shop"),
    };
  });

console.log(`\nshop open at boot: ${shopOpen}`);
const after = await readChrome();
for (const k of ["roll", "pause", "hud", "shop"]) {
  const r = after[k];
  if (!r.present) { console.log(`WHILE OPEN ${k}: absent from the DOM`); continue; }
  console.log(`WHILE OPEN ${k}: opacity=${r.opacity} visibility=${r.visibility} pointer-events=${r.pointerEvents} ` +
              `hitIsSelf=${r.hitIsSelf} (topmost at its centre = ${r.hitClass})`);
}

// A tap where ROLL! sits must NOT start a dice roll while the stall is up.
if (after.roll?.present) {
  const before2 = await page2.evaluate(() => (window.__SSP__.state?.() ?? {}).match?.phase ?? null);
  await page2.mouse.click(after.roll.rect.cx, after.roll.rect.cy);
  await page2.waitForTimeout(1000);
  const after2 = await page2.evaluate(() => ({
    phase: (window.__SSP__.state?.() ?? {}).match?.phase ?? null,
    die: window.__DIE_STATE ?? null,
    shopStillOpen: !!document.querySelector(".ssp-shop"),
  }));
  console.log(`tap where ROLL! is: phase ${before2} -> ${after2.phase}; die=${after2.die}; shop still open=${after2.shopStillOpen}`);
  console.log(after2.die === "hidden" || after2.die === null
    ? "  -> the tap did not roll the die (correct: the stall blocks the board)"
    : "  -> a roll started through the shop (still broken)");
}

await page2.screenshot({ path: "tools/critic/frames/economy/SHOP/shop-modal-lock.png" });

/* ---------- 3. chrome returns once the stall closes ---------- */
await page2.keyboard.press("Escape");
let shopGone = false;
for (let i = 0; i < 20; i++) {
  shopGone = await page2.evaluate(() => !document.querySelector(".ssp-shop"));
  if (shopGone) break;
  await page2.waitForTimeout(250);
}
await page2.waitForTimeout(500);
const back = await readChrome();
console.log(`\nshop closed: ${shopGone}`);
console.log(`AFTER close -> roll: ${JSON.stringify(back.roll).slice(0, 150)}`);
console.log(`AFTER close -> pause: ${JSON.stringify(back.pause).slice(0, 130)}`);

console.log("\nconsole errors (page 1):", errs.length ? JSON.stringify(errs.slice(0, 3)) : "none");
console.log("console errors (page 2):", errs2.length ? JSON.stringify(errs2.slice(0, 3)) : "none");
await b.close();
