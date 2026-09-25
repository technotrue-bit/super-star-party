// Usage: node tools/parse-runs.mjs <log>
// Extracts RESULT_JSON_START...END blocks and prints fires, duck windows, clipping.
import fs from "node:fs";
const log = fs.readFileSync(process.argv[2], "utf8");
const blocks = [...log.matchAll(/RESULT_JSON_START\n([\s\S]*?)\nRESULT_JSON_END/g)];
if (!blocks.length) { console.log("NO RESULT_JSON blocks found"); process.exit(0); }
for (const b of blocks) {
  const j = JSON.parse(b[1]);
  console.log("\n==== RUN ====");
  console.log("url:", j.url || "(none)");
  console.log("nSamples:", j.nSamples, "globalMaxPeak:", j.globalMaxPeak, "peakBelowOne:", j.peakBelowOne, "errors:", JSON.stringify(j.errors));
  if (j.dbg && j.dbg.length) console.log("dbg:", j.dbg.join(" | "));
  console.log("fires (id@ms xN):");
  const counts = {};
  for (const f of j.fires) counts[f.id] = (counts[f.id]||0)+1;
  for (const k of Object.keys(counts).sort()) console.log("  " + k + " x" + counts[k] + " (first@"+Math.round(j.fires.find(f=>f.id===k).t)+")");
  const stings = j.duckWindows || [];
  if (stings.length) {
    console.log("duck windows:");
    for (const w of stings) {
      console.log("  " + w.id + " @ " + Math.round(w.fireT) + "ms | targetGain=" + w.targetGain + " before=" + Number(w.beforeDuck).toFixed(3) + " min=" + Number(w.minDuck).toFixed(3) + " after=" + (w.afterDuck===null?"null":Number(w.afterDuck).toFixed(3)));
      const curve = (w.curve||[]).sort((a,b)=>a.t-b.t);
      for (let i=0;i+1<curve.length;i+=2) console.log("    t="+curve[i].t.toFixed(1)+" duck="+curve[i].duck.toFixed(3)+" | t="+curve[i+1].t.toFixed(1)+" duck="+curve[i+1].duck.toFixed(3));
    }
  }
}
