// No-core-rng guard: cosmetic board code (src/board/lively/**, src/board/downtown/**)
// must never import the gameplay generator (src/core/rng). twin-seed cannot catch
// stolen draws, so this static check runs in CI next to probe-lively-isolation.
//   node tools/check-lively-imports.mjs   -> exit 1 on any violation
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DIRS = ["src/board/lively", "src/board/downtown"];
const CORE_RNG = resolve(ROOT, "src/core/rng");
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(n)) files.push(p);
  }
};
for (const d of DIRS) if (existsSync(join(ROOT, d))) walk(join(ROOT, d));

const SPEC = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/gs;
const bad = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(SPEC)) {
    const spec = m[1] ?? m[2] ?? m[3];
    const stmt = m[0];
    const target = spec.startsWith(".") ? resolve(dirname(f), spec).replace(/\.(ts|js)$/, "") : spec;
    const line = src.slice(0, m.index).split("\n").length;
    if (target === CORE_RNG || /(^|\/)core\/rng$/.test(spec)) bad.push(`${relative(ROOT, f)}:${line} imports the core rng (${spec})`);
    else if (/\{[^}]*\brng\b[^}]*\}/.test(stmt) && !/fxRng/.test(spec)) bad.push(`${relative(ROOT, f)}:${line} imports a binding named rng from ${spec}`);
  }
}
console.log(`checked ${files.length} files in ${DIRS.join(", ")}`);
for (const b of bad) console.log(`  ${b}`);
console.log(bad.length ? "FAIL: cosmetic code imports the gameplay rng" : "PASS: no core rng imports");
process.exit(bad.length ? 1 : 0);
