/**
 * Board probe: The Cruise Ship (board 3, 132 spaces).
 *
 * Part 1 (graph, static): loads ?board=cruise and checks the def from
 * __SSP__.board(): 132 spaces, next[] well-formed (1 or 2 edges, in range),
 * every space reachable from the start and the start reachable from every
 * space, the stay edges walk the Promenade (64) and the Lido ring (22), 13
 * forks whose lanes run back onto a loop without forking again, prize spots
 * valid (12, unique, plain blue/red, never start/fork/rejoin), the type mix
 * (4 shops, 5 Gus spaces, 6 stamp stands, 5 minigame balloons), zero errors.
 *
 * Part 2 (seeded match): runs tools/board-golden.mjs for seed 7 on the cruise
 * board through the finale and compares every turn-boundary hash and every
 * synchronous rng mark against tools/golden/cruise-seed7.json, so the match
 * replays byte for byte. Re-record that file (SSP_GOLDEN_OUT) only for an
 * intended gameplay change on this board.
 *
 * Part 3 (autoplay): plays each seed in SSP_CR_SEEDS (default "4,5") for up
 * to SSP_CR_TURNS turns and checks boardId, that tokens only stand on valid
 * spaces, the balloon only on prize spots (or where a Balloon Tug pulled it),
 * zero page errors, and reports which fork lanes were walked. At least half
 * of the 13 forks must have been taken both ways across the seeds.
 *
 *   SSP_URL=http://127.0.0.1:5181 node tools/probe-board-cruise.mjs
 *   SSP_SKIP_GOLDEN=1 skips part 2.
 */
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEEDS = (process.env.SSP_CR_SEEDS ?? "4,5").split(",").map(Number);
const RUN_TURNS = Number(process.env.SSP_CR_TURNS ?? 8);
const CAP_MS = 420000;
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${msg}`);
  if (!ok) fails.push(msg);
};

const browser = await chromium.launch();
try {
  // ---- Part 1 ----------------------------------------------------------------
  console.log("1. Cruise Ship graph (static)");
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/?board=cruise&seed=7&screen=board&audio=0`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => (window.__SSP__?.state?.()?.match?.players?.length ?? 0) > 0, null, { timeout: 45000 });
  const d = await page.evaluate(() => window.__SSP__.board());
  const boardId = await page.evaluate(() => window.__SSP__.state().match.boardId);
  await page.close();
  check(d.id === "cruise-ship" && boardId === "cruise-ship", `active board is cruise-ship (board()=${d.id}, match.boardId=${boardId})`);
  const n = d.size;
  check(n === 132 && d.next.length === 132 && d.spaces.length === 132, `132 spaces (size ${n}, next ${d.next.length})`);
  check(d.next.every((row, i) => (row.length === 1 || row.length === 2) && row.every((j) => Number.isInteger(j) && j >= 0 && j < n && j !== i)), "every next[] row has 1-2 in-range edges");
  const reach = (from, edges) => {
    const seen = new Set([from]);
    const q = [from];
    while (q.length) for (const j of edges(q.shift())) if (!seen.has(j)) { seen.add(j); q.push(j); }
    return seen;
  };
  const fwd = reach(d.startIndex, (i) => d.next[i]);
  check(fwd.size === n, `all spaces reachable from start ${d.startIndex} (${fwd.size}/${n})`);
  const back = Array.from({ length: n }, () => []);
  d.next.forEach((row, i) => row.forEach((j) => back[j].push(i)));
  const rev = reach(d.startIndex, (i) => back[i]);
  check(rev.size === n, `start reachable from every space (${rev.size}/${n})`);
  // Loops = stay cycles: the Promenade from the start, the Lido ring from the first space off it.
  const cycle = (from) => {
    const out = [];
    for (let s = from, k = 0; k <= n; k++) { if (out.includes(s)) break; out.push(s); s = d.next[s][0]; }
    return d.next[out[out.length - 1]][0] === from ? out : [];
  };
  const prom = cycle(d.startIndex);
  check(prom.length === 64, `stay edges walk the 64-space Promenade (${prom.length})`);
  const lidoStart = Array.from({ length: n }, (_, i) => i).find((i) => !prom.includes(i) && cycle(i).length > 0);
  const lido = lidoStart === undefined ? [] : cycle(lidoStart);
  check(lido.length === 22, `stay edges walk the 22-space Lido ring (${lido.length})`);
  const onLoop = new Set([...prom, ...lido]);
  const forks = d.next.map((row, i) => (row.length === 2 ? i : -1)).filter((i) => i >= 0);
  check(forks.length === 13, `13 forks (at ${forks.join(", ")})`);
  const forkInfo = [];
  for (const f of forks) {
    const path = [];
    let s = d.next[f][1];
    while (!onLoop.has(s) && path.length < n) { path.push(s); s = d.next[s][0]; }
    const rejoin = s;
    // The stay side of the fork: the loop spaces the lane skips (up to the rejoin or 30 hops).
    const skipped = [];
    for (let r = d.next[f][0], k = 0; r !== rejoin && k < 30; r = d.next[r][0], k++) skipped.push(r);
    forkInfo.push({ fork: f, path, rejoin, skipped });
    check(onLoop.has(rejoin) && path.length > 0 && path.every((p) => d.next[p].length === 1),
      `fork ${f} (${d.spaces[f].name}) lane ${path[0]}..${path[path.length - 1]} rejoins at ${rejoin} (${d.spaces[rejoin].name})`);
  }
  const laneTiles = new Set(forkInfo.flatMap((f) => f.path));
  check(onLoop.size + laneTiles.size === n, `loops (${onLoop.size}) + lane tiles (${laneTiles.size}) cover the board`);
  const ps = d.prizeSpots;
  const rejoins = new Set(forkInfo.map((f) => f.rejoin));
  check(ps.length === 12 && new Set(ps).size === ps.length, `12 unique prize spots [${ps.join(",")}]`);
  const badSpot = ps.filter((s) => !(s >= 0 && s < n) || s === d.startIndex || forks.includes(s) || rejoins.has(s) || !["blue", "red"].includes(d.spaces[s].type));
  check(badSpot.length === 0, `prize spots are plain spaces off the start/forks/rejoins${badSpot.length ? " (bad: " + badSpot.join(",") + ")" : ""}`);
  check(ps.some((s) => laneTiles.has(s)) && ps.some((s) => prom.includes(s)) && ps.some((s) => lido.includes(s)), "prize spots on the Promenade, the Lido ring and the lanes");
  const count = (t) => d.spaces.filter((s) => s.type === t).length;
  const mix = { shop: count("shop"), grumpus: count("grumpus"), stamp: count("stamp"), minigame_balloon: count("minigame_balloon"), green: count("green"), red: count("red"), blue: count("blue") };
  check(mix.shop === 4 && mix.grumpus === 5 && mix.stamp === 6 && mix.minigame_balloon === 5 && mix.blue > mix.red && mix.red > mix.green, `type mix ${JSON.stringify(mix)}`);
  check(d.spaces[d.startIndex].type === "blue", `start (${d.spaces[d.startIndex].name}) is a plain space`);
  check(errors.length === 0, `no page errors on load${errors.length ? ": " + errors[0] : ""}`);

  // ---- Part 2 ----------------------------------------------------------------
  if (process.env.SSP_SKIP_GOLDEN !== "1") {
    console.log("2. cruise seed-7 full match vs tools/golden/cruise-seed7.json");
    const r = spawnSync(process.execPath, [resolve(ROOT, "tools/board-golden.mjs")], {
      env: { ...process.env, SSP_SEED: "7", SSP_TURNS: "30", SSP_GOLDEN: resolve(ROOT, "tools/golden/cruise-seed7.json"), SSP_BOARD: "cruise" },
      encoding: "utf8",
      timeout: 1500000,
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    for (const line of out.split("\n").filter((l) => /^golden|finale|page errors|PASS|FAIL/.test(l))) console.log(`    ${line}`);
    check(/finale reached: true/.test(out), "seed 7 plays through to the finale");
    check(r.status === 0, "cruise seed-7 hashes + rng marks match the recorded replay, no page errors");
  }

  // ---- Part 3 ----------------------------------------------------------------
  console.log(`3. Cruise autoplay (seeds ${SEEDS.join(", ")}, up to ${RUN_TURNS} turns each)`);
  const taken = forkInfo.map(() => ({ branch: false, stay: false }));
  for (const seed of SEEDS) {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
    await p.goto(`${BASE}/?board=cruise&seed=${seed}&screen=board&autoplay=1&audio=0&speed=4`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForFunction(() => window.__SSP__?.state, null, { timeout: 45000 });
    await p.evaluate(() => {
      // Hops in walking order (from -> to), so a fork's lane choice is exact.
      const seen = { hops: [], balloons: [], boards: [], tugged: [], spaces: [], turn: 0 };
      let prevPos = null, prevItems = null, tugUsers = [];
      const last = {};
      const tick = () => {
        const m = window.__SSP__?.state?.()?.match;
        if (m && (m.players?.length ?? 0) > 0) {
          m.players.forEach((pl, i) => {
            if (last[i] !== undefined && last[i] !== pl.space) seen.hops.push([last[i], pl.space]);
            last[i] = pl.space;
            if (!seen.spaces.includes(pl.space)) seen.spaces.push(pl.space);
          });
          const items = m.players.map((x) => JSON.stringify(x.items ?? x.inventory ?? []));
          if (prevItems) items.forEach((it, i) => { if (prevItems[i]?.includes("chomp_call") && !it.includes("chomp_call")) tugUsers.push({ i, turn: m.turn }); });
          prevItems = items;
          if (m.starBalloonPos !== prevPos) {
            prevPos = m.starBalloonPos;
            if (tugUsers.some((u) => u.turn === m.turn && m.players[u.i]?.space === prevPos) && !seen.tugged.includes(prevPos)) seen.tugged.push(prevPos);
          }
          if (!seen.balloons.includes(m.starBalloonPos)) seen.balloons.push(m.starBalloonPos);
          if (m.boardId && !seen.boards.includes(m.boardId)) seen.boards.push(m.boardId);
          seen.turn = m.turn;
        }
        requestAnimationFrame(tick);
      };
      window.__CR = seen;
      requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    let seen;
    let finale = false;
    while (Date.now() - t0 < CAP_MS) {
      await p.evaluate(() => document.querySelector("#mg-start-btn")?.click());
      seen = await p.evaluate(() => window.__CR);
      if ((await p.evaluate(() => window.__SSP__.state().screen)) === "finale") { finale = true; break; }
      if (seen.turn > RUN_TURNS) break;
      await p.waitForTimeout(150);
    }
    await p.close();
    const hop = new Set(seen.hops.map(([a, b]) => `${a}>${b}`));
    forkInfo.forEach((f, k) => {
      if (hop.has(`${f.fork}>${d.next[f.fork][1]}`)) taken[k].branch = true;
      if (hop.has(`${f.fork}>${d.next[f.fork][0]}`)) taken[k].stay = true;
    });
    const badBalloon = seen.balloons.filter((b) => !ps.includes(b) && !seen.tugged.includes(b));
    console.log(`    seed ${seed}: reached turn ${seen.turn}${finale ? " (finale)" : ""} in ${Math.round((Date.now() - t0) / 1000)}s, ${seen.spaces.length} spaces stood on, ${seen.hops.length} hops, balloon at [${seen.balloons.join(",")}]${seen.tugged.length ? ` (Balloon Tug to ${seen.tugged.join(",")})` : ""}`);
    check(seen.boards.length === 1 && seen.boards[0] === "cruise-ship", `seed ${seed}: match.boardId stays cruise-ship (${seen.boards.join(",")})`);
    check(seen.turn >= Math.min(RUN_TURNS, 3) || finale, `seed ${seed}: match progressed (turn ${seen.turn})`);
    check(seen.spaces.every((s) => Number.isInteger(s) && s >= 0 && s < n), `seed ${seed}: tokens only on valid spaces`);
    check(badBalloon.length === 0, `seed ${seed}: balloon only on prize spots${badBalloon.length ? " (bad " + badBalloon.join(",") + ")" : ""}`);
    check(errs.length === 0, `seed ${seed}: no page errors${errs.length ? ": " + errs[0] : ""}`);
  }
  const lanes = forkInfo.map((f, k) => `${f.fork}:${taken[k].branch ? "B" : "-"}${taken[k].stay ? "S" : "-"}`);
  console.log(`    fork lanes walked: ${lanes.join(" ")}`);
  const both = taken.filter((t) => t.branch && t.stay).length;
  check(both * 2 >= forkInfo.length, `forks taken both ways: ${both}/${forkInfo.length}`);
} finally {
  await browser.close();
}

console.log(fails.length ? `\nFAIL: ${fails.length} check(s)` : "\nPASS: Cruise Ship graph, seeded replay and autoplay");
process.exit(fails.length ? 1 : 0);
