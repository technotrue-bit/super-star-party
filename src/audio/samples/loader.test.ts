import { describe, expect, it, vi } from "vitest";
import { detectStart, SampleLoader, type LoaderDeps } from "./loader";
import { PROBE_AAC, PROBE_OPUS } from "./probeClips";
import type { InstrumentZones, SampledInstrument, Zone } from "./types";

/* ---- fixtures ---- */

function instrument(set: SampledInstrument["set"]): SampledInstrument {
  return { set, kind: "melodic", standIn: "pad", oneShot: false, release: 0.3, gain: 0.8, velUpper: [1], maxShift: 1.5, maxLen: 0 };
}

function zone(set: string, name: string, root: number): Zone {
  return { root, layer: 0, rr: 0, tune: 0, frames: 4800, file: `${set}/${name}/${root}.abc` };
}

const pianoZones = [60, 64, 67].map((root) => zone("core", "piano", root));
const bellZones = [zone("fairground", "bells", 72)];

const table: Record<string, SampledInstrument> = {
  piano: instrument("core"),
  bells: instrument("fairground"),
};

const zoneTable: Record<string, InstrumentZones> = {
  piano: { source: "fixture", zones: pianoZones },
  bells: { source: "fixture", zones: bellZones },
};

const BASE = "/base/";
const urlOf = (z: Zone, ext = "webm") => `${BASE}music/${z.file}.${ext}`;
const ctx = {} as BaseAudioContext;

/** First byte of every fake file: what decode() looks at. */
const GOOD = 1;
const BAD = 0;
const OPUS_MARK = 10;
const AAC_MARK = 11;

function probeBytes(marker: number): ArrayBuffer {
  return new Uint8Array([marker]).buffer;
}

/** Fakes for the loader's I/O, plus the logs the tests read. */
function harness(over: Partial<LoaderDeps> = {}) {
  const fetched: string[] = [];
  const decoded: number[] = [];
  const missing = new Set<string>(); // URLs that 404
  const corrupt = new Set<string>(); // URLs whose bytes arrive but will not decode
  const undecodable = new Set<number>([BAD]); // markers decode() rejects
  const gate = { wait: null as Promise<void> | null };
  const warn = vi.fn<(msg: string) => void>();

  // A sample whose first audible frame is at 240 / 48000 = 5 ms.
  const data = new Float32Array(4800);
  data[240] = 0.5;
  const audio = { sampleRate: 48000, length: data.length, duration: 0.1, getChannelData: () => data } as unknown as AudioBuffer;

  const deps: LoaderDeps = {
    async fetchBytes(url) {
      fetched.push(url);
      if (gate.wait) await gate.wait;
      if (missing.has(url)) throw new Error(`404 ${url}`);
      return probeBytes(corrupt.has(url) ? BAD : GOOD);
    },
    async decode(_ctx, bytes) {
      // decodeAudioData detaches the ArrayBuffer it is given.
      if (bytes.byteLength === 0) throw new Error("buffer already detached");
      const marker = new Uint8Array(bytes)[0];
      structuredClone(bytes, { transfer: [bytes] });
      decoded.push(marker);
      if (undecodable.has(marker)) throw new Error("EncodingError");
      return audio;
    },
    zones: async () => zoneTable,
    table,
    baseUrl: BASE,
    warn,
    ...over,
  };
  const probes = { opus: probeBytes(OPUS_MARK), aac: probeBytes(AAC_MARK) };
  return { deps, fetched, decoded, missing, corrupt, undecodable, gate, warn, probes, data };
}

type Harness = ReturnType<typeof harness>;

async function loaderFor(h: Harness, force?: "aac" | "synth", fail: number[] = []) {
  for (const marker of fail) h.undecodable.add(marker);
  const loader = new SampleLoader(h.deps);
  await loader.chooseFormat(ctx, h.probes, force);
  return loader;
}

/* ---- format choice ---- */

describe("chooseFormat", () => {
  it("is off until a format is chosen, and load does nothing then", async () => {
    const h = harness();
    const loader = new SampleLoader(h.deps);
    expect(loader.format).toBe("off");
    await loader.load("core", ctx);
    expect(h.fetched).toEqual([]);
    expect(loader.status("core")).toBe("idle");
  });

  it("chooses opus when the opus probe decodes", async () => {
    const h = harness();
    const loader = new SampleLoader(h.deps);
    await expect(loader.chooseFormat(ctx, h.probes)).resolves.toBe("opus");
    expect(loader.format).toBe("opus");
    expect(h.decoded).toEqual([OPUS_MARK]);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("falls back to aac when opus fails", async () => {
    const h = harness();
    const loader = await loaderFor(h, undefined, [OPUS_MARK]);
    expect(loader.format).toBe("aac");
    expect(h.decoded).toEqual([OPUS_MARK, AAC_MARK]);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("uses synth when both probes fail, with one warning", async () => {
    const h = harness();
    const loader = await loaderFor(h, undefined, [OPUS_MARK, AAC_MARK]);
    expect(loader.format).toBe("synth");
    expect(h.decoded).toEqual([OPUS_MARK, AAC_MARK]);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0][0]).toMatch(/^\[audio\]/);
  });

  it("force aac skips the opus probe; force synth skips both", async () => {
    const forcedAac = harness();
    const aac = await loaderFor(forcedAac, "aac");
    expect(aac.format).toBe("aac");
    expect(forcedAac.decoded).toEqual([AAC_MARK]);

    const forcedSynth = harness();
    const synth = await loaderFor(forcedSynth, "synth");
    expect(synth.format).toBe("synth");
    expect(forcedSynth.decoded).toEqual([]);
    expect(forcedSynth.warn).not.toHaveBeenCalled();
  });

  it("force aac on a browser that cannot decode it falls back to synth with one warning", async () => {
    const h = harness();
    const loader = await loaderFor(h, "aac", [AAC_MARK]);
    expect(loader.format).toBe("synth");
    expect(h.warn).toHaveBeenCalledTimes(1);
  });

  it("decodes copies of the probes, so the caller's bytes survive", async () => {
    const h = harness();
    await loaderFor(h);
    expect(h.probes.opus.byteLength).toBe(1);
  });

  it("load does nothing under synth", async () => {
    const h = harness();
    const loader = await loaderFor(h, "synth");
    await loader.load("core", ctx);
    expect(h.fetched).toEqual([]);
    expect(loader.status("core")).toBe("idle");
  });
});

/* ---- loading ---- */

describe("load", () => {
  it("concurrent load fetches each file once", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    const a = loader.load("core", ctx);
    const b = loader.load("core", ctx);
    expect(b).toBe(a);
    expect(loader.status("core")).toBe("loading");
    await Promise.all([a, b]);
    expect(h.fetched).toHaveLength(3);
    expect(new Set(h.fetched).size).toBe(3);
    expect(loader.status("core")).toBe("ready");
    await loader.load("core", ctx);
    expect(h.fetched).toHaveLength(3);
  });

  it("urls use the chosen format", async () => {
    const opus = harness();
    await (await loaderFor(opus)).load("core", ctx);
    expect([...opus.fetched].sort()).toEqual(pianoZones.map((z) => urlOf(z)).sort());
    expect(opus.fetched).toContain("/base/music/core/piano/60.abc.webm");

    const aac = harness();
    await (await loaderFor(aac, undefined, [OPUS_MARK])).load("core", ctx);
    expect([...aac.fetched].sort()).toEqual(pianoZones.map((z) => urlOf(z, "m4a")).sort());
  });

  it("a file two zones share is fetched and decoded once", async () => {
    // A kit token recorded at one dynamic lists the same file on both velocity layers.
    const soft = { token: "B", layer: 0, rr: 0, tune: 0, frames: 4800, file: "core/kit/B-v0.abc" };
    const loud = { ...soft, layer: 1 };
    const kit: SampledInstrument = { ...instrument("core"), kind: "kit", velUpper: [0.6, 1] };
    const h = harness({
      table: { kit },
      zones: async () => ({ kit: { source: "fixture", zones: [soft, loud] } }),
    });
    const loader = await loaderFor(h);
    await loader.load("core", ctx);
    expect(h.fetched).toEqual([urlOf(soft)]);
    expect(h.decoded).toEqual([OPUS_MARK, GOOD]); // the format probe, then the file
    expect(loader.status("core")).toBe("ready");
    expect(loader.buffer("kit", loud)).toBe(loader.buffer("kit", soft));
  });

  it("loads only the files of the requested set", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    await loader.load("fairground", ctx);
    expect(h.fetched).toEqual([urlOf(bellZones[0])]);
    expect(loader.status("fairground")).toBe("ready");
    expect(loader.status("core")).toBe("idle");
    expect(loader.buffer("piano", pianoZones[0])).toBeNull();
  });

  it("a set with no instruments is ready at once", async () => {
    const zones = vi.fn(async () => zoneTable);
    const h = harness({ zones });
    const loader = await loaderFor(h);
    await loader.load("cruise", ctx);
    expect(loader.status("cruise")).toBe("ready");
    expect(h.fetched).toEqual([]);
    expect(zones).not.toHaveBeenCalled();
  });

  it("buffer() looks the decoded file up by zone and records where the sound starts", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    await loader.load("core", ctx);
    const got = loader.buffer("piano", pianoZones[1]);
    expect(got).not.toBeNull();
    expect(got!.start).toBeCloseTo(0.005, 6);
    expect(got!.buffer.sampleRate).toBe(48000);
    expect(loader.buffer("piano", zone("core", "piano", 99))).toBeNull();
  });

  it("failed file retried once then stand-in", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    const bad = pianoZones[0];
    h.missing.add(urlOf(bad));

    await loader.load("core", ctx);
    expect(h.fetched).toHaveLength(3);
    expect(loader.failed()).toEqual([]);
    expect(loader.buffer("piano", bad)).toBeNull();
    expect(loader.buffer("piano", pianoZones[1])).not.toBeNull();
    expect(loader.status("core")).toBe("idle"); // not ready, not yet failed: the next load retries
    expect(h.warn).not.toHaveBeenCalled();

    await loader.load("core", ctx);
    expect(h.fetched).toHaveLength(4); // only the file that failed
    expect(h.fetched[3]).toBe(urlOf(bad));
    expect(loader.failed()).toEqual(["piano"]);
    expect(loader.status("core")).toBe("failed");
    expect(loader.buffer("piano", bad)).toBeNull();
    expect(loader.buffer("piano", pianoZones[2])).not.toBeNull(); // the rest of the set still plays
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0][0]).toMatch(/^\[audio\]/);

    await loader.load("core", ctx);
    expect(h.fetched).toHaveLength(4);
    expect(h.warn).toHaveBeenCalledTimes(1);
  });

  it("a decode failure counts like a fetch failure", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    const bad = pianoZones[2];
    h.corrupt.add(urlOf(bad));
    await loader.load("core", ctx);
    await loader.load("core", ctx);
    expect(h.fetched.filter((u) => u === urlOf(bad))).toHaveLength(2); // refetched, since its bytes were no good
    expect(loader.failed()).toEqual(["piano"]);
    expect(loader.status("core")).toBe("failed");
    expect(loader.buffer("piano", bad)).toBeNull();
    expect(loader.buffer("piano", pianoZones[0])).not.toBeNull();
  });

  it("failed() lists an instrument once however many of its files failed", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    h.missing.add(urlOf(pianoZones[0]));
    h.missing.add(urlOf(pianoZones[1]));
    await loader.load("core", ctx);
    await loader.load("core", ctx);
    expect(loader.failed()).toEqual(["piano"]);
    expect(h.warn).toHaveBeenCalledTimes(2); // one per file
  });

  it("a file that recovers on the retry leaves the set ready", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    h.missing.add(urlOf(pianoZones[0]));
    await loader.load("core", ctx);
    h.missing.clear();
    await loader.load("core", ctx);
    expect(loader.status("core")).toBe("ready");
    expect(loader.failed()).toEqual([]);
    expect(loader.buffer("piano", pianoZones[0])).not.toBeNull();
  });

  it("load never rejects when zones() throws", async () => {
    for (const zones of [
      () => {
        throw new Error("chunk gone");
      },
      () => Promise.reject(new Error("chunk gone")),
    ]) {
      const h = harness({ zones });
      const loader = await loaderFor(h);
      await expect(loader.load("core", ctx)).resolves.toBeUndefined();
      expect(loader.status("core")).toBe("failed");
      expect(h.warn).toHaveBeenCalledTimes(1);
      expect(h.warn.mock.calls[0][0]).toMatch(/^\[audio\]/);
      expect(h.fetched).toEqual([]);
    }
  });

  it("asks for the tables once; later loads fail quietly", async () => {
    const zones = vi.fn(async (): Promise<Record<string, InstrumentZones>> => {
      throw new Error("chunk gone");
    });
    const h = harness({ zones });
    const loader = await loaderFor(h);
    await loader.load("core", ctx);
    await loader.load("fairground", ctx);
    expect(zones).toHaveBeenCalledTimes(1);
    expect(loader.status("fairground")).toBe("failed");
    expect(h.warn).toHaveBeenCalledTimes(1);
  });
});

/* ---- memory ---- */

describe("releaseDecoded and free", () => {
  it("releaseDecoded keeps bytes; load re-decodes without fetching", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    await loader.load("core", ctx);
    const before = h.decoded.length;

    loader.releaseDecoded("core");
    expect(loader.status("core")).toBe("idle");
    for (const z of pianoZones) expect(loader.buffer("piano", z)).toBeNull();

    await loader.load("core", ctx);
    expect(h.fetched).toHaveLength(3);
    expect(h.decoded.length - before).toBe(3); // decode() would have rejected a detached copy
    expect(loader.status("core")).toBe("ready");
    expect(loader.buffer("piano", pianoZones[0])!.start).toBeCloseTo(0.005, 6);
  });

  it("free drops bytes; load fetches again", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    await loader.load("core", ctx);

    loader.free("core");
    expect(loader.status("core")).toBe("idle");
    for (const z of pianoZones) expect(loader.buffer("piano", z)).toBeNull();

    await loader.load("core", ctx);
    expect(h.fetched).toHaveLength(6);
    expect(loader.status("core")).toBe("ready");
  });

  it("a release or free does not touch other sets", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    await loader.load("core", ctx);
    await loader.load("fairground", ctx);
    loader.free("core");
    expect(loader.status("fairground")).toBe("ready");
    expect(loader.buffer("bells", bellZones[0])).not.toBeNull();
  });

  it("a file that failed twice stays on its stand-in through release and free", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    h.missing.add(urlOf(pianoZones[0]));
    await loader.load("core", ctx);
    await loader.load("core", ctx);
    loader.free("core");
    await loader.load("core", ctx);
    expect(h.fetched.filter((u) => u === urlOf(pianoZones[0]))).toHaveLength(2);
    expect(loader.failed()).toEqual(["piano"]);
    expect(loader.status("core")).toBe("failed");
  });

  describe.each(["releaseDecoded", "free"] as const)("%s while a load is in flight", (drop) => {
    it.each(["before any fetch starts", "with every fetch under way"])("keeps nothing from that load, %s", async (when) => {
      const h = harness();
      const loader = await loaderFor(h);
      let open!: () => void;
      h.gate.wait = new Promise<void>((resolve) => (open = resolve));

      const first = loader.load("core", ctx);
      if (when !== "before any fetch starts") await vi.waitFor(() => expect(h.fetched).toHaveLength(3));
      loader[drop]("core");
      expect(loader.status("core")).toBe("idle");
      open();
      await first;
      expect(loader.status("core")).toBe("idle");
      for (const z of pianoZones) expect(loader.buffer("piano", z)).toBeNull();
      if (when === "before any fetch starts") expect(h.fetched).toEqual([]); // nothing worth fetching

      h.gate.wait = null;
      await loader.load("core", ctx);
      expect(loader.status("core")).toBe("ready");
      for (const z of pianoZones) expect(loader.buffer("piano", z)).not.toBeNull();
    });
  });

  it("a load asked for during a stale one waits for it, then loads", async () => {
    const h = harness();
    const loader = await loaderFor(h);
    let openStale!: () => void;
    let openFresh!: () => void;
    h.gate.wait = new Promise<void>((resolve) => (openStale = resolve));

    const stale = loader.load("core", ctx);
    await vi.waitFor(() => expect(h.fetched).toHaveLength(3));
    loader.releaseDecoded("core");
    const fresh = loader.load("core", ctx);
    expect(fresh).not.toBe(stale);
    expect(loader.status("core")).toBe("loading");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.fetched).toHaveLength(3); // the fresh load has not started: the stale one is still running

    h.gate.wait = new Promise<void>((resolve) => (openFresh = resolve));
    openStale();
    await stale;
    expect(loader.status("core")).toBe("loading"); // the stale load does not report over the fresh one
    openFresh();
    await fresh;
    expect(loader.status("core")).toBe("ready");
    expect(h.fetched).toHaveLength(6); // the stale load kept nothing, so the fresh one fetched again
    for (const z of pianoZones) expect(loader.buffer("piano", z)).not.toBeNull();
  });
});

/* ---- detectStart ---- */

describe("detectStart", () => {
  it("finds the first sample above -50 dBFS", () => {
    const at48k = new Float32Array(1000);
    at48k[480] = 0.01;
    expect(detectStart(at48k, 48000)).toBeCloseTo(0.01, 9);

    const at44k = new Float32Array(1000);
    at44k[441] = 0.01;
    expect(detectStart(at44k, 44100)).toBeCloseTo(0.01, 9);

    expect(detectStart(new Float32Array(1000), 48000)).toBe(0);
  });

  it("skips what is below the threshold and reads negative samples", () => {
    const quiet = new Float32Array(1000);
    quiet[100] = 0.002; // about -54 dBFS
    quiet[300] = -0.5;
    expect(detectStart(quiet, 48000)).toBeCloseTo(300 / 48000, 9);
  });

  it("takes the threshold in dB", () => {
    const s = new Float32Array(1000);
    s[100] = 0.002;
    expect(detectStart(s, 48000, -60)).toBeCloseTo(100 / 48000, 9);
    expect(detectStart(s, 48000)).toBe(0);
  });
});

/* ---- probe clips ---- */

describe("probe clips", () => {
  const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  it("are a WebM (Opus) file and an M4A (AAC) file, each small", () => {
    const opus = bytesOf(PROBE_OPUS);
    expect([...opus.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]); // EBML header
    expect(new TextDecoder().decode(opus)).toContain("A_OPUS");

    const aac = bytesOf(PROBE_AAC);
    expect(new TextDecoder().decode(aac.slice(4, 12))).toBe("ftypM4A ");
    expect(new TextDecoder().decode(aac)).toContain("mp4a");

    expect(PROBE_OPUS.length + PROBE_AAC.length).toBeLessThan(4096);
  });
});
