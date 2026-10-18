/**
 * SUPER STAR PARTY — sample loader: picks the audio format this browser can decode, then
 * fetches and decodes a set's files, keeps the fetched bytes so a set can be released and
 * re-decoded without the network, and retries a failed file once before leaving its
 * instrument on the synth stand-in. All I/O goes through `LoaderDeps`, so this module is
 * safe to import anywhere and the tests run on fakes.
 */

import type { InstrumentZones, LoadedBuffer, SampledInstrument, SetId, Zone } from "./types";

/**
 * `idle`: nothing is loaded and `load()` has work to do (before the first load, after
 * `releaseDecoded` or `free`, or while a file that failed once awaits its retry).
 * `ready`: every file decoded. `failed`: at least one file failed twice (the rest still plays).
 */
export type SetStatus = "idle" | "loading" | "ready" | "failed";

/** `synth`: no usable format, stay on stand-ins. `off`: not chosen yet. */
export type Format = "opus" | "aac" | "synth" | "off";

export interface LoaderDeps {
  fetchBytes(url: string): Promise<ArrayBuffer>;
  decode(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer>;
  zones(): Promise<Record<string, InstrumentZones>>;
  table: Record<string, SampledInstrument>;
  baseUrl: string;
  warn(msg: string): void;
}

/** A file that fails this many times is never fetched again. */
const MAX_FAILURES = 2;

const EXTENSION = { opus: "webm", aac: "m4a" } as const;

/** Seconds to the first sample louder than `thresholdDb` (dBFS); 0 for silence. */
export function detectStart(samples: Float32Array, sampleRate: number, thresholdDb = -50): number {
  const limit = 10 ** (thresholdDb / 20);
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > limit) return i / sampleRate;
  }
  return 0;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface FileState {
  instrument: string;
  zone: Zone;
  /** The fetched file, kept (once it has decoded) so a release can re-decode without the network. */
  bytes: ArrayBuffer | null;
  loaded: LoadedBuffer | null;
  failures: number;
}

interface SetState {
  status: SetStatus;
  /** Known after the first successful read of the zone tables. */
  files: FileState[] | null;
  inflight: { epoch: number; promise: Promise<void> } | null;
  /** Bumped by release and free: a load that began earlier keeps nothing it finishes. */
  epoch: number;
}

export class SampleLoader {
  private _format: Format = "off";
  private readonly sets = new Map<SetId, SetState>();
  private readonly files = new Map<string, FileState>();
  private readonly failedInstruments = new Set<string>();
  private zoneTables: Promise<Record<string, InstrumentZones>> | null = null;

  constructor(private readonly deps: LoaderDeps) {}

  get format(): Format {
    return this._format;
  }

  /**
   * Test-decodes the embedded probe clips and settles on the first format that works: opus, then aac.
   * `force` skips the opus probe ("aac") or both ("synth"). With nothing decodable, one warning.
   */
  async chooseFormat(
    ctx: BaseAudioContext,
    probes: { opus: ArrayBuffer; aac: ArrayBuffer },
    force?: "aac" | "synth",
  ): Promise<Format> {
    if (force === "synth") return (this._format = "synth");
    if (force !== "aac" && (await this.canDecode(ctx, probes.opus))) return (this._format = "opus");
    if (await this.canDecode(ctx, probes.aac)) return (this._format = "aac");
    this.deps.warn("[audio] this browser decoded neither the Opus nor the AAC test clip; music stays on synth voices");
    return (this._format = "synth");
  }

  /**
   * Fetches and decodes every file of the set. Never rejects. Concurrent calls share one load.
   * Under `synth` or `off` it does nothing.
   */
  load(set: SetId, ctx: BaseAudioContext): Promise<void> {
    if (this._format !== "opus" && this._format !== "aac") return Promise.resolve();
    const st = this.state(set);
    const current = st.inflight;
    if (current && current.epoch === st.epoch) return current.promise;

    const instruments = Object.keys(this.deps.table).filter((name) => this.deps.table[name].set === set);
    if (instruments.length === 0) {
      st.status = "ready";
      return Promise.resolve();
    }

    st.status = "loading";
    const epoch = st.epoch;
    // A load that a release or free left behind is still running: let it settle first, so
    // the two never fetch the same file at once.
    const behind = current?.promise;
    const promise: Promise<void> = (async () => {
      await behind;
      await this.run(st, instruments, ctx, epoch);
    })().finally(() => {
      if (st.inflight?.promise === promise) st.inflight = null;
    });
    st.inflight = { epoch, promise };
    return promise;
  }

  /** Drops the decoded buffers of a set but keeps its fetched bytes. */
  releaseDecoded(set: SetId): void {
    this.drop(set, false);
  }

  /** Drops the decoded buffers and the fetched bytes of a set. */
  free(set: SetId): void {
    this.drop(set, true);
  }

  status(set: SetId): SetStatus {
    return this.sets.get(set)?.status ?? "idle";
  }

  /** Instruments that have a file on stand-in for the rest of the session, each listed once. */
  failed(): string[] {
    return [...this.failedInstruments];
  }

  /** The decoded sample for a zone, or null while it is not loaded. Looked up by `zone.file`. */
  buffer(_instrument: string, zone: Zone): LoadedBuffer | null {
    return this.files.get(zone.file)?.loaded ?? null;
  }

  private async canDecode(ctx: BaseAudioContext, probe: ArrayBuffer): Promise<boolean> {
    try {
      await this.deps.decode(ctx, probe.slice(0)); // decoding detaches the buffer it is given
      return true;
    } catch {
      return false;
    }
  }

  private state(set: SetId): SetState {
    let st = this.sets.get(set);
    if (!st) {
      st = { status: "idle", files: null, inflight: null, epoch: 0 };
      this.sets.set(set, st);
    }
    return st;
  }

  private drop(set: SetId, bytes: boolean): void {
    const st = this.state(set);
    st.epoch++;
    st.status = "idle";
    for (const f of st.files ?? []) {
      f.loaded = null;
      if (bytes) f.bytes = null;
    }
  }

  private async run(st: SetState, instruments: string[], ctx: BaseAudioContext, epoch: number): Promise<void> {
    if (st.epoch !== epoch) return; // released or freed while waiting its turn
    let files: FileState[];
    try {
      st.files ??= await this.listFiles(instruments);
      files = st.files;
    } catch {
      if (st.epoch === epoch) st.status = "failed"; // warned once, where the tables were asked for
      return;
    }
    await Promise.all(files.map((f) => this.loadFile(st, f, ctx, epoch)));
    if (st.epoch !== epoch) return;
    if (files.some((f) => f.failures >= MAX_FAILURES)) st.status = "failed";
    else if (files.every((f) => f.loaded)) st.status = "ready";
    else st.status = "idle"; // a file failed once: the next load retries it
  }

  /** The zone tables are asked for once per session, failure included: one warning, and no hammering of a chunk that is gone. */
  private zoneTable(): Promise<Record<string, InstrumentZones>> {
    this.zoneTables ??= Promise.resolve()
      .then(() => this.deps.zones())
      .catch((err: unknown) => {
        this.deps.warn(`[audio] could not read the sample tables; every instrument stays on its stand-in: ${message(err)}`);
        throw err;
      });
    return this.zoneTables;
  }

  private async listFiles(instruments: string[]): Promise<FileState[]> {
    const tables = await this.zoneTable();
    const files: FileState[] = [];
    for (const instrument of instruments) {
      for (const zone of tables[instrument]?.zones ?? []) {
        let f = this.files.get(zone.file);
        if (!f) {
          f = { instrument, zone, bytes: null, loaded: null, failures: 0 };
          this.files.set(zone.file, f);
        }
        if (!files.includes(f)) files.push(f); // zones may share a file (a kit layer reusing another's)
      }
    }
    return files;
  }

  private async loadFile(st: SetState, f: FileState, ctx: BaseAudioContext, epoch: number): Promise<void> {
    if (f.loaded || f.failures >= MAX_FAILURES) return;
    try {
      const bytes = f.bytes ?? (await this.deps.fetchBytes(this.url(f.zone)));
      const buffer = await this.deps.decode(ctx, bytes.slice(0)); // decoding detaches what it is given; keep the original
      if (st.epoch !== epoch) return; // released or freed while this was in flight
      f.bytes = bytes;
      f.loaded = { buffer, start: detectStart(buffer.getChannelData(0), buffer.sampleRate) };
    } catch (err) {
      f.bytes = null; // the next try starts from the network
      f.failures++;
      if (f.failures >= MAX_FAILURES) {
        this.failedInstruments.add(f.instrument);
        this.deps.warn(`[audio] ${f.zone.file} failed twice (${message(err)}); "${f.instrument}" stays on its stand-in`);
      }
    }
  }

  private url(zone: Zone): string {
    const ext = EXTENSION[this._format as "opus" | "aac"];
    return `${this.deps.baseUrl}music/${zone.file}.${ext}`;
  }
}
