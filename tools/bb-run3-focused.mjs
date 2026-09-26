// RUN3 focused capture: countdown ticks, mid-close ring, pinch frame,
// ceremony beats (banner/confetti/ticker/rank card). speed=1 for wall-time
// fidelity. Plus a speed=2 run to confirm determinism holds at speed=2.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = "D:/Play Games/super-star-party/tools/critic/frames/minigames/bumper_balls/RUN3";
fs.mkdirSync(OUT, { recursive: true });

async function enterMinigame(page) {
  await page.goto("http://localhost:5177/?seed=7&autoplay=1&audio=0&SPEED&minigame=bumper_balls", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  for (let i = 0; i < 40; i++) {
    const scr = await page.evaluate(() => {
      try {
        window.__SSP__.seed(7);
        window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"]);
        window.__SSP__.goto("minigame");
        return window.__SSP__.state?.()?.screen ?? "?";
      } catch { return "ERR"; }
    });
    if (scr === "minigame") return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function runFocused(label, speed) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 300)));
  const url = "http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=" + speed + "&minigame=bumper_balls";

  // patch URL with the right speed
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  let entered = false;
  for (let i = 0; i < 40; i++) {
    const scr = await page.evaluate(() => {
      try {
        window.__SSP__.seed(7);
        window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"]);
        window.__SSP__.goto("minigame");
        return window.__SSP__.state?.()?.screen ?? "?";
      } catch { return "ERR"; }
    });
    if (scr === "minigame") { entered = true; break; }
    await page.waitForTimeout(400);
  }
  if (!entered) { await browser.close(); return { label, error: "no enter", errors }; }

  const result = { label, speed, errors, shots: [] };

  if (speed === 1) {
    // Countdown ticks (2.8s total: 3 @0, 2 @0.7, 1 @1.4, GO @2.1)
    const ticks = [[300, "count-3"], [1000, "count-2"], [1700, "count-1"], [2450, "count-go"]];
    for (const [wait, name] of ticks) {
      await page.waitForTimeout(wait === 300 ? wait : wait - ticks[ticks.indexOf([wait, name]) - 1]?.[0]);
      await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`) });
      result.shots.push(name);
    }
  }

  // Sample __BB__ every 250ms; capture mid-close + pinch frames
  let last = null;
  let gotMid = false;
  let endWall = null;
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(250);
    const bb = await page.evaluate(() => window.__BB__ ? {
      t: +window.__BB__.t?.toFixed?.(3) ?? window.__BB__.t,
      ringR: +(window.__BB__.ringR ?? 0).toFixed(3),
      alive: window.__BB__.alive ? [...window.__BB__.alive] : null,
      elimOrder: window.__BB__.elimOrder ? [...window.__BB__.elimOrder] : null,
      elimRingR: window.__BB__.elimRingR ? [...window.__BB__.elimRingR] : null,
      endPath: window.__BB__.endPath ?? null,
      ranking: window.__BB__.ranking ? [...window.__BB__.ranking] : null,
    } : null);
    if (bb) {
      last = bb;
      if (speed === 1 && !gotMid && bb.ringR > 2.2 && bb.ringR < 2.8 && bb.t > 10) {
        gotMid = true;
        await page.screenshot({ path: path.join(OUT, `${label}-midclose.png`) });
        result.shots.push("midclose");
      }
      if (bb.endPath) { endWall = Date.now(); break; }
    }
  }
  result.final = last;

  if (speed === 1 && endWall) {
    // Ceremony beats (ceremony t=0 at ~0.6s after round end):
    // banner @0.8, confetti @1.05 (lives ~1s), ticker @1.25-2.45, rank card @2.5
    const beats = [[900, "cer-banner"], [1000, "cer-confetti"], [600, "cer-ticker"], [1300, "cer-rankcard"], [1400, "cer-board"]];
    let acc = 0;
    for (const [wait, name] of beats) {
      await page.waitForTimeout(wait - acc);
      acc = wait;
      await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`) });
      result.shots.push(name);
    }
  }

  await browser.close();
  return result;
}

const a = await runFocused("focus1", 1);
console.log("FOCUS1 final:", JSON.stringify(a.final));
console.log("FOCUS1 shots:", a.shots.join(","));
console.log("FOCUS1 errors:", a.errors.length ? a.errors : "none");

const b = await runFocused("focus2", 2);
console.log("FOCUS2 final:", JSON.stringify(b.final));
console.log("FOCUS2 errors:", b.errors.length ? b.errors : "none");

const cmp = (x, y) => JSON.stringify(x) === JSON.stringify(y);
console.log("SPEED1vs2 elimOrder match:", cmp(a.final?.elimOrder, b.final?.elimOrder));
console.log("SPEED1vs2 ranking match:", cmp(a.final?.ranking, b.final?.ranking));
console.log("SPEED1vs2 endPath match:", a.final?.endPath === b.final?.endPath);
