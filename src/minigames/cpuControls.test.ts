import { describe, it, expect } from "vitest";
import { mulberry32 } from "../core/rng";
import { cpuChargeTime, cpuDialRate, cpuDrawPath, cpuSwipe, cpuTwinPeriod } from "./cpuControls";

const SKILLS = [0.7, 1, 1.3] as const;

/** Seeded rng that counts its draws. */
function counting(seed: number) {
  const inner = mulberry32(seed);
  const rng = Object.assign(
    () => {
      rng.draws++;
      return inner();
    },
    { draws: 0 },
  );
  return rng;
}

const PATH: Array<[number, number]> = [
  [0, 0],
  [0.25, 0.1],
  [0.5, 0.5],
  [0.75, 0.9],
  [1, 1],
];

/** Each helper run once with a fresh counting rng; returns the draws consumed. */
const HELPERS: Record<string, { expected: number; run: (skill: number, rng: () => number) => unknown }> = {
  cpuChargeTime: { expected: 2, run: (s, r) => cpuChargeTime(0.8, 1.5, s, r) },
  cpuSwipe: { expected: 4, run: (s, r) => cpuSwipe(0.3, -0.9, 0.7, s, r) },
  cpuDialRate: { expected: 2, run: (s, r) => cpuDialRate(6, s, r) },
  cpuTwinPeriod: { expected: 2, run: (s, r) => cpuTwinPeriod(0.2, s, r) },
  cpuDrawPath: { expected: 2 * PATH.length, run: (s, r) => cpuDrawPath(PATH, s, r) },
};

describe("draw counts match at every skill", () => {
  for (const [name, { expected, run }] of Object.entries(HELPERS)) {
    it(`${name} draws ${expected} at skill 0.7, 1 and 1.3`, () => {
      for (const skill of SKILLS) {
        for (const seed of [1, 7, 12345]) {
          const rng = counting(seed);
          run(skill, rng);
          expect(rng.draws).toBe(expected);
        }
      }
    });
  }

  it("cpuDrawPath draws 2 per point, and none for an empty path", () => {
    const rng = counting(3);
    expect(cpuDrawPath([], 1, rng)).toEqual([]);
    expect(rng.draws).toBe(0);
    const rng2 = counting(3);
    cpuDrawPath(PATH.slice(0, 2), 1.3, rng2);
    expect(rng2.draws).toBe(4);
  });
});

describe("challenge is closer than relaxed", () => {
  const TRIALS = 2000;

  it("cpuChargeTime mean |error| shrinks with skill", () => {
    const target = 0.75;
    const holdMax = 1.5;
    const meanErr = (skill: number) => {
      const rng = mulberry32(42);
      let sum = 0;
      for (let i = 0; i < TRIALS; i++) sum += Math.abs(cpuChargeTime(target, holdMax, skill, rng) - target);
      return sum / TRIALS;
    };
    const [relaxed, normal, challenge] = [meanErr(0.7), meanErr(1), meanErr(1.3)];
    expect(challenge).toBeLessThan(normal);
    expect(normal).toBeLessThan(relaxed);
  });

  it("cpuSwipe angle error shrinks with skill", () => {
    const aimX = 0.6;
    const aimY = 0.8;
    const aim = Math.atan2(aimY, aimX);
    const meanErr = (skill: number) => {
      const rng = mulberry32(99);
      let sum = 0;
      for (let i = 0; i < TRIALS; i++) {
        const s = cpuSwipe(aimX, aimY, 0.6, skill, rng);
        let d = Math.atan2(s.dy, s.dx) - aim;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        sum += Math.abs(d);
      }
      return sum / TRIALS;
    };
    const [relaxed, normal, challenge] = [meanErr(0.7), meanErr(1), meanErr(1.3)];
    expect(challenge).toBeLessThan(normal);
    expect(normal).toBeLessThan(relaxed);
  });
});

describe("same seed, same output", () => {
  for (const [name, { run }] of Object.entries(HELPERS)) {
    it(name, () => {
      for (const skill of SKILLS) {
        expect(run(skill, mulberry32(2024))).toEqual(run(skill, mulberry32(2024)));
      }
    });
  }
});

describe("output sanity", () => {
  it("cpuChargeTime stays within 0..holdMax", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const t = cpuChargeTime(1.4, 1.5, 0.7, rng);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1.5);
    }
  });

  it("cpuSwipe returns a unit direction and a 0..1 power", () => {
    const rng = mulberry32(6);
    for (let i = 0; i < 500; i++) {
      const s = cpuSwipe(-2, 3, 0.95, 0.7, rng);
      expect(Math.hypot(s.dx, s.dy)).toBeCloseTo(1, 9);
      expect(s.power).toBeGreaterThanOrEqual(0);
      expect(s.power).toBeLessThanOrEqual(1);
    }
  });

  it("cpuDialRate centres on ideal * min(1.15, 0.75 + 0.25 * skill)", () => {
    for (const skill of SKILLS) {
      const rng = mulberry32(8);
      let sum = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) sum += cpuDialRate(6, skill, rng);
      expect(sum / n).toBeCloseTo(6 * Math.min(1.15, 0.75 + 0.25 * skill), 1);
    }
  });

  it("cpuTwinPeriod centres on ideal and stays positive", () => {
    const rng = mulberry32(9);
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const p = cpuTwinPeriod(0.2, 0.7, rng);
      expect(p).toBeGreaterThan(0);
      sum += p;
    }
    expect(sum / n).toBeCloseTo(0.2, 1);
  });

  it("cpuDrawPath keeps point count, does not mutate input, and stays near the path", () => {
    const copy = PATH.map((p) => [...p]);
    const out = cpuDrawPath(PATH, 1, mulberry32(10));
    expect(PATH).toEqual(copy);
    expect(out).toHaveLength(PATH.length);
    out.forEach((p, i) => {
      expect(Math.hypot(p[0] - PATH[i][0], p[1] - PATH[i][1])).toBeLessThan(0.15);
    });
  });

  it("never produces NaN or Infinity even when rng returns 0 or just under 1", () => {
    for (const v of [0, 0.999999999]) {
      const r = () => v;
      const flat = [
        cpuChargeTime(0.8, 1.5, 1, r),
        cpuSwipe(1, 0, 0.5, 1, r).dx,
        cpuSwipe(1, 0, 0.5, 1, r).power,
        cpuDialRate(6, 1, r),
        cpuTwinPeriod(0.2, 1, r),
        ...cpuDrawPath(PATH, 1, r).flat(),
      ];
      for (const x of flat) expect(Number.isFinite(x)).toBe(true);
    }
  });
});
