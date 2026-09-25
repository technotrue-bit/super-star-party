/**
 * SUPER STAR PARTY — Web Audio engine (public API).
 *
 * Contract (kept byte-compatible with the wave-0 stub):
 *   audio.ready                      Promise (resolved)
 *   audio.unlock()                   create/resume context (first gesture)
 *   audio.master.gain                0..1 master volume
 *   audio.music.play(track, opts?)   start a looping track
 *   audio.music.stop(fade?)          fade out current track
 *   audio.music.track()              name of current track / 'silence'
 *   audio.music.intensity(level)     0..1 dynamic layers
 *   audio.music.tracks()             [added] registered track ids
 *   audio.sfx.play(name, opts?)      one-shot sound effect
 *   audio.sfx.stopAll()              cut all active one-shots
 *   audio.levels()                   {rms, peak} live analyser
 *   audio.renderTrack(track, seconds) -> Promise<Blob> offline WAV render
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
import { TRACKS, trackIds } from "./music/tracks";
import { Sequencer, scheduleTrackInto } from "./music/sequencer";
import { startCrowdMurmur, wireCrowdReactions } from "./music/crowd";
import type { CrowdHandle } from "./music/crowd";
import { SFX } from "./sfx/sounds";
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

let stingerSeq: Sequencer | null = null;
let stingerTrackGain: GainNode | null = null;

interface PendingPlay {
  track: string;
  opts?: { intensity?: number };
}
let pendingTrack: PendingPlay | null = null;

let crowd: CrowdHandle | null = null;
let reactionsWired = false;
let visibilityWired = false;

const lastPlay = new Map<string, number>();
const activeStops: Array<{ stop: StopFn; until: number }> = [];

try {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("audio") === "0") {
    disabled = true;
  }
} catch {
  /* URL parsing must never break the game */
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
  musicGain.gain.value = settings.musicVolume;
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
  sfxGain.gain.value = settings.sfxVolume;
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
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Music                                                              */
/* ------------------------------------------------------------------ */

function startTrack(track: string, opts?: { intensity?: number }): void {
  if (!ctx) return;
  const def = TRACKS[track];
  if (!def) {
    console.warn(`[audio] unknown track '${track}'`);
    return;
  }
  // quick-fade whatever is playing
  if (sequencer) {
    sequencer.stop(0.12);
    sequencer.onEnded = null;
    bus.emit("audio:track", { track: currentTrack, playing: false });
  }
  trackGain = ctx.createGain();
  trackGain.gain.value = 0.3; // headroom trim: mix targets ~-14 LUFS feel
  trackGain.connect(duckGain!);
  const seq = new Sequencer(ctx, trackGain, def);
  seq.onEnded = () => {
    if (sequencer !== seq) return; // a newer track replaced us
    sequencer = null;
    trackGain = null;
    currentTrack = "";
    bus.emit("audio:track", { track, playing: false });
  };
  if (opts?.intensity !== undefined) currentIntensity = Math.min(1, Math.max(0, opts.intensity));
  seq.setIntensity(currentIntensity);
  seq.start();
  sequencer = seq;
  currentTrack = track;
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
  const pitch = opts?.pitch ?? 0;
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

/** Call from the first pointer/key gesture. Safe to call repeatedly. */
export function unlock(): void {
  const c = ensureContext();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
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
    play(track: string, opts?: { intensity?: number }): void {
      console.log(`[AUDIO_PLAY] ${track} t=${performance.now().toFixed(1)}`);
      if (!TRACKS[track]) {
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
     */
    stinger(track: string, opts?: { duckTo?: number; duckAttack?: number; duckRelease?: number }): () => void {
      console.log(`[AUDIO_STINGER] ${track} t=${performance.now().toFixed(1)}`);
      if (!TRACKS[track]) {
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
      const def = TRACKS[track];
      const seq = new Sequencer(c, stingerTrackGain, def);
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
      bus.emit("audio:track", { track: stopped, playing: false });
    },

    track(): string {
      if (disabled) return "silence";
      return currentTrack || "silence";
    },

    intensity(level: number): void {
      currentIntensity = Math.min(1, Math.max(0, level));
      sequencer?.setIntensity(currentIntensity);
    },

    /** [added] list of registered track ids. */
    tracks(): string[] {
      return trackIds();
    },
  },

  sfx: {
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

  /**
   * Offline render of a track to a 16-bit PCM WAV blob.
   * Full arrangement (all intensity layers) through the music bus at
   * settings.musicVolume, mastered by the same comp/limiter chain.
   * Works even when the live context is disabled (tool use).
   */
  async renderTrack(track: string, seconds = 20): Promise<Blob> {
    const def = TRACKS[track];
    if (!def) throw new Error(`renderTrack: unknown track '${track}'`);
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

    scheduleTrackInto(c, track, trackOut, dur);
    const rendered = await c.startRendering();
    return encodeWav(rendered);
  },
};
