// Debug: check HUD DOM structure when board appears
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("console", (m) => console.log("PAGE:", m.text()));

await page.goto("http://localhost:5177/?seed=7&audio=0&speed=2&minigame=balloon_pop", {
  waitUntil: "domcontentloaded", timeout: 30000
});
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });

await page.evaluate(() => {
  window.__SSP__.seed(7);
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
});

// Enter minigame
let launched = false;
for (let i = 0; i < 25; i++) {
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  await page.waitForTimeout(220);
  const scr = await page.evaluate(() => window.__SSP__.state().screen);
  if (scr === "minigame") { launched = true; break; }
}

// Wait for board
let waited = 0;
while (waited < 60000) {
  await page.waitForTimeout(200);
  waited += 200;
  const scr = await page.evaluate(() => window.__SSP__.state().screen);
  if (scr !== "minigame") break;
}

// Check DOM immediately after board appears, then 500ms later
await page.waitForTimeout(50);
const dom1 = await page.evaluate(() => {
  const chips = document.querySelectorAll(".ssp-hud-chip");
  return Array.from(chips, (chip) => {
    const nameEl = chip.querySelector(".ssp-hud-chip__name");
    const coinEl = chip.querySelector('[aria-label="coins"]');
    return {
      name: nameEl?.textContent || "?",
      coin: coinEl?.textContent || "?",
      zIndex: window.getComputedStyle(coinEl || chip).zIndex,
    };
  });
});
console.log("DOM@50ms:", JSON.stringify(dom1));

await page.waitForTimeout(500);
const dom2 = await page.evaluate(() => {
  const chips = document.querySelectorAll(".ssp-hud-chip");
  return Array.from(chips, (chip) => {
    const nameEl = chip.querySelector(".ssp-hud-chip__name");
    const coinEl = chip.querySelector('[aria-label="coins"]');
    return {
      name: nameEl?.textContent || "?",
      coin: coinEl?.textContent || "?",
    };
  });
});
console.log("DOM@550ms:", JSON.stringify(dom2));

// Also check match state
const state = await page.evaluate(() => {
  const st = window.__SSP__.state();
  return {
    screen: st.screen,
    players: (st.match?.players ?? []).map((p) => ({ name: p.name, coins: p.coins ?? p.coin })),
  };
});
console.log("STATE:", JSON.stringify(state));

await browser.close();
