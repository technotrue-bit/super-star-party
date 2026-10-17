import { describe, expect, it } from "vitest";
import { StepClock } from "./clock";
import type { PlannedStep, StepClockOpts } from "./clock";

/** One 16th at 120 BPM. */
const STEP = 0.125;
/** One 16th at 127.2 BPM. */
const STEP_127 = 60 / 127.2 / 4;

/** The simulated audio time of the plan() call in progress; anchors read it as audioNow(). */
let simNow = 0;

/** Call plan(now) for now = from, from + dt, ..., to and concatenate the steps. */
function collect(clock: StepClock, from: number, to: number, dt = 0.025): PlannedStep[] {
  const out: PlannedStep[] = [];
  const n = Math.round((to - from) / dt);
  for (let i = 0; i <= n; i++) {
    simNow = from + i * dt;
    out.push(...clock.plan(simNow));
  }
  return out;
}

/** 120 BPM, straight, from t 0, four looping bars (plus any overrides). */
function make(over: Partial<StepClockOpts> = {}): StepClock {
  return new StepClock({ bpm: 120, swing: 0.5, totalSteps: 64, loop: true, t0: 0, ...over });
}

function stepAt(steps: PlannedStep[], t: number): PlannedStep | undefined {
  return steps.find((s) => Math.abs(s.t - t) < 1e-9);
}

describe("StepClock", () => {
  it("plans contiguous steps across a loop wrap", () => {
    const steps = collect(make({ totalSteps: 32 }), 0, 10);
    expect(steps).toHaveLength(81); // t 0 .. 10.0, every step with t < 10 + 0.12
    expect(new Set(steps.map((s) => s.t)).size).toBe(steps.length);
    expect(steps[0].t).toBe(0);
    steps.forEach((s, i) => {
      expect(s.step).toBe(i % 32);
      expect(s.bar).toBe(Math.floor(i / 16));
      if (i > 0) expect(s.t).toBe(steps[i - 1].t + STEP);
    });
  });

  it("a non-looping clock ends after its last step", () => {
    const clock = make({ totalSteps: 16, loop: false });
    const first = collect(clock, 0, 1);
    expect(clock.ended).toBe(false);
    const steps = [...first, ...collect(clock, 1.025, 5)];
    expect(steps).toHaveLength(16);
    expect(steps.map((s) => s.step)).toEqual([...Array(16).keys()]);
    expect(clock.ended).toBe(true);
  });

  it("tempo change lands on the first unplanned bar line", () => {
    const clock = make({ swing: 0.62 });
    const before = collect(clock, 0, 1.3);
    clock.queueChange({ bpm: 127.2 });
    const steps = [...before, ...collect(clock, 1.325, 6)];
    const early = steps.filter((s) => s.t < 2.0 - 1e-9);
    expect(early).toHaveLength(16);
    for (const s of early) {
      expect(s.stepDur).toBe(STEP);
      expect(s.swingOffset).toBeCloseTo((0.62 - 0.5) * 2 * STEP, 12);
    }
    const bar = stepAt(steps, 2.0);
    expect(bar).toMatchObject({ step: 16, bar: 1, stepDur: STEP_127 });
    expect(bar?.swingOffset).toBeCloseTo((0.62 - 0.5) * 2 * STEP_127, 12);
    expect(steps[17].t).toBeCloseTo(2.0 + STEP_127, 12);
    expect(clock.bpm).toBe(127.2);
  });

  it("a change queued inside the lookahead waits a bar", () => {
    const clock = make();
    const before = collect(clock, 0, 1.95);
    expect(stepAt(before, 2.0)).toBeDefined(); // the bar line at 2.0 is already planned
    clock.queueChange({ bpm: 127.2 });
    const steps = [...before, ...collect(clock, 1.975, 8)];
    const early = steps.filter((s) => s.t < 4.0 - 1e-9);
    expect(early).toHaveLength(32);
    for (const s of early) expect(s.stepDur).toBe(STEP);
    expect(stepAt(steps, 4.0)).toMatchObject({ step: 32, bar: 2, stepDur: STEP_127 });
  });

  it("fill plays one bar, then the change", () => {
    const clock = make({ hasFill: true });
    const before = collect(clock, 0, 1.3);
    clock.queueChange({ bpm: 127.2, transpose: 1, lift: true, fill: true });
    const steps = [...before, ...collect(clock, 1.325, 8)];
    for (const s of steps.slice(0, 16)) expect(s.fill).toBe(false);
    steps.slice(16, 32).forEach((s, i) => {
      expect(s).toMatchObject({ step: 16 + i, bar: 1, t: 2.0 + i * STEP });
      expect(s).toMatchObject({ fill: true, transpose: 0, lift: false, stepDur: STEP });
    });
    expect(steps[32]).toMatchObject({ step: 32, bar: 2, t: 4.0 });
    expect(steps[32]).toMatchObject({ fill: false, transpose: 1, lift: true, stepDur: STEP_127 });
    for (const s of steps.slice(33)) {
      expect(s).toMatchObject({ fill: false, transpose: 1, lift: true, stepDur: STEP_127 });
    }
  });

  it("fill without a theme fill applies the change at once", () => {
    const clock = make(); // hasFill defaults to false
    const before = collect(clock, 0, 1.3);
    clock.queueChange({ bpm: 127.2, transpose: 1, lift: true, fill: true });
    const steps = [...before, ...collect(clock, 1.325, 6)];
    for (const s of steps.slice(0, 16)) {
      expect(s).toMatchObject({ fill: false, transpose: 0, lift: false, stepDur: STEP });
    }
    expect(steps[16]).toMatchObject({ step: 16, bar: 1, t: 2.0 });
    expect(steps[16]).toMatchObject({ fill: false, transpose: 1, lift: true, stepDur: STEP_127 });
  });

  it("no backlog after a 2 s gap", () => {
    const clock = make();
    const first = clock.plan(1.0);
    const steps = clock.plan(3.5);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.t).toBeGreaterThanOrEqual(3.53 - 1e-9);
    expect(steps[0].step).toBe(first[first.length - 1].step + 1); // the pattern resumes where it stopped
  });

  it("pickup starts mid-bar so bar 0 lands on beat0", () => {
    const steps = collect(make({ pickupStartStep: 8 }), 0, 3);
    const pickup = steps.filter((s) => s.pickup);
    expect(pickup).toHaveLength(8);
    pickup.forEach((s, i) => expect(s).toMatchObject({ step: 8 + i, bar: -1, t: i * STEP }));
    expect(steps[8]).toMatchObject({ step: 0, bar: 0, t: 1.0, pickup: false });
  });

  it("anchored bar lines follow the game clock after a stall", () => {
    for (const speed of [1, 1.5, 2]) {
      const clock = make({ bpm: 120 * speed, pickupStartStep: 8 });
      clock.setAnchor({
        beat0: 1.0,
        barSec: 2.0,
        speed,
        audioNow: () => simNow,
        gameNow: () => (simNow < 3 ? speed * simNow : speed * (simNow - 0.2)),
      });
      const bars = collect(clock, 0, 12).filter((s) => !s.pickup && s.step % 16 === 0);
      expect(bars.length).toBeGreaterThanOrEqual(6);
      let afterStall = 0;
      for (const s of bars) {
        const grid = (1.0 + 2 * s.bar) / speed;
        // A bar line at exactly 3.0 (speed 1) is planned at 2.9, inside the 0.12 s
        // lookahead and before the stall, so only bar lines after 3 carry the 0.2.
        const ak = grid > 3 ? grid + 0.2 : grid;
        if (grid > 3) afterStall += 1;
        expect(Math.abs(s.t - ak)).toBeLessThanOrEqual(0.005);
      }
      expect(afterStall).toBeGreaterThan(0);
      expect(clock.barTimes()).toEqual(bars.slice(-8).map((s) => s.t)); // recorded after correction
    }
  });

  it("barTimes keeps the last 8 bar lines", () => {
    const clock = make({ totalSteps: 32, pickupStartStep: 8 }); // main bar lines at 1, 3, 5, ...
    expect(clock.barTimes()).toEqual([]);
    collect(clock, 0, 5);
    expect(clock.barTimes()).toEqual([1, 3, 5]);
    collect(clock, 5.025, 20);
    expect(clock.barTimes()).toEqual([5, 7, 9, 11, 13, 15, 17, 19]);
  });
});
