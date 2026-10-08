// Orchestrator probe: reach a star purchase autonomously and verify the 3.0s ceremony.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/economy/orch";
fs.mkdirSync(OUT, { recursive: true });
const seeds = (process.argv[2] ?? "5,13,17").split(",");

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });

async function trySeed(seed) {
  await page.goto(`http://localhost:5177/?seed=${seed}&autoplay=1&audio=0&speed=2`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate((s) => { window.__SSP__.seed(Number(s)); window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]); }, seed);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__SSP__.goto("board"));

  let starSeen = null;
  const t0 = Date.now();
  let lastStars = 0;
  while (Date.now() - t0 < 150000) {
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => {
      const st = window.__SSP__?.state?.() ?? {};
      const players = (st.match?.players ?? []).map((p) => ({ stars: p.stars, coins: p.coins }));
      const banners = Array.from(document.querySelectorAll(".ssp-fb-banner")).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && getComputedStyle(e).opacity !== "0";
      }).map((e) => (e.innerText || "").trim().slice(0, 40));
      const floats = Array.from(document.querySelectorAll("[class*='float']")).map((e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), t: (e.innerText || "").trim().slice(0, 8) };
      });
      return { screen: st.screen, players, banners, floats };
    });
    const totalStars = s.players.reduce((a, p) => a + (p.stars ?? 0), 0);
    if (totalStars > lastStars) {
      starSeen = { at: Math.round((Date.now() - t0) / 1000), seed, state: s };
      await page.screenshot({ path: `${OUT}/star-seed${seed}.png` });
      break;
    }
    lastStars = totalStars;
    if (s.banners.some((b) => /STAR/i.test(b))) {
      starSeen = { at: Math.round((Date.now() - t0) / 1000), seed, bannerMoment: s, state: s };
      await page.screenshot({ path: `${OUT}/star-banner-seed${seed}.png` });
    }
    if (s.screen !== "board" && s.screen !== "minigame") break;
  }
  return starSeen;
}

let found = null;
for (const seed of seeds) {
  found = await trySeed(seed);
  console.log(`SEED ${seed}:`, found ? JSON.stringify(found).slice(0, 500) : "no star purchase within 150s");
  if (found) break;
}
console.log("ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (!found || errors.length) process.exitCode = 1;
await browser.close();
