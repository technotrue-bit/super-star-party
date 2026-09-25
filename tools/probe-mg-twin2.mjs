// Real-time twin probe v2: capture post-payout state at the minigame->board transition.
// Usage: node tools/probe-mg-twin2.mjs balloon_pop
import { chromium } from "@playwright/test";

const game = process.argv[2] ?? "balloon_pop";
const url = `http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=2&minigame=${game}`;

async function runOnce(label) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });

  // Start the match ONCE, then retry only the goto (a startMatch inside the retry loop
  // can reset the match mid-minigame and produce hybrid, meaningless runs).
  await page.evaluate(() => {
    window.__SSP__.seed(7);
    window.__SSP__.autoplay(true);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"]);
  });

  let entered = false;
  for (let i = 0; i < 40; i++) {
    const scr = await page.evaluate(() => {
      try {
        window.__SSP__.goto("minigame");
        return window.__SSP__.state?.()?.screen ?? "?";
      } catch { return "ERR"; }
    });
    if (scr === "minigame") { entered = true; break; }
    await page.waitForTimeout(400);
  }
  if (!entered) { await browser.close(); return { label, error: "no minigame" }; }

  let prev = "minigame";
  let snapshot = null;
  for (let i = 0; i < 600; i++) {
    await page.waitForTimeout(150);
    const s = await page.evaluate(() => {
      const st = window.__SSP__?.state?.() ?? {};
      return {
        screen: st.screen ?? "?",
        players: (st.match?.players ?? []).map((p) => [p.coins ?? p.coin, p.stars ?? p.wins]),
      };
    });
    if (prev === "minigame" && s.screen === "board") {
      // The payout lands AFTER the screen change (results ceremony + award), so sampling
      // at the transition compares two pre-payout states and matches trivially. Settle first.
      await page.waitForTimeout(4500);
      snapshot = await page.evaluate(() =>
        (window.__SSP__?.state?.()?.match?.players ?? []).map((p) => [p.coins ?? p.coin, p.stars ?? p.wins])
      );
      break;
    }
    prev = s.screen;
  }
  await browser.close();
  return { label, snapshot, errors };
}

const a = await runOnce("A");
const b = await runOnce("B");
console.log("A:", JSON.stringify(a));
console.log("B:", JSON.stringify(b));
console.log("MATCH:", JSON.stringify(a.snapshot) === JSON.stringify(b.snapshot) && !!a.snapshot);
