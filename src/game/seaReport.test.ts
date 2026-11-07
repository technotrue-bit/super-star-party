import { describe, expect, it } from "vitest";
import { seaKindFor, seaReport, type SeaKind } from "./seaReport";

const KINDS: SeaKind[] = ["calm", "tailwind", "choppy", "treasure", "dinner"];

describe("Sea Report", () => {
  it("is a pure function of seed and turn", () => {
    for (const seed of [1, 7, 42, 123456789]) {
      for (let turn = 1; turn <= 20; turn++) {
        expect(seaKindFor(seed, turn)).toBe(seaKindFor(seed, turn));
      }
    }
  });

  it("never repeats a condition on consecutive rounds", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (let turn = 2; turn <= 20; turn++) {
        expect(seaKindFor(seed, turn)).not.toBe(seaKindFor(seed, turn - 1));
      }
    }
  });

  it("deals every condition across matches", () => {
    const seen = new Map<SeaKind, number>();
    for (let seed = 0; seed < 400; seed++) {
      for (let turn = 1; turn <= 10; turn++) {
        const k = seaKindFor(seed, turn);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    for (const k of KINDS) expect(seen.get(k) ?? 0).toBeGreaterThan(200);
  });

  it("has display text for every condition", () => {
    for (const k of KINDS) {
      const r = seaReport(k);
      expect(r.kind).toBe(k);
      expect(r.banner.length).toBeGreaterThan(0);
      expect(r.toast.length).toBeGreaterThan(0);
    }
  });
});
