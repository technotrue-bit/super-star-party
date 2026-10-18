import { describe, expect, it } from "vitest";
import { chooseRival, defaultRivals, reconcileRivals } from "./rivals";

const N = 8; // roster size
const valid = (rivals: number[], hero: number): boolean =>
  rivals.length === 3 && new Set(rivals).size === 3 && !rivals.includes(hero) && rivals.every((r) => r >= 0 && r < N);

describe("rival lineup", () => {
  it("defaults to the first three other heroes in roster order", () => {
    expect(defaultRivals(0, 3, N)).toEqual([1, 2, 3]);
    expect(defaultRivals(2, 3, N)).toEqual([0, 1, 3]);
    expect(defaultRivals(7, 3, N)).toEqual([0, 1, 2]);
  });

  it("puts a pick in its seat", () => {
    expect(chooseRival([1, 2, 3], 1, 6, 0)).toEqual([1, 6, 3]);
  });

  it("swaps seats when the pick is already a rival", () => {
    expect(chooseRival([1, 2, 3], 0, 3, 0)).toEqual([3, 2, 1]);
  });

  it("ignores picking the hero", () => {
    expect(chooseRival([1, 2, 3], 0, 0, 0)).toEqual([1, 2, 3]);
  });

  it("trades places when the new hero was a rival", () => {
    // Hero Pip (0) with rivals Bounce, Glimmer, Wisp; switch hero to Glimmer.
    expect(reconcileRivals([1, 2, 7], 2, 0, 3, N)).toEqual([1, 0, 7]);
  });

  it("keeps the lineup when the new hero was not a rival", () => {
    expect(reconcileRivals([1, 2, 7], 5, 0, 3, N)).toEqual([1, 2, 7]);
  });

  it("repairs duplicates and bad indices", () => {
    const r = reconcileRivals([4, 4, 99], 0, null, 3, N);
    expect(valid(r, 0)).toBe(true);
    expect(r[0]).toBe(4);
  });

  it("stays valid through any sequence of hero changes and picks", () => {
    let hero = 0;
    let rivals = defaultRivals(hero, 3, N);
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let step = 0; step < 500; step++) {
      if (rnd(2) === 0) {
        const prev = hero;
        hero = rnd(N);
        rivals = reconcileRivals(rivals, hero, prev, 3, N);
      } else {
        rivals = chooseRival(rivals, rnd(3), rnd(N), hero);
      }
      expect(valid(rivals, hero)).toBe(true);
    }
  });
});
