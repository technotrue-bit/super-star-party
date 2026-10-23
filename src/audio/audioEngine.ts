/**
 * SUPER STAR PARTY — Web Audio engine (public API).
 *
 * Contract (kept byte-compatible with the wave-0 stub):
 *   audio.ready                      Promise (resolved)
 *   audio.unlock()                   create/resume context (first gesture)
 *   audio.master.gain                0..1 master volume
 *   audio.music.volume               [added] 0..1 music bus volume
 *   audio.sfx.volume                 [added] 0..1 sfx bus volume
 *   audio.music.play(track, opts?)   start a looping track
 *   audio.music.stop(fade?)          fade out current track
 *   audio.music.track()              name of current track / 'silence'
 *   audio.music.theme()              [added] the theme it resolved to / 'silence'
 *   audio.music.intensity(level)     0..1 dynamic layers
 *   audio.music.lift(on)             [added] final-turns lift (board themes)
 *   audio.music.setBoard(id)         [added] board for "board"; loads its sample set
 *   audio.music.tracks()             [added] registered track ids + aliases
 *   audio.sfx.play(name, opts?)      one-shot sound effect
 *   audio.sfx.stopAll()              cut all active one-shots
 *   audio.levels()                   {rms, peak} live analyser
 *   audio.debug()                    [added] theme, lift, tempo, samples, bars
 *   audio.renderTrack(track, seconds, opts?) -> Promise<Blob> offline WAV render
 *
 * "board", "minigame_a" and "minigame_b" are aliases: the music director
 * resolves them to a theme by board and minigame genre. Notes play through
 * the sampler, which uses a synth stand-in for any sample not loaded yet.
 *
 * Bus topology:
 *   music voices -> layer gains -> trackGain -> musicGain -> musicComp -> master
 *   sfx    -> sfxGain   -> sfxComp   -> master
 *   crowd  -> crowdGain -> crowdComp -> master
 *   master -> limiter (threshold -6dB, ratio 4, makeup +3dB) -> analyser -> out
 *
 * Safety: with ?audio=0 or a failed AudioContext every method no-ops
 * (track() -> 'silence', play() safe, levels() -> zeros). The game never
 * crashes without audio.
 */

import { bus } from "../core/events";
import { settings } from "../config/settings";
import { TRACKS, trackIds, trackSets } from "./music/tracks";
import type { TrackDef } from "./music/tracks";
import { Sequencer, scheduleTrackInto } from "./music/sequencer";
import { Director, boardSet, playableId, resolveTheme } from "./music/director";
import type { SequencerControl } from "./music/director";
import type { NotePlayer } from "./music/player";
import { createSamplerPlayer } from "./samples/sampler";
import { SampleLoader } from "./samples/loader";
import type { Format, SetStatus } from "./samples/loader";
import { SAMPLED } from "./samples/instruments.gen";
import { PROBE_AAC, PROBE_OPUS } from "./samples/probeClips";
import type { InstrumentZones, SetId } from "./samples/types";
import { startCrowdMurmur, wireCrowdReactions } from "./music/crowd";
import type { CrowdHandle } from "./music/crowd";
import { SFX, resolvePitch } from "./sfx/sounds";
import type { SfxPlayOpts } from "./sfx/sounds";
import type { StopFn } from "./sfx/synth";

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
let disabled = false; // audio=0 param or context creation failure
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let crowdGain: GainNode | null = null;
let stingerGain: GainNode | null = null;
let duckGain: GainNode | null = null;

let sequencer: Sequencer | null = null;
let trackGain: GainNode | null = null;
let currentTrack = "";
let currentIntensity = 0.5;
/** The main track's theme and tempo, for theme() and the director's lift; null when nothing plays. */
let nowPlaying: SequencerControl | null = null;

let stingerSeq: Sequencer | null = null;
let stingerTrackGain: GainNode | null = null;

/** `music` (a minigame's rhythm anchor) is accepted and ignored until the anchor is wired. */
interface PlayOpts {
  intensity?: number;
  genre?: string;
  music?: { bpm: number; beat0: number };
}

interface PendingPlay {
  track: string;
  opts?: PlayOpts;
}
let pendingTrack: PendingPlay | null = null;

const director = new Director(() => nowPlaying);

/* Samples. No loader exists under ?audio=0, so nothing is ever fetched. */
let loader: SampleLoader | null = null;
let formatStarted = false;
/** Every set asked for (tracks, board). Asked before the format is known, a set loads once it is. */
const wantedSets = new Set<SetId>();
let boardSetId: SetId | null = null;
let standInNotes = 0;
/** Zone tables for the sampler's synchronous reads: {} (every note on its stand-in) until the module arrives. */
let zoneTable: Record<string, InstrumentZones> = {};

/** The generated zone tables, loaded on first use (kept out of the main bundle). */
function loadZones(): Promise<Record<string, InstrumentZones>> {
  return import("./samples/zones.gen").then((m) => (zoneTable = m.ZONES));
}

/** Plays every live note: samples where loaded, synth stand-ins everywhere else. */
const livePlayer: NotePlayer = createSamplerPlayer({
  table: SAMPLED,
  zones: () => zoneTable,
  buffer: (inst, zone) => loader?.buffer(inst, zone) ?? null,
  onStandIn: () => void standInNotes++,
});

let crowd: CrowdHandle | null = null;
let reactionsWired = false;
let visibilityWired = false;

const lastPlay = new Map<string, number>();
const activeStops: Array<{ stop: StopFn; until: number }> = [];

// Bus volumes live here, not on the nodes, so they can be set before the
// first gesture builds the graph. Saved slider values load at startup so
// every entry point (not only the title screen) gets them.
const LS_MUSIC = "ssp.musicVolume";
const LS_SFX = "ssp.sfxVolume";

function clampVolume(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function savedVolume(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : clampVolume(parseFloat(raw), fallback);
  } catch {
    return fallback; // no storage (node, private mode)
  }
}

let musicVolume = savedVolume(LS_MUSIC, settings.musicVolume);
let sfxVolume = savedVolume(LS_SFX, settings.sfxVolume);

/** A URL query flag, or null outside a browser. */
function urlParam(name: string): string | null {
  try {
    return typeof window !== "undefined" ? new URLSearchParams(window.location.search).get(name) : null;
  } catch {
    return null; // URL parsing must never break the game
  }
}

if (urlParam("audio") === "0") disabled = true;

/** `?samples=0` keeps every note on its synth stand-in; `?audiofmt=aac` skips the Opus probe. */
function forcedFormat(): "aac" | "synth" | undefined {
  if (urlParam("samples") === "0") return "synth";
  if (urlParam("audiofmt") === "aac") return "aac";
  return undefined;
}

/** audio.ready — resolves immediately (stub-compatible). */
export const ready: Promise<void> = Promise.resolve();

/* ------------------------------------------------------------------ */
/*  Graph construction                                                 */
/* ------------------------------------------------------------------ */

function makeCompressor(
  c: BaseAudioContext,
  threshold: number,
  ratio: number,
  makeupDb: number,
  attack: number,
  release: number,
): GainNode {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = threshold;
  comp.knee.value = 12;
  comp.ratio.value = ratio;
  comp.attack.value = attack;
  comp.release.value = release;
  const makeup = c.createGain();
  makeup.gain.value = Math.pow(10, makeupDb / 20);
  comp.connect(makeup);
  return makeup; // output of the comp+makeup pair
}

/**
 * Final safety net: piecewise soft-clipper that only engages above ~-1.4 dBFS,
 * so limiter attack transients can never reach full scale. Inaudible in use.
 */
function makeSafetyClipper(c: BaseAudioContext): WaveShaperNode {
  const ws = c.createWaveShaper();
  ws.oversample = "4x";
  const n = 2048;
  const curve = new Float32Array(n);
  const knee = 0.85;
  const slope = 0.12;
  const cap = 0.95;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    let y = x;
    if (ax > knee) y = Math.sign(x) * Math.min(cap, knee + (ax - knee) * slope);
    curve[i] = y;
  }
  ws.curve = curve;
  return ws;
}

function buildGraph(c: AudioContext): void {
  master = c.createGain();
  master.gain.value = settings.masterVolume;

  // music bus:
  //   trackGain (board track) -> duckGain -> musicGain -> musicComp -> master
  //   stingerGain (stinger track) -> musicGain (bypasses duck — plays at full level)
  musicGain = c.createGain();
  musicGain.gain.value = musicVolume;
  const musicComp = makeCompressor(c, -18, 2.5, 2.5, 0.01, 0.22);
  musicGain.connect(musicComp);
  musicComp.connect(master);

  // duckGain: wraps the board track so we can dip it under stingers/ceremonies.
  duckGain = c.createGain();
  duckGain.gain.value = 1.0;
  duckGain.connect(musicGain);

  // stingerGain: parallel path for stingers — bypasses the duck so the
  // fanfare/ceremony cuts through at full level while the board track dips.
  stingerGain = c.createGain();
  stingerGain.gain.value = 0.5;
  stingerGain.connect(musicGain);

  // sfx bus
  sfxGain = c.createGain();
  sfxGain.gain.value = sfxVolume;
  const sfxComp = makeCompressor(c, -14, 3, 2, 0.004, 0.12);
  sfxGain.connect(sfxComp);
  sfxComp.connect(master);

  // crowd bus (murmur + reactions)
  crowdGain = c.createGain();
  crowdGain.gain.value = settings.crowdVolume;
  const crowdComp = makeCompressor(c, -16, 2.5, 2, 0.02, 0.25);
  crowdGain.connect(crowdComp);
  crowdComp.connect(master);

  // master limiter -> safety clipper -> analyser -> destination
  // true limiter: high ratio + low ceiling so peaks can never exceed ~-6.5 dBFS
  const limiter = makeCompressor(c, -8, 20, 1.5, 0.002, 0.2);
  master.connect(limiter);
  const clipper = makeSafetyClipper(c);
  limiter.connect(clipper);
  analyser = c.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  clipper.connect(analyser);
  analyser.connect(c.destination);

  // crowd murmur pad (the party is never silent)
  crowd = startCrowdMurmur(c, crowdGain);

  if (!reactionsWired) {
    reactionsWired = true;
    wireCrowdReactions((name, volume) => {
      // route through the same throttled sfx path (crowd route)
      if (ctx && !disabled) playSfx(name, { volume }, true);
    });
  }

  if (!visibilityWired && typeof document !== "undefined") {
    visibilityWired = true;
    document.addEventListener("visibilitychange", () => {
      if (!ctx || disabled) return;
      if (document.visibilityState === "visible" && ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }
    });
  }
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  if (disabled) return null;
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      disabled = true;
      return null;
    }
    ctx = new AC();
    buildGraph(ctx);
  } catch {
    ctx = null;
    disabled = true;
    return null;
  }
  loader = createLoader();
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Samples                                                            */
/* ------------------------------------------------------------------ */

function createLoader(): SampleLoader {
  return new SampleLoader({
    fetchBytes: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    },
    decode: (c, bytes) => c.decodeAudioData(bytes),
    zones: loadZones,
    table: SAMPLED,
    baseUrl: import.meta.env.BASE_URL,
    warn: (msg) => console.warn(msg),
  });
}

function base64Bytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Fresh copies of the embedded probe clips (decoding detaches a buffer). */
function probeClips(): { opus: ArrayBuffer; aac: ArrayBuffer } {
  return { opus: base64Bytes(PROBE_OPUS), aac: base64Bytes(PROBE_AAC) };
}

/** The sample sets a track needs. */
function setsOf(def: TrackDef): SetId[] {
  return trackSets(def);
}

/** Load a set now, or once the format is known. Never awaited: music starts on stand-ins. */
function requestSet(set: SetId): void {
  if (disabled) return;
  wantedSets.add(set);
  if (loader && ctx) void loader.load(set, ctx);
}

/** First unlock: pick the format, then load core and every set asked for so far. */
function startSamples(c: AudioContext): void {
  const l = loader;
  if (!l || formatStarted) return;
  formatStarted = true;
  wantedSets.add("core");
  void Promise.resolve()
    .then(() => l.chooseFormat(c, probeClips(), forcedFormat()))
    .then(() => {
      void l.load("core", c);
      for (const set of wantedSets) void l.load(set, c);
    })
    .catch((err: unknown) => console.warn(`[audio] sample format check failed; music stays on synth voices: ${String(err)}`));
}

/* ------------------------------------------------------------------ */
/*  Music                                                              */
/* ------------------------------------------------------------------ */

/** What plays for a request: the theme it resolves to and the track that plays it, or null for an unknown id. */
function resolveTrack(track: string, by: { board?: string; genre?: string }): { theme: string; id: string; def: TrackDef } | null {
  const theme = resolveTheme(track, by);
  const id = playableId(theme, TRACKS);
  return id ? { theme, id, def: TRACKS[id] } : null;
}

function startTrack(track: string, opts?: PlayOpts): void {
  if (!ctx) return;
  const resolved = resolveTrack(track, { board: director.board, genre: opts?.genre });
  if (!resolved) {
    console.warn(`[audio] unknown track '${track}'`);
    return;
  }
  const { theme, def } = resolved;
  // quick-fade whatever is playing
  if (sequencer) {
    sequencer.stop(0.12);
    sequencer.onEnded = null;
    bus.emit("audio:track", { track: currentTrack, playing: false });
  }
  trackGain = ctx.createGain();
  trackGain.gain.value = 0.3; // headroom trim: mix targets ~-14 LUFS feel
  trackGain.connect(duckGain!);
  for (const set of setsOf(def)) requestSet(set);
  // Constructed and started in one go: the sequencer fixes its start time when it is made.
  const seq = new Sequencer(ctx, trackGain, def, { ...director.startOptions(theme, def.bpm), player: livePlayer });
  seq.onEnded = () => {
    if (sequencer !== seq) return; // a newer track replaced us
    sequencer = null;
    trackGain = null;
    currentTrack = "";
    nowPlaying = null;
    bus.emit("audio:track", { track, playing: false });
  };
  if (opts?.intensity !== undefined) currentIntensity = Math.min(1, Math.max(0, opts.intensity));
  seq.setIntensity(currentIntensity);
  seq.start();
  sequencer = seq;
  currentTrack = track;
  nowPlaying = { theme, baseBpm: def.bpm, queueChange: (c) => seq.queueChange(c) };
  bus.emit("audio:track", { track, playing: true });
}

/* ------------------------------------------------------------------ */
/*  SFX                                                                */
/* ------------------------------------------------------------------ */

function playSfx(name: string, opts?: SfxPlayOpts, internal = false): void {
  if (disabled || !ctx) return;
  const def = SFX[name];
  if (!def) {
    console.warn(`[audio] unknown sfx '${name}'`);
    return;
  }
  const nowMs = performance.now();
  const gap = def.gap ?? settings.sfxMinGapMs;
  const last = lastPlay.get(name) ?? -Infinity;
  if (nowMs - last < gap) return;
  lastPlay.set(name, nowMs);

  const t = ctx.currentTime + 0.01;
  const out = def.route === "crowd" ? crowdGain! : sfxGain!;
  const vol = opts?.volume ?? 1;
  const pitch = resolvePitch(opts);
  const stop = def.build(ctx, out, t, { vol, pitch });
  activeStops.push({ stop, until: t + 6 });
  if (!internal) bus.emit("audio:sfx", { name });
}

/** Prune finished one-shots so the list never grows unbounded. */
function pruneStops(): void {
  const now = ctx ? ctx.currentTime : 0;
  for (let i = activeStops.length - 1; i >= 0; i--) {
    if (activeStops[i].until < now - 1) activeStops.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ */
/*  Offline render + WAV                                               */
/* ------------------------------------------------------------------ */

function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const dataLen = buffer.length * numCh * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const view = new DataView(ab);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface AudioDebug {
  /** The playing theme, or "silence". */
  theme: string;
  /** Whether the final-turns lift is on (board themes play it). */
  lift: boolean;
  /** Tempo and transpose of the main track as scheduled; 0 when nothing plays. */
  bpm: number;
  transpose: number;
  samples: { format: Format; sets: Record<string, SetStatus>; failed: string[]; standInNotes: number };
  /** The rhythm anchor; always null until it is wired. */
  anchor: null;
  /** AudioContext time now, and the times of the main track's last 8 scheduled bar lines. */
  bars: { audioNow: number; bars: number[] };
}

function themeNow(): string {
  return nowPlaying?.theme ?? "silence";
}

/** Call from the first pointer/key gesture. Safe to call repeatedly. */
export function unlock(): void {
  const c = ensureContext();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  startSamples(c);
  if (pendingTrack) {
    const p = pendingTrack;
    pendingTrack = null;
    startTrack(p.track, p.opts);
  }
}

export const audio = {
  ready,
  unlock,

  master: {
    get gain(): number {
      return master?.gain.value ?? 1;
    },
    set gain(v: number) {
      if (master) master.gain.value = v;
    },
  },

  music: {
    /** [added] Music bus volume 0..1 (applies now, or when audio starts). */
    get volume(): number {
      return musicVolume;
    },
    set volume(v: number) {
      musicVolume = clampVolume(v, musicVolume);
      if (musicGain) musicGain.gain.value = musicVolume;
    },

    /** Start a track; "board" and "minigame_*" resolve by board and `genre`. */
    play(track: string, opts?: PlayOpts): void {
      console.log(`[AUDIO_PLAY] ${track} t=${performance.now().toFixed(1)}`);
      if (!resolveTrack(track, { board: director.board, genre: opts?.genre })) {
        console.warn(`[audio] unknown track '${track}'`);
        return;
      }
      if (disabled) return; // silent mode: track() stays 'silence'
      if (!ctx) {
        pendingTrack = { track, opts };
        return; // starts on first unlock() gesture
      }
      startTrack(track, opts);
    },

    /**
     * Play a one-shot stinger on the dedicated stinger bus (bypasses duck),
     * and dip the board track's duckGain for the stinger's duration so the
     * fanfare/ceremony cuts through cleanly. Returns a stop function.
     *
     * This is the ONLY path that plays non-looping ceremony tracks — it
     * routes to stingerGain (parallel to duckGain) so the board music ducks
     * while the stinger plays at full level, then restores both.
     * Resolves through the director like play(); a stinger is never lifted.
     */
    stinger(track: string, opts?: { duckTo?: number; duckAttack?: number; duckRelease?: number }): () => void {
      console.log(`[AUDIO_STINGER] ${track} t=${performance.now().toFixed(1)}`);
      const resolved = resolveTrack(track, { board: director.board });
      if (!resolved) {
        console.warn(`[audio] unknown stinger '${track}'`);
        return () => {};
      }
      if (disabled) return () => {};
      const c = ensureContext();
      if (!c) return () => {};

      // Fade out any previous stinger
      if (stingerSeq) {
        stingerSeq.stop(0.08);
        stingerSeq = null;
        stingerTrackGain = null;
      }

      const duckTo = opts?.duckTo ?? 0.316; // dip board to ~-10 dB (spec: -6..-10)
      const duckAttack = opts?.duckAttack ?? 0.08;
      const duckRelease = opts?.duckRelease ?? 0.5;

      // Duck the board track
      if (duckGain) {
        const now = c.currentTime;
        duckGain.gain.cancelScheduledValues(now);
        duckGain.gain.setValueAtTime(duckGain.gain.value, now);
        duckGain.gain.linearRampToValueAtTime(duckTo, now + duckAttack);
      }

      // Start the stinger on the stinger bus
      stingerTrackGain = c.createGain();
      stingerTrackGain.gain.value = 0.5;
      stingerTrackGain.connect(stingerGain!);
      const def = resolved.def;
      for (const set of setsOf(def)) requestSet(set);
      const seq = new Sequencer(c, stingerTrackGain, def, { player: livePlayer });
      seq.start();
      stingerSeq = seq;

      const stopFn = () => {
        if (stingerSeq === seq) {
          stingerSeq = null;
          stingerTrackGain = null;
        }
        seq.stop(0.1);
        // Restore board duck
        if (duckGain) {
          const now = c.currentTime;
          duckGain.gain.cancelScheduledValues(now);
          duckGain.gain.setValueAtTime(duckGain.gain.value, now);
          duckGain.gain.linearRampToValueAtTime(1.0, now + duckRelease);
        }
      };

      // If the track is non-looping, auto-restore when it ends
      if (!def.loop) {
        seq.onEnded = () => {
          if (stingerSeq === seq) {
            stingerSeq = null;
            stingerTrackGain = null;
          }
          // Restore board duck
          if (duckGain) {
            const now = c.currentTime;
            duckGain.gain.cancelScheduledValues(now);
            duckGain.gain.setValueAtTime(duckGain.gain.value, now);
            duckGain.gain.linearRampToValueAtTime(1.0, now + duckRelease);
          }
        };
      }
      return stopFn;
    },

    /** Immediately restore duck (e.g. when the ceremony is skipped). */
    restoreDuck(release = 0.4): void {
      if (!duckGain || !ctx) return;
      const now = ctx.currentTime;
      duckGain.gain.cancelScheduledValues(now);
      duckGain.gain.setValueAtTime(duckGain.gain.value, now);
      duckGain.gain.linearRampToValueAtTime(1.0, now + release);
    },

    /** Sample the current duck gain (for QA/measurements). */
    duckLevel(): number {
      return duckGain?.gain.value ?? 1;
    },

    /**
     * Duck the music bus by a measured amount for a measured duration.
     * Used by SFX moments that need the music to dip (coin loss, crowd cheer,
     * minigame wipe, etc). Auto-releases after `holdMs`.
     */
    duck(amount = 0.4, attackMs = 80, holdMs = 200, releaseMs = 400): void {
      if (!duckGain || !ctx) return;
      const now = ctx.currentTime;
      const a = attackMs / 1000;
      const h = holdMs / 1000;
      const r = releaseMs / 1000;
      duckGain.gain.cancelScheduledValues(now);
      duckGain.gain.setValueAtTime(duckGain.gain.value, now);
      duckGain.gain.linearRampToValueAtTime(amount, now + a);
      duckGain.gain.setValueAtTime(amount, now + a + h);
      duckGain.gain.linearRampToValueAtTime(1.0, now + a + h + r);
    },

    stop(fade = 0.4): void {
      pendingTrack = null;
      if (!sequencer || !ctx) return;
      const stopped = currentTrack;
      sequencer.stop(fade);
      sequencer.onEnded = null;
      sequencer = null;
      trackGain = null;
      currentTrack = "";
      nowPlaying = null;
      bus.emit("audio:track", { track: stopped, playing: false });
    },

    /** The requested track id ("board", not the theme it resolved to). */
    track(): string {
      if (disabled) return "silence";
      return currentTrack || "silence";
    },

    /** The theme the current track resolved to ("board.fairground" for "board"). */
    theme(): string {
      return themeNow();
    },

    intensity(level: number): void {
      currentIntensity = Math.min(1, Math.max(0, level));
      sequencer?.setIntensity(currentIntensity);
    },

    /** Final-turns lift. Idempotent; board themes only (a playing one changes at its next bar line). */
    lift(on: boolean): void {
      if (disabled) return;
      director.lift(on);
    },

    /** The board "board" resolves for. Loads its sample set and frees the previous board's. */
    setBoard(id: string): void {
      if (disabled) return;
      director.setBoard(id);
      const next = boardSet(id);
      if (boardSetId && boardSetId !== next) {
        wantedSets.delete(boardSetId);
        loader?.free(boardSetId);
      }
      boardSetId = next;
      if (next) requestSet(next);
    },

    /** [added] list of registered track ids, plus the aliases the director resolves. */
    tracks(): string[] {
      return [...trackIds(), "board", "minigame_a", "minigame_b"];
    },
  },

  sfx: {
    /** [added] SFX bus volume 0..1 (applies now, or when audio starts). */
    get volume(): number {
      return sfxVolume;
    },
    set volume(v: number) {
      sfxVolume = clampVolume(v, sfxVolume);
      if (sfxGain) sfxGain.gain.value = sfxVolume;
    },

    play(name: string, opts?: SfxPlayOpts): void {
      console.log(`[AUDIO_SFX] ${name} t=${performance.now().toFixed(1)}`);
      pruneStops();
      playSfx(name, opts, false);
    },

    stopAll(): void {
      for (const s of activeStops) {
        try {
          s.stop();
        } catch {
          /* ignore */
        }
      }
      activeStops.length = 0;
    },
  },

  /** Analyser levels — debug API + critics prove audio is live. */
  levels(): { rms: number; peak: number } {
    if (!analyser || !ctx) return { rms: 0, peak: 0 };
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    return { rms: Math.sqrt(sum / data.length), peak };
  },

  /** Music state for the debug API. Every field is always there; under ?audio=0 each holds its default. */
  debug(): AudioDebug {
    const sets: Record<string, SetStatus> = {};
    if (loader) for (const set of wantedSets) sets[set] = loader.status(set);
    return {
      theme: themeNow(),
      lift: director.lifted,
      bpm: sequencer?.clock.bpm ?? 0,
      transpose: sequencer?.clock.transpose ?? 0,
      samples: { format: loader?.format ?? "off", sets, failed: loader?.failed() ?? [], standInNotes },
      anchor: null,
      bars: { audioNow: ctx?.currentTime ?? 0, bars: sequencer?.clock.barTimes() ?? [] },
    };
  },

  /**
   * Offline render of a track to a 16-bit PCM WAV blob.
   * Full arrangement (all intensity layers) through the music bus at
   * settings.musicVolume, mastered by the same comp/limiter chain.
   * Resolves through the director with `opts.board` and `opts.genre` (never
   * the live game's), loads the track's sample sets into the offline context
   * first, and plays a board theme lifted only with `opts.lift`.
   * Works even when the live context is disabled (tool use): it makes its
   * own loader, choosing the format by probing the offline context.
   */
  async renderTrack(track: string, seconds = 20, opts: { lift?: boolean; board?: string; genre?: string } = {}): Promise<Blob> {
    const resolved = resolveTrack(track, { board: opts.board, genre: opts.genre });
    if (!resolved) throw new Error(`renderTrack: unknown track '${track}'`);
    const { theme, id, def } = resolved;
    const dur = Math.max(1, Math.min(120, seconds));
    const sr = 44100;
    const OC =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!OC) throw new Error("renderTrack: OfflineAudioContext unavailable");
    const c = new OC(2, Math.ceil(sr * dur), sr);

    // music bus only, at musicVolume
    const trackOut = c.createGain();
    trackOut.gain.setValueAtTime(0.3, 0); // same headroom trim as live
    trackOut.gain.setValueAtTime(0.3, Math.max(0.01, dur - 0.05));
    trackOut.gain.linearRampToValueAtTime(0.0001, dur - 0.01);
    const musicG = c.createGain();
    musicG.gain.value = settings.musicVolume;
    const musicComp = makeCompressor(c, -18, 2.5, 2.5, 0.01, 0.22);
    const limiter = makeCompressor(c, -8, 20, 1.5, 0.002, 0.2);
    const clipper = makeSafetyClipper(c);
    trackOut.connect(musicG);
    musicG.connect(musicComp);
    musicComp.connect(limiter);
    limiter.connect(clipper);
    clipper.connect(c.destination);

    const renderLoader = createLoader();
    await renderLoader.chooseFormat(c, probeClips(), forcedFormat());
    await Promise.all(setsOf(def).map((set) => renderLoader.load(set, c)));
    const player = createSamplerPlayer({
      table: SAMPLED,
      zones: () => zoneTable,
      buffer: (inst, zone) => renderLoader.buffer(inst, zone),
      onStandIn: () => {}, // standInNotes counts live notes only
    });
    const renderDirector = new Director(() => null);
    renderDirector.lift(opts.lift ?? false);
    const start = renderDirector.startOptions(theme, def.bpm);
    scheduleTrackInto(c, id, trackOut, dur, { ...start, player });
    const rendered = await c.startRendering();
    return encodeWav(rendered);
  },
};
