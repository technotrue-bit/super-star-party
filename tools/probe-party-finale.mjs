// Plays a 1-turn all-CPU match to its natural end and records the party finale.
// Usage: node tools/probe-party-finale.mjs [port] [w] [h] [outDir] [mode]
//   mode: "natural" (default) plays the last turn; "quick" jumps via ?quickend=1.
//   action (7th arg): "again" | "menu" | "skip-again" clicks through the summary and
//   checks the finale left nothing behind.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const port = process.argv[2] ?? "5183";
const W = Number(process.argv[3] ?? 390);
const H = Number(process.argv[4] ?? 844);
const OUT = process.argv[5] ?? `tools/critic/frames/party-finale/${W}x${H}`;
const MODE = process.argv[6] ?? "natural";
const ACTION = process.argv[7] ?? "";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/status of 403/.test(m.text())) errs.push("CONSOLE: " + m.text()); });
const q = MODE === "quick" ? "quickend=1&" : "";
await p.goto(`http://localhost:${port}/?${q}seed=7&audio=0&speed=${MODE === "quick" ? 1 : 4}`);
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 30000 });
await p.waitForTimeout(1500);
if (MODE !== "quick") {
  await p.evaluate(async () => {
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"], ["cpu", "cpu", "cpu", "cpu"]);
    window.__SSP__.setTurns(1);
    window.__SSP__.autoplay(true);
  });
}
const t0 = Date.now();
const seen = [];
let shot = 0;
let lastShot = 0;
let finaleAt = 0;
while (Date.now() - t0 < 240000) {
  await p.waitForTimeout(250);
  const s = await p.evaluate(() => {
    const txt = document.body.innerText.replace(/\s+/g, " ").trim();
    const btns = Array.from(document.querySelectorAll("button")).filter((b) => b.offsetParent).map((b) => b.textContent?.trim()).filter(Boolean);
    return { screen: window.__SSP__.state().screen, txt: txt.slice(0, 220), btns };
  });
  // The START MINI GAME card waits for a click even under autoplay (as in smoke-play).
  await p.evaluate(() => document.querySelector("#mg-start-btn")?.click());
  if (s.screen === "finale" && !finaleAt) finaleAt = Date.now();
  if (/THAT.S THE GAME/.test(s.txt) && !seen.includes("game-shot")) { seen.push("game-shot"); await p.screenshot({ path: `${OUT}/thats-the-game.png` }); }
  const key = s.screen + s.txt.slice(0, 80);
  if (!seen.length || seen[seen.length - 1] !== key) {
    seen.push(key);
    console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s [${s.screen}] ${s.txt.slice(0, 160)}${s.btns.length ? " | buttons: " + s.btns.join("/") : ""}`);
  }
  if (finaleAt && ACTION === "skip-again" && Date.now() - finaleAt > 2500 && !seen.includes("skipped")) {
    seen.push("skipped");
    await p.click(".ssp-fin-skip");
    console.log("clicked SKIP");
  }
  if (finaleAt && Date.now() - lastShot > 900) {
    lastShot = Date.now();
    shot++;
    await p.screenshot({ path: `${OUT}/f${String(shot).padStart(2, "0")}.png` });
  }
  if (finaleAt && Date.now() - finaleAt > 45000) break;
  if (!finaleAt && Date.now() - t0 > 200000) { await p.screenshot({ path: `${OUT}/stuck.png` }); console.log("STUCK", JSON.stringify(await p.evaluate(() => window.__SSP__.state()))?.slice(0, 600)); break; }
  if (s.screen === "finale" && s.btns.some((x) => /PLAY AGAIN/i.test(x)) && Date.now() - finaleAt > 3000) {
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/final.png` });
    break;
  }
}
if (ACTION) {
  const label = ACTION === "menu" ? "MAIN MENU" : "PLAY AGAIN";
  await p.getByRole("button", { name: new RegExp(label === "MAIN MENU" ? "main menu" : "play again", "i") }).click();
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => ({
    screen: window.__SSP__.state().screen,
    finDom: document.querySelectorAll(".ssp-fin, .ssp-fin-sum").length,
    stage: (() => { let n = 0; for (const el of document.querySelectorAll("canvas")) n++; return n; })(),
  }));
  console.log(`after ${label}:`, JSON.stringify(after));
  await p.screenshot({ path: `${OUT}/after.png` });
}
console.log(`frames: ${shot}`);
console.log("ERRORS:", errs.length ? errs.slice(0, 5) : "none");
await b.close();
