// Orchestrator probe: when the STAR banner is in the DOM, where is it ON SCREEN?
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/economy/orch";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });

await page.goto("http://localhost:5177/?seed=5&autoplay=1&audio=0&speed=2", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate(() => { window.__SSP__.seed(5); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]); });
await page.waitForTimeout(900);
await page.evaluate(() => window.__SSP__.goto("board"));

const dump = () => page.evaluate(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const all = Array.from(document.querySelectorAll(".ssp-fb-banner, .ssp-fb-toast, .ssp-hud-banner, [class*='float'], .ssp-feedback-root"));
  return {
    viewport: { vw, vh },
    els: all.map((e) => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      return {
        cls: e.className.toString().slice(0, 46),
        text: (e.innerText || "").trim().slice(0, 24),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        opacity: st.opacity, z: st.zIndex, vis: st.visibility,
        onScreen: r.x + r.width > 0 && r.x < vw && r.y + r.height > 0 && r.y < vh,
      };
    }),
  };
});

let hit = false;
const t0 = Date.now();
while (Date.now() - t0 < 150000 && !hit) {
  await page.waitForTimeout(200);
  const has = await page.evaluate(() => Array.from(document.querySelectorAll(".ssp-fb-banner")).some((e) => /STAR/i.test(e.innerText || "")));
  if (has) {
    hit = true;
    const d = await dump();
    console.log("AT_DETECTION:", JSON.stringify(d));
    await page.screenshot({ path: `${OUT}/star-t0.png` });
    await page.waitForTimeout(700);
    console.log("T700:", JSON.stringify(await dump()));
    await page.screenshot({ path: `${OUT}/star-t700.png` });
    await page.waitForTimeout(700);
    console.log("T1400:", JSON.stringify(await dump()));
    await page.screenshot({ path: `${OUT}/star-t1400.png` });
  }
}
console.log("HIT:", hit, "ELAPSED_S:", Math.round((Date.now() - t0) / 1000));
console.log("ERRORS:", errors.length ? errors.slice(0, 4) : "none");
await browser.close();
