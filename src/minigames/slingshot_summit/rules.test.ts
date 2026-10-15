import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../core/rng";
import {
  CPU_PLAN_DRAWS,
  HOLD_MAX,
  RELOAD,
  ROUND_SECONDS,
  TARGETS,
  WIND_AT,
  chargeForDistance,
  chargeOf,
  flightTime,
  landDistance,
  landPoint,
  planCpuShot,
  rankPlayers,
  ringAt,
  scoreLanding,
  solveShot,
  swayTime,
  targetOffset,
} from "./rules";

const PHASES = [0.4, 2.1, 4.0];

describe("aim and charge", () => {
  it("maps a hold to a distance and back", () => {
    expect(chargeOf(HOLD_MAX)).toBe(1);
    expect(chargeOf(5)).toBe(1);
    expect(chargeOf(-1)).toBe(0);
    for (const c of [0, 0.25, 0.5, 1]) expect(chargeForDistance(landDistance(c))).toBeCloseTo(c, 9);
  });

  it("lands straight ahead at aim 0 and to the side with aim", () => {
    const p = landPoint(0, 0.5);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(-landDistance(0.5), 9);
    expect(landPoint(1, 0.5).x).toBeGreaterThan(0.5);
    expect(landPoint(-1, 0.5).x).toBeLessThan(-0.5);
  });
});

describe("rings", () => {
  const spec = TARGETS[1];
  it("scores 5 in the middle, 3 and 1 further out, 0 outside", () => {
    const cx = targetOffset(spec, PHASES[1], 3);
    const z = -spec.dist;
    expect(ringAt(cx, z, spec, PHASES[1], 3)).toBe(5);
    expect(ringAt(cx + spec.radius * 0.45, z, spec, PHASES[1], 3)).toBe(3);
    expect(ringAt(cx + spec.radius * 0.8, z, spec, PHASES[1], 3)).toBe(1);
    expect(ringAt(cx + spec.radius * 1.1, z, spec, PHASES[1], 3)).toBe(0);
    expect(ringAt(cx, z - spec.radius * 1.2, spec, PHASES[1], 3)).toBe(0);
  });

  it("measures against where the target is when the acorn lands", () => {
    const z = -spec.dist;
    const early = targetOffset(spec, PHASES[1], 3);
    const late = targetOffset(spec, PHASES[1], 3 + 0.6);
    expect(Math.abs(early - late)).toBeGreaterThan(0.2);
    expect(ringAt(early, z, spec, PHASES[1], 3)).toBe(5);
    expect(ringAt(early, z, spec, PHASES[1], 3.6)).toBeLessThan(5);
  });

  it("picks the target an acorn lands on", () => {
    const t = 7;
    const x = targetOffset(TARGETS[2], PHASES[2], t);
    expect(scoreLanding(x, -TARGETS[2].dist, PHASES, t)).toEqual({ ring: 5, target: 2 });
    expect(scoreLanding(0, -1, PHASES, t)).toEqual({ ring: 0, target: -1 });
  });
});

describe("sway clock", () => {
  it("runs at game speed until the wind, then smoothly 30% faster", () => {
    expect(swayTime(10)).toBe(10);
    expect(swayTime(WIND_AT)).toBe(WIND_AT);
    let prev = swayTime(WIND_AT);
    let lastRate = 1;
    for (let t = WIND_AT + 0.05; t <= ROUND_SECONDS + 3; t += 0.05) {
      const now = swayTime(t);
      const rate = (now - prev) / 0.05;
      expect(rate).toBeGreaterThanOrEqual(lastRate - 1e-6);
      expect(rate).toBeLessThan(1.31);
      lastRate = rate;
      prev = now;
    }
    expect(lastRate).toBeCloseTo(1.3, 1);
  });
});

describe("solveShot", () => {
  it("puts a perfect shot in the bullseye of every target at any time", () => {
    for (let i = 0; i < TARGETS.length; i++) {
      for (const release of [1, 6.3, 12, 29.5, 33, 41]) {
        const sol = solveShot(i, PHASES[i], release, 0, 0);
        const p = landPoint(sol.aim, sol.charge);
        expect(ringAt(p.x, p.z, TARGETS[i], PHASES[i], release + flightTime(sol.charge))).toBe(5);
      }
    }
  });
});

describe("planCpuShot", () => {
  const draws = (skill: number): number => {
    let n = 0;
    const inner = mulberry32(5);
    planCpuShot(() => (n++, inner()), skill, PHASES, 4);
    return n;
  };

  it("draws the same number of rng values at every skill", () => {
    for (const s of [0.7, 1, 1.3]) expect(draws(s)).toBe(CPU_PLAN_DRAWS);
  });

  it("releases about 1.4 / skill after the last shot and honours the reload", () => {
    for (const skill of [0.7, 1, 1.3]) {
      const rng = mulberry32(11);
      let after = 2;
      for (let k = 0; k < 40; k++) {
        const plan = planCpuShot(rng, skill, PHASES, after);
        expect(plan.pullStart).toBeGreaterThanOrEqual(after + RELOAD - 1e-9);
        expect(plan.releaseAt).toBeCloseTo(plan.pullStart + plan.holdSec, 9);
        expect(plan.releaseAt - after).toBeGreaterThanOrEqual(1.4 / skill - 1e-9);
        after = plan.releaseAt;
      }
    }
  });

  /** Mean points of one CPU seat over a whole round, over many seeds. */
  const roundPoints = (skill: number, seed: number): { points: number; shots: number } => {
    const rng = mulberry32(seed);
    let after = rng() * 0.8;
    let points = 0;
    let shots = 0;
    for (;;) {
      const plan = planCpuShot(rng, skill, PHASES, after);
      if (plan.releaseAt >= ROUND_SECONDS) break;
      const c = chargeOf(plan.holdSec);
      const p = landPoint(plan.aim, c);
      points += scoreLanding(p.x, p.z, PHASES, plan.releaseAt + flightTime(c)).ring;
      shots++;
      after = plan.releaseAt;
    }
    return { points, shots };
  };
  const mean = (skill: number): { points: number; shots: number } => {
    let points = 0;
    let shots = 0;
    const N = 300;
    for (let s = 1; s <= N; s++) {
      const r = roundPoints(skill, s);
      points += r.points;
      shots += r.shots;
    }
    return { points: points / N, shots: shots / N };
  };

  it("scores more at higher levels, with a sensible Normal round", () => {
    const relaxed = mean(0.7);
    const normal = mean(1);
    const challenge = mean(1.3);
    console.log(`CPU mean per round: relaxed ${relaxed.points.toFixed(1)} (${relaxed.shots.toFixed(1)} shots), normal ${normal.points.toFixed(1)} (${normal.shots.toFixed(1)}), challenge ${challenge.points.toFixed(1)} (${challenge.shots.toFixed(1)})`);
    expect(relaxed.points).toBeLessThan(normal.points);
    expect(normal.points).toBeLessThan(challenge.points);
    expect(normal.points).toBeGreaterThan(35);
    expect(normal.points).toBeLessThan(60);
  });
});

describe("rankPlayers", () => {
  it("breaks a points tie by 5s, then 3s, then the coin", () => {
    const t = (id: number, points: number, fives: number, threes: number, coin: number) => ({ id, points, fives, threes, coin });
    expect(rankPlayers([t(0, 20, 2, 0, 0.1), t(1, 20, 3, 0, 0.2), t(2, 25, 0, 0, 0.3), t(3, 20, 3, 1, 0.4)])).toEqual([2, 3, 1, 0]);
    expect(rankPlayers([t(0, 10, 1, 1, 0.9), t(1, 10, 1, 1, 0.1)])).toEqual([0, 1]);
  });
});
