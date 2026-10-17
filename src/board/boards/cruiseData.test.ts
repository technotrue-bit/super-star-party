import { describe, expect, it } from "vitest";
import { groundHeight, hopsBetween } from "../boardData";
import { boardDef, resolveBoardRule, parseBoardRule } from "../registry";
import { CRUISE_H, cruiseShip } from "./cruiseData";

const d = cruiseShip;
const n = d.spaces.length;

function reach(from: number, edges: (i: number) => number[]): Set<number> {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) for (const j of edges(q.shift()!)) if (!seen.has(j)) (seen.add(j), q.push(j));
  return seen;
}

describe("The Cruise Ship board", () => {
  it("has exactly 132 spaces, indexed in order", () => {
    expect(n).toBe(132);
    expect(d.next.length).toBe(132);
    d.spaces.forEach((s, i) => expect(s.index).toBe(i));
    expect(new Set(d.spaces.map((s) => s.name)).size).toBe(132);
  });

  it("is registered and reachable by its aliases", () => {
    expect(boardDef("cruise-ship")).toBe(d);
    expect(parseBoardRule("cruise")).toBe("cruise-ship");
    expect(parseBoardRule("ship")).toBe("cruise-ship");
    // A seeded "random" pick stays an integer hash over the registered ids.
    expect(["fizzy-fairground", "downtown", "cruise-ship"]).toContain(resolveBoardRule("random", 7));
  });

  it("has a well-formed move graph: every space reachable, the start reachable from every space", () => {
    for (const [i, row] of d.next.entries()) {
      expect(row.length === 1 || row.length === 2).toBe(true);
      for (const j of row) expect(Number.isInteger(j) && j >= 0 && j < n && j !== i).toBe(true);
    }
    expect(reach(d.startIndex, (i) => d.next[i]).size).toBe(n);
    const back: number[][] = Array.from({ length: n }, () => []);
    d.next.forEach((row, i) => row.forEach((j) => back[j].push(i)));
    expect(reach(d.startIndex, (i) => back[i]).size).toBe(n);
  });

  it("walks the Promenade (64) and the Lido ring (22) on stay edges", () => {
    const [prom, lido] = d.loops;
    expect(prom.length).toBe(64);
    expect(lido.length).toBe(22);
    for (const loop of d.loops) loop.forEach((s, k) => expect(d.next[s][0]).toBe(loop[(k + 1) % loop.length]));
  });

  it("has 13 forks, each an open lane that rejoins a loop without forking again", () => {
    const forks = d.next.flatMap((row, i) => (row.length === 2 ? [i] : []));
    expect(forks.length).toBe(13);
    const onLoop = new Set(d.loops.flat());
    expect(d.branches?.length).toBe(13);
    for (const br of d.branches ?? []) {
      expect(d.next[br.from][1]).toBe(br.path[0]);
      br.path.forEach((p, k) => expect(d.next[p]).toEqual([br.path[k + 1] ?? br.to]));
      expect(onLoop.has(br.from) && onLoop.has(br.to)).toBe(true);
      expect(br.label.length).toBeGreaterThan(0);
    }
    expect(onLoop.size + (d.branches ?? []).reduce((a, b) => a + b.path.length, 0)).toBe(n);
  });

  it("keeps the star chase moving: star spots average under 24 hops apart", () => {
    const ps = d.prizeSpots;
    let sum = 0;
    let count = 0;
    for (const a of ps) for (const b of ps) if (a !== b) (sum += hopsBetween(d, a, b), count++);
    expect(sum / count).toBeLessThan(24);
    expect(hopsBetween(d, d.startIndex, d.prizeStart)).toBeLessThanOrEqual(8);
  });

  it("puts the Grand Prize Balloon only on plain spaces off the forks", () => {
    const ps = d.prizeSpots;
    expect(ps.length).toBe(12);
    expect(new Set(ps).size).toBe(12);
    const rejoins = new Set((d.branches ?? []).map((b) => b.to));
    for (const s of ps) {
      expect(["blue", "red"]).toContain(d.spaces[s].type);
      expect(s).not.toBe(d.startIndex);
      expect(d.next[s].length).toBe(1);
      expect(rejoins.has(s)).toBe(false);
    }
    expect(ps).toContain(d.prizeStart);
  });

  it("uses the shared space types in party-board proportions", () => {
    const count = (t: string) => d.spaces.filter((s) => s.type === t).length;
    expect(count("shop")).toBe(4);
    expect(count("grumpus")).toBe(5);
    expect(count("stamp")).toBe(6);
    expect(count("minigame_balloon")).toBe(5);
    expect(count("blue")).toBeGreaterThan(count("red"));
    expect(count("red")).toBeGreaterThan(count("green"));
    for (const k of ["shy", "goomba", "koopa"]) expect(d.spaces.filter((s) => s.stamp === k).length).toBe(2);
    expect(d.spaces[d.startIndex].type).toBe("blue");
    for (const s of d.spaces.filter((x) => x.type === "minigame_balloon")) expect([5, 10]).toContain(s.balloonCoins);
  });

  it("sits every space on its deck and spaces neighbours a hop apart", () => {
    const lido = new Set(d.loops[1]);
    const pool = new Set(d.branches?.find((b) => b.label === "Pool Bridge")?.path ?? []);
    const ballroom = new Set(d.branches?.find((b) => b.label === "Grand Ballroom")?.path ?? []);
    for (const s of d.spaces) {
      const h = groundHeight(d, s.x, s.y);
      const want = lido.has(s.index) || pool.has(s.index) ? CRUISE_H.lido : ballroom.has(s.index) && Math.abs(s.x) < 8 ? CRUISE_H.ballroom : 0;
      expect(h, `${s.index} ${s.name}`).toBeCloseTo(want, 5);
    }
    for (const [i, row] of d.next.entries()) {
      for (const j of row) {
        const a = d.spaces[i];
        const b = d.spaces[j];
        const len = Math.hypot(a.x - b.x, a.y - b.y);
        const climb = Math.abs(groundHeight(d, a.x, a.y) - groundHeight(d, b.x, b.y)) > 1;
        // A stairway hop crosses its flight; every other hop is one space apart.
        expect(len, `${a.name} -> ${b.name}`).toBeGreaterThan(2.3);
        expect(len, `${a.name} -> ${b.name}`).toBeLessThan(climb ? 6 : 3.4);
      }
    }
  });

  it("never crowds two unconnected spaces together", () => {
    const linked = new Set<string>();
    d.next.forEach((row, i) => row.forEach((j) => (linked.add(`${i},${j}`), linked.add(`${j},${i}`))));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (linked.has(`${i},${j}`)) continue;
        const len = Math.hypot(d.spaces[i].x - d.spaces[j].x, d.spaces[i].y - d.spaces[j].y);
        expect(len, `${d.spaces[i].name} ~ ${d.spaces[j].name}`).toBeGreaterThanOrEqual(2.55);
      }
    }
  });
});
