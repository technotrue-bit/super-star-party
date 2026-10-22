import { afterEach, describe, expect, it, vi } from "vitest";
import { Sequencer, layerTargets, scheduleStep, scheduleTrackInto } from "./sequencer";
import type { LayerBus, TrackSections } from "./sequencer";
import { TRACKS, midiToFreq, noteToMidi, parseSection, parseTrack } from "./tracks";
import type { TrackDef, VoiceDef } from "./tracks";
import type { PlannedStep } from "./clock";
import type { NotePlayer } from "./player";

/* ---- fakes: Web Audio just far enough for the sequencer ---- */

class FakeParam {
  value = 0;
  sets: Array<[value: number, t: number]> = [];
  targets: number[] = [];
  setValueAtTime(v: number, t: number): void {
    this.sets.push([v, t]);
  }
  setTargetAtTime(v: number): void {
    this.targets.push(v);
  }
  cancelScheduledValues(): void {}
  linearRampToValueAtTime(): void {}
}

class FakeGain {
  gain = new FakeParam();
  to: unknown = null;
  connect(node: unknown): void {
    this.to = node;
  }
  disconnect(): void {}
}

class FakeCtx {
  currentTime = 0;
  gains: FakeGain[] = [];
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
}

/** The five layer gains feeding `out`, in layer order: base, perc2, counter, bright, lift. */
function layerGains(ctx: FakeCtx, out: unknown): FakeGain[] {
  return ctx.gains.filter((g) => g.to === out);
}

interface Hit {
  kind: "note" | "drum";
  t: number;
  style: string;
  out: unknown;
  vel: number;
  freqs: number[];
  lenSec: number;
  token: string;
  step: number;
  slide: number | undefined;
}

function recorder(): { player: NotePlayer; hits: Hit[] } {
  const hits: Hit[] = [];
  const player: NotePlayer = {
    note(_ctx, out, t, style, freqs, lenSec, vel, opts) {
      hits.push({ kind: "note", t, style, out, vel, freqs, lenSec, token: "", step: opts.step, slide: opts.slide });
    },
    drum(_ctx, out, t, style, token, vel) {
      hits.push({ kind: "drum", t, style, out, vel, freqs: [], lenSec: 0, token, step: 0, slide: undefined });
    },
  };
  return { player, hits };
}

function ps(over: Partial<PlannedStep> = {}): PlannedStep {
  return { step: 0, bar: 0, t: 1, stepDur: 0.125, swingOffset: 0, transpose: 0, lift: false, fill: false, pickup: false, ...over };
}

function hz(note: string): number {
  return midiToFreq(noteToMidi(note));
}

/** A fake layer bus plus its gains by name. */
function fakeBus(): { layers: LayerBus; gains: Record<keyof LayerBus, FakeGain> } {
  const gains = { base: new FakeGain(), perc2: new FakeGain(), counter: new FakeGain(), bright: new FakeGain(), lift: new FakeGain() };
  return { layers: gains as unknown as LayerBus, gains };
}

const NO_SECTIONS: TrackSections = { fill: [], pickup: [] };

/** A looping 120 BPM track with the given voices (and optional sections). */
function track(voices: VoiceDef[], over: Partial<TrackDef> = {}): TrackDef {
  return { id: "t", bpm: 120, swing: 0.5, loop: true, voices, ...over };
}

function sectionsOf(def: TrackDef): TrackSections {
  return { fill: parseSection(def, "fill"), pickup: parseSection(def, "pickup") };
}

/** Run one step through scheduleStep against fresh fakes. */
function run(def: TrackDef, step: PlannedStep) {
  const { layers, gains } = fakeBus();
  const { player, hits } = recorder();
  scheduleStep(new FakeCtx() as unknown as BaseAudioContext, parseTrack(def), sectionsOf(def), step, layers, player);
  return { hits, gains };
}

const EVERY_STEP = Array.from({ length: 16 }, () => "h:1").join(" ");

describe("scheduleStep", () => {
  it("plays the main bar given by the running bar count modulo the bar count", () => {
    const def = track([{ style: "pad", pattern: ["C4:16", "E4:16"] }]);
    expect(run(def, ps({ bar: 2 })).hits[0].freqs).toEqual([hz("C4")]);
    expect(run(def, ps({ bar: 3 })).hits[0].freqs).toEqual([hz("E4")]);
  });

  it("starts events on their own step only, and skips rests", () => {
    const def = track([{ style: "pad", pattern: ["-:2 C4:2 -:12"] }]);
    expect(run(def, ps({ step: 0 })).hits).toHaveLength(0);
    expect(run(def, ps({ step: 1 })).hits).toHaveLength(0);
    expect(run(def, ps({ step: 2 })).hits).toHaveLength(1);
    expect(run(def, ps({ step: 3 })).hits).toHaveLength(0);
    // a wrapped looping step number still maps onto its bar position
    expect(run(def, ps({ step: 18 })).hits).toHaveLength(1);
  });

  it("delays off-beat steps by the swing offset", () => {
    const def = track([{ style: "pad", pattern: ["C4:1 C4:1 -:14"] }]);
    expect(run(def, ps({ step: 0, t: 2, swingOffset: 0.03 })).hits[0].t).toBe(2);
    expect(run(def, ps({ step: 1, t: 2.125, swingOffset: 0.03 })).hits[0].t).toBeCloseTo(2.155, 12);
  });

  it("passes note length, velocity, slide and the layer bus to the player", () => {
    const def = track([{ style: "trombone", layer: "counter", gain: 0.5, pattern: ["D4:4:0.9:-2 -:12"] }]);
    const { hits, gains } = run(def, ps({ stepDur: 0.2 }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "note", style: "trombone", lenSec: 0.8, step: 0.2, slide: -2, out: gains.counter });
    expect(hits[0].vel).toBeCloseTo(0.45, 12);
  });

  it("transposes notes by the voice's semitones plus the clock's", () => {
    const def = track([{ style: "pad", transpose: 12, pattern: ["A4:16"] }]);
    expect(run(def, ps()).hits[0].freqs[0]).toBeCloseTo(hz("A4") * 2, 9);
    expect(run(def, ps({ transpose: 1 })).hits[0].freqs[0]).toBeCloseTo(hz("A4") * 2 * Math.pow(2, 1 / 12), 9);
  });

  it("sends drum events to the drum method with the voice style and a clamped velocity", () => {
    const def = track([{ style: "drums", layer: "perc2", gain: 2, pattern: ["K:4:0.8 -:12"] }]);
    const { hits, gains } = run(def, ps());
    expect(hits).toEqual([expect.objectContaining({ kind: "drum", style: "drums", token: "K", vel: 1, out: gains.perc2 })]);
  });

  it("in a fill bar swaps the drum voices for the fill section and keeps the rest", () => {
    const def = track(
      [
        { style: "drums", pattern: ["K:16"] },
        { style: "s:kit.core", pattern: ["H:16"] },
        { style: "bassOom", pattern: ["C2:16"] },
      ],
      { fill: [{ style: "drums", pattern: ["S:16"] }] },
    );
    const plain = run(def, ps()).hits;
    expect(plain.map((h) => h.token || h.style)).toEqual(["K", "H", "bassOom"]);
    const filled = run(def, ps({ fill: true })).hits;
    expect(filled.map((h) => h.token || h.style)).toEqual(["bassOom", "S"]);
  });

  it("a fill flag with no fill section leaves the drums playing", () => {
    const def = track([{ style: "drums", pattern: ["K:16"] }]);
    expect(run(def, ps({ fill: true })).hits.map((h) => h.token)).toEqual(["K"]);
  });

  it("in the pickup bar plays only the pickup section, from its own bar", () => {
    const def = track([{ style: "drums", pattern: ["K:16"] }], {
      pickup: [{ style: "drums", pattern: ["-:8 S:8"] }],
    });
    expect(run(def, ps({ pickup: true, bar: -1, step: 4 })).hits).toHaveLength(0);
    expect(run(def, ps({ pickup: true, bar: -1, step: 8 })).hits.map((h) => h.token)).toEqual(["S"]);
  });

  it("sets the lift gain only when the clock's lift changes", () => {
    const { layers, gains } = fakeBus();
    const { player, hits } = recorder();
    const def = track([
      { style: "pad", pattern: ["C4:16"] },
      { style: "pad", layer: "lift", pattern: ["E4:16"] },
    ]);
    const voices = parseTrack(def);
    const go = (step: PlannedStep) =>
      scheduleStep(new FakeCtx() as unknown as BaseAudioContext, voices, NO_SECTIONS, step, layers, player);
    go(ps({ t: 1 }));
    go(ps({ t: 1.125 }));
    expect(gains.lift.gain.sets).toEqual([]);
    go(ps({ t: 2, lift: true }));
    go(ps({ t: 2.125, lift: true }));
    expect(gains.lift.gain.sets).toEqual([[1, 2]]);
    go(ps({ t: 4, lift: false }));
    expect(gains.lift.gain.sets).toEqual([[1, 2], [0.0001, 4]]);
    // lift voices feed the lift bus, and only on lifted steps
    expect(hits.filter((h) => h.out === gains.lift)).toHaveLength(2);
  });

  it("skips lift-layer notes on a step that is not lifted", () => {
    const def = track(
      [
        { style: "pad", pattern: ["C4:16"] },
        { style: "pad", layer: "lift", pattern: ["E4:16"] },
      ],
      { pickup: [{ style: "pad", layer: "lift", pattern: ["G4:16"] }] },
    );
    expect(run(def, ps()).hits.map((h) => h.freqs[0])).toEqual([hz("C4")]);
    expect(run(def, ps({ lift: true })).hits.map((h) => h.freqs[0])).toEqual([hz("C4"), hz("E4")]);
    expect(run(def, ps({ pickup: true, bar: -1 })).hits).toEqual([]);
    expect(run(def, ps({ pickup: true, bar: -1, lift: true })).hits.map((h) => h.freqs[0])).toEqual([hz("G4")]);
  });
});

describe("layerTargets", () => {
  it("leaves lift out: intensity never drives it", () => {
    expect(Object.keys(layerTargets(1))).toEqual(["base", "perc2", "counter", "bright"]);
  });
});

describe("scheduleTrackInto", () => {
  const ids: string[] = [];
  afterEach(() => {
    for (const id of ids.splice(0)) delete TRACKS[id];
  });
  /** Register a throwaway track with a hit on every step. */
  function register(over: Partial<TrackDef> = {}): string {
    const id = `__test${ids.length}`;
    ids.push(id);
    TRACKS[id] = track([{ style: "drums", pattern: [EVERY_STEP, EVERY_STEP] }], { id, ...over });
    return id;
  }

  it("plans a long window in one go without dropping or doubling steps", () => {
    const ctx = new FakeCtx();
    const { player, hits } = recorder();
    scheduleTrackInto(ctx as unknown as BaseAudioContext, register(), {} as AudioNode, 24, { player });
    expect(hits).toHaveLength(192); // 24 s / 0.125 s
    hits.forEach((h, i) => expect(h.t).toBeCloseTo(i * 0.125, 9));
  });

  it("stops a one-shot track after its last step", () => {
    const ctx = new FakeCtx();
    const { player, hits } = recorder();
    scheduleTrackInto(ctx as unknown as BaseAudioContext, register({ loop: false }), {} as AudioNode, 60, { player });
    expect(hits).toHaveLength(32); // two bars
    expect(hits[31].t).toBeCloseTo(31 * 0.125, 9);
  });

  it("opens every layer, and the lift layer only on request", () => {
    const off = new FakeCtx();
    const outOff = {} as AudioNode;
    scheduleTrackInto(off as unknown as BaseAudioContext, register(), outOff, 1, { player: recorder().player });
    expect(layerGains(off, outOff).map((g) => g.gain.value)).toEqual([1, 1, 1, 1, 0.0001]);

    const on = new FakeCtx();
    const outOn = {} as AudioNode;
    scheduleTrackInto(on as unknown as BaseAudioContext, register(), outOn, 1, { lift: true, player: recorder().player });
    expect(layerGains(on, outOn).map((g) => g.gain.value)).toEqual([1, 1, 1, 1, 1]);
  });

  it("starts at the tempo and transpose it is given (a lifted render)", () => {
    const id = `__test${ids.length}`;
    ids.push(id);
    TRACKS[id] = track([{ style: "pad", pattern: ["C4:16", "C4:16"] }], { id });
    const { player, hits } = recorder();
    scheduleTrackInto(new FakeCtx() as unknown as BaseAudioContext, id, {} as AudioNode, 4, { bpm: 240, transpose: 1, player });
    expect(hits.map((h) => h.t)).toEqual([0, 1, 2, 3]); // a bar lasts 1 s at 240 BPM
    expect(hits[0].freqs[0]).toBeCloseTo(hz("C#4"), 9);
  });

  it("rejects an unknown track", () => {
    expect(() => scheduleTrackInto(new FakeCtx() as unknown as BaseAudioContext, "nope", {} as AudioNode, 1)).toThrow(/unknown track/);
  });
});

describe("Sequencer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A Sequencer on a fake context whose clock the test advances 25 ms at a time. */
  function setup(def: TrackDef, opts: ConstructorParameters<typeof Sequencer>[3] = {}) {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setInterval: (f: () => void, ms: number) => globalThis.setInterval(f, ms),
      clearInterval: (id: number) => globalThis.clearInterval(id),
      setTimeout: (f: () => void, ms: number) => globalThis.setTimeout(f, ms),
      clearTimeout: (id: number) => globalThis.clearTimeout(id),
    });
    const ctx = new FakeCtx();
    const out = new FakeGain();
    const { player, hits } = recorder();
    const seq = new Sequencer(ctx as unknown as AudioContext, out as unknown as GainNode, def, { player, ...opts });
    const advance = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / 0.025); i++) {
        ctx.currentTime += 0.025;
        vi.advanceTimersByTime(25);
      }
    };
    return { seq, ctx, out, hits, advance };
  }

  it("schedules each step once from the audio clock, then ends a one-shot once", () => {
    const def = track([{ style: "drums", pattern: [EVERY_STEP, EVERY_STEP] }], { loop: false });
    const { seq, hits, advance } = setup(def);
    const onEnded = vi.fn();
    seq.onEnded = onEnded;
    seq.start();
    advance(8);
    expect(hits).toHaveLength(32);
    hits.forEach((h, i) => expect(h.t).toBeCloseTo(0.08 + i * 0.125, 9));
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("keeps a looping track going, wrapping through its bars", () => {
    const def = track([{ style: "pad", pattern: ["C4:16", "E4:16"] }]);
    const { seq, hits, advance } = setup(def);
    seq.start();
    advance(9); // 2 bars = 4 s: bars 0 1 0 1 ...
    const bars = hits.filter((h) => h.kind === "note").map((h) => h.freqs[0]);
    expect(bars.slice(0, 5)).toEqual([hz("C4"), hz("E4"), hz("C4"), hz("E4"), hz("C4")]);
    seq.stop(0);
  });

  it("applies queued changes through the clock at a bar line", () => {
    const def = track([{ style: "pad", pattern: ["C4:16"] }]);
    const { seq, hits, advance } = setup(def);
    seq.start();
    advance(0.5);
    seq.queueChange({ transpose: 12, bpm: 60 });
    expect(seq.clock.transpose).toBe(0); // waits for the next bar line
    advance(4);
    expect(seq.clock.transpose).toBe(12);
    expect(seq.clock.bpm).toBe(60);
    expect(hits[0].freqs[0]).toBeCloseTo(hz("C4"), 9);
    expect(hits[1].freqs[0]).toBeCloseTo(hz("C4") * 2, 9);
    expect(hits[1].t - hits[0].t).toBeCloseTo(2, 9); // bar 0 at 120 BPM
    seq.stop(0);
  });

  it("starts at the tempo, transpose and lift it is given", () => {
    const def = track([
      { style: "pad", pattern: ["A4:1 -:15"] },
      { style: "pad", layer: "lift", pattern: ["A4:1 -:15"] },
    ]);
    const { seq, ctx, out, hits, advance } = setup(def, { bpm: 240, transpose: 12, lift: true });
    seq.start();
    advance(1);
    expect(hits[0].freqs[0]).toBeCloseTo(hz("A4") * 2, 9);
    expect(hits[0].step).toBeCloseTo(0.0625, 12); // a 16th at 240 BPM
    const lift = layerGains(ctx, out)[4];
    expect(lift.gain.value).toBe(1);
    expect(lift.gain.sets).toEqual([]); // already lifted: nothing to switch
    seq.stop(0);
  });

  it("leaves the lift layer alone when intensity changes", () => {
    const def = track([{ style: "pad", pattern: ["C4:16"] }]);
    const { seq, ctx, out } = setup(def);
    seq.setIntensity(1);
    const [base, perc2, counter, bright, lift] = layerGains(ctx, out);
    expect(base.gain.targets).toEqual([]);
    expect([perc2, counter, bright].map((g) => g.gain.targets.length)).toEqual([1, 1, 1]);
    expect(lift.gain.targets).toEqual([]);
    expect(lift.gain.value).toBe(0.0001);
  });
});
