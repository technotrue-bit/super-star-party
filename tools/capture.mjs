// tools/capture.mjs — deterministic capture + state-dump harness for critics.
// Usage:
//   node tools/capture.mjs --url "http://localhost:5177/?screen=showcase" \
//     --out tools/critic/frames/board/run1 --shots 4 --viewport 390x844 \
//     --actions "js:window.__SSP__.goto('showcase')" "js:window.__SSP__.advance(120)"
//
// Each shot: screenshot PNG + state JSON (window.__SSP__.state()) + console
// error log. State JSON is the critic's ground truth for the RUNNING game.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
function actions() {
  const out = [];
  const i = process.argv.indexOf("--actions");
  if (i < 0) return out;
  for (let j = i + 1; j < process.argv.length; j++) {
    if (process.argv[j].startsWith("--")) break;
    out.push(process.argv[j]);
  }
  return out;
}

const url = arg("url", "http://localhost:5177/");
const outDir = arg("out", "tools/critic/frames/run");
const shots = Number(arg("shots", "3"));
const [vw, vh] = arg("viewport", "390x844").split("x").map(Number);
const waitMs = Number(arg("wait", "1200"));

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 300)));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

// Run any --actions (js:... or wait:ms)
for (const a of actions()) {
  if (a.startsWith("js:")) {
    await page.evaluate((code) => {
      // eslint-disable-next-line no-eval
      (0, eval)(code);
    }, a.slice(3));
    await page.waitForTimeout(300);
  } else if (a.startsWith("wait:")) {
    await page.waitForTimeout(Number(a.slice(5)));
  }
}

for (let i = 1; i <= shots; i++) {
  const state = await page.evaluate(() => window.__SSP__?.state() ?? { noSSP: true });
  const stamp = String(i).padStart(2, "0");
  await page.screenshot({ path: path.join(outDir, `shot-${stamp}.png`) });
  fs.writeFileSync(path.join(outDir, `state-${stamp}.json`), JSON.stringify(state, null, 2));
  if (i < shots) await page.waitForTimeout(waitMs);
}
fs.writeFileSync(path.join(outDir, "console-errors.txt"), errors.length ? errors.join("\n") : "none");
console.log("SHOTS:", shots, "->", outDir);
console.log("CONSOLE_ERRORS:", errors.length ? errors : "none");
console.log("LAST_STATE:", JSON.stringify(await page.evaluate(() => window.__SSP__?.state()?.screen ?? "?")));
await browser.close();
