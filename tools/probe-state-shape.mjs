/**
 * probe-state-shape.mjs — settle the last two field names and confirm the ending.
 *
 * An earlier smoke run reported "token moved: false" and "no minigames captured"
 * purely because it guessed field names (pos / minigameHistory) that do not exist
 * in MatchState. This dumps one real player object and the real turn flow shape,
 * then plays the ending (?quickend=1) to confirm the finale is reachable and plays.
 *
 * Foreground: node tools/probe-state-shape.mjs
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/smoke";
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 140)));

await page.goto("http://localhost:5177/?seed=7&audio=0", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 25; i++) {
  const s = await page.evaluate(() => window.__SSP__?.state?.().screen);
  if (s) break;
  await page.waitForTimeout(300);
}
await page.evaluate(() => window.__SSP__?.startMatch?.(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]));
await page.waitForTimeout(1500);

const shape = await page.evaluate(() => {
  const m = window.__SSP__?.state?.().match ?? {};
  const p = (m.players ?? [])[0] ?? null;
  return {
    matchKeys: Object.keys(m),
    playerKeys: p ? Object.keys(p) : [],
    player0: p,
    phase: m.phase,
  };
});
console.log("MatchState keys:", shape.matchKeys.join(", "));
console.log("player keys:   ", shape.playerKeys.join(", "));
console.log("player 0:      ", JSON.stringify(shape.player0));
console.log("phase:         ", shape.phase);

// Watch the token's `space` advance during a REAL autoplayed turn.
// The first attempt at this enabled autoplay ~1.5s after startMatch, before the board
// screen had entered and installed its autoplay hook, so nothing ticked and it read
// "moved: false". Wait for the board to be live first.
for (let i = 0; i < 30; i++) {
  const live = await page.evaluate(() => window.__SSP__?.state?.().screen === "board");
  if (live) break;
  await page.evaluate(() => window.__SSP__?.goto?.("board"));
  await page.waitForTimeout(500);
}
await page.waitForTimeout(2500);
const read = () => page.evaluate(() => {
  const m = window.__SSP__?.state?.().match ?? {};
  return { spaces: (m.players ?? []).map((p) => p.space), turn: m.turn, phase: m.phase, coins: (m.players ?? []).map((p) => p.coins) };
});
const before = await read();
console.log("\nbefore autoplay:", JSON.stringify(before));
await page.evaluate(() => window.__SSP__?.autoplay?.(true));
let after = before, tries = 0;
while (tries++ < 90) {
  await page.waitForTimeout(500);
  const cur = await read();
  if (JSON.stringify(cur.spaces) !== JSON.stringify(before.spaces)) { after = cur; break; }
}
console.log("after  autoplay:", JSON.stringify(after));
console.log(`token movement: spaces ${JSON.stringify(before.spaces)} -> ${JSON.stringify(after.spaces)} | moved: ${JSON.stringify(before.spaces) !== JSON.stringify(after.spaces)} | turn ${before.turn} -> ${after.turn} | phase ${before.phase} -> ${after.phase}`);
console.log(`coins: ${JSON.stringify(before.coins)} -> ${JSON.stringify(after.coins)}`);
await page.evaluate(() => window.__SSP__?.autoplay?.(false));

// the ending
console.log("\nending: booting ?quickend=1");
const p2 = await b.newPage({ viewport: { width: 390, height: 844 } });
p2.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });
await p2.goto("http://localhost:5177/?quickend=1&audio=0&seed=7", { waitUntil: "domcontentloaded" });
let onFinale = false;
for (let i = 0; i < 40; i++) {
  onFinale = await p2.evaluate(() => window.__SSP__?.state?.().screen === "finale");
  if (onFinale) break;
  await p2.waitForTimeout(400);
}
const finalText = await p2.evaluate(() =>
  Array.from(document.querySelectorAll("div,button"))
    .filter((d) => { const cs = getComputedStyle(d); return cs.position === "fixed" && parseFloat(cs.opacity) > 0.5 && (d.textContent || "").trim(); })
    .map((d) => (d.textContent || "").trim().slice(0, 30))
    .filter((t) => /WINS|STAR|PLAY AGAIN|TITLE|STANDINGS/i.test(t))
    .slice(0, 6)
);
console.log("finale reached:", onFinale);
console.log("finale text:", JSON.stringify(finalText));
await p2.screenshot({ path: `${OUT}/06-finale-confirmed.png`, fullPage: false });

console.log(`\nconsole errors: ${errors.length ? JSON.stringify(errors.slice(0, 4)) : "none"}`);
await b.close();
