/**
 * SUPER STAR PARTY — step sequencer.
 *
 * 16th-note grid with lookahead scheduling (classic Chris Wilson
 * "Tale of Two Clocks" pattern): a 25ms timer asks the StepClock for every
 * step whose start falls within `lookahead` (120ms) of ctx.currentTime and
 * schedules its notes, so playback is seamless and glitch-free even under
 * janky frames. All timing (swing, tempo and key changes on bar lines, fills,
 * pickups, the hidden-tab resync) lives in StepClock; this file turns the
 * steps it plans into notes.
 *
 * Swing: off-beat 16ths (odd steps) are delayed by
 *   (swing - 0.5) * 2 * stepDur   seconds
 * so swing 0.5 = straight, 0.62 = light shuffle, 0.7 = heavy swing.
 *
 * Intensity layers (0..1): voices are tagged base / perc2 / counter /
 * bright and routed to per-layer gains. intensity() crossfades them:
 *   perc2   fades in across [0.30, 0.65]
 *   counter fades in across [0.50, 0.85]
 *   bright  fades in across [0.60, 0.95]
 * At 0.2 the board track is a calm cruise; at 1.0 it is a full party.
 * The `lift` layer ignores intensity: the clock switches it on a bar line.
 *
 * What a note sounds like is the NotePlayer's business (player.ts); the
 * default is the oscillator synth every track was written for.
 *
 * The same scheduling core drives offline renders (scheduleTrackInto) — no
 * timer, just plan the whole window.
 */

import { TRACKS, parseSection, parseTrack } from "./tracks";
import type { TrackDef, ParsedVoice } from "./tracks";
import { StepClock } from "./clock";
import type { ClockChange, PlannedStep } from "./clock";
import { synthPlayer, voiceRoute } from "./player";
import type { NotePlayer } from "./player";

export type LayerName = "base" | "perc2" | "counter" | "bright" | "lift";

const LAYER_ORDER: LayerName[] = ["base", "perc2", "counter", "bright", "lift"];

/** A silent layer gain: exponential ramps cannot reach 0. */
const SILENT = 0.0001;

function smoothstep(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  return v * v * (3 - 2 * v);
}

/** Layer gain targets for a given intensity (0..1). `lift` is not intensity-driven. */
export function layerTargets(intensity: number): Record<Exclude<LayerName, "lift">, number> {
  return {
    base: 1,
    perc2: smoothstep((intensity - 0.3) / 0.35),
    counter: smoothstep((intensity - 0.5) / 0.35),
    bright: smoothstep((intensity - 0.6) / 0.35),
  };
}

export type LayerBus = Record<LayerName, GainNode>;

/** One-bar sections that sit outside the main voices. */
export interface TrackSections {
  fill: ParsedVoice[];
  pickup: ParsedVoice[];
}

/** Whether each lift gain is currently scheduled on, so only changes touch the AudioParam. */
const liftState = new WeakMap<GainNode, boolean>();

/** One gain per layer, all feeding `out`. `lift` starts on or off; the rest at `level`. */
function createLayers(ctx: BaseAudioContext, out: AudioNode, level: number, lifted: boolean): LayerBus {
  const bus: LayerBus = {
    base: ctx.createGain(),
    perc2: ctx.createGain(),
    counter: ctx.createGain(),
    bright: ctx.createGain(),
    lift: ctx.createGain(),
  };
  for (const name of LAYER_ORDER) {
    bus[name].gain.value = name === "lift" ? (lifted ? 1 : SILENT) : level;
    bus[name].connect(out);
  }
  liftState.set(bus.lift, lifted);
  return bus;
}

/** Voices a fill bar replaces: the synth drum voice and the sampled kits. */
function isDrumStyle(style: string): boolean {
  return style === "drums" || voiceRoute(style) === "kit";
}

/**
 * Schedule every voice event for one planned 16th step.
 * Shared by the live sequencer and the offline renderer.
 *
 * A pickup step plays the pickup section's bar. A main step plays bar
 * `ps.bar % barCount`; in a fill bar the drum voices are swapped for the
 * fill section's voices and everything else plays as normal.
 */
export function scheduleStep(
  ctx: BaseAudioContext,
  voices: ParsedVoice[],
  sections: TrackSections,
  ps: PlannedStep,
  layers: LayerBus,
  player: NotePlayer,
): void {
  if ((liftState.get(layers.lift) ?? false) !== ps.lift) {
    liftState.set(layers.lift, ps.lift);
    layers.lift.gain.setValueAtTime(ps.lift ? 1 : SILENT, ps.t);
  }
  if (ps.pickup) {
    for (const v of sections.pickup) playVoice(ctx, v, 0, ps, layers, player);
    return;
  }
  const fill = ps.fill && sections.fill.length > 0;
  for (const v of voices) {
    if (fill && isDrumStyle(v.style)) continue;
    playVoice(ctx, v, ps.bar % v.barCount, ps, layers, player);
  }
  if (fill) for (const v of sections.fill) playVoice(ctx, v, 0, ps, layers, player);
}

/** Send the events of one voice's bar that start on this step to the player. */
function playVoice(
  ctx: BaseAudioContext,
  v: ParsedVoice,
  bar: number,
  ps: PlannedStep,
  layers: LayerBus,
  player: NotePlayer,
): void {
  const local = ps.step % 16;
  const out = layers[v.layer];
  for (const e of v.bars[bar]) {
    if (e.s !== local || e.kind === "rest") continue;
    const et = ps.t + (e.s % 2 === 1 ? ps.swingOffset : 0);
    const vel = Math.min(1, e.vel * v.gain);
    if (e.kind === "drum") {
      player.drum(ctx, out, et, v.style, e.token, vel);
      continue;
    }
    const freqs = e.freqs.map((f) => f * Math.pow(2, (v.transpose + ps.transpose) / 12));
    player.note(ctx, out, et, v.style, freqs, e.len * ps.stepDur, vel, {
      step: ps.stepDur,
      slide: e.slide,
    });
  }
}

/** Length of the main pattern in steps (every main voice has the same bar count). */
function totalStepsOf(voices: ParsedVoice[]): number {
  return voices[0].barCount * 16;
}

/**
 * Offline scheduling: schedule the full arrangement for `seconds`.
 * One-shot tracks stop after their last step; looping tracks wrap.
 * Every layer plays at full level; `lift` only with `opts.lift`. `bpm` and
 * `transpose` start the clock away from the track's own (a lifted render).
 */
export function scheduleTrackInto(
  ctx: BaseAudioContext,
  trackId: string,
  out: AudioNode,
  seconds: number,
  opts: { lift?: boolean; bpm?: number; transpose?: number; player?: NotePlayer } = {},
): TrackDef {
  const def = TRACKS[trackId];
  if (!def) throw new Error(`scheduleTrackInto: unknown track '${trackId}'`);
  const voices = parseTrack(def);
  const sections: TrackSections = { fill: parseSection(def, "fill"), pickup: parseSection(def, "pickup") };
  const lift = opts.lift ?? false;
  const player = opts.player ?? synthPlayer;
  const layers = createLayers(ctx, out, 1, lift); // render = full arrangement
  const clock = new StepClock({
    bpm: opts.bpm ?? def.bpm,
    swing: def.swing,
    totalSteps: totalStepsOf(voices),
    loop: def.loop,
    t0: 0,
    transpose: opts.transpose,
    lift,
    hasFill: sections.fill.length > 0,
  });
  // One call for the whole window: calls more than 0.5 s apart would count as a hidden tab.
  for (const ps of clock.plan(0, seconds)) {
    scheduleStep(ctx, voices, sections, ps, layers, player);
  }
  return def;
}

/* ------------------------------------------------------------------ */
/*  Live sequencer                                                     */
/* ------------------------------------------------------------------ */

export interface SequencerOpts {
  /** Who sounds the notes; defaults to the oscillator synth. */
  player?: NotePlayer;
  /** Starting transpose in semitones. */
  transpose?: number;
  /** Start with the lift layer on. */
  lift?: boolean;
  /** Starting tempo; defaults to the track's. */
  bpm?: number;
}

export class Sequencer {
  private ctx: AudioContext;
  private def: TrackDef;
  private voices: ParsedVoice[];
  private sections: TrackSections;
  private layers: LayerBus;
  private out: GainNode; // per-playback gain (fade on stop)
  private player: NotePlayer;
  private stepClock: StepClock;
  private timer: number | null = null;
  private intensity = 0.5;
  /** Called when a non-looping track finishes. */
  onEnded: (() => void) | null = null;

  /** The first step lands 80 ms after construction, so call start() right away. */
  constructor(ctx: AudioContext, out: GainNode, def: TrackDef, opts: SequencerOpts = {}) {
    this.ctx = ctx;
    this.out = out;
    this.def = def;
    this.player = opts.player ?? synthPlayer;
    this.voices = parseTrack(def);
    this.sections = { fill: parseSection(def, "fill"), pickup: parseSection(def, "pickup") };
    this.stepClock = new StepClock({
      bpm: opts.bpm ?? def.bpm,
      swing: def.swing,
      totalSteps: totalStepsOf(this.voices),
      loop: def.loop,
      t0: ctx.currentTime + 0.08,
      transpose: opts.transpose,
      lift: opts.lift,
      hasFill: this.sections.fill.length > 0,
    });
    this.layers = createLayers(ctx, out, SILENT, opts.lift ?? false);
  }

  get trackId(): string {
    return this.def.id;
  }

  /** The step clock: queue tempo, key, lift and fill changes, set the anchor, read bar times. */
  get clock(): StepClock {
    return this.stepClock;
  }

  /** Queue a change for the next bar line that has not been scheduled yet. */
  queueChange(c: ClockChange): void {
    this.stepClock.queueChange(c);
  }

  setIntensity(level: number): void {
    this.intensity = Math.min(1, Math.max(0, level));
    const targets = layerTargets(this.intensity);
    const now = this.ctx.currentTime;
    for (const name of LAYER_ORDER) {
      if (name === "base" || name === "lift") continue; // base is always at 1; lift ignores intensity
      const g = this.layers[name].gain;
      const target = targets[name] < 0.001 ? SILENT : targets[name];
      g.setTargetAtTime(target, now, 0.25);
    }
  }

  start(): void {
    this.setIntensity(this.intensity);
    this.layers.base.gain.value = 1;
    // Timer first: tick() may finish the track (an anchored clock can run out at once).
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop(fade: number): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const now = this.ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setValueAtTime(this.out.gain.value, now);
      this.out.gain.linearRampToValueAtTime(0.0001, now + fade);
    } catch {
      /* context may be closed */
    }
    window.setTimeout(() => {
      try {
        this.out.disconnect();
      } catch {
        /* already gone */
      }
    }, Math.max(50, fade * 1000) + 50);
  }

  private tick(): void {
    for (const ps of this.stepClock.plan(this.ctx.currentTime)) {
      scheduleStep(this.ctx, this.voices, this.sections, ps, this.layers, this.player);
    }
    if (this.stepClock.ended) this.finish();
  }

  private finish(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const now = this.ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setValueAtTime(this.out.gain.value, now);
      this.out.gain.linearRampToValueAtTime(0.0001, now + 0.08);
    } catch {
      /* context closed */
    }
    window.setTimeout(() => {
      try {
        this.out.disconnect();
      } catch {
        /* already gone */
      }
    }, 150);
    this.onEnded?.();
  }
}
