import { afterEach, describe, expect, it, vi } from "vitest";
import * as instruments from "../music/instruments";
import { createSamplerPlayer, layerFor, midiFromHz, pickKitZone, pickZone, rateFor, resolveNote } from "./sampler";
import type { InstrumentZones, LoadedBuffer, SampledInstrument, Zone } from "./types";

/* ---- fixtures ---- */

function zone(over: Partial<Zone> & { layer: number; rr: number }): Zone {
  return { tune: 0, frames: 1000, file: `${over.root ?? over.token}.l${over.layer}.rr${over.rr}`, ...over };
}

const piano: SampledInstrument = {
  set: "core",
  kind: "melodic",
  standIn: "pad",
  oneShot: false,
  release: 0.3,
  gain: 0.8,
  velUpper: [0.6, 1],
  maxShift: 1.5,
  maxLen: 0,
};

const kitCore: SampledInstrument = {
  set: "core",
  kind: "kit",
  standIn: "drums",
  oneShot: true,
  release: 0.05,
  gain: 0.9,
  velUpper: [1],
  maxShift: 0,
  maxLen: 0.4,
};

const table: Record<string, SampledInstrument> = { piano, "kit.core": kitCore };

const zones57_60_63 = [57, 60, 63].flatMap((root) => [0, 1].map((layer) => zone({ root, layer, rr: 0 })));
const zones60_62 = [zone({ root: 60, layer: 0, rr: 0 }), zone({ root: 62, layer: 0, rr: 0 })];

const zoneTable: Record<string, InstrumentZones> = {
  piano: { source: "fixture", zones: zones57_60_63 },
  "kit.core": {
    source: "fixture",
    zones: [
      zone({ token: "K", layer: 0, rr: 0 }),
      zone({ token: "S", layer: 0, rr: 0 }),
      zone({ token: "S", layer: 0, rr: 1 }),
    ],
  },
};

const stub: LoadedBuffer = { buffer: {} as AudioBuffer, start: 0 };

describe("midiFromHz", () => {
  it("rounds to the nearest note", () => {
    expect(midiFromHz(440)).toBe(69);
    expect(midiFromHz(261.6256)).toBe(60);
  });
});

describe("layerFor", () => {
  it("takes the first layer whose bound covers the velocity, the last above all", () => {
    expect(layerFor([0.6, 1], 0.5)).toBe(0);
    expect(layerFor([0.6, 1], 0.6)).toBe(0);
    expect(layerFor([0.6, 1], 0.75)).toBe(1);
    expect(layerFor([1], 0.2)).toBe(0);
    expect(layerFor([0.6, 1], 1.4)).toBe(1);
  });
});

describe("pickZone", () => {
  it("takes the nearest root, higher on a tie", () => {
    expect(pickZone(zones57_60_63, 61, 0, 0)?.root).toBe(60);
    expect(pickZone(zones60_62, 61, 0, 0)?.root).toBe(62);
  });

  it("cycles round robins", () => {
    const rr = [zone({ root: 60, layer: 0, rr: 0 }), zone({ root: 60, layer: 0, rr: 1 })];
    expect([0, 1, 2].map((n) => pickZone(rr, 60, 0, n)?.rr)).toEqual([0, 1, 0]);
  });

  it("cycles round robins in rr order, not list order", () => {
    const rr = [zone({ root: 60, layer: 0, rr: 1 }), zone({ root: 60, layer: 0, rr: 0 })];
    expect([0, 1, 2].map((n) => pickZone(rr, 60, 0, n)?.rr)).toEqual([0, 1, 0]);
  });

  it("only uses the requested layer", () => {
    const both = [zone({ root: 60, layer: 0, rr: 0 }), zone({ root: 64, layer: 1, rr: 0 })];
    expect(pickZone(both, 60, 1, 0)?.root).toBe(64);
    expect(pickZone(both, 64, 0, 0)?.root).toBe(60);
    expect(pickZone(both, 60, 2, 0)).toBeNull();
  });

  it("ignores kit zones, which have no root", () => {
    expect(pickZone([zone({ token: "K", layer: 0, rr: 0 })], 60, 0, 0)).toBeNull();
    expect(pickZone([], 60, 0, 0)).toBeNull();
  });
});

describe("pickKitZone", () => {
  const kit = zoneTable["kit.core"].zones;

  it("picks by token and cycles its round robins", () => {
    expect(pickKitZone(kit, "S", 0, 0)?.rr).toBe(0);
    expect(pickKitZone(kit, "S", 0, 1)?.rr).toBe(1);
    expect(pickKitZone(kit, "S", 0, 2)?.rr).toBe(0);
    expect(pickKitZone(kit, "K", 0, 5)?.token).toBe("K");
  });

  it("gives null for an unknown token or layer", () => {
    expect(pickKitZone(kit, "H", 0, 0)).toBeNull();
    expect(pickKitZone(kit, "K", 1, 0)).toBeNull();
  });
});

describe("rateFor", () => {
  it("applies tune", () => {
    expect(rateFor(64, { root: 63, tune: 0 } as Zone)).toBeCloseTo(2 ** (1 / 12));
    expect(rateFor(64, { root: 63, tune: 50 } as Zone)).toBeCloseTo(2 ** (1.5 / 12));
    expect(rateFor(60, { root: 60, tune: 0 } as Zone)).toBe(1);
  });
});

describe("resolveNote", () => {
  it("resolves a loaded zone to a sample with its buffer", () => {
    const seen: Array<[string, string]> = [];
    const buffer = (inst: string, z: Zone): LoadedBuffer => {
      seen.push([inst, z.file]);
      return stub;
    };
    // vel 0.8 is layer 1; midi 61 is nearest root 60
    const r = resolveNote(table, zoneTable, "s:piano", 61, 0.8, 0, buffer);
    expect(r).toEqual({ kind: "sample", instrument: "piano", zone: zones57_60_63.find((z) => z.root === 60 && z.layer === 1), buf: stub });
    expect(seen).toEqual([["piano", "60.l1.rr0"]]);
  });

  it("missing buffer resolves to the stand-in", () => {
    expect(resolveNote(table, zoneTable, "s:piano", 60, 0.8, 0, () => null)).toEqual({ kind: "standIn", standIn: "pad" });
  });

  it("an instrument with no zones loaded yet resolves to its stand-in", () => {
    expect(resolveNote(table, {}, "s:piano", 60, 0.8, 0, () => stub)).toEqual({ kind: "standIn", standIn: "pad" });
  });

  it("unknown instrument resolves to the stand-in of nothing", () => {
    expect(resolveNote(table, zoneTable, "s:nope", 60, 0.8, 0, () => stub)).toEqual({ kind: "standIn", standIn: "" });
  });
});

/* ---- player: Web Audio faked just far enough to record what gets scheduled ---- */

type ParamCall = [method: "set" | "lin" | "exp", value: number, t: number];

class FakeParam {
  calls: ParamCall[] = [];
  setValueAtTime(v: number, t: number): void {
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.calls.push(["lin", v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    this.calls.push(["exp", v, t]);
  }
}

class FakeSource {
  buffer: unknown = null;
  playbackRate = new FakeParam();
  to: unknown = null;
  started: Array<[when: number, offset: number | undefined]> = [];
  stopped: number[] = [];
  connect(node: unknown): void {
    this.to = node;
  }
  start(when: number, offset?: number): void {
    this.started.push([when, offset]);
  }
  stop(when: number): void {
    this.stopped.push(when);
  }
}

class FakeGain {
  gain = new FakeParam();
  to: unknown = null;
  connect(node: unknown): void {
    this.to = node;
  }
}

class FakeCtx {
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
}

function setup(over: Partial<Parameters<typeof createSamplerPlayer>[0]> = {}) {
  const ctx = new FakeCtx();
  const out = {} as AudioNode;
  const onStandIn = vi.fn();
  const asked: Array<[string, string]> = [];
  const bufs = new Map<string, LoadedBuffer>();
  const player = createSamplerPlayer({
    table,
    zones: () => zoneTable,
    buffer: (inst, z) => {
      asked.push([inst, z.file]);
      return bufs.get(`${inst}/${z.file}`) ?? { buffer: { duration: 2 } as AudioBuffer, start: 0.01 };
    },
    onStandIn,
    ...over,
  });
  return { ctx, c: ctx as unknown as BaseAudioContext, out, player, onStandIn, asked, bufs };
}

const opts = { step: 0.125 };
const C4 = 261.6256;

describe("createSamplerPlayer: routing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends synth styles to the oscillator engine", () => {
    const voice = vi.spyOn(instruments.VOICES, "pad").mockImplementation(() => {});
    const hit = vi.spyOn(instruments, "drumHit").mockImplementation(() => {});
    const { c, out, player, ctx, onStandIn } = setup();
    player.note(c, out, 1, "pad", [220], 0.5, 0.7, { step: 0.125, slide: 2 });
    player.drum(c, out, 2, "drums", "K", 0.6);
    expect(voice).toHaveBeenCalledExactlyOnceWith(c, out, 1, [220], 0.5, 0.7, { step: 0.125, slide: 2 });
    expect(hit).toHaveBeenCalledExactlyOnceWith(c, out, 2, "K", 0.6);
    expect(ctx.sources).toHaveLength(0);
    expect(onStandIn).not.toHaveBeenCalled();
  });

  it("plays nothing for a kit style asked to play a pitched note", () => {
    const { c, out, player, ctx, onStandIn } = setup();
    expect(() => player.note(c, out, 0, "s:kit.core", [C4], 1, 1, opts)).not.toThrow();
    expect(ctx.sources).toHaveLength(0);
    expect(onStandIn).not.toHaveBeenCalled();
  });
});

describe("createSamplerPlayer: sampled notes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("plays the nearest zone from its start offset at the shifted rate, through gain * vel", () => {
    const { c, ctx, out, player, asked, onStandIn } = setup();
    // 277.18 Hz is midi 61: nearest root 60 on layer 1 (vel 0.9), one semitone up
    player.note(c, out, 2, "s:piano", [277.1826], 0.5, 0.9, opts);
    expect(asked).toEqual([["piano", "60.l1.rr0"]]);
    expect(ctx.sources).toHaveLength(1);
    const [src] = ctx.sources;
    const [g] = ctx.gains;
    expect(src.buffer).toEqual({ duration: 2 });
    expect(src.started).toEqual([[2, 0.01]]);
    expect(src.to).toBe(g);
    expect(g.to).toBe(out);
    expect(src.playbackRate.calls).toHaveLength(1);
    expect(src.playbackRate.calls[0][0]).toBe("set");
    expect(src.playbackRate.calls[0][1]).toBeCloseTo(2 ** (1 / 12));
    expect(src.playbackRate.calls[0][2]).toBe(2);
    expect(g.gain.calls[0]).toEqual(["set", 0.8 * 0.9, 2]);
    expect(onStandIn).not.toHaveBeenCalled();
  });

  it("holds a sustained note for lenSec, then fades over the release", () => {
    const { c, ctx, out, player } = setup();
    player.note(c, out, 2, "s:piano", [C4], 0.5, 0.5, opts);
    const peak = 0.8 * 0.5;
    expect(ctx.gains[0].gain.calls).toEqual([
      ["set", peak, 2],
      ["set", peak, 2.5],
      ["lin", 0, 2.8],
    ]);
    expect(ctx.sources[0].stopped).toHaveLength(1);
    expect(ctx.sources[0].stopped[0]).toBeGreaterThanOrEqual(2.8);
    expect(ctx.sources[0].stopped[0]).toBeLessThan(2.9);
  });

  it("plays a one-shot instrument to its buffer length or maxLen, whatever lenSec is", () => {
    const oneShot = { ...piano, oneShot: true, release: 0.1, maxLen: 1.5 };
    const tbl = { piano: oneShot };
    const long = setup({ table: tbl });
    // buffer 2 s from offset 0.01 at rate 1 is 1.99 s, capped to maxLen 1.5
    long.player.note(long.c, long.out, 4, "s:piano", [C4], 0.1, 1, opts);
    const g = long.ctx.gains[0].gain.calls;
    expect(g[0]).toEqual(["set", 0.8, 4]);
    expect(g[1][0]).toBe("set");
    expect(g[1][2]).toBeCloseTo(5.4);
    expect(g[2][0]).toBe("lin");
    expect(g[2][1]).toBe(0);
    expect(g[2][2]).toBeCloseTo(5.5);
    expect(long.ctx.sources[0].stopped[0]).toBeGreaterThanOrEqual(5.5);

    const short = setup({ table: tbl, buffer: () => ({ buffer: { duration: 0.5 } as AudioBuffer, start: 0 }) });
    // buffer shorter than maxLen and lenSec longer: plays the buffer (0.5 s), not lenSec
    short.player.note(short.c, short.out, 4, "s:piano", [C4], 3, 1, opts);
    const s = short.ctx.gains[0].gain.calls;
    expect(s[s.length - 1]).toEqual(["lin", 0, 4.5]);
  });

  it("a one-shot with maxLen 0 is not capped", () => {
    const { c, ctx, out, player } = setup({ table: { piano: { ...piano, oneShot: true, release: 0, maxLen: 0 } } });
    player.note(c, out, 0, "s:piano", [C4], 0.1, 1, opts);
    const last = ctx.gains[0].gain.calls.at(-1)!;
    expect(last[2]).toBeCloseTo(1.99);
  });

  it("a one-shot lasts buffer length divided by rate", () => {
    const { c, ctx, out, player } = setup({
      table: { piano: { ...piano, oneShot: true, release: 0, maxLen: 0 } },
      buffer: () => ({ buffer: { duration: 1 } as AudioBuffer, start: 0 }),
    });
    // midi 72 against root 63 is rate 2 ** (9 / 12) ~ 1.68
    player.note(c, out, 0, "s:piano", [523.2511], 0.1, 1, opts);
    expect(ctx.gains[0].gain.calls.at(-1)![2]).toBeCloseTo(1 / 2 ** (9 / 12));
  });

  it("ramps the playback rate exponentially to the slide target by the end of the note", () => {
    const { c, ctx, out, player } = setup();
    player.note(c, out, 1, "s:piano", [C4], 0.5, 0.5, { step: 0.125, slide: 12 });
    const calls = ctx.sources[0].playbackRate.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["set", 1, 1]);
    expect(calls[1][0]).toBe("exp");
    expect(calls[1][1]).toBeCloseTo(2);
    expect(calls[1][2]).toBe(1.5);
  });

  it("no slide, or a slide of zero, leaves the rate alone", () => {
    const { c, ctx, out, player } = setup();
    player.note(c, out, 1, "s:piano", [C4], 0.5, 0.5, { step: 0.125, slide: 0 });
    player.note(c, out, 1, "s:piano", [C4], 0.5, 0.5, opts);
    expect(ctx.sources.map((s) => s.playbackRate.calls.length)).toEqual([1, 1]);
  });

  it("plays each chord frequency as its own sample", () => {
    const { c, ctx, out, player, asked } = setup();
    player.note(c, out, 0, "s:piano", [220, 277.1826, 329.6276], 1, 0.5, opts);
    expect(ctx.sources).toHaveLength(3);
    expect(asked.map(([, file]) => file)).toEqual(["57.l0.rr0", "60.l0.rr0", "63.l0.rr0"]);
  });

  it("uses the quiet layer for soft notes and the loud layer for hard ones", () => {
    const { c, out, player, asked } = setup();
    player.note(c, out, 0, "s:piano", [C4], 1, 0.3, opts);
    player.note(c, out, 0, "s:piano", [C4], 1, 0.9, opts);
    expect(asked.map(([, file]) => file)).toEqual(["60.l0.rr0", "60.l1.rr0"]);
  });

  describe("round robins", () => {
    const rrZones: Record<string, InstrumentZones> = {
      piano: { source: "fixture", zones: [0, 1].map((rr) => zone({ root: 60, layer: 0, rr })) },
      bell: { source: "fixture", zones: [0, 1].map((rr) => zone({ root: 60, layer: 0, rr })) },
    };
    const rrTable = { piano, bell: { ...piano, standIn: "glock" } };

    it("count per instrument, one step per sample played", () => {
      const { c, out, player, asked } = setup({ table: rrTable, zones: () => rrZones });
      for (let i = 0; i < 3; i++) player.note(c, out, i, "s:piano", [C4], 0.2, 0.5, opts);
      player.note(c, out, 3, "s:bell", [C4], 0.2, 0.5, opts);
      player.note(c, out, 4, "s:piano", [C4], 0.2, 0.5, opts);
      expect(asked).toEqual([
        ["piano", "60.l0.rr0"],
        ["piano", "60.l0.rr1"],
        ["piano", "60.l0.rr0"],
        ["bell", "60.l0.rr0"],
        ["piano", "60.l0.rr1"],
      ]);
    });

    it("do not advance for a note a stand-in covered", () => {
      vi.spyOn(instruments.VOICES, "pad").mockImplementation(() => {});
      let loaded = false;
      const { c, out, player, asked } = setup({
        table: rrTable,
        zones: () => rrZones,
        buffer: (inst, z) => {
          asked.push([inst, z.file]);
          return loaded ? { buffer: { duration: 1 } as AudioBuffer, start: 0 } : null;
        },
      });
      player.note(c, out, 0, "s:piano", [C4], 0.2, 0.5, opts);
      loaded = true;
      player.note(c, out, 1, "s:piano", [C4], 0.2, 0.5, opts);
      expect(asked.map(([, f]) => f)).toEqual(["60.l0.rr0", "60.l0.rr0"]);
    });

    it("belong to the player, not the module", () => {
      const a = setup({ table: rrTable, zones: () => rrZones });
      const b = setup({ table: rrTable, zones: () => rrZones });
      a.player.note(a.c, a.out, 0, "s:piano", [C4], 0.2, 0.5, opts);
      b.player.note(b.c, b.out, 0, "s:piano", [C4], 0.2, 0.5, opts);
      expect(b.asked).toEqual([["piano", "60.l0.rr0"]]);
    });
  });
});

describe("createSamplerPlayer: stand-ins", () => {
  afterEach(() => vi.restoreAllMocks());

  it("plays the old synth voice for a note whose buffer is not loaded, and says so", () => {
    const voice = vi.spyOn(instruments.VOICES, "pad").mockImplementation(() => {});
    const { c, ctx, out, player, onStandIn } = setup({ buffer: () => null });
    player.note(c, out, 3, "s:piano", [220, 330], 0.5, 0.7, { step: 0.125, slide: 2 });
    expect(ctx.sources).toHaveLength(0);
    expect(voice.mock.calls).toEqual([
      [c, out, 3, [220], 0.5, 0.7, { step: 0.125, slide: 2 }],
      [c, out, 3, [330], 0.5, 0.7, { step: 0.125, slide: 2 }],
    ]);
    expect(onStandIn).toHaveBeenCalledTimes(2);
  });

  it("falls back per note: loaded notes still sample", () => {
    const voice = vi.spyOn(instruments.VOICES, "pad").mockImplementation(() => {});
    const { c, ctx, out, player, onStandIn } = setup({
      buffer: (_inst, z) => (z.root === 63 ? null : { buffer: { duration: 1 } as AudioBuffer, start: 0 }),
    });
    player.note(c, out, 0, "s:piano", [220, 329.6276], 0.5, 0.5, opts);
    expect(ctx.sources).toHaveLength(1);
    expect(voice).toHaveBeenCalledTimes(1);
    expect(voice.mock.calls[0][3]).toEqual([329.6276]);
    expect(onStandIn).toHaveBeenCalledTimes(1);
  });

  it("falls back while the zone tables are still loading", () => {
    const voice = vi.spyOn(instruments.VOICES, "pad").mockImplementation(() => {});
    const { c, ctx, out, player, onStandIn } = setup({ zones: () => ({}) });
    player.note(c, out, 0, "s:piano", [C4], 0.5, 0.5, opts);
    expect(ctx.sources).toHaveLength(0);
    expect(voice).toHaveBeenCalledTimes(1);
    expect(onStandIn).toHaveBeenCalledTimes(1);
  });

  it("an unknown instrument plays nothing and warns once per instrument", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const voice = vi.spyOn(instruments.VOICES, "pad").mockImplementation(() => {});
    const { c, ctx, out, player, onStandIn } = setup();
    for (let i = 0; i < 5; i++) player.note(c, out, i, "s:nope", [C4], 0.5, 0.5, opts);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("nope");
    player.note(c, out, 6, "s:nada", [C4], 0.5, 0.5, opts);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(ctx.sources).toHaveLength(0);
    expect(voice).not.toHaveBeenCalled();
    expect(onStandIn).not.toHaveBeenCalled();
  });
});

describe("createSamplerPlayer: kits", () => {
  afterEach(() => vi.restoreAllMocks());

  it("plays the zone for the token at its natural rate, through gain * vel", () => {
    const { c, ctx, out, player, asked, onStandIn } = setup();
    player.drum(c, out, 5, "s:kit.core", "K", 0.5);
    expect(asked).toEqual([["kit.core", "K.l0.rr0"]]);
    const [src] = ctx.sources;
    const [g] = ctx.gains;
    expect(src.started).toEqual([[5, 0.01]]);
    expect(src.to).toBe(g);
    expect(g.to).toBe(out);
    expect(src.playbackRate.calls).toEqual([["set", 1, 5]]);
    expect(g.gain.calls[0]).toEqual(["set", 0.9 * 0.5, 5]);
    expect(onStandIn).not.toHaveBeenCalled();
  });

  it("a kit hit plays to its buffer length or maxLen", () => {
    const { c, ctx, out, player } = setup();
    // buffer 2 s from 0.01, maxLen 0.4, release 0.05
    player.drum(c, out, 5, "s:kit.core", "K", 1);
    const calls = ctx.gains[0].gain.calls;
    expect(calls.at(-1)![0]).toBe("lin");
    expect(calls.at(-1)![2]).toBeCloseTo(5.4);
  });

  it("cycles a token's round robins", () => {
    const { c, out, player, asked } = setup();
    for (let i = 0; i < 3; i++) player.drum(c, out, i, "s:kit.core", "S", 0.5);
    expect(asked.map(([, f]) => f)).toEqual(["S.l0.rr0", "S.l0.rr1", "S.l0.rr0"]);
  });

  it("an unmapped token does not advance the kit's round robins", () => {
    vi.spyOn(instruments, "drumHit").mockImplementation(() => {});
    const { c, out, player, asked } = setup();
    player.drum(c, out, 0, "s:kit.core", "S", 0.5);
    player.drum(c, out, 1, "s:kit.core", "H", 0.5);
    player.drum(c, out, 2, "s:kit.core", "S", 0.5);
    expect(asked.map(([, f]) => f)).toEqual(["S.l0.rr0", "S.l0.rr1"]);
  });

  it("falls back to the synth drum, and says so, for an unmapped token", () => {
    const hit = vi.spyOn(instruments, "drumHit").mockImplementation(() => {});
    const { c, ctx, out, player, onStandIn } = setup();
    player.drum(c, out, 2, "s:kit.core", "H", 0.4);
    expect(hit).toHaveBeenCalledExactlyOnceWith(c, out, 2, "H", 0.4);
    expect(ctx.sources).toHaveLength(0);
    expect(onStandIn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the synth drum when the buffer is not loaded", () => {
    const hit = vi.spyOn(instruments, "drumHit").mockImplementation(() => {});
    const { c, ctx, out, player, onStandIn } = setup({ buffer: () => null });
    player.drum(c, out, 2, "s:kit.core", "K", 0.4);
    expect(hit).toHaveBeenCalledExactlyOnceWith(c, out, 2, "K", 0.4);
    expect(ctx.sources).toHaveLength(0);
    expect(onStandIn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the synth drum for an unknown kit or before its zones load", () => {
    const hit = vi.spyOn(instruments, "drumHit").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { c, out, player, onStandIn } = setup();
    player.drum(c, out, 1, "s:kit.nope", "K", 0.4);
    expect(hit).toHaveBeenCalledExactlyOnceWith(c, out, 1, "K", 0.4);
    expect(onStandIn).toHaveBeenCalledTimes(1);

    const loading = setup({ zones: () => ({}) });
    loading.player.drum(loading.c, loading.out, 1, "s:kit.core", "K", 0.4);
    expect(hit).toHaveBeenCalledTimes(2);
    expect(loading.onStandIn).toHaveBeenCalledTimes(1);
  });

  it("warns once about an unknown kit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(instruments, "drumHit").mockImplementation(() => {});
    const { c, out, player } = setup();
    for (let i = 0; i < 4; i++) player.drum(c, out, i, "s:kit.nope", "K", 0.4);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
