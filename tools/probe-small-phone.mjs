/**
 * probe-small-phone.mjs — every menu fits a small phone's real visible area.
 *
 * For each browser × size it walks the real UI by touch (iPhone UA, isMobile, hasTouch):
 *   title  → Settings (and every visible button) reachable; SETTINGS fully on screen
 *   hero   → Pick a Hero: START fully on screen without scrolling, tappable (not covered);
 *            other buttons either on screen or inside a scroller that is itself on screen;
 *            hero model inside its slot (dev builds only, via __SSP__.selectBounds)
 *   board  → after START: board HUD buttons on screen (no regression)
 *   mgintro→ Minigames → Coin Cannon "Ready to play?": PLAY! fully on screen, tap starts it
 * A button fails when its rect leaves the viewport and no on-screen ancestor can scroll it.
 * Chromium also proves the Pick a Hero settings list really scrolls under a touch swipe.
 *
 *   SSP_URL=http://127.0.0.1:5261 SSP_SHOTS=/workspace/ssp-fit-shots/probe node tools/probe-small-phone.mjs
 *   env: SSP_BROWSERS=webkit,chromium  SSP_SIZES=375x635,...  SSP_SCREENS=title,hero,board,mgintro
 *        SSP_SHOT_PREFIX=after  SSP_DSF=2
 * Exits non-zero on any failure. Works on dev and production builds.
 */
import { chromium, webkit } from "@playwright/test";
import fs from "node:fs";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5261").replace(/\/$/, "");
const SHOTS = process.env.SSP_SHOTS ?? "/workspace/ssp-fit-shots/probe";
const PREFIX = process.env.SSP_SHOT_PREFIX ?? "fit";
const DSF = Number(process.env.SSP_DSF ?? 2);
const BROWSERS = (process.env.SSP_BROWSERS ?? "webkit,chromium").split(",").map((s) => s.trim()).filter(Boolean);
const SIZES = (process.env.SSP_SIZES ?? "375x812,375x635,375x667,320x568,844x390,667x375,390x844,430x932")
  .split(",").map((s) => s.trim().split("x").map(Number));
const SCREENS = new Set((process.env.SSP_SCREENS ?? "title,hero,board,mgintro").split(",").map((s) => s.trim()));
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1";
const LOAD = 60000;
fs.mkdirSync(SHOTS, { recursive: true });
const t0 = Date.now();
const rows = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

function check(name, ok, detail = "") {
  rows.push({ name, ok: !!ok, detail: String(detail).slice(0, 200) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + String(detail).slice(0, 300) : ""}`);
}

/** Runs in the page: visible buttons that leave the viewport with no on-screen scroller, plus primary-button status. */
function measure(primarySel) {
  const vw = innerWidth, vh = innerHeight;
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.visibility === "hidden" || s.display === "none" || +s.opacity < 0.05) return false;
    }
    return true;
  };
  const onScreen = (r) => r.top >= -1 && r.left >= -1 && r.bottom <= vh + 1 && r.right <= vw + 1;
  const scroller = (e) => {
    for (let n = e.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      const y = /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1;
      const x = /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1;
      if ((y || x) && onScreen(n.getBoundingClientRect())) return n;
    }
    const d = document.scrollingElement;
    if (d && d.scrollHeight > vh + 1 && getComputedStyle(document.body).overflowY !== "hidden") return d;
    return null;
  };
  const label = (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const bad = [];
  let scrolled = 0;
  for (const e of document.querySelectorAll('button,[role=button]')) {
    if (!shown(e)) continue;
    const r = e.getBoundingClientRect();
    const off = Math.round(Math.max(-r.left, -r.top, r.right - vw, r.bottom - vh));
    if (off <= 1) continue;
    const sc = scroller(e);
    if (sc) { scrolled++; continue; }
    bad.push({ label: label(e), y: Math.round(r.top), h: Math.round(r.height), off });
  }
  let primary = null;
  const p = primarySel ? [...document.querySelectorAll(primarySel)].find(shown) : null;
  if (p) {
    const r = p.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    primary = {
      label: label(p),
      rect: [r.left, r.top, r.width, r.height].map(Math.round),
      fully: r.top >= -0.5 && r.left >= -0.5 && r.bottom <= vh + 0.5 && r.right <= vw + 0.5,
      hit: !!hit && (hit === p || p.contains(hit)),
    };
  }
  return { vw, vh, bad, scrolled, primary };
}

async function visibleLabels(page) {
  return page.evaluate(() => [...document.querySelectorAll("button,[role=button]")].filter((e) => {
    const r = e.getBoundingClientRect();
    if (!r.width) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.visibility === "hidden" || s.display === "none" || +s.opacity < 0.05) return false;
    }
    return true;
  }).map((e) => (e.getAttribute("aria-label") || e.textContent).trim()));
}

async function run(bName, W, H) {
  const engine = bName === "webkit" ? webkit : chromium;
  const browser = await engine.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true, userAgent: UA,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const tag = `${bName} ${W}x${H}`;
  const shot = (screen) => page.screenshot({ path: `${SHOTS}/${PREFIX}-${bName}-${screen}-${W}x${H}.png` });
  const btn = (re) => page.getByRole("button", { name: re }).first();
  const fits = async (screen, primarySel, primaryName) => {
    const m = await page.evaluate(measure, primarySel);
    check(`${tag} ${screen}: no unreachable buttons`, m.bad.length === 0, m.bad.length ? J(m.bad) : `${m.scrolled} in scrollers`);
    if (primarySel) {
      check(`${tag} ${screen}: ${primaryName} fully on screen`, m.primary?.fully, J(m.primary));
      check(`${tag} ${screen}: ${primaryName} not covered`, m.primary?.hit, J(m.primary));
    }
    return m;
  };
  const load = async () => {
    await page.goto(`${BASE}/?audio=0`, { waitUntil: "load", timeout: LOAD });
    await btn(/Play — start/).waitFor({ timeout: LOAD });
    await sleep(2000);
  };
  try {
    await load();
    if (SCREENS.has("title")) {
      await shot("title");
      await fits("title", 'button[aria-label="Settings"]', "SETTINGS");
    }
    if (SCREENS.has("hero") || SCREENS.has("board")) {
      await btn(/Play — start/).tap({ timeout: 10000 });
      await page.getByRole("button", { name: /Start the match/ }).waitFor({ timeout: 20000 });
      await sleep(2000);
      await shot("hero");
      await fits("hero", 'button[aria-label="Start the match"]', "START");
      const sb = await page.evaluate(() => window.__SSP__?.selectBounds?.() ?? null);
      if (sb?.hero?.box && sb.slot) {
        const b = sb.hero.box, s = sb.slot;
        check(`${tag} hero: model inside slot + viewport`,
          b.x >= s.x - 2 && b.y >= s.y - 2 && b.x + b.w <= s.x + s.w + 2 && b.y + b.h <= s.y + s.h + 2 &&
          b.x >= -2 && b.y >= -2 && b.x + b.w <= W + 2 && b.y + b.h <= H + 2, `${J(b)} slot ${J(s)}`);
      }
      const body = await page.evaluate(() => {
        const e = document.querySelector(".ssp-sel-body");
        return e ? { sh: e.scrollHeight, ch: e.clientHeight } : null;
      });
      if (bName === "chromium" && body && body.sh > body.ch + 1) {
        // A real touch swipe on the settings list must scroll it (touch-action / pointer-events).
        const cdp = await ctx.newCDPSession(page);
        const r = await page.evaluate(() => { const b = document.querySelector(".ssp-sel-body").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.75, h: b.height }; });
        // Raw touch events (synthesizeScrollGesture's touch source does nothing headless).
        const dy = Math.round(r.h * 0.5);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
        for (let i = 1; i <= 10; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: r.x, y: r.y - (dy * i) / 10 }] });
          await sleep(16);
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await sleep(600);
        const st = await page.evaluate(() => document.querySelector(".ssp-sel-body").scrollTop);
        check(`${tag} hero: settings list scrolls by touch`, st > 10, `scrollTop ${st} (sh ${body.sh} / ch ${body.ch})`);
        await fits("hero (scrolled)", 'button[aria-label="Start the match"]', "START");
        await page.evaluate(() => { document.querySelector(".ssp-sel-body").scrollTop = 0; });
      }
      if (SCREENS.has("board")) {
        await page.getByRole("button", { name: /Start the match/ }).tap({ timeout: 10000 });
        let onBoard = false;
        for (let i = 0; i < 45; i++) { // ~90s: CPUs may all move before the human (turn order is random)
          await sleep(2000);
          const v = await visibleLabels(page);
          if (v.includes("NO THANKS")) { await btn(/^NO THANKS$/).tap().catch(() => {}); continue; }
          if (v.includes("HIT!")) { await btn(/^HIT!$/).tap().catch(() => {}); continue; }
          // On the board: the map button, or the ROLL pad when the human moves first (a tip can cover the map button).
          if (v.some((l) => /Look at the map|^ROLL/.test(l))) { onBoard = true; break; }
        }
        check(`${tag} board: reached HUD after START`, onBoard);
        await sleep(1200);
        await shot("board");
        await fits("board", null, null);
      }
    }
    if (SCREENS.has("mgintro")) {
      await load();
      await btn(/Minigames — just/).tap({ timeout: 10000 });
      await sleep(2000);
      await btn(/Next: pick a minigame/).tap({ timeout: 10000 });
      await sleep(2000);
      await btn(/Play Coin Cannon/).tap({ timeout: 10000 });
      await page.locator(".ssp-mgr__play").waitFor({ timeout: 20000 });
      await sleep(2500);
      await shot("mgintro");
      await fits("mgintro", ".ssp-mgr__play", "PLAY!");
      await page.locator(".ssp-mgr__play").tap({ timeout: 10000 });
      const started = await page.waitForFunction(() => !document.querySelector(".ssp-mgr"), null, { timeout: 20000 }).then(() => true, () => false);
      check(`${tag} mgintro: PLAY! tap starts the minigame`, started);
      await sleep(3000);
      await shot("minigame");
    }
  } catch (e) {
    check(`${tag} flow`, false, e.message.split("\n")[0]);
    await page.screenshot({ path: `${SHOTS}/${PREFIX}-${bName}-error-${W}x${H}.png` }).catch(() => {});
  }
  check(`${tag} no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  await browser.close();
}

for (const b of BROWSERS) for (const [W, H] of SIZES) await run(b, W, H);

const failed = rows.filter((r) => !r.ok);
console.log("\n| result | check |\n|---|---|");
for (const r of rows) console.log(`| ${r.ok ? "PASS" : "FAIL"} | ${r.name} |`);
console.log(`\n${rows.length - failed.length}/${rows.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed.length ? 1 : 0);
