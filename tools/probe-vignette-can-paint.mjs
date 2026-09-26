/**
 * probe-vignette-can-paint.mjs — does the board's .ssp-vignette actually paint
 * ABOVE the WebGL canvas?
 *
 * A blind critic reported the ceremony vignette as "engine-level detected
 * (opacity 0.742) but never rendered". Rather than infer from stills, force the
 * vignette to an unmistakable state and look at pixels:
 *
 *   A. as-is            -> baseline frame
 *   B. forced SOLID RED -> if the frame does not go red, the element is UNDER the canvas
 *   C. display:none     -> control, proves B's change was the vignette's doing
 *
 * Also dumps every fixed full-screen overlay with its z-index and the canvas's own
 * position/z-index, so the stacking order is readable rather than guessed.
 *
 * Foreground: node tools/probe-vignette-can-paint.mjs
 */
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import fs from "node:fs";

const OUT = "tools/critic/frames/board/VIGNETTE-STACK";
fs.mkdirSync(OUT, { recursive: true });

function stats(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: W, height: H, data } = png;
  const px = 0;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  return { r: +(r / n).toFixed(1), g: +(g / n).toFixed(1), b: +(b / n).toFixed(1), px };
}

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5177/?seed=7&audio=0&autoplay=0", { waitUntil: "domcontentloaded" });
let live = false;
for (let i = 0; i < 30; i++) {
  live = await page.evaluate(() => (window.__SSP__?.state?.() ?? {}).screen === "board");
  if (live) break;
  await page.evaluate(() => window.__SSP__?.goto?.("board"));
  await page.waitForTimeout(400);
}
console.log("board live:", live);
await page.waitForTimeout(1200);

const stack = await page.evaluate(() => {
  const out = { canvas: null, overlays: [] };
  for (const c of Array.from(document.querySelectorAll("canvas"))) {
    const cs = getComputedStyle(c);
    const r = c.getBoundingClientRect();
    out.canvas = {
      w: c.width, h: c.height,
      cssW: Math.round(r.width), cssH: Math.round(r.height),
      position: cs.position, zIndex: cs.zIndex, opacity: cs.opacity, display: cs.display,
    };
  }
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "absolute") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 300 || r.height < 500) continue;             // full-screen overlays only
    out.overlays.push({
      cls: String(el.className).slice(0, 44),
      z: cs.zIndex, pos: cs.position,
      opacity: +parseFloat(cs.opacity).toFixed(3),
      display: cs.display,
      bg: (cs.backgroundImage !== "none" ? "image" : cs.backgroundColor).slice(0, 46),
    });
  }
  return out;
});
console.log("CANVAS:", JSON.stringify(stack.canvas));
console.log("full-screen overlays (paint order = lower z first):");
for (const o of stack.overlays) console.log("  ", JSON.stringify(o));

const shot = async (name) => { const p = `${OUT}/${name}.png`; await page.screenshot({ path: p }); return p; };

const a = await shot("a-as-is");
const bShot = await page.evaluate(() => {
  const v = document.querySelector(".ssp-vignette");
  if (!v) return false;
  v.style.setProperty("background", "rgb(255,0,0)", "important");
  v.style.setProperty("background-image", "none", "important");
  v.style.setProperty("opacity", "1", "important");
  return true;
});
const shotB = await shot("b-forced-red");
const cShot = await page.evaluate(() => {
  const v = document.querySelector(".ssp-vignette");
  v.style.setProperty("display", "none", "important");
  return true;
});
const shotC = await shot("c-hidden");

const A = stats(a), B = stats(shotB), C = stats(shotC);
console.log(`\nvignette element found and forced: ${bShot}`);
console.log(`A as-is       avg rgb=(${A.r},${A.g},${A.b})`);
console.log(`B forced red  avg rgb=(${B.r},${B.g},${B.b})  -> red rose by ${(B.r - A.r).toFixed(1)}`);
console.log(`C hidden      avg rgb=(${C.r},${C.g},${C.b})  -> vs B: red fell by ${(B.r - C.r).toFixed(1)}`);
const paints = (B.r - C.r) > 12 || (B.r - A.r) > 12;
console.log(paints
  ? "\nVERDICT: the vignette DOES paint above the canvas (forcing it red visibly changes the frame)."
  : "\nVERDICT: the vignette does NOT paint above the canvas - it is rendering underneath (z-order bug).");

await b.close();
