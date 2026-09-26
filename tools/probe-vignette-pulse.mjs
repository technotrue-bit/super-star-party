/**
 * probe-vignette-pulse.mjs — how much does a REAL ceremony vignette pulse
 * actually contribute to the frame?
 *
 * probe-vignette-can-paint.mjs already proved the element paints above the canvas
 * (forcing it solid red moved the frame's average red 132.6 -> 159.0; hiding it
 * returned exactly 132.6). This measures the real thing: wait for a live pulse
 * (computed opacity > 0.25), capture the frame, hide ONLY the vignette, capture
 * again ~100ms later, and diff the edge band. Any difference is the vignette's
 * own contribution - not confetti, not the board art.
 *
 * Foreground: node tools/probe-vignette-pulse.mjs
 */
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import fs from "node:fs";

const OUT = "tools/critic/frames/board/VIGNETTE-PULSE";
fs.mkdirSync(OUT, { recursive: true });

function bands(file, px = 26) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: W, height: H, data } = png;
  const at = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  let er = 0, eg = 0, eb = 0, en = 0, cr = 0, cg = 0, cb = 0, cn = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b] = at(x, y);
      const edge = x < px || y < px || x >= W - px || y >= H - px;
      if (edge) { er += r; eg += g; eb += b; en++; }
      else { cr += r; cg += g; cb += b; cn++; }
    }
  return {
    edge: { r: er / en, g: eg / en, b: eb / en },
    centre: { r: cr / cn, g: cg / cn, b: cb / cn },
  };
}

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5177/?seed=7&audio=0&autoplay=1&speed=2", { waitUntil: "domcontentloaded" });
let live = false;
for (let i = 0; i < 30; i++) {
  live = await page.evaluate(() => (window.__SSP__?.state?.() ?? {}).screen === "board");
  if (live) break;
  await page.evaluate(() => window.__SSP__?.goto?.("board"));
  await page.waitForTimeout(400);
}
console.log("board live:", live);

const vigOpacity = () =>
  page.evaluate(() => {
    const v = document.querySelector(".ssp-vignette");
    if (!v) return -1;
    const cs = getComputedStyle(v);
    return { o: parseFloat(cs.opacity), bg: cs.backgroundImage.slice(0, 60) };
  });

let done = 0;
const t0 = Date.now();
while (Date.now() - t0 < 150000 && done < 3) {
  const v = await vigOpacity();
  if (v !== -1 && v.o > 0.25) {
    await page.screenshot({ path: `${OUT}/pulse-${done}-ON.png` });
    await page.evaluate(() => {
      const el = document.querySelector(".ssp-vignette");
      el.dataset.prevVis = el.style.visibility || "";
      el.style.setProperty("visibility", "hidden", "important");
    });
    await page.screenshot({ path: `${OUT}/pulse-${done}-OFF.png` });
    await page.evaluate(() => {
      const el = document.querySelector(".ssp-vignette");
      el.style.removeProperty("visibility");
    });
    const on = bands(`${OUT}/pulse-${done}-ON.png`);
    const off = bands(`${OUT}/pulse-${done}-OFF.png`);
    const dEdge = Math.hypot(on.edge.r - off.edge.r, on.edge.g - off.edge.g, on.edge.b - off.edge.b);
    const dCentre = Math.hypot(on.centre.r - off.centre.r, on.centre.g - off.centre.g, on.centre.b - off.centre.b);
    console.log(`pulse ${done}: opacity=${v.o.toFixed(3)}  edge shift=${dEdge.toFixed(1)} rgb  centre shift=${dCentre.toFixed(1)} rgb`);
    console.log(`   edge ON  rgb=(${on.edge.r.toFixed(1)},${on.edge.g.toFixed(1)},${on.edge.b.toFixed(1)})  OFF rgb=(${off.edge.r.toFixed(1)},${off.edge.g.toFixed(1)},${off.edge.b.toFixed(1)})`);
    console.log(`   bg=${v.bg}`);
    done++;
    await page.waitForTimeout(1500);
  } else {
    await page.waitForTimeout(120);
  }
}
console.log(`\npulses measured: ${done}`);
await b.close();
