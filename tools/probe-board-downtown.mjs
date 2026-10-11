/**
 * Board registry probe (Downtown slice 1).
 *
 * Part 1 (carnival parity): runs tools/board-golden.mjs for seed 7 over a full
 * match and compares every turn-boundary snapshot hash (boardId dropped) and
 * every synchronous rng mark against tools/golden/carnival-seed7.json, recorded
 * on PR F (feat/moving-star, seeded Grand Prize start). Any gameplay drift on the carnival fails here.
 *
 * Part 2 (Downtown graph, static): loads ?board=downtown and checks the def from
 * __SSP__.board(): 46 spaces, next[] well-formed (1 or 2 edges, in range), every
 * space reachable from start, start reachable from every space, each fork's
 * branch runs back onto the ring, both sides of a fork are within 1 hop, prize
 * spots == the derived rule (PR F: reachable, not start/fork/rejoin/shop; 39),
 * carnival-style type mix (2 shops, 2 grumpus, 3 stamps, 2 minigame balloons).
 *
 * Part 3 (Downtown runtime): autoplays seed 7 on Downtown and checks boardId,
 * that tokens only stand on valid spaces, the balloon only sits on prize spots
 * (or on a space a Balloon Tug pulled it to),
 * and that both forks were taken both ways (a branch tile and a skipped ring
 * tile seen) across the seeds in SSP_DT_SEEDS (default "7,5"), zero page errors.
 *
 *   SSP_URL=http://127.0.0.1:5197 node tools/probe-board-downtown.mjs
 *   SSP_SKIP_GOLDEN=1 skips part 1.
 */
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
// PR F: seed 5 starts the balloon on Market Street (36), so a CPU takes the Market Gate branch;
// with the seeded start, seed 2 never did.
const SEEDS = (process.env.SSP_DT_SEEDS ?? "7,5").split(",").map(Number);
const RUN_TURNS = Number(process.env.SSP_DT_TURNS ?? 10);
const CAP_MS = 420000;
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${msg}`);
  if (!ok) fails.push(msg);
};

// ---- Part 1 ----------------------------------------------------------------
if (process.env.SSP_SKIP_GOLDEN !== "1") {
  console.log("1. carnival seed-7 hash parity vs main (tools/golden/carnival-seed7.json)");
  const r = spawnSync(process.execPath, [resolve(ROOT, "tools/board-golden.mjs")], {
    env: { ...process.env, SSP_SEED: "7", SSP_TURNS: "30", SSP_GOLDEN: resolve(ROOT, "tools/golden/carnival-seed7.json"), SSP_BOARD: "carnival" },
    encoding: "utf8",
    timeout: 600000,
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  for (const line of out.split("\n").filter((l) => /^golden|finale|PASS|FAIL/.test(l))) console.log(`    ${line}`);
  check(r.status === 0, "carnival seed-7 hashes + rng marks identical to main");
}

// ---- Part 2 ----------------------------------------------------------------
const browser = await chromium.launch();
try {
  console.log("2. Downtown graph (static)");
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/?board=downtown&seed=7&screen=board&audio=0`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for the match to start: before startMatch the idle match object carries the default board.
  await page.waitForFunction(() => (window.__SSP__?.state?.()?.match?.players?.length ?? 0) > 0, null, { timeout: 45000 });
  const d = await page.evaluate(() => window.__SSP__.board());
  const boardId = await page.evaluate(() => window.__SSP__.state().match.boardId);
  await page.close();
  check(d.id === "downtown" && boardId === "downtown", `active board is downtown (board()=${d.id}, match.boardId=${boardId})`);
  const n = d.size;
  check(n === 46 && d.next.length === 46 && d.spaces.length === 46, `46 spaces (size ${n}, next ${d.next.length})`);
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
  // Ring = the stay cycle from start.
  const ring = [];
  for (let s = d.startIndex, k = 0; k <= n; k++) { if (ring.includes(s)) break; ring.push(s); s = d.next[s][0]; }
  const onRing = new Set(ring);
  check(ring.length === 32 && d.next[ring[ring.length - 1]][0] === d.startIndex, `stay edges form the 32-space Ring Road (${ring.length})`);
  const forks = d.next.map((row, i) => (row.length === 2 ? i : -1)).filter((i) => i >= 0);
  check(forks.length === 2, `two forks (at ${forks.join(", ")})`);
  const forkInfo = [];
  for (const f of forks) {
    const path = [];
    let s = d.next[f][1];
    while (!onRing.has(s) && path.length < n) { path.push(s); s = d.next[s][0]; }
    const rejoin = s;
    let ringHops = 0;
    const skipped = [];
    for (let r = d.next[f][0]; r !== rejoin && ringHops < n; r = d.next[r][0]) { skipped.push(r); ringHops++; }
    ringHops++;
    const branchHops = path.length + 1;
    forkInfo.push({ fork: f, path, rejoin, skipped });
    check(onRing.has(rejoin) && path.length > 0, `fork ${f} (${d.spaces[f].name}) branch ${path[0]}..${path[path.length - 1]} rejoins the ring at ${rejoin} (${d.spaces[rejoin].name})`);
    check(Math.abs(branchHops - ringHops) <= 1, `fork ${f}: branch ${branchHops} hops vs ring ${ringHops} hops`);
    check(path.every((p) => d.next[p].length === 1), `fork ${f}: branch tiles do not fork again`);
  }
  const branchTiles = new Set(forkInfo.flatMap((f) => f.path));
  check(ring.length + branchTiles.size === n, `ring (${ring.length}) + branch tiles (${branchTiles.size}) cover the board`);
  const ps = d.prizeSpots;
  const rejoins = new Set(forkInfo.map((f) => f.rejoin));
  // PR F: no hand-picked spots. prizeSpots is derived: reachable from start, not the start,
  // not a shop, not a fork, not a rejoin (2+ reachable predecessors), ascending.
  const preds = Array.from({ length: n }, () => 0);
  fwd.forEach((i) => d.next[i].forEach((j) => preds[j]++));
  const derived = [...fwd].filter((s) => s !== d.startIndex && d.spaces[s].type !== "shop" && d.next[s].length < 2 && preds[s] < 2).sort((a, b) => a - b);
  check(JSON.stringify(ps) === JSON.stringify(derived), `prizeSpots == derived rule (${ps.length} spots) [${ps.join(",")}]${JSON.stringify(ps) === JSON.stringify(derived) ? "" : " want [" + derived.join(",") + "]"}`);
  check(ps.length === 39 && new Set(ps).size === ps.length, `39 unique prize spots`);
  const badSpot = ps.filter((s) => !(s >= 0 && s < n) || s === d.startIndex || forks.includes(s) || rejoins.has(s) || d.spaces[s].type === "shop");
  check(badSpot.length === 0, `no prize spot on start/fork/rejoin/shop${badSpot.length ? " (bad: " + badSpot.join(",") + ")" : ""}`);
  check(ps.some((s) => branchTiles.has(s)) && ps.some((s) => onRing.has(s)), "prize spots on both the ring and the forks");
  const count = (t) => d.spaces.filter((s) => s.type === t).length;
  const mix = { shop: count("shop"), grumpus: count("grumpus"), stamp: count("stamp"), minigame_balloon: count("minigame_balloon"), green: count("green"), red: count("red"), blue: count("blue") };
  check(mix.shop === 2 && mix.grumpus === 2 && mix.stamp === 3 && mix.minigame_balloon === 2, `type mix ${JSON.stringify(mix)}`);
  check(d.spaces[d.startIndex].type === "blue", `start (${d.spaces[d.startIndex].name}) is a plain space`);
  check(errors.length === 0, `no page errors on load${errors.length ? ": " + errors[0] : ""}`);

  // ---- Part 3 --------------------------------------------------------------
  console.log(`3. Downtown autoplay (seeds ${SEEDS.join(", ")}, up to ${RUN_TURNS} turns each)`);
  const taken = forkInfo.map(() => ({ branch: false, ring: false }));
  for (const seed of SEEDS) {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
    await p.goto(`${BASE}/?board=downtown&seed=${seed}&screen=board&autoplay=1&audio=0&speed=4`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForFunction(() => window.__SSP__?.state, null, { timeout: 45000 });
    await p.evaluate(() => {
      // tugged: balloon positions set by a Balloon Tug (chomp_call moves the balloon onto the user's space,
      // which need not be a prize spot); the prize-spot check skips those.
      const seen = { spaces: [], balloons: [], boards: [], tugged: [], turn: 0 };
      let prevPos = null, prevItems = null, tugUsers = [];
      const tick = () => {
        const m = window.__SSP__?.state?.()?.match;
        if (m && (m.players?.length ?? 0) > 0) {
          for (const pl of m.players ?? []) if (!seen.spaces.includes(pl.space)) seen.spaces.push(pl.space);
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
      window.__DT = seen;
      requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    let seen;
    let finale = false;
    while (Date.now() - t0 < CAP_MS) {
      await p.evaluate(() => document.querySelector("#mg-start-btn")?.click());
      seen = await p.evaluate(() => window.__DT);
      if ((await p.evaluate(() => window.__SSP__.state().screen)) === "finale") { finale = true; break; }
      if (seen.turn > RUN_TURNS) break;
      await p.waitForTimeout(150);
    }
    await p.close();
    const spaces = new Set(seen.spaces);
    forkInfo.forEach((f, k) => {
      if (f.path.some((s) => spaces.has(s))) taken[k].branch = true;
      if (f.skipped.some((s) => spaces.has(s))) taken[k].ring = true;
    });
    const badBalloon = seen.balloons.filter((b) => !ps.includes(b) && !seen.tugged.includes(b));
    console.log(`    seed ${seed}: reached turn ${seen.turn}${finale ? " (finale)" : ""} in ${Math.round((Date.now() - t0) / 1000)}s, ${spaces.size} spaces stood on, balloon at [${seen.balloons.join(",")}]${seen.tugged.length ? ` (Balloon Tug to ${seen.tugged.join(",")})` : ""}`);
    check(seen.boards.length === 1 && seen.boards[0] === "downtown", `seed ${seed}: match.boardId stays downtown (${seen.boards.join(",")})`);
    check(seen.turn >= Math.min(RUN_TURNS, 3) || finale, `seed ${seed}: match progressed (turn ${seen.turn})`);
    check([...spaces].every((s) => Number.isInteger(s) && s >= 0 && s < n), `seed ${seed}: tokens only on valid spaces`);
    check(badBalloon.length === 0, `seed ${seed}: balloon only on prize spots${badBalloon.length ? " (bad " + badBalloon.join(",") + ")" : ""}`);
    check(errs.length === 0, `seed ${seed}: no page errors${errs.length ? ": " + errs[0] : ""}`);
  }
  forkInfo.forEach((f, k) => {
    check(taken[k].branch && taken[k].ring, `fork ${f.fork} (${d.spaces[f.fork].name}) taken both ways (branch ${taken[k].branch}, ring ${taken[k].ring})`);
  });
} finally {
  await browser.close();
}

console.log(fails.length ? `\nFAIL: ${fails.length} check(s)` : "\nPASS: carnival parity + Downtown graph valid");
process.exit(fails.length ? 1 : 0);
