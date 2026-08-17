// Temp determinism probe at speed 1 (orchestrator verification) — run: node tools/det-verify-slow.mjs <tag>
import { chromium } from "@playwright/test";
import fs from "node:fs";

const tag = process.argv[2] ?? "A";
const out = `${process.env.LOCALAPPDATA}/Temp/det-slow-${tag}.txt`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
await page.goto("http://localhost:5177/?autoplay=1&audio=0", { waitUntil: "networkidle" }); // speed 1
await page.waitForTimeout(2500);
await page.evaluate(() => {
  window.__SSP__.seed(7);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"]);
});
const lines = [];
const t0 = Date.now();
while (Date.now() - t0 < 420000) {
  const s = await page.evaluate(() => {
    const m = window.__SSP__.state().match;
    return {
      phase: m.phase, turn: m.turn, cur: m.currentPlayer, dice: JSON.stringify(m.lastDice),
      players: m.players.map((p) => `${p.name}:${p.coins}:${p.stars}:${p.space}`).join("|"),
    };
  });
  lines.push(JSON.stringify(s));
  if (s.phase === "ended") break;
  await page.waitForTimeout(150);
}
fs.writeFileSync(out, lines.join("\n") + "\n" + "ERRORS:" + (errors.length ? errors.join(";") : "none"));
console.log(tag, "lines:", lines.length, "last:", lines[lines.length - 1]?.slice(0, 150));
await browser.close();
