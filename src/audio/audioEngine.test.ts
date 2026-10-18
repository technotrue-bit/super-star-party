import { afterEach, describe, expect, it, vi } from "vitest";
import { audio } from "./audioEngine";
import { SAMPLED } from "./samples/instruments.gen";
import { ZONES } from "./samples/zones.gen";
import { SFX, resolvePitch } from "./sfx/sounds";

describe("audio volumes", () => {
  it("keeps music and sfx volume separate from master", () => {
    const master = audio.master.gain;
    audio.music.volume = 0.2;
    audio.sfx.volume = 0.7;
    expect(audio.music.volume).toBe(0.2);
    expect(audio.sfx.volume).toBe(0.7);
    expect(audio.master.gain).toBe(master);
  });

  it("clamps volumes to 0..1 and ignores NaN", () => {
    audio.music.volume = 1.8;
    expect(audio.music.volume).toBe(1);
    audio.sfx.volume = -0.5;
    expect(audio.sfx.volume).toBe(0);
    audio.sfx.volume = 0.4;
    audio.sfx.volume = Number.NaN;
    expect(audio.sfx.volume).toBe(0.4);
  });
});

describe("sfx pitch", () => {
  it("reads pitch as semitones", () => {
    expect(resolvePitch({ pitch: 7 })).toBe(7);
    expect(resolvePitch(undefined)).toBe(0);
  });

  it("reads rate as a frequency multiplier", () => {
    expect(resolvePitch({ rate: 2 })).toBeCloseTo(12);
    expect(resolvePitch({ rate: 0.5 })).toBeCloseTo(-12);
    expect(resolvePitch({ rate: 1 })).toBe(0);
  });

  it("adds rate and pitch together", () => {
    expect(resolvePitch({ rate: 2, pitch: -5 })).toBeCloseTo(7);
  });

  it("ignores a rate that is not positive", () => {
    expect(resolvePitch({ rate: 0, pitch: 3 })).toBe(3);
    expect(resolvePitch({ rate: -1 })).toBe(0);
  });
});

describe("music director wiring", () => {
  it("tracks() lists real ids plus the aliases", () => {
    expect(audio.music.tracks()).toEqual(expect.arrayContaining(["board", "minigame_a", "minigame_b", "title"]));
  });

  it("debug() has defaults without an AudioContext", () => {
    expect(audio.debug().samples.format).toBe("off");
    expect(audio.debug().anchor).toBeNull();
  });

  it("debug() reports every field with its default before audio starts", () => {
    expect(audio.debug()).toEqual({
      theme: "silence",
      lift: false,
      bpm: 0,
      transpose: 0,
      samples: { format: "off", sets: {}, failed: [], standInNotes: 0 },
      anchor: null,
      bars: { audioNow: 0, bars: [] },
    });
  });

  it("the new music calls are safe without an AudioContext", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    audio.music.setBoard("cruise-ship");
    audio.music.lift(true);
    audio.music.lift(false);
    audio.music.play("board", { intensity: 0.5, genre: "race", music: { bpm: 120, beat0: 1 } });
    expect(audio.music.track()).toBe("silence");
    expect(audio.music.theme()).toBe("silence");
    expect(audio.debug().samples.sets).toEqual({});
    audio.music.stop(0);
    log.mockRestore();
  });

  it("no file under src/audio imports core/rng", () => {
    const audioSources = import.meta.glob<string>("../audio/**/*.ts", { query: "?raw", import: "default", eager: true });
    expect(Object.keys(audioSources)).toContain("./audioEngine.ts"); // vite keys files in this folder relative to it
    const offenders = Object.entries(audioSources)
      .filter(([, text]) => /from\s+["'][./]*core\/rng["']/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

/* ---- a live engine on a fake AudioContext ---- */

/** Takes any read, write or call: every node, param and source the graph and synth voices touch. */
function anyNode(): any {
  const store = new Map<PropertyKey, unknown>();
  return new Proxy(function () {}, {
    get(_t, key) {
      if (store.has(key)) return store.get(key);
      if (key === "then") return undefined; // not a promise
      if (key === Symbol.toPrimitive) return () => 0; // an unset number reads as 0
      const node = anyNode();
      store.set(key, node);
      return node;
    },
    set(_t, key, value) {
      store.set(key, value);
      return true;
    },
    apply: () => anyNode(),
  });
}

/** True for the two probe clips' containers: WebM (EBML magic) and MP4 (an `ftyp` box). */
function isProbeClip(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes);
  const webm = b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  return webm || String.fromCharCode(...b.subarray(4, 8)) === "ftyp";
}

class FakeAudioContext {
  static last: FakeAudioContext;
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  constructor() {
    const self = new Proxy(this, { get: (t, key) => (key in t ? Reflect.get(t, key) : anyNode()) });
    FakeAudioContext.last = self;
    return self;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
  }
  decodeAudioData(bytes: ArrayBuffer): Promise<unknown> {
    return isProbeClip(bytes) ? Promise.resolve(this.createBuffer(1, 2400, 48000)) : Promise.reject(new Error("not audio"));
  }
}

/** A fresh engine module on a fake window with `search` as its URL query. `advance` steps the clock 25 ms at a time, firing the timers. */
async function liveEngine(search: string) {
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  vi.stubGlobal("window", {
    AudioContext: FakeAudioContext,
    location: { search },
    setInterval: (fn: () => void) => (timers.set(nextTimer, fn), nextTimer++),
    clearInterval: (id: number) => timers.delete(id),
    setTimeout: () => 0,
  });
  // Sample files answer with a container the fake decoder accepts, so sets load.
  const fetchSpy = vi.fn(async (url: string) => ({ ok: true, arrayBuffer: async () => fakeClip(url) }));
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
  const engine = await import("./audioEngine");
  const tracks = await import("./music/tracks");
  const advance = (seconds: number) => {
    const ctx = FakeAudioContext.last;
    for (const end = ctx.currentTime + seconds; ctx.currentTime < end; ) {
      ctx.currentTime += 0.025;
      for (const fn of [...timers.values()]) fn();
    }
  };
  live = engine.audio;
  return { ...engine, TRACKS: tracks.TRACKS, fetchSpy, warn, advance };
}

/** A few bytes in the container a sample URL names: WebM's EBML magic or an MP4 `ftyp` box. */
function fakeClip(url: string): ArrayBuffer {
  return new Uint8Array(url.endsWith(".m4a") ? [0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70] : [0x1a, 0x45, 0xdf, 0xa3]).buffer;
}

/** The engine made by the latest liveEngine call. */
let live: typeof audio | null = null;

/** Lets every pending promise settle (the fake decodes resolve at once). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Waits until the engine has picked a format and no set is mid-load. The zone tables arrive by a
 * dynamic import, so a load can outlive a test and fetch through the next test's stub without this.
 */
async function quiet(engine: typeof audio): Promise<void> {
  await vi.waitFor(() => {
    const { format, sets } = engine.debug().samples;
    if (Object.keys(sets).length === 0) return; // no loader, or nothing asked for
    expect(format).not.toBe("off");
    expect(Object.values(sets)).not.toContain("loading");
  });
}

/** Every distinct file of a set's instruments. */
function setFiles(set: string): string[] {
  const files = Object.entries(ZONES)
    .filter(([name]) => SAMPLED[name].set === set)
    .flatMap(([, { zones }]) => zones.map((z) => z.file));
  return [...new Set(files)].sort();
}

/** The sample files fetched, as zone file paths with the given extension removed. */
function fetchedFiles(fetchSpy: { mock: { calls: unknown[][] } }, ext: string): string[] {
  return fetchSpy.mock.calls.map(([url]) => String(url).replace(/^.*?music\//, "").replace(ext, "")).sort();
}

describe("live engine wiring (fake AudioContext)", () => {
  afterEach(async () => {
    if (live) await quiet(live);
    live = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("probes the format at unlock, then loads core and every set asked for before it was known", async () => {
    const { audio, unlock, fetchSpy, warn } = await liveEngine("?audio=1");
    audio.music.setBoard("cruise-ship");
    audio.music.play("board", { intensity: 0.6 });
    expect(audio.debug().samples.sets).toEqual({}); // no loader before the first unlock
    unlock();
    expect(audio.music.track()).toBe("board");
    expect(audio.music.theme()).toBe("board.cruise"); // plays board.fairground until Plan 2
    expect(audio.debug().samples.format).toBe("off"); // the probe is still decoding
    expect(audio.debug().samples.sets).toEqual({ cruise: "idle", core: "idle" });
    expect(fetchSpy).not.toHaveBeenCalled();
    await quiet(audio);
    expect(audio.debug().samples).toEqual({ format: "opus", sets: { cruise: "ready", core: "ready" }, failed: [], standInNotes: 0 });
    expect(fetchedFiles(fetchSpy, ".webm")).toEqual(setFiles("core")); // each core file once, as Opus; cruise has none yet
    expect(warn).not.toHaveBeenCalled();
  });

  it("a board change frees the previous board's set and loads the new one", async () => {
    const { audio, unlock } = await liveEngine("?audio=1");
    unlock();
    audio.music.setBoard("cruise-ship");
    await quiet(audio);
    expect(audio.debug().samples.sets).toEqual({ core: "ready", cruise: "ready" });
    audio.music.setBoard("fizzy-fairground");
    await quiet(audio);
    expect(audio.debug().samples.sets).toEqual({ core: "ready", fairground: "ready" });
  });

  it("?samples=0 keeps the synth voices", async () => {
    const { audio, unlock } = await liveEngine("?audio=1&samples=0");
    unlock();
    await settle();
    expect(audio.debug().samples).toMatchObject({ format: "synth", sets: { core: "idle" } });
  });

  it("?audiofmt=aac skips the Opus probe", async () => {
    const { audio, unlock, fetchSpy } = await liveEngine("?audio=1&audiofmt=aac");
    unlock();
    await quiet(audio);
    expect(audio.debug().samples).toMatchObject({ format: "aac", sets: { core: "ready" } });
    expect(fetchedFiles(fetchSpy, ".m4a")).toEqual(setFiles("core"));
  });

  it("?audio=0 makes no loader and fetches nothing, whatever is called", async () => {
    const { audio, unlock, fetchSpy } = await liveEngine("?audio=0");
    unlock();
    audio.music.setBoard("cruise-ship");
    audio.music.play("board");
    audio.music.lift(true);
    audio.music.stinger("win");
    await settle();
    expect(audio.music.track()).toBe("silence");
    expect(audio.debug()).toEqual({
      theme: "silence",
      lift: false,
      bpm: 0,
      transpose: 0,
      samples: { format: "off", sets: {}, failed: [], standInNotes: 0 },
      anchor: null,
      bars: { audioNow: 0, bars: [] },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("every listed track plays, aliases resolved", async () => {
    const { audio, unlock, warn } = await liveEngine("?audio=1");
    unlock();
    for (const id of audio.music.tracks()) {
      audio.music.play(id);
      expect(audio.music.track()).toBe(id);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("a minigame alias resolves by genre, through the interim fallback", async () => {
    const { audio, unlock } = await liveEngine("?audio=1");
    unlock();
    audio.music.play("minigame_b", { intensity: 1, genre: "rhythm" });
    expect(audio.music.track()).toBe("minigame_b");
    expect(audio.music.theme()).toBe("mg.rhythm");
    expect(audio.debug().bpm).toBe(118); // mg.puzzle plays it for now
  });

  it("a board theme started while lifted starts lifted; lift off lands at a bar line", async () => {
    const { audio, unlock, advance } = await liveEngine("?audio=1");
    unlock();
    audio.music.lift(true);
    audio.music.play("board");
    expect(audio.debug()).toMatchObject({ theme: "board.fairground", lift: true, bpm: 132 * 1.06, transpose: 1 });
    audio.music.lift(false);
    expect(audio.debug()).toMatchObject({ lift: false, bpm: 132 * 1.06 }); // still the bar already planned
    advance(2.5); // past the next bar line (a bar is about 1.7 s)
    expect(audio.debug()).toMatchObject({ lift: false, bpm: 132, transpose: 0 });
  });

  it("lift on reaches a playing board theme but never another theme", async () => {
    const { audio, unlock, advance } = await liveEngine("?audio=1");
    unlock();
    audio.music.play("shop");
    audio.music.lift(true);
    advance(4);
    expect(audio.debug()).toMatchObject({ theme: "shop", lift: true, transpose: 0 });
    audio.music.play("board");
    audio.music.lift(false);
    audio.music.lift(true);
    advance(4);
    expect(audio.debug()).toMatchObject({ theme: "board.fairground", lift: true, bpm: 132 * 1.06, transpose: 1 });
  });

  it("reports the main track's bar lines and the audio time", async () => {
    const { audio, unlock, advance } = await liveEngine("?audio=1");
    unlock();
    audio.music.play("title");
    advance(5);
    const { audioNow, bars } = audio.debug().bars;
    expect(audioNow).toBeCloseTo(FakeAudioContext.last.currentTime, 9);
    expect(bars.length).toBeGreaterThanOrEqual(2);
    expect(bars[0]).toBeCloseTo(0.08, 9); // the first bar line, 80 ms after the start
  });

  it("counts every note a stand-in plays for a missing sample", async () => {
    const { audio, unlock, advance, TRACKS, warn } = await liveEngine("?audio=1");
    TRACKS.__kit = { id: "__kit", bpm: 120, swing: 0.5, loop: true, voices: [{ style: "s:kit.core", pattern: ["K:4 K:4 K:4 K:4"] }] };
    unlock();
    audio.music.play("__kit");
    advance(1.5); // planned through 1.62 s: kicks at 0.08, 0.58, 1.08 and 1.58, before core has loaded
    expect(audio.debug().samples.standInNotes).toBe(4);
    await quiet(audio);
    advance(2); // core is loaded: these kicks play samples
    expect(audio.debug().samples.standInNotes).toBe(4);
    expect(warn).not.toHaveBeenCalled();
  });
});

/* Source guards: the two mistakes that silently broke sounds before. */

const sources = import.meta.glob<string>(["../**/*.ts", "!../**/*.test.ts", "!../**/*.d.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const files = Object.entries(sources).map(([path, text]) => ({ rel: path.slice(3), text }));

describe("sfx call sites", () => {
  it("only name registered sounds", () => {
    expect(files.some((f) => f.rel === "game/turnLoop.ts")).toBe(true);
    const call = /(?:\bsfx|sfx\.play|playSfx|\bsound:|tapSfx:)\s*\(?\s*"([a-zA-Z0-9_.]+)"/g;
    const unknown: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(call)) {
        if (!SFX[m[1]]) unknown.push(`${f.rel}: "${m[1]}"`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("never pass a multiplier as pitch (use rate)", () => {
    // pitch is semitones, so 0.5..1.9 is almost always a multiplier written
    // in the wrong field: it plays a fraction of a semitone sharp.
    const fractional = /\bpitch:\s*(?:0?\.\d+|1\.\d+)\b/g;
    const hits: string[] = [];
    for (const f of files) {
      if (f.rel.startsWith("audio")) continue;
      for (const m of f.text.matchAll(fractional)) hits.push(`${f.rel}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
});
