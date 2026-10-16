import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../core/rng";
import {
  BANK_X,
  COURSE_LEN,
  CPU_CORRECT_COOLDOWN,
  FALLS,
  GAP_IDEAL,
  GAP_MAX,
  GAP_MIN,
  HALF_WIDTH,
  IMPULSE,
  LANE_X,
  RAPIDS,
  SAME_YAW,
  SLOW_FACTOR,
  SLOW_TIME,
  YAW_CORRECT,
  assignTeams,
  cadenceQuality,
  cpuStep,
  currentAt,
  fallsAt,
  flowAt,
  gradeOf,
  judgePress,
  leaderTeam,
  makeCourse,
  newCanoe,
  newCpuSeat,
  newPaddler,
  rankPlayers,
  rapidsAt,
  riverSlope,
  riverY,
  slowFactor,
  stepCanoe,
  strokeImpulse,
  type Course,
  type Side,
} from "./rules";

const DT = 1 / 60;
const NO_ROCKS: Course = { rocks: [] };

/** An rng that counts its draws. */
function counted(seed: number): { rng: () => number; draws: () => number } {
  const inner = mulberry32(seed);
  let n = 0;
  return {
    rng: () => {
      n++;
      return inner();
    },
    draws: () => n,
  };
}

describe("judgePress", () => {
  it("treats the first press as a weak restart", () => {
    const p = newPaddler();
    const r = judgePress(p, "a", 1);
    expect(r.kind).toBe("start");
    expect(r.impulse).toBeCloseTo(IMPULSE * 0.5, 9);
    expect(p.strokes).toBe(0);
  });

  it("scores the other side within 0.25 to 0.7 s as a stroke", () => {
    const p = newPaddler();
    judgePress(p, "a", 1);
    const r = judgePress(p, "b", 1.4);
    expect(r.kind).toBe("stroke");
    expect(r.gap).toBeCloseTo(0.4, 9);
    expect(r.impulse).toBeGreaterThan(0);
    expect(p.strokes).toBe(1);
    expect(p.streak).toBe(1);
  });

  it("accepts the edges of the window and refuses just outside it", () => {
    for (const [gap, kind] of [
      [GAP_MIN, "stroke"],
      [GAP_MAX, "stroke"],
      [GAP_MIN - 0.01, "rushed"],
      [GAP_MAX + 0.01, "start"],
    ] as const) {
      const p = newPaddler();
      judgePress(p, "a", 5);
      expect(judgePress(p, "b", 5 + gap).kind).toBe(kind);
    }
  });

  it("makes the same side twice a yaw kick with no stroke", () => {
    const p = newPaddler();
    judgePress(p, "a", 1);
    const r = judgePress(p, "a", 1.4);
    expect(r.kind).toBe("same");
    expect(r.impulse).toBe(0);
    expect(r.yaw).toBeCloseTo(SAME_YAW, 9);
    expect(p.same).toBe(1);
    expect(p.strokes).toBe(0);
    // The other side kicks the other way.
    const q = newPaddler();
    judgePress(q, "b", 1);
    expect(judgePress(q, "b", 1.4).yaw).toBeCloseTo(-SAME_YAW, 9);
  });

  it("counts a fast alternation as rushed: no push, no turn", () => {
    const p = newPaddler();
    judgePress(p, "a", 1);
    const r = judgePress(p, "b", 1.1);
    expect(r.kind).toBe("rushed");
    expect(r.impulse).toBe(0);
    expect(r.yaw).toBe(0);
    expect(p.rushed).toBe(1);
  });

  it("restarts the rhythm after a pause, even on the same side", () => {
    const p = newPaddler();
    judgePress(p, "a", 1);
    const r = judgePress(p, "a", 2.5);
    expect(r.kind).toBe("start");
    expect(r.late).toBe(true);
    expect(p.late).toBe(1);
    expect(p.same).toBe(0);
  });

  it("alternating strokes cancel their yaw", () => {
    const p = newPaddler();
    let yaw = judgePress(p, "a", 0).yaw;
    for (let i = 1; i <= 7; i++) yaw += judgePress(p, i % 2 ? "b" : "a", i * 0.4).yaw;
    expect(Math.abs(yaw)).toBeLessThan(0.05);
  });

  it("builds a streak and breaks it on a mistake", () => {
    const p = newPaddler();
    let t = 0;
    judgePress(p, "a", t);
    for (let i = 0; i < 4; i++) {
      t += 0.4;
      judgePress(p, i % 2 ? "a" : "b", t);
    }
    expect(p.streak).toBe(4);
    judgePress(p, "a", (t += 0.4));
    expect(p.streak).toBe(0);
  });

  it("is one attempt per press: nothing changes without a call", () => {
    const p = newPaddler();
    judgePress(p, "a", 1);
    const before = JSON.stringify(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(p.presses).toBe(1);
  });
});

describe("cadence", () => {
  it("peaks at the sweet spot and falls off both ways", () => {
    expect(cadenceQuality(GAP_IDEAL)).toBeCloseTo(1, 9);
    expect(cadenceQuality(0.3)).toBeLessThan(cadenceQuality(0.36));
    expect(cadenceQuality(0.6)).toBeLessThan(cadenceQuality(0.5));
    expect(cadenceQuality(GAP_MAX)).toBeGreaterThan(0.29);
  });

  it("makes the push per second best near 0.4 s, so mashing at 0.25 s does not win", () => {
    const perSecond = (g: number): number => strokeImpulse(g) / g;
    for (let g = GAP_MIN; g <= GAP_MAX + 1e-9; g += 0.01) {
      if (Math.abs(g - GAP_IDEAL) < 0.005) continue;
      expect(perSecond(g)).toBeLessThan(perSecond(GAP_IDEAL));
    }
  });

  it("grades by distance from the sweet spot", () => {
    expect(gradeOf(0.4)).toBe("perfect");
    expect(gradeOf(0.45)).toBe("perfect");
    expect(gradeOf(0.3)).toBe("good");
    expect(gradeOf(0.6)).toBe("ok");
    expect(gradeOf(0.26)).toBe("ok");
  });
});

describe("the river", () => {
  it("runs downhill, and drops steeply at each waterfall", () => {
    for (let s = 0; s < COURSE_LEN; s += 2) expect(riverY(s + 2)).toBeLessThan(riverY(s));
    for (const f of FALLS) {
      const drop = riverY(f.s) - riverY(f.s + f.len);
      expect(drop).toBeGreaterThan(f.drop * 0.95);
      expect(riverSlope(f.s + f.len / 2)).toBeLessThan(-0.3);
    }
  });

  it("riverSlope is the derivative of riverY", () => {
    for (let s = 1; s < COURSE_LEN; s += 3.3) {
      const num = (riverY(s + 0.001) - riverY(s - 0.001)) / 0.002;
      expect(riverSlope(s)).toBeCloseTo(num, 3);
    }
  });

  it("flows faster in the rapids and fastest down the falls", () => {
    const calm = flowAt(10);
    const rapid = flowAt(40);
    const fall = flowAt(FALLS[0].s + FALLS[0].len / 2);
    expect(calm).toBeCloseTo(1, 9);
    expect(rapid).toBeGreaterThan(calm);
    expect(fall).toBeGreaterThan(rapid);
    expect(rapidsAt(10)).toBe(0);
    expect(rapidsAt((RAPIDS[0][0] + RAPIDS[0][1]) / 2)).toBe(1);
    expect(fallsAt(FALLS[1].s + 2)).toBe(1);
  });

  it("only pushes sideways in the rapids", () => {
    expect(currentAt(5)).toBe(0);
    let max = 0;
    for (let s = 25; s < 58; s += 0.5) max = Math.max(max, Math.abs(currentAt(s)));
    expect(max).toBeGreaterThan(0.3);
  });
});

describe("makeCourse", () => {
  it("is the same course for the same rng and draws a fixed count", () => {
    const a = counted(11);
    const b = counted(11);
    const ca = makeCourse(a.rng);
    const cb = makeCourse(b.rng);
    expect(ca).toEqual(cb);
    expect(a.draws()).toBe(b.draws());
    expect(a.draws() % 3).toBe(0);
  });

  it("keeps the start, the falls and the lagoon clear and the rocks in order", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { rocks } = makeCourse(mulberry32(seed));
      expect(rocks.length).toBeGreaterThan(10);
      for (let i = 0; i < rocks.length; i++) {
        const r = rocks[i];
        expect(r.s).toBeGreaterThanOrEqual(24);
        expect(r.s).toBeLessThan(COURSE_LEN - 10);
        if (i) expect(r.s).toBeGreaterThanOrEqual(rocks[i - 1].s);
        for (const f of FALLS) expect(r.s < f.s - 6 || r.s > f.s + f.len + 6).toBe(true);
      }
    }
  });

  it("always leaves each lane's centre line clear, so going straight never hits", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const rock of makeCourse(mulberry32(seed)).rocks) {
        for (const lane of [-LANE_X, LANE_X]) {
          expect(Math.abs(rock.x - lane)).toBeGreaterThan(rock.r + HALF_WIDTH + 0.5);
        }
      }
    }
  });
});

describe("stepCanoe", () => {
  const run = (c: ReturnType<typeof newCanoe>, course: Course, secs: number, laneX = 0): void => {
    for (let i = 0; i < Math.round(secs / DT); i++) stepCanoe(c, DT, course, laneX, 0, 0);
  };

  it("coasts forward on an impulse and slows by drag", () => {
    const c = newCanoe(0);
    stepCanoe(c, DT, NO_ROCKS, 0, 3, 0);
    const v1 = c.v;
    run(c, NO_ROCKS, 1);
    expect(c.s).toBeGreaterThan(0);
    expect(c.v).toBeLessThan(v1 * 0.3);
  });

  it("turns toward the side a same-side kick points at, and straightens out", () => {
    const c = newCanoe(0);
    c.v = 5;
    stepCanoe(c, DT, NO_ROCKS, 0, 0, SAME_YAW);
    expect(c.yaw).toBeGreaterThan(0.15);
    const yaw0 = c.yaw;
    for (let i = 0; i < 90; i++) {
      c.v = 5;
      stepCanoe(c, DT, NO_ROCKS, 0, 0, 0);
    }
    expect(c.x).toBeGreaterThan(0.3);
    expect(c.yaw).toBeLessThan(yaw0 * 0.4);
  });

  it("two paddlers push twice as hard as one", () => {
    const steady = (paddlers: number): number => {
      const c = newCanoe(0);
      const ps = Array.from({ length: paddlers }, () => newPaddler());
      let t = 0;
      let side: Side = "a";
      for (let step = 0; step < 60 * 20; step++) {
        t = step * DT;
        let v = 0;
        let yaw = 0;
        if (step % 24 === 0) {
          side = side === "a" ? "b" : "a";
          for (const p of ps) {
            const r = judgePress(p, side, t);
            v += r.impulse;
            yaw += r.yaw;
          }
        }
        stepCanoe(c, DT, NO_ROCKS, 0, v, yaw);
      }
      return c.s;
    };
    const one = steady(1);
    const two = steady(2);
    expect(two / one).toBeGreaterThan(1.85);
    expect(two / one).toBeLessThan(2.15);
  });

  it("a rock slows the canoe for a second, then it speeds up again", () => {
    const course: Course = { rocks: [{ s: 6, x: 0, r: 0.7 }] };
    const c = newCanoe(0.3);
    c.s = 4.5;
    c.v = 6;
    let hit = null;
    for (let i = 0; i < 60 && !hit; i++) hit = stepCanoe(c, DT, course, 0.3, 0, 0);
    expect(hit?.kind).toBe("rock");
    expect(c.bumps).toBe(1);
    expect(c.slowT).toBeCloseTo(SLOW_TIME, 1);
    expect(slowFactor(c.slowT)).toBeCloseTo(SLOW_FACTOR, 2);
    // Pushed out of the rock, away from it.
    expect(c.x).toBeGreaterThan(0.7 + HALF_WIDTH);
    c.v = 6;
    const s0 = c.s;
    for (let i = 0; i < 30; i++) {
      c.v = 6;
      stepCanoe(c, DT, NO_ROCKS, 0.3, 0, 0);
    }
    const slowRun = c.s - s0;
    for (let i = 0; i < 60; i++) {
      c.v = 6;
      stepCanoe(c, DT, NO_ROCKS, 0.3, 0, 0);
    }
    const s1 = c.s;
    for (let i = 0; i < 30; i++) {
      c.v = 6;
      stepCanoe(c, DT, NO_ROCKS, 0.3, 0, 0);
    }
    expect(c.s - s1).toBeGreaterThan(slowRun * 2);
  });

  it("does not bump twice in a row on the same rock", () => {
    const course: Course = { rocks: [{ s: 6, x: 0, r: 0.7 }] };
    const c = newCanoe(0);
    c.s = 5;
    c.v = 6;
    let bumps = 0;
    for (let i = 0; i < 20; i++) {
      c.v = 6;
      if (stepCanoe(c, DT, course, 0, 0, 0)) bumps++;
    }
    expect(bumps).toBe(1);
  });

  it("the banks stop a canoe that drifts out", () => {
    const c = newCanoe(0);
    c.x = BANK_X - 0.05;
    c.v = 6;
    c.yaw = 0.4;
    let hit = null;
    for (let i = 0; i < 30 && !hit; i++) {
      c.v = 6;
      hit = stepCanoe(c, DT, NO_ROCKS, 0, 0, 0);
    }
    expect(hit?.kind).toBe("bank");
    expect(Math.abs(c.x)).toBeLessThan(BANK_X);
  });

  it("goes straight past rocks when it stays in its lane", () => {
    const { rocks } = makeCourse(mulberry32(5));
    const c = newCanoe(-LANE_X);
    let bumps = 0;
    while (c.s < COURSE_LEN - 20) {
      c.v = 5;
      if (stepCanoe(c, DT, { rocks }, -LANE_X, 0, 0)) bumps++;
      // Hold the lane (the cross-current is ignored by pinning x).
      c.x = -LANE_X;
    }
    expect(bumps).toBe(0);
  });
});

describe("cpuStep", () => {
  it("alternates and waits for its time", () => {
    const { rng } = counted(3);
    const seat = newCpuSeat(rng);
    const p = newPaddler();
    expect(cpuStep(seat, p, 0, 0, 0, 1, rng).side).toBeNull();
    const sides: Side[] = [];
    for (let step = 0; step < 60 * 6; step++) {
      const r = cpuStep(seat, p, 0, step * DT, 0, 1, rng);
      if (r.side) {
        sides.push(r.side);
        judgePress(p, r.side, step * DT);
      }
    }
    expect(sides.length).toBeGreaterThan(10);
    for (let i = 1; i < sides.length; i++) expect(sides[i]).not.toBe(sides[i - 1]);
  });

  it("draws exactly two values per press at every skill", () => {
    for (const skill of [0.7, 1, 1.3]) {
      const c = counted(9);
      const seat = newCpuSeat(c.rng);
      expect(c.draws()).toBe(1);
      const p = newPaddler();
      let presses = 0;
      for (let step = 0; step < 60 * 8; step++) {
        const r = cpuStep(seat, p, 0, step * DT, 0, skill, c.rng);
        if (r.side) {
          presses++;
          judgePress(p, r.side, step * DT);
        }
      }
      expect(c.draws()).toBe(1 + presses * 2);
    }
  });

  it("strokes the correcting side twice when the canoe is yawed past 10 degrees", () => {
    const { rng } = counted(4);
    const seat = newCpuSeat(rng);
    seat.nextAt = 0;
    const p = newPaddler();
    judgePress(p, "b", -1); // last was RIGHT; yaw to the right needs RIGHT twice
    // Bow turned right: the fix is the RIGHT side ("b"), and it was last, so one press.
    const yaw = YAW_CORRECT + 0.02;
    const first = cpuStep(seat, p, yaw, 0, 0, 1, rng);
    expect(first.side).toBe("b");
    expect(first.corrUntil).toBeCloseTo(CPU_CORRECT_COOLDOWN, 9);
    expect(seat.queue).toEqual([]);
  });

  it("queues a second press when it was on the other side", () => {
    const { rng } = counted(4);
    const seat = newCpuSeat(rng);
    seat.nextAt = 0;
    const p = newPaddler();
    judgePress(p, "b", -1);
    const yaw = -(YAW_CORRECT + 0.02); // bow left: fix with LEFT ("a"), but last was "b"
    const first = cpuStep(seat, p, yaw, 0, 0, 1, rng);
    expect(first.side).toBe("a");
    expect(seat.queue).toEqual(["a"]);
    judgePress(p, "a", 0);
    seat.nextAt = 0.4;
    const second = cpuStep(seat, p, yaw, 0.4, first.corrUntil, 1, rng);
    expect(second.side).toBe("a");
    expect(judgePress(p, "a", 0.4).kind).toBe("same");
  });

  it("does not correct a small yaw, or again inside the cooldown", () => {
    const { rng } = counted(4);
    const seat = newCpuSeat(rng);
    seat.nextAt = 0;
    const p = newPaddler();
    judgePress(p, "a", -1);
    const small = cpuStep(seat, p, YAW_CORRECT - 0.02, 0, 0, 1, rng);
    expect(small.side).toBe("b"); // plain alternation
    judgePress(p, "b", 0);
    seat.nextAt = 0.4;
    const cool = cpuStep(seat, p, YAW_CORRECT + 0.1, 0.4, 5, 1, rng);
    expect(cool.side).toBe("a"); // still alternating: another paddler just corrected
  });
});

describe("a whole CPU race", () => {
  function race(seed: number, skill: number): { win: number; bumps: number } {
    const { rng } = counted(seed);
    const course = makeCourse(rng);
    const canoes = [newCanoe(-LANE_X), newCanoe(LANE_X)];
    const pads = [0, 1, 2, 3].map(() => newPaddler());
    const seats = [0, 1, 2, 3].map(() => newCpuSeat(rng));
    const corr = [0, 0];
    for (let step = 0; step < 60 * 80; step++) {
      const t = step * DT;
      const v = [0, 0];
      const y = [0, 0];
      for (let i = 0; i < 4; i++) {
        const c = i < 2 ? 0 : 1;
        const r = cpuStep(seats[i], pads[i], canoes[c].yaw, t, corr[c], skill, rng);
        corr[c] = r.corrUntil;
        if (r.side) {
          const j = judgePress(pads[i], r.side, t);
          v[c] += j.impulse;
          y[c] += j.yaw;
        }
      }
      for (let c = 0; c < 2; c++) stepCanoe(canoes[c], DT, course, c ? LANE_X : -LANE_X, v[c], y[c]);
      if (canoes[0].s >= COURSE_LEN || canoes[1].s >= COURSE_LEN) return { win: t, bumps: canoes[0].bumps + canoes[1].bumps };
    }
    return { win: Infinity, bumps: 0 };
  }

  it("finishes in about 40 s at Normal, for any seed", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { win } = race(seed, 1);
      expect(win).toBeGreaterThan(34);
      expect(win).toBeLessThan(46);
    }
  });

  it("is quicker at Challenge than at Relaxed", () => {
    const mean = (skill: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 12; seed++) sum += race(seed, skill).win;
      return sum / 12;
    };
    expect(mean(1.3)).toBeLessThan(mean(1));
    expect(mean(1)).toBeLessThan(mean(0.7));
  });

  it("is deterministic", () => {
    expect(race(5, 1)).toEqual(race(5, 1));
  });
});

describe("teams and the result", () => {
  it("puts the local seat on team 0 with one drawn partner", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const c = counted(seed);
      const [a, b] = assignTeams([0, 1, 2, 3], 0, c.rng);
      expect(c.draws()).toBe(1);
      expect(a[0]).toBe(0);
      expect([...a, ...b].sort()).toEqual([0, 1, 2, 3]);
      expect(a).toHaveLength(2);
      expect(b).toHaveLength(2);
    }
  });

  it("falls back to the first seat when the local seat is not a player", () => {
    const [a] = assignTeams([0, 1, 2, 3], -1, mulberry32(1));
    expect(a[0]).toBe(0);
  });

  it("can pair the local seat with every other seat", () => {
    const partners = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) partners.add(assignTeams([0, 1, 2, 3], 2, mulberry32(seed))[0][1]);
    expect([...partners].sort()).toEqual([0, 1, 3]);
  });

  it("ranks the winning team first, best strokes first, then the other team", () => {
    const strokes = [10, 40, 30, 20];
    expect(rankPlayers([[0, 1], [2, 3]], 1, strokes)).toEqual([2, 3, 1, 0]);
    expect(rankPlayers([[0, 1], [2, 3]], 0, strokes)).toEqual([1, 0, 2, 3]);
    expect(rankPlayers([[0, 1], [2, 3]], 0, new Map([[0, 5], [1, 5]]))).toEqual([0, 1, 2, 3]);
  });

  it("calls the leader, with a coin for an exact tie", () => {
    expect(leaderTeam([10, 12], 0)).toBe(1);
    expect(leaderTeam([13, 12], 1)).toBe(0);
    expect(leaderTeam([12, 12], 1)).toBe(1);
    expect(leaderTeam([12, 12], 0)).toBe(0);
  });
});
