import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../core/rng";
import { DIAL_TURNS_PER_SEC } from "../padKeys";
import {
  CPU_EASE_MUL,
  CPU_IDEAL,
  CPU_SEGMENT,
  CPU_SEGMENT_DRAWS,
  HEAT_RATE,
  TOP_TURNS,
  HEAT_TURNS,
  JAM_RELIEF,
  JAM_TIME,
  TIME_CAP,
  TOP_ANGLE,
  TURN,
  atTop,
  climbOf,
  cpuCrank,
  heatBand,
  makeCoins,
  newCart,
  newCpuBrain,
  rankCarts,
  stepCart,
  type Cart,
} from "./rules";

const DT = 1 / 60;

/** Crank at a steady turns/s for `secs`. Returns the events seen. */
function crankFor(c: Cart, turns: number, secs: number): string[] {
  const ev: string[] = [];
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    const e = stepCart(c, turns * TURN * DT, DT);
    if (e) ev.push(e);
  }
  return ev;
}

describe("the climb", () => {
  it("rises in a straight line with the clockwise angle and caps at the top", () => {
    expect(climbOf(0)).toBe(0);
    expect(climbOf(TOP_ANGLE / 2)).toBeCloseTo(0.5, 12);
    expect(climbOf(TOP_ANGLE * 3)).toBe(1);
    expect(climbOf(-5)).toBe(0);
    expect(atTop({ angle: TOP_ANGLE })).toBe(true);
    expect(atTop({ angle: TOP_ANGLE - 0.01 })).toBe(false);
  });

  it("is the same whether the angle comes in small or large pieces", () => {
    const a = newCart();
    const b = newCart();
    for (let i = 0; i < 120; i++) stepCart(a, 1.5 * TURN * DT, DT);
    for (let i = 0; i < 30; i++) stepCart(b, 1.5 * TURN * DT * 4, DT * 4);
    expect(a.angle).toBeCloseTo(b.angle, 9);
  });

  it("ignores turning back: no progress, no heat, nothing lost", () => {
    const c = newCart();
    crankFor(c, 1, 2);
    const angle = c.angle;
    crankFor(c, -3, 2);
    expect(c.angle).toBeCloseTo(angle, 9);
    expect(c.heat).toBe(0);
    expect(c.back).toBeGreaterThan(0);
    // and forward still works afterwards
    crankFor(c, 1, 1);
    expect(c.angle).toBeGreaterThan(angle + TURN * 0.9);
  });

  it("a cart that never moves stays on the ground", () => {
    const c = newCart();
    for (let i = 0; i < 600; i++) stepCart(c, 0, DT);
    expect(c.angle).toBe(0);
    expect(c.heat).toBe(0);
  });
});

describe("heat", () => {
  it("the line is 2.2 turns per second", () => {
    expect(HEAT_TURNS).toBe(2.2);
    expect(HEAT_RATE).toBeCloseTo(2.2 * TURN, 12);
  });

  it("builds no heat at or under 2.2 turns per second, however long", () => {
    for (const turns of [1, 2, 2.1, 2.2]) {
      const c = newCart();
      const ev = crankFor(c, turns, 30);
      expect(ev).toEqual([]);
      expect(c.heat, `${turns} turns/s`).toBeLessThan(1e-6);
    }
  });

  it("builds heat above 2.2 turns per second, faster the faster you go", () => {
    const heatAfter = (turns: number): number => {
      const c = newCart();
      crankFor(c, turns, 1);
      return c.heat;
    };
    expect(heatAfter(2.5)).toBeGreaterThan(0);
    expect(heatAfter(3)).toBeGreaterThan(heatAfter(2.5));
    expect(heatAfter(4)).toBeGreaterThan(heatAfter(3));
  });

  it("cools when you ease off", () => {
    const c = newCart();
    crankFor(c, 3, 0.9);
    const hot = c.heat;
    expect(hot).toBeGreaterThan(0.3);
    crankFor(c, 1.5, 1);
    expect(c.heat).toBeLessThan(hot);
    crankFor(c, 0, 5);
    expect(c.heat).toBe(0);
  });

  it("one quick flick is not a red line (the speed is a running average)", () => {
    const c = newCart();
    // a 0.1 s burst at 5 turns/s
    crankFor(c, 5, 0.1);
    crankFor(c, 1, 2);
    expect(c.jams).toBe(0);
    expect(c.peak).toBeLessThan(0.15);
  });

  it("a hard mash fills the gauge and jams within about two seconds", () => {
    const c = newCart();
    const ev = crankFor(c, 3, 3);
    expect(ev[0]).toBe("jam");
    expect(c.jams).toBe(1);
    expect(c.peak).toBe(1);
  });

  it("a slight overspeed takes much longer to jam than a hard mash", () => {
    const timeToJam = (turns: number): number => {
      const c = newCart();
      for (let i = 0; i < 60 * 60; i++) if (stepCart(c, turns * TURN * DT, DT) === "jam") return i * DT;
      return Infinity;
    };
    const slow = timeToJam(2.4);
    const fast = timeToJam(3.2);
    expect(fast).toBeLessThan(2);
    expect(slow).toBeGreaterThan(fast * 3);
    expect(Number.isFinite(slow)).toBe(true);
  });
});

describe("the jam", () => {
  function jammed(): Cart {
    const c = newCart();
    for (let i = 0; i < 600; i++) if (stepCart(c, 3.5 * TURN * DT, DT) === "jam") return c;
    throw new Error("never jammed");
  }

  it("holds the chain for 1.5 s and then lets go", () => {
    expect(JAM_TIME).toBe(1.5);
    const c = jammed();
    expect(c.jam).toBeCloseTo(JAM_TIME, 9);
    expect(c.heat).toBe(1);
    expect(heatBand(c)).toBe(3);
    let steps = 0;
    let ev: string | null = null;
    while (c.jam > 0 && steps < 1000) {
      ev = stepCart(c, 0, DT);
      steps++;
    }
    expect(steps * DT).toBeGreaterThan(1.49);
    expect(steps * DT).toBeLessThan(1.52);
    expect(ev).toBe("free");
    expect(c.heat).toBe(JAM_RELIEF);
  });

  it("makes no progress while jammed, however hard you crank", () => {
    const c = jammed();
    const angle = c.angle;
    crankFor(c, 5, 1.4);
    expect(c.angle).toBe(angle);
    expect(c.wasted).toBeGreaterThan(0);
    expect(c.jam).toBeGreaterThan(0);
  });

  it("cools while jammed and resumes from a cooler crank", () => {
    const c = jammed();
    let last = c.heat;
    while (c.jam > 0) {
      stepCart(c, 0, DT);
      expect(c.heat).toBeLessThanOrEqual(last + 1e-12);
      last = c.heat;
    }
    // the fast running average was thrown away with the jam
    expect(c.rate).toBe(0);
    const angle = c.angle;
    crankFor(c, 2, 1);
    expect(c.angle).toBeGreaterThan(angle + TURN * 1.9);
  });

  it("turning back while jammed does not move the cart", () => {
    const c = jammed();
    const angle = c.angle;
    crankFor(c, -2, 1);
    expect(c.angle).toBe(angle);
  });

  it("counts every jam", () => {
    const c = newCart();
    let jams = 0;
    for (let i = 0; i < 60 * 12; i++) if (stepCart(c, 3.5 * TURN * DT, DT) === "jam") jams++;
    expect(jams).toBeGreaterThanOrEqual(3);
    expect(c.jams).toBe(jams);
  });
});

describe("heat bands", () => {
  it("cool, warm, hot, jammed", () => {
    expect(heatBand({ heat: 0.1, jam: 0 })).toBe(0);
    expect(heatBand({ heat: 0.5, jam: 0 })).toBe(1);
    expect(heatBand({ heat: 0.79, jam: 0 })).toBe(1);
    expect(heatBand({ heat: 0.8, jam: 0 })).toBe(2);
    expect(heatBand({ heat: 1, jam: 1 })).toBe(3);
  });
});

describe("ranking", () => {
  it("highest cart first", () => {
    expect(
      rankCarts([
        { id: 0, angle: 10, jams: 0, coin: 0.1 },
        { id: 1, angle: 30, jams: 0, coin: 0.2 },
        { id: 2, angle: 20, jams: 0, coin: 0.3 },
        { id: 3, angle: 5, jams: 0, coin: 0.4 },
      ]),
    ).toEqual([1, 2, 0, 3]);
  });

  it("a tie goes to the fewest jams, then the coin", () => {
    expect(
      rankCarts([
        { id: 0, angle: TOP_ANGLE, jams: 2, coin: 0.9 },
        { id: 1, angle: TOP_ANGLE, jams: 1, coin: 0.1 },
        { id: 2, angle: TOP_ANGLE, jams: 1, coin: 0.8 },
        { id: 3, angle: 1, jams: 0, coin: 0.5 },
      ]),
    ).toEqual([2, 1, 0, 3]);
  });

  it("draws exactly one value per seat for the coins", () => {
    let n = 0;
    const rng = mulberry32(5);
    makeCoins(() => (n++, rng()), 4);
    expect(n).toBe(4);
  });
});

describe("CPU", () => {
  /** A CPU round on its own: steps one seat to the top (or the cap). */
  function run(seed: number, skill: number): { t: number; cart: Cart; draws: number } {
    const rng0 = mulberry32(seed);
    let draws = 0;
    const rng = () => (draws++, rng0());
    const brain = newCpuBrain();
    const cart = newCart();
    let step = 0;
    while (step * DT < TIME_CAP && !atTop(cart)) {
      const rate = cpuCrank(brain, cart, step * DT, skill, rng);
      stepCart(cart, rate * DT, DT);
      step++;
    }
    return { t: step * DT, cart, draws };
  }

  it("draws the same number of values at every skill", () => {
    const counts = [0.7, 1, 1.3].map((skill) => {
      let n = 0;
      const rng0 = mulberry32(3);
      const rng = () => (n++, rng0());
      const brain = newCpuBrain();
      const cart = newCart();
      for (let s = 0; s < 60 * 20; s++) cpuCrank(brain, cart, s * DT, skill, rng);
      return n;
    });
    expect(counts[0]).toBe(counts[1]);
    expect(counts[1]).toBe(counts[2]);
    // a draw triple per segment and none in between
    expect(counts[0] % CPU_SEGMENT_DRAWS).toBe(0);
    expect(counts[0]).toBe(Math.ceil(20 / CPU_SEGMENT) * CPU_SEGMENT_DRAWS);
  });

  it("is the same on a replay of the same seed", () => {
    const a = run(11, 1);
    const b = run(11, 1);
    expect(a.t).toBe(b.t);
    expect(a.cart.angle).toBe(b.cart.angle);
    expect(a.draws).toBe(b.draws);
  });

  it("eases off after the gauge has been past 80% for a moment, and resumes when it is cool", () => {
    const brain = newCpuBrain();
    brain.until = Infinity;
    brain.rate = CPU_IDEAL;
    const rng = () => 0.5;
    const hot = { heat: 0.9, jam: 0 };
    // not yet: it has not noticed
    expect(cpuCrank(brain, hot, 1, 1, rng)).toBeCloseTo(CPU_IDEAL, 9);
    // after the reaction time it slows
    const eased = cpuCrank(brain, hot, 1.3, 1, rng);
    expect(eased).toBeCloseTo(CPU_IDEAL * CPU_EASE_MUL, 9);
    // still eased at 60% heat, back to full at 40%
    expect(cpuCrank(brain, { heat: 0.6, jam: 0 }, 1.4, 1, rng)).toBeCloseTo(CPU_IDEAL * CPU_EASE_MUL, 9);
    expect(cpuCrank(brain, { heat: 0.4, jam: 0 }, 1.5, 1, rng)).toBeCloseTo(CPU_IDEAL, 9);
  });

  it("paces: Normal is the keyboard dial's 1.5 turns/s, Relaxed about 1.3, Challenge about 1.75, all under the heat line", () => {
    const N = 120;
    const pace = (skill: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= N; seed++) {
        const r = run(seed, skill);
        sum += r.cart.angle / TURN / r.t;
      }
      return sum / N;
    };
    const relaxed = pace(0.7);
    const normal = pace(1);
    const challenge = pace(1.3);
    expect(Math.abs(normal - DIAL_TURNS_PER_SEC) / DIAL_TURNS_PER_SEC).toBeLessThan(0.05);
    expect(relaxed).toBeGreaterThan(1.22);
    expect(relaxed).toBeLessThan(1.4);
    expect(challenge).toBeGreaterThan(1.65);
    expect(challenge).toBeLessThan(1.9);
    expect(relaxed).toBeLessThan(normal);
    expect(normal).toBeLessThan(challenge);
    expect(challenge).toBeLessThan(HEAT_TURNS - 0.3);
  });

  it("a CPU is never a mash: Challenge jams under half a time a round", () => {
    let jams = 0;
    const N = 120;
    for (let seed = 1; seed <= N; seed++) jams += run(seed, 1.3).cart.jams;
    expect(jams / N).toBeLessThan(0.5);
  });
});

describe("the race", () => {
  /** One race: a cart cranked at a steady `turns` per second against three CPUs. Returns the cart's place (0 best). */
  function race(seed: number, turns: number, skill: number): number {
    const rng = mulberry32(seed);
    const me = newCart();
    const cpus = [0, 1, 2].map(() => ({ cart: newCart(), brain: newCpuBrain() }));
    let step = 0;
    while (step * DT < TIME_CAP && !atTop(me) && !cpus.some((c) => atTop(c.cart))) {
      const t = step * DT;
      stepCart(me, turns * TURN * DT, DT);
      for (const c of cpus) stepCart(c.cart, cpuCrank(c.brain, c.cart, t, skill, rng) * DT, DT);
      step++;
    }
    return cpus.filter((c) => c.cart.angle > me.angle).length;
  }
  const share = (turns: number, skill: number, ok: (place: number) => boolean): number => {
    let n = 0;
    const N = 100;
    for (let seed = 1; seed <= N; seed++) if (ok(race(seed, turns, skill))) n++;
    return n / N;
  };

  it("a steady 1.5 turns/s (the keyboard) beats Relaxed CPUs in most races", () => {
    expect(share(DIAL_TURNS_PER_SEC, 0.7, (p) => p === 0)).toBeGreaterThan(0.6);
  });

  it("a steady 1.5 turns/s finishes in the top two against Normal CPUs in a fair share of races", () => {
    expect(share(DIAL_TURNS_PER_SEC, 1, (p) => p <= 1)).toBeGreaterThanOrEqual(0.35);
  });

  it("a steady 2.15 turns/s (just under the heat line) wins against Challenge CPUs in most races", () => {
    expect(share(2.15, 1.3, (p) => p === 0)).toBeGreaterThan(0.8);
    // and builds no heat on the way
    const c = newCart();
    crankFor(c, 2.15, 30);
    expect(c.jams).toBe(0);
  });

  it("nobody can top the hill in under 28 s: the heat line caps the pace", () => {
    expect(TOP_TURNS / HEAT_TURNS).toBeGreaterThanOrEqual(28);
    for (let seed = 1; seed <= 60; seed++) {
      for (const skill of [0.7, 1, 1.3]) {
        const rng = mulberry32(seed);
        const brain = newCpuBrain();
        const cart = newCart();
        let step = 0;
        while (step * DT < TIME_CAP && !atTop(cart)) {
          stepCart(cart, cpuCrank(brain, cart, step * DT, skill, rng) * DT, DT);
          step++;
        }
        if (atTop(cart)) expect(step * DT).toBeGreaterThanOrEqual(28);
      }
    }
  });

  it("a keyboard player at 1.5 turns/s tops the hill before the cap", () => {
    expect(TOP_TURNS / DIAL_TURNS_PER_SEC).toBeLessThan(TIME_CAP);
  });

  it("the round, cap included, stays under a minute", () => {
    expect(TIME_CAP).toBeLessThanOrEqual(60 - 3);
  });
});
