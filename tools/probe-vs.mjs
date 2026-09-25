// Orchestrator probe: verify the VS splash renders (name + VS + competitors) before the countdown.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/w4-vs/orch";
fs.mkdirSync(OUT, { recursive: true });
const ids = (process.argv[2] ?? "drum_solo,coin_grab").split(",");

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)); });

for (const id of ids) {
  await page.goto(`http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=2&minigame=${id}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate(() => { window.__SSP__.seed(7); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]); });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  // catch the splash in the first ~2.5s
  const seen = [];
  for (let i = 0; i < 26; i++) {
    await page.waitForTimeout(90);
    const s = await page.evaluate(() => {
      const root = document.querySelector(".ssp-vs-root");
      const title = document.querySelector(".ssp-vs-title, .ssp-vs-name");
      const vs = document.querySelector(".ssp-vs-vs");
      const players = Array.from(document.querySelectorAll(".ssp-vs-player")).map((e) => (e.innerText || "").trim().slice(0, 18));
      const count = document.querySelector(".ssp-mg-count");
      return {
        root: !!root,
        title: title ? (title.innerText || "").trim().slice(0, 40) : null,
        vs: vs ? (vs.innerText || "").trim().slice(0, 8) : null,
        players,
        countText: count ? (count.innerText || "").trim().slice(0, 8) : null,
      };
    });
    seen.push(s);
    if (s.root && i === 6) await page.screenshot({ path: `${OUT}/${id}-splash.png` });
    const st = await page.evaluate(() => window.__SSP__?.state?.()?.screen);
    if (st === "minigame" && s.countText && !s.root && i > 10) break;
  }
  const withRoot = seen.filter((s) => s.root).length;
  const first = seen.find((s) => s.root);
  console.log(`ID ${id}: splashFrames=${withRoot}/${seen.length} title=${JSON.stringify(first?.title)} vs=${JSON.stringify(first?.vs)} players=${JSON.stringify(first?.players)}`);
}

console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 5) : "none");
await browser.close();
