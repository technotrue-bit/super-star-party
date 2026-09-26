import fs from "node:fs";
import { PNG } from "pngjs";
const OUT = "D:/Play Games/super-star-party/tools/critic/frames/economy/orch-red";
const files = fs.readdirSync(OUT).filter(f => f.startsWith("r5-") && f.endsWith(".png")).sort();
function census(png) {
  const d = png.data;
  const n = png.width * png.height;
  let rSum = 0, redPixels = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i*4], g = d[i*4+1], b = d[i*4+2];
    rSum += r;
    if (r > 90 && r > g + 10 && r > b + 10) redPixels++;
  }
  return { redMean: rSum / n, redShare: (redPixels / n) * 100 };
}
let before = null, afterCensuses = [];
for (const f of files) {
  const buf = fs.readFileSync(`${OUT}/${f}`);
  const png = PNG.sync.read(buf);
  const c = census(png);
  console.log(f, JSON.stringify(c));
  if (f.includes("pre-turn") || f.includes("at-effect-start")) before = c;
  if (f.includes("burst")) afterCensuses.push(c);
}
if (afterCensuses.length > 0) {
  let rSum = 0, pSum = 0;
  for (const c of afterCensuses) { rSum += c.redMean; pSum += c.redShare; }
  const avg = { redMean: rSum / afterCensuses.length, redShare: pSum / afterCensuses.length };
  console.log("=== BEFORE:", JSON.stringify(before));
  console.log("=== AFTER (avg of", afterCensuses.length, "frames):", JSON.stringify(avg));
  console.log("=== DELTA redMean:", (avg.redMean - before.redMean).toFixed(1), "redShare:", (avg.redShare - before.redShare).toFixed(2));
}
