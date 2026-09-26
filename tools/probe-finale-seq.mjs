// Orchestrator: capture the match finale beat by beat (quickend path) and log what is on screen.
// Samples DOM text + phase-ish signals while grabbing a frame every ~400ms across the sequence.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "tools/critic/frames/w4-finale/SEQ";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
await p.goto("http://localhost:5177/?quickend=1&seed=7&autoplay=1&audio=0&speed=1");
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });

// reach the finale (retrying goto: an early goto silently no-ops)
let there = false;
for (let i = 0; i < 40 && !there; i++) {
  const s = await p.evaluate(() => window.__SSP__.state().screen);
  if (s === "finale") { there = true; break; }
  await p.evaluate(() => window.__SSP__.goto("finale"));
  await p.waitForTimeout(250);
}
console.log("reached finale:", there);

let shot = 0;
const seen = [];
const t0 = Date.now();
for (let i = 0; i < 70; i++) {
  await p.waitForTimeout(400);
  const s = await p.evaluate(() => {
    const txt = document.body.innerText.replace(/\s+/g, " ").trim();
    const btns = Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim()).filter(Boolean);
    return { screen: window.__SSP__.state().screen, txt: txt.slice(0, 200), btns };
  });
  const key = s.txt.slice(0, 60);
  if (!seen.length || seen[seen.length - 1].key !== key) {
    seen.push({ key, at: Date.now() - t0, txt: s.txt, btns: s.btns });
    console.log(`+${(Date.now() - t0) / 1000}s [${s.screen}] ${s.txt.slice(0, 150)}${s.btns.length ? " | buttons: " + s.btns.join("/") : ""}`);
  }
  if (shot < 12 && i % 2 === 0) {
    shot++;
    await p.screenshot({ path: `${OUT}/f${String(shot).padStart(2, "0")}.png` });
  }
  if (seen.some((x) => x.btns.length) && seen[seen.length - 1].btns.length && i > 40) break;
}
console.log(`frames: ${shot} | distinct text states: ${seen.length}`);
console.log("ERRORS:", errs.length ? errs.slice(0, 3) : "none");
await b.close();
