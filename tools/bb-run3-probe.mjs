// RUN3 critic probe — BUMPER BALLS pinch drama + determinism.
// Two real-time twin runs at seed 7, speed=1, __BB__ sampled every 250ms.
// Screenshots at each elimination + results ceremony beats. Console errors logged.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = "D:/Play Games/super-star-party/tools/critic/frames/minigames/bumper_balls/RUN3";
fs.mkdirSync(OUT, { recursive: true });

const URL = "http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=1&minigame=bumper_balls";

async function runOnce(label) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 300)));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
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
  if (!entered) {
    await browser.close();
    return { label, error: "could not enter minigame", errors };
  }

  const samples = [];
  let last = null;
  let shotIdx = 0;
  const t0 = Date.now();
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
      const elimCount = bb.elimOrder?.length ?? 0;
      const prevCount = last?.elimOrder?.length ?? 0;
      if (!last || elimCount !== prevCount || bb.endPath !== last.endPath) {
        samples.push(JSON.parse(JSON.stringify(bb)));
        shotIdx++;
        await page.screenshot({ path: path.join(OUT, `${label}-shot-${String(shotIdx).padStart(2, "0")}.png`) });
      }
      last = bb;
    }
    if (last?.endPath) break;
  }
  const roundEnd = last;

  await page.waitForTimeout(1200);
  const cerState1 = await page.evaluate(() => ({
    screen: window.__SSP__?.state?.()?.screen,
    phase: window.__SSP__?.state?.()?.match?.phase,
  }));
  await page.screenshot({ path: path.join(OUT, `${label}-shot-ceremony-1.png`) });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${label}-shot-ceremony-2.png`) });
  const cerState2 = await page.evaluate(() => ({
    screen: window.__SSP__?.state?.()?.screen,
    phase: window.__SSP__?.state?.()?.match?.phase,
  }));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, `${label}-shot-ceremony-3.png`) });
  const cerState3 = await page.evaluate(() => ({
    screen: window.__SSP__?.state?.()?.screen,
    phase: window.__SSP__?.state?.()?.match?.phase,
  }));

  const wallTime = ((Date.now() - t0) / 1000).toFixed(1);
  await browser.close();
  return { label, final: roundEnd, samples, cerStates: [cerState1, cerState2, cerState3], wallTime, errors };
}

const a = await runOnce("twin1");
const b = await runOnce("twin2");
const cmp = (x, y) => JSON.stringify(x) === JSON.stringify(y);

const report = {
  twinA: { final: a.final, samples: a.samples, cerStates: a.cerStates, wallTime: a.wallTime, errors: a.errors },
  twinB: { final: b.final, samples: b.samples, cerStates: b.cerStates, wallTime: b.wallTime, errors: b.errors },
  match: {
    elimOrder: cmp(a.final?.elimOrder, b.final?.elimOrder),
    ranking: cmp(a.final?.ranking, b.final?.ranking),
    endPath: a.final?.endPath === b.final?.endPath,
  },
};
fs.writeFileSync(path.join(OUT, "twins.json"), JSON.stringify(report, null, 2));
console.log("=== TWIN A ===");
console.log("final:", JSON.stringify(a.final));
console.log("samples:", JSON.stringify(a.samples));
console.log("ceremony states:", JSON.stringify(a.cerStates));
console.log("wallTime(s):", a.wallTime);
console.log("errors:", a.errors.length ? a.errors : "none");
console.log("=== TWIN B ===");
console.log("final:", JSON.stringify(b.final));
console.log("samples:", JSON.stringify(b.samples));
console.log("ceremony states:", JSON.stringify(b.cerStates));
console.log("wallTime(s):", b.wallTime);
console.log("errors:", b.errors.length ? b.errors : "none");
console.log("=== MATCH ===", JSON.stringify(report.match));
