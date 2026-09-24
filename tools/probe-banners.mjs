// Orchestrator probe: measure max simultaneous banners/toasts on the board (feedback-layer check).
import { chromium } from "@playwright/test";

const speed = process.argv[2] ?? "4";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });

await page.goto(`http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=${speed}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate(() => { window.__SSP__.seed(7); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]); });
await page.waitForTimeout(1000);
await page.evaluate(() => window.__SSP__.goto("board"));

let maxB = 0, maxT = 0, maxFloat = 0, samples = 0;
const t0 = Date.now();
while (Date.now() - t0 < 100000) {
  await page.waitForTimeout(120);
  const c = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.opacity !== "0" && st.display !== "none" && st.visibility !== "hidden";
    };
    const banners = Array.from(document.querySelectorAll(".ssp-fb-banner, .ssp-hud-banner")).filter(vis);
    const toasts = Array.from(document.querySelectorAll(".ssp-fb-toast")).filter(vis);
    const floats = Array.from(document.querySelectorAll(".ssp-float, .ssp-floating-number, [class*='float']")).filter(vis);
    const die = document.querySelector(".ssp-die, .ssp-roll-die");
    return {
      b: banners.length, t: toasts.length, f: floats.length,
      dieZ: die ? getComputedStyle(die).zIndex : null,
      stack: banners.slice(0, 3).map((e) => (e.innerText || "").slice(0, 24)),
    };
  });
  samples++;
  maxB = Math.max(maxB, c.b); maxT = Math.max(maxT, c.t); maxFloat = Math.max(maxFloat, c.f);
  if (c.b > 2 || c.t > 2) console.log("SPIKE:", JSON.stringify(c));
}
console.log(JSON.stringify({ maxBanners: maxB, maxToasts: maxT, maxFloating: maxFloat, samples, dieZLast: null }));
console.log("ERRORS:", errors.length ? errors.slice(0, 4) : "none");
await browser.close();
