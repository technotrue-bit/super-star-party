import { describe, expect, it } from "vitest";
import { StepClock } from "./clock";
import type { PlannedStep, StepClockOpts } from "./clock";

/** One 16th at 120 BPM. */
const STEP = 0.125;
/** One 16th at 127.2 BPM. */
const STEP_127 = 60 / 127.2 / 4;

/** The simulated audio time of the plan() call in progress; anchors read it as audioNow(). */
let simNow = 0;
/** The `now` of the plan() call that returned each collected step. */
const plannedAt = new WeakMap<PlannedStep, number>();

/** Call plan(now) for now = from, from + dt, ..., to and concatenate the steps. */
function collect(clock: StepClock, from: number, to: number, dt = 0.025): PlannedStep[] {
  const out: PlannedStep[] = [];
  const n = Math.round((to - from) / dt);
  for (let i = 0; i <= n; i++) {
    simNow = from + i * dt;
    for (const s of clock.plan(simNow)) {
      plannedAt.set(s, simNow);
      out.push(s);
    }
  }
  return out;
}

/** No step starts before the plan() call that returned it, and t never goes backwards. */
function expectNoPastInOrder(steps: PlannedStep[]): void {
  steps.forEach((s, i) => {
    expect(s.t).toBeGreaterThanOrEqual(plannedAt.get(s) as number);
    if (i > 0) expect(s.t).toBeGreaterThanOrEqual(steps[i - 1].t);
  });
}

/**
 * An anchored start like Drum Solo's: pickup from step 8 at t0 0, so main bar k lies on the
 * grid at 1.0 + 2k. The game clock runs at 1x and reads audio time plus `ahead(audio time)`.
 */
function anchoredClock(ahead: (a: number) => number, over: Partial<StepClockOpts> = {}): StepClock {
  const clock = make({ pickupStartStep: 8, ...over });
  clock.setAnchor({ beat0: 1.0, barSec: 2.0, speed: 1, audioNow: () => simNow, gameNow: () => simNow + ahead(simNow) });
  return clock;
}

function mainStep(steps: PlannedStep[], step: number, bar: number): PlannedStep | undefined {
  return steps.find((s) => !s.pickup && s.step === step && s.bar === bar);
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

  it("an anchor after a 2 s gap skips whole bars, never planning in the past", () => {
    const clock = anchoredClock(() => 0, { hasFill: true }); // the game clock kept running through the gap
    const before = collect(clock, 0, 1.0); // the pickup and main step 0 (t 1.0)
    clock.queueChange({ transpose: 1, fill: true }); // its fill bar (bar 1) will be skipped
    const steps = [...before, ...collect(clock, 3.5, 3.5), ...collect(clock, 3.525, 9)];
    expectNoPastInOrder(steps);
    const main = steps.filter((s) => !s.pickup);
    // The resync resumes bar 0 at step 1 (t 3.53); steps 2-15 follow, up to t 5.28.
    expect(main.slice(0, 16).map((s) => s.step)).toEqual([...Array(16).keys()]);
    expect(main[1].t).toBeCloseTo(3.53, 12);
    for (const s of main.slice(0, 16)) expect(s).toMatchObject({ bar: 0, transpose: 0, fill: false });
    // Bars 1 and 2 (grid 3.0 and 5.0) are behind plan(5.175)'s now and are skipped whole;
    // bar 3 starts on its grid time 7.0 with the change applied and its fill dropped.
    expect(main[16]).toMatchObject({ step: 48, bar: 3, transpose: 1, fill: false });
    expect(main[16].t).toBeCloseTo(7.0, 9);
    expect(steps.some((s) => s.bar === 1 || s.bar === 2 || s.fill)).toBe(false);
    const times = clock.barTimes();
    expect(times).toHaveLength(3); // bar lines 0, 3 and 4: skipped bars leave no trace
    expect(times[0]).toBe(1.0);
    expect(times[1]).toBeCloseTo(7.0, 9);
    expect(times[2]).toBeCloseTo(9.0, 9);
  });

  it("an anchor that moves a bar earlier starts it at the target, never before the previous step", () => {
    // The game clock jumps ahead at audio 4. Bar line 2 (grid 5.0) is first looked at by
    // plan(4.775), just after main step 31 (t 4.875) was returned.
    for (const [ahead, start] of [
      [0.1, 4.9], // target 4.9 is after the previous step: the bar starts at the target
      [0.15, 4.875], // target 4.85 is before the previous step: the bar starts with it
    ]) {
      const steps = collect(anchoredClock((a) => (a < 4 ? 0 : ahead)), 0, 7);
      expectNoPastInOrder(steps);
      expect(mainStep(steps, 31, 1)?.t).toBe(4.875);
      expect(mainStep(steps, 32, 2)?.t).toBeCloseTo(start, 9);
      expect(mainStep(steps, 33, 2)?.t).toBeCloseTo(start + STEP, 9); // the bar's steps follow its new start
    }
  });

  it("an anchored bar 0 just after the first plan() call is planned at its target, not skipped", () => {
    const clock = make(); // no pickup; the clock's own bar 0 would be at t0 0
    clock.setAnchor({ beat0: 0.01, barSec: 2.0, speed: 1, audioNow: () => simNow, gameNow: () => simNow });
    const steps = collect(clock, 0, 1.0);
    expectNoPastInOrder(steps);
    expect(steps[0]).toMatchObject({ step: 0, bar: 0, pickup: false });
    expect(steps[0].t).toBeCloseTo(0.01, 12);
    steps.forEach((s, i) => expect(s.t).toBeCloseTo(0.01 + i * STEP, 12));
    expect(clock.barTimes()).toHaveLength(1);
    expect(clock.barTimes()[0]).toBeCloseTo(0.01, 12);
  });

  it("a non-looping anchored clock ends when it skips past its last bar", () => {
    const clock = anchoredClock(() => 0, { totalSteps: 32, loop: false });
    const steps = [...collect(clock, 0, 1.0), ...collect(clock, 3.5, 3.5), ...collect(clock, 3.525, 6)];
    expectNoPastInOrder(steps);
    // Bar 0 resumes after the gap; bar 1 (grid 3.0) is behind plan(5.175)'s now, and it is the last.
    expect(steps.filter((s) => !s.pickup).map((s) => s.step)).toEqual([...Array(16).keys()]);
    expect(clock.ended).toBe(true);
    expect(clock.plan(6.025)).toEqual([]);
  });

  it("rejects a tempo or a length that would make plan() loop forever", () => {
    for (const bpm of [0, -120, NaN, Infinity]) expect(() => make({ bpm }), `bpm ${bpm}`).toThrow(RangeError);
    for (const totalSteps of [0, -16, NaN, 8.5]) expect(() => make({ totalSteps }), `totalSteps ${totalSteps}`).toThrow(RangeError);
    const clock = make();
    for (const bpm of [0, -60, NaN]) expect(() => clock.queueChange({ bpm }), `queued bpm ${bpm}`).toThrow(RangeError);
    expect(clock.bpm).toBe(120);
  });

  it("ignores an anchor whose target is not a finite time, and keeps the free-running grid", () => {
    for (const loop of [false, true]) {
      const free = collect(make({ pickupStartStep: 8, totalSteps: 32, loop }), 0, 6);
      for (const game of [NaN, -Infinity, Infinity]) {
        const clock = make({ pickupStartStep: 8, totalSteps: 32, loop });
        clock.setAnchor({ beat0: 1.0, barSec: 2.0, speed: 1, audioNow: () => simNow, gameNow: () => game });
        const steps = collect(clock, 0, 6);
        expect(steps.map((s) => s.t), `loop ${loop}, game time ${game}`).toEqual(free.map((s) => s.t));
      }
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
