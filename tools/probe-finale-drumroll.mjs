/**
 * probe-finale-drumroll.mjs — does the bonus reveal actually have a run-up?
 *
 * The finale's own header claimed a drumroll. A blind critic measured the truth:
 * the award simply appeared. This samples the banner text every 80ms through the
 * finale (?quickend=1) and proves the run-up exists as a SEQUENCE OF VISIBLE
 * STATES — several distinct "NAME...?" flips before each award — rather than
 * asserting it from the source.
 *
 * Foreground: node tools/probe-finale-drumroll.mjs
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/w4-finale/DRUMROLL";
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto("http://localhost:5177/?quickend=1&audio=0&seed=7", { waitUntil: "domcontentloaded" });

let onFinale = false;
for (let i = 0; i < 40; i++) {
  onFinale = await page.evaluate(() => (window.__SSP__?.state?.() ?? {}).screen === "finale");
  if (onFinale) break;
  await page.waitForTimeout(400);
}
console.log("reached finale:", onFinale);

const samples = [];
const t0 = Date.now();
let shots = 0;
while (Date.now() - t0 < 16000) {
  const s = await page.evaluate(() => {
    const banner = document.querySelector(".ssp-finale-banner, #ssp-finale-banner");
    const anyBig = Array.from(document.querySelectorAll("div"))
      .filter((d) => {
        const cs = getComputedStyle(d);
        if (cs.position !== "fixed") return false;
        const r = d.getBoundingClientRect();
        return r.width > 60 && r.height > 24 && r.height < 200 && parseFloat(cs.opacity) > 0.5 &&
               (d.textContent || "").length < 60 && /[A-Za-z★]/.test(d.textContent || "");
      })
      .map((d) => (d.textContent || "").trim().slice(0, 44));
    const bigZ = Array.from(document.querySelectorAll("div"))
      .filter((d) => {
        const cs = getComputedStyle(d);
        return cs.position === "fixed" && parseInt(cs.zIndex || "0", 10) >= 90 &&
               (d.textContent || "").trim().length > 0 && (d.textContent || "").length < 60;
      })
      .map((d) => (d.textContent || "").trim().slice(0, 44));
    return { t: Math.round(performance.now()), texts: anyBig, zTexts: bigZ };
  });
  samples.push(s);
  await page.waitForTimeout(80);
}

// collapse to a timeline of text transitions
const timeline = [];
let prev = null;
for (const s of samples) {
  const key = [...new Set([...s.texts, ...(s.zTexts ?? [])])].join(" | ");
  if (key && key !== prev) { timeline.push({ t: s.t, text: key }); prev = key; }
}

console.log("\nbanner timeline (visible text changes):");
for (const e of timeline) console.log(`  t=${String(e.t).padStart(6)}ms  ${e.text}`);

const cycling = timeline.filter((e) => /\.\.\.\?/.test(e.text));
const awards = timeline.filter((e) => /WINS THE/.test(e.text));
const distinctCycle = new Set(cycling.map((e) => e.text));
console.log(`\nrun-up flips observed: ${cycling.length} (${distinctCycle.size} distinct candidate texts)`);
console.log(`award reveals observed: ${awards.length}`);
for (const a of awards) console.log(`   ${a.text}`);

const firstCycle = cycling[0]?.t ?? -1;
const firstAward = awards[0]?.t ?? -1;
console.log(`\nfirst drumroll flip at ${firstCycle}ms, first award at ${firstAward}ms -> run-up = ${firstAward - firstCycle}ms`);
console.log(cycling.length >= 4 && firstCycle > 0 && firstAward > firstCycle
  ? "VERDICT: the award is REVEALED after a visible drumroll run-up (not simply appearing)."
  : "VERDICT: no run-up detected — the award still just appears.");

await page.screenshot({ path: `${OUT}/finale-drumroll-window.png` });
console.log("console errors:", errs.length ? JSON.stringify(errs.slice(0, 3)) : "none");
await b.close();
