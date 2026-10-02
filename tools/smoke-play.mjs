/**
 * smoke-play.mjs — "does the game work?" answered by playing it.
 *
 * Drives the real UI the way a player does: title -> PLAY -> character select ->
 * START! -> ROLL! -> then lets a full match autoplay to the finale. Reports what
 * actually happened (screens reached, phases, minigames, errors) rather than
 * trusting any prior claim.
 *
 * Foreground: node tools/smoke-play.mjs
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/smoke";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
let page;

// The debug API nests everything under state().match (MatchState) - reading
// `s.players` at the top level returns undefined and made an earlier run of this
// probe claim "token moved: false" when the token had in fact moved.
const state = () =>
  page.evaluate(() => {
    const s = window.__SSP__?.state?.() ?? {};
    const m = s.match ?? {};
    const ps = m.players ?? [];
    return {
      screen: s.screen,
      phase: m.phase,
      round: m.round ?? m.turn ?? m.turnIndex,
      die: (window.__DIE_STATE ?? "n/a"),
      coins: ps.map((p) => p.coins),
      stars: ps.map((p) => p.stars),
      positions: ps.map((p) => p.pos),
      current: m.current ?? m.turnOwner ?? null,
      history: (m.minigameHistory ?? m.history ?? []).length,
    };
  });

async function clickText(re, label) {
  const clicked = await page.evaluate(
    ([src, flags]) => {
      const rx = new RegExp(src, flags);
      const cands = Array.from(document.querySelectorAll("button, [role=button], .ssp-btn"));
      const hit = cands.find((b) => rx.test((b.textContent || "").trim()) &&
        b.offsetParent !== null && getComputedStyle(b).pointerEvents !== "none" &&
        parseFloat(getComputedStyle(b).opacity) > 0.5);
      if (hit) { hit.click(); return (hit.textContent || "").trim().slice(0, 24); }
      return null;
    },
    [re.source, re.flags]
  );
  console.log(clicked ? `  clicked "${clicked}" (${label})` : `  !! no clickable match for ${label}`);
  return clicked;
}

const b = await chromium.launch();
page = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 160)));

console.log("1. boot");
await page.goto("http://localhost:5177/?audio=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
let st = await state();
console.log("   screen:", st.screen, "| canvas:", await page.evaluate(() => {
  const c = document.querySelector("canvas");
  return c ? `${c.width}x${c.height}` : "none";
}));
await page.screenshot({ path: `${OUT}/01-title.png` });

console.log("2. PLAY ->");
await clickText(/play/i, "PLAY");
await page.waitForTimeout(1800);
st = await state();
console.log("   screen:", st.screen);
await page.screenshot({ path: `${OUT}/02-selected.png` });

console.log("3. START! ->");
await clickText(/start/i, "START");
await page.waitForTimeout(2200);
st = await state();
console.log("   screen:", st.screen, "| phase:", st.phase, "| coins:", JSON.stringify(st.coins));
await page.screenshot({ path: `${OUT}/03-board.png` });

console.log("4. ROLL! -> (human click)");
const before = st.positions;
await clickText(/roll/i, "ROLL");
let sawDie = "hidden", moved = false;
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(() => window.__DIE_STATE ?? "n/a");
  if (s !== "hidden" && s !== "n/a") sawDie = s;
  const now = await state();
  if (JSON.stringify(now.positions) !== JSON.stringify(before)) { moved = true; break; }
  await page.waitForTimeout(250);
}
st = await state();
console.log(`   die state seen: ${sawDie} | token moved: ${moved}`);
console.log(`   positions: ${JSON.stringify(before)} -> ${JSON.stringify(st.positions)}`);
await page.screenshot({ path: `${OUT}/04-rolled.png` });

console.log("5. autoplay a full match (speed 3)");
await page.evaluate(() => window.__SSP__?.autoplay?.(true));
const seenScreens = new Set();
const seenMinigames = new Set();
const seenPhases = new Set();
const minigames = new Set();
const t0 = Date.now();
let reachedFinale = false;
while (Date.now() - t0 < 240000) {
  const s = await page.evaluate(() => {
    const st = window.__SSP__?.state?.() ?? {};
    const m = st.match ?? {};
    const flow = m.minigameHistory ?? m.history ?? [];
    const last = flow.length ? flow[flow.length - 1] : null;
    return {
      screen: st.screen,
      phase: m.phase,
      round: m.round ?? m.turn,
      mg: (last && (last.id ?? last.minigame ?? last.game)) ?? null,
      coins: (m.players ?? []).map((p) => p.coins),
      stars: (m.players ?? []).map((p) => p.stars),
    };
  });
  if (s.screen) seenScreens.add(s.screen);
  if (s.phase) seenPhases.add(s.phase);
  if (s.mg) minigames.add(s.mg);
  if (s.screen === "finale") { reachedFinale = true; break; }
  await page.waitForTimeout(1000);
}
st = await state();
const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`   ran ${mins} min of match time`);
console.log(`   screens visited: ${[...seenScreens].join(", ")}`);
console.log(`   phases seen: ${[...seenPhases].join(", ")}`);
console.log(`   minigames played: ${[...minigames].join(", ") || "(none captured)"}`);
console.log(`   reached finale: ${reachedFinale}`);
console.log(`   coins now: ${JSON.stringify(st.coins)} | stars now: ${JSON.stringify(st.stars)} | round: ${st.round} | phase: ${st.phase}`);
await page.screenshot({ path: `${OUT}/05-finale.png` });

fs.writeFileSync(`${OUT}/console-errors.txt`, errors.join("\n") || "(none)");
console.log(`\nconsole errors: ${errors.length ? errors.length + " -> " + JSON.stringify(errors.slice(0, 4)) : "none"}`);
console.log(errors.length === 0 && moved && reachedFinale
  ? "\nVERDICT: the game plays end to end - title -> select -> a human ROLL that moves the token -> a full match -> finale, with zero console errors."
  : "\nVERDICT: something in the flow needs attention (see above).");
await b.close();
