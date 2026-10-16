import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../core/rng";
import {
  ANGLE_GAIN,
  COUNTER_END,
  CPU_PERIOD,
  CPU_PLAN_DRAWS,
  DIST_MAX,
  DIST_MIN,
  FLAVOR_COUNT,
  MAX_SWIPE_ANGLE,
  RAIL_MARGIN,
  SEATS,
  STREAM_LENGTH,
  bakeFlavor,
  counterHalfWidth,
  fateOf,
  judge,
  makeStreams,
  planCpuThrow,
  pathAt,
  pointAlong,
  powerForDistance,
  rankPlayers,
  seatAt,
  slideDistance,
  slidePosition,
  slideTime,
  swipeToThrow,
  timeAtDistance,
} from "./rules";

describe("swipeToThrow", () => {
  it("throws straight up the counter for an upward swipe", () => {
    const t = swipeToThrow(0, -1, 0.6);
    expect(t).not.toBeNull();
    expect(t?.angle).toBeCloseTo(0, 9);
    expect(t?.power).toBeCloseTo(0.6, 9);
  });

  it("leans with the swipe, at the angle gain", () => {
    const right = swipeToThrow(Math.sin(0.4), -Math.cos(0.4), 0.5);
    expect(right?.angle).toBeCloseTo(0.4 * ANGLE_GAIN, 9);
    const left = swipeToThrow(-Math.sin(0.4), -Math.cos(0.4), 0.5);
    expect(left?.angle).toBeCloseTo(-0.4 * ANGLE_GAIN, 9);
  });

  it("clamps a wide swipe, and a lone Left or Right arrow throws as wide as it may", () => {
    expect(swipeToThrow(1, 0, 0.5)?.angle).toBeCloseTo(MAX_SWIPE_ANGLE * ANGLE_GAIN, 9);
    expect(swipeToThrow(-1, 0, 0.5)?.angle).toBeCloseTo(-MAX_SWIPE_ANGLE * ANGLE_GAIN, 9);
    expect(swipeToThrow(Math.sin(1.2), -Math.cos(1.2), 0.5)?.angle).toBeCloseTo(MAX_SWIPE_ANGLE * ANGLE_GAIN, 9);
  });

  it("ignores a swipe down the screen, and one with no direction", () => {
    expect(swipeToThrow(0, 1, 0.8)).toBeNull();
    expect(swipeToThrow(0.5, 0.86, 0.8)).toBeNull();
    expect(swipeToThrow(0, 0, 0.8)).toBeNull();
    expect(swipeToThrow(Number.NaN, -1, 0.8)).toBeNull();
  });

  it("clamps the power", () => {
    expect(swipeToThrow(0, -1, 3)?.power).toBe(1);
    expect(swipeToThrow(0, -1, -2)?.power).toBe(0);
  });
});

describe("the slide", () => {
  it("maps power to distance and back", () => {
    expect(slideDistance(0)).toBe(DIST_MIN);
    expect(slideDistance(1)).toBe(DIST_MAX);
    for (const p of [0, 0.3, 0.5, 1]) expect(powerForDistance(slideDistance(p))).toBeCloseTo(p, 9);
  });

  it("decelerates to a stop exactly at the distance", () => {
    for (const dist of [2, 5.8, 9.6]) {
      const T = slideTime(dist);
      expect(slidePosition(dist, 0)).toBe(0);
      expect(slidePosition(dist, T)).toBeCloseTo(dist, 9);
      expect(slidePosition(dist, T + 5)).toBeCloseTo(dist, 9);
      // Fast at first, slowing down: the first half-second covers more than the last.
      const first = slidePosition(dist, T * 0.25) - slidePosition(dist, 0);
      const last = slidePosition(dist, T) - slidePosition(dist, T * 0.75);
      expect(first).toBeGreaterThan(last);
    }
  });
});

describe("timing along the slide", () => {
  it("inverts the slide position", () => {
    for (const dist of [3, 6, 9.6]) {
      expect(timeAtDistance(dist, 0)).toBe(0);
      expect(timeAtDistance(dist, dist)).toBeCloseTo(slideTime(dist), 9);
      for (const s of [0.5, 1.7, dist * 0.8]) expect(slidePosition(dist, timeAtDistance(dist, s))).toBeCloseTo(s, 9);
    }
  });
});

describe("where a pie ends up", () => {
  it("stops where the swipe said when it stays on the counter", () => {
    const f = fateOf(0, 5);
    expect(f.kind).toBe("rest");
    if (f.kind === "rest") {
      expect(f.x).toBeCloseTo(0, 9);
      expect(f.z).toBeCloseTo(-5, 9);
    }
  });

  it("falls off the far end when it slides too far", () => {
    const f = fateOf(0, COUNTER_END + 0.5);
    expect(f.kind).toBe("off");
    if (f.kind === "off") expect(f.at).toBeCloseTo(COUNTER_END, 6);
    expect(fateOf(0, COUNTER_END - 0.2).kind).toBe("rest");
    // A slanted slide reaches the end sooner along its own length.
    expect(fateOf(0.3, COUNTER_END).kind).toBe("rest");
    const slanted = fateOf(0.3, COUNTER_END + 0.5);
    expect(slanted.kind).toBe("off");
    if (slanted.kind === "off") expect(slanted.at).toBeCloseTo(COUNTER_END / Math.cos(0.3), 6);
  });

  it("keeps a wide pie on the counter, sliding along the rail", () => {
    const f = fateOf(0.35, 5);
    expect(f.kind).toBe("rest");
    if (f.kind === "rest") {
      expect(f.rail).toBe(true);
      expect(f.x).toBeCloseTo(counterHalfWidth(f.z) - RAIL_MARGIN, 9);
    }
    const g = fateOf(-0.35, 5);
    if (g.kind === "rest") expect(g.x).toBeLessThan(0);
    expect(pathAt(0.1, 4).rail).toBe(false);
    for (let s = 0; s <= 8; s += 0.5) {
      for (const a of [-0.35, 0.35]) {
        const p = pathAt(a, s);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(counterHalfWidth(p.z) - RAIL_MARGIN + 1e-9);
      }
    }
  });

  it("keeps every plate on the counter, reachable from the launch spot", () => {
    for (const seat of SEATS) {
      expect(Math.abs(seat.x)).toBeLessThan(counterHalfWidth(seat.z) - RAIL_MARGIN);
      expect(-seat.z).toBeLessThan(COUNTER_END - 1);
      const angle = Math.atan2(seat.x, -seat.z);
      const dist = Math.hypot(seat.x, seat.z);
      expect(Math.abs(angle) / ANGLE_GAIN).toBeLessThan(MAX_SWIPE_ANGLE);
      expect(dist).toBeGreaterThan(DIST_MIN);
      expect(dist).toBeLessThan(DIST_MAX);
      expect(fateOf(angle, dist).kind).toBe("rest");
    }
  });

  it("finds the customer a pie stops in front of, else none", () => {
    SEATS.forEach((seat, i) => expect(seatAt(seat.x, seat.z)).toBe(i));
    expect(seatAt(0, -2)).toBe(-1);
    expect(seatAt(0, -4)).toBe(-1);
    // Short of a plate by more than the zone, and beside it by more than the zone.
    expect(seatAt(SEATS[0].x, SEATS[0].z + 1.4)).toBe(-1);
    expect(seatAt(SEATS[0].x - 1, SEATS[0].z)).toBe(-1);
  });

  it("leaves a gap between the two front customers", () => {
    expect(seatAt((SEATS[0].x + SEATS[2].x) / 2, SEATS[0].z)).toBe(-1);
  });

  it("serves a perfect throw at every plate", () => {
    SEATS.forEach((seat, i) => {
      const angle = Math.atan2(seat.x, -seat.z);
      const dist = Math.hypot(seat.x, seat.z);
      const end = pointAlong(angle, dist);
      expect(seatAt(end.x, end.z)).toBe(i);
    });
  });
});

describe("judge", () => {
  it("pays +1 for the order, -1 for another pie, 0 for a customer who is eating", () => {
    expect(judge(2, 2)).toBe(1);
    expect(judge(2, 3)).toBe(-1);
    expect(judge(2, null)).toBe(0);
  });
});

describe("orders", () => {
  it("draws a fixed number of values and never repeats a flavor back to back", () => {
    let n = 0;
    const inner = mulberry32(3);
    const streams = makeStreams(() => (n++, inner()));
    expect(n).toBe(STREAM_LENGTH * (SEATS.length + 1));
    expect(streams.orders).toHaveLength(SEATS.length);
    for (const seq of streams.orders) {
      expect(seq).toHaveLength(STREAM_LENGTH);
      for (let k = 0; k < seq.length; k++) {
        expect(seq[k]).toBeGreaterThanOrEqual(0);
        expect(seq[k]).toBeLessThan(FLAVOR_COUNT);
        if (k > 0) expect(seq[k]).not.toBe(seq[k - 1]);
      }
    }
    for (const p of streams.picks) expect(p).toBeLessThan(SEATS.length);
  });

  it("uses every flavor", () => {
    const streams = makeStreams(mulberry32(9));
    const seen = new Set(streams.orders.flat());
    expect(seen.size).toBe(FLAVOR_COUNT);
  });

  it("bakes a pie for a customer who is waiting", () => {
    expect(bakeFlavor([1, 2, 3], 0)).toBe(1);
    expect(bakeFlavor([1, 2, 3], 2)).toBe(3);
    expect(bakeFlavor([null, 2, 3], 0)).toBe(2);
    expect(bakeFlavor([1, null, null], 1)).toBe(1);
    expect(bakeFlavor([null, null, null], 1)).toBe(-1);
  });
});

describe("planCpuThrow", () => {
  const ORDERS = [0, 2, 3];
  const draws = (skill: number): number => {
    let n = 0;
    const inner = mulberry32(5);
    planCpuThrow(() => (n++, inner()), skill, 2, ORDERS);
    return n;
  };

  it("draws the same number of rng values at every skill, and whatever it holds", () => {
    for (const s of [0.7, 1, 1.3]) expect(draws(s)).toBe(CPU_PLAN_DRAWS);
    let n = 0;
    const inner = mulberry32(5);
    planCpuThrow(() => (n++, inner()), 1, 1, ORDERS);
    expect(n).toBe(CPU_PLAN_DRAWS);
  });

  it("feeds the customer who wants the pie it holds", () => {
    // A mistake roll is the only reason to go elsewhere, so most plans pick the right seat.
    const rng = mulberry32(21);
    let right = 0;
    const N = 400;
    for (let k = 0; k < N; k++) if (planCpuThrow(rng, 1, 3, ORDERS).seat === 2) right++;
    expect(right / N).toBeGreaterThan(0.9);
  });

  /** Share of planned throws that land in front of the customer the CPU meant to feed. */
  const hitRate = (skill: number): number => {
    const rng = mulberry32(1234);
    let hit = 0;
    const N = 3000;
    for (let k = 0; k < N; k++) {
      const held = k % 3 === 0 ? 0 : k % 3 === 1 ? 2 : 3;
      const plan = planCpuThrow(rng, skill, held, ORDERS);
      const throwOf = swipeToThrow(plan.swipe.dx, plan.swipe.dy, plan.swipe.power);
      if (!throwOf) continue;
      const dist = slideDistance(throwOf.power);
      const fate = fateOf(throwOf.angle, dist);
      if (fate.kind === "rest" && seatAt(fate.x, fate.z) === plan.seat && ORDERS[plan.seat] === held) hit++;
    }
    return hit / N;
  };

  it("serves more at higher levels, with a sensible Normal hit rate", () => {
    const relaxed = hitRate(0.7);
    const normal = hitRate(1);
    const challenge = hitRate(1.3);
    expect(relaxed).toBeLessThan(normal);
    expect(normal).toBeLessThan(challenge);
    expect(normal).toBeGreaterThan(0.3);
    expect(normal).toBeLessThan(0.7);
    // And a Normal CPU, throwing every CPU_PERIOD, serves a handful in a round.
    const throws = 50 / CPU_PERIOD;
    expect(normal * throws).toBeGreaterThan(9);
    expect(normal * throws).toBeLessThan(24);
  });
});

describe("rankPlayers", () => {
  it("breaks a tie by most served, then fewest wrong, then the coin", () => {
    const t = (id: number, score: number, served: number, wrong: number, coin: number) => ({ id, score, served, wrong, coin });
    expect(rankPlayers([t(0, 10, 12, 2, 0.1), t(1, 10, 10, 0, 0.2), t(2, 12, 12, 0, 0.3), t(3, 10, 12, 2, 0.9)])).toEqual([2, 3, 0, 1]);
    expect(rankPlayers([t(0, 10, 12, 2, 0.4), t(1, 10, 12, 1, 0.1)])).toEqual([1, 0]);
    expect(rankPlayers([t(0, 5, 5, 0, 0.9), t(1, 5, 5, 0, 0.1)])).toEqual([0, 1]);
  });

  it("ranks a negative score last", () => {
    const t = (id: number, score: number) => ({ id, score, served: 0, wrong: 0, coin: 0 });
    expect(rankPlayers([t(0, -2), t(1, 0), t(2, 3), t(3, -1)])).toEqual([2, 1, 3, 0]);
  });
});
