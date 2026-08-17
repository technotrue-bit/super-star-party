/**
 * SUPER STAR PARTY — step sequencer.
 *
 * 16th-note grid with lookahead scheduling (classic Chris Wilson
 * "Tale of Two Clocks" pattern): a 25ms timer schedules every note whose
 * start time falls within `lookahead` (120ms) of ctx.currentTime, so
 * playback is seamless and glitch-free even under janky frames.
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
 *
 * The same scheduling core drives offline renders (renderTrack) — no
 * timer, just step through the whole window.
 */

import { TRACKS } from "./tracks";
import type { TrackDef, ParsedVoice } from "./tracks";
import { parseTrack } from "./tracks";
import { VOICES, drumHit } from "./instruments";

export type LayerName = "base" | "perc2" | "counter" | "bright";

const LAYER_ORDER: LayerName[] = ["base", "perc2", "counter", "bright"];

function smoothstep(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  return v * v * (3 - 2 * v);
}

/** Layer gain targets for a given intensity (0..1). */
export function layerTargets(intensity: number): Record<LayerName, number> {
  return {
    base: 1,
    perc2: smoothstep((intensity - 0.3) / 0.35),
    counter: smoothstep((intensity - 0.5) / 0.35),
    bright: smoothstep((intensity - 0.6) / 0.35),
  };
}

export interface LayerBus {
  base: GainNode;
  perc2: GainNode;
  counter: GainNode;
  bright: GainNode;
}

/**
 * Schedule every voice event for one 16th step.
 * Shared by the live sequencer and the offline renderer.
 */
export function scheduleStep(
  ctx: BaseAudioContext,
  def: TrackDef,
  voices: ParsedVoice[],
  step: number,
  t: number,
  stepDur: number,
  swingOffset: number,
  layers: LayerBus,
): void {
  const local = step % 16;
  for (const v of voices) {
    const bar = Math.floor(step / 16) % v.barCount;
    const events = v.bars[bar];
    const layerGain = layers[v.layer];
    if (!layerGain) continue;
    const voice = VOICES[v.style];
    for (const e of events) {
      if (e.s !== local) continue;
      if (e.kind === "rest") continue;
      const et = t + (e.s % 2 === 1 ? swingOffset : 0);
      const lenSec = e.len * stepDur;
      const vel = Math.min(1, e.vel * v.gain);
      if (e.kind === "drum") {
        drumHit(ctx, layerGain, et, e.token, vel);
        continue;
      }
      if (!voice) continue;
      const freqs = e.freqs.map((f) => f * Math.pow(2, v.transpose / 12));
      voice(ctx, layerGain, et, freqs, lenSec, vel, {
        step: stepDur,
        slide: e.slide,
      });
    }
  }
}

/**
 * Offline scheduling: schedule the full arrangement for `seconds`.
 * One-shot tracks stop after their last step; looping tracks wrap.
 */
export function scheduleTrackInto(
  ctx: BaseAudioContext,
  trackId: string,
  out: AudioNode,
  seconds: number,
): TrackDef {
  const def = TRACKS[trackId];
  if (!def) throw new Error(`scheduleTrackInto: unknown track '${trackId}'`);
  const voices = parseTrack(def);
  const stepDur = 60 / def.bpm / 4;
  const swingOffset = (def.swing - 0.5) * stepDur * 2;
  const layers: LayerBus = {
    base: ctx.createGain(),
    perc2: ctx.createGain(),
    counter: ctx.createGain(),
    bright: ctx.createGain(),
  };
  for (const name of LAYER_ORDER) {
    layers[name].gain.value = 1; // render = full arrangement
    layers[name].connect(out);
  }
  const totalSteps = voices[0].barCount * 16;
  let t = 0;
  let step = 0;
  while (t < seconds) {
    scheduleStep(ctx, def, voices, step, t, stepDur, swingOffset, layers);
    t += stepDur;
    step += 1;
    if (!def.loop && step >= totalSteps) break;
  }
  return def;
}

/* ------------------------------------------------------------------ */
/*  Live sequencer                                                     */
/* ------------------------------------------------------------------ */

export class Sequencer {
  private ctx: AudioContext;
  private def: TrackDef;
  private voices: ParsedVoice[];
  private layers: LayerBus;
  private out: GainNode; // per-playback gain (fade on stop)
  private stepDur: number;
  private swingOffset: number;
  private totalSteps: number;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private lastTick = 0;
  private intensity = 0.5;
  /** Called when a non-looping track finishes. */
  onEnded: (() => void) | null = null;

  constructor(ctx: AudioContext, out: GainNode, def: TrackDef) {
    this.ctx = ctx;
    this.out = out;
    this.def = def;
    this.voices = parseTrack(def);
    this.stepDur = 60 / def.bpm / 4;
    this.swingOffset = (def.swing - 0.5) * this.stepDur * 2;
    this.totalSteps = this.voices[0].barCount * 16;
    this.layers = {
      base: ctx.createGain(),
      perc2: ctx.createGain(),
      counter: ctx.createGain(),
      bright: ctx.createGain(),
    };
    for (const name of LAYER_ORDER) {
      this.layers[name].gain.value = 0.0001;
      this.layers[name].connect(out);
    }
  }

  get trackId(): string {
    return this.def.id;
  }

  setIntensity(level: number): void {
    this.intensity = Math.min(1, Math.max(0, level));
    const targets = layerTargets(this.intensity);
    const now = this.ctx.currentTime;
    for (const name of LAYER_ORDER) {
      if (name === "base") continue; // base is always at 1
      const g = this.layers[name].gain;
      const target = targets[name] < 0.001 ? 0.0001 : targets[name];
      g.setTargetAtTime(target, now, 0.25);
    }
  }

  start(): void {
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.lastTick = this.ctx.currentTime;
    this.setIntensity(this.intensity);
    this.layers.base.gain.value = 1;
    // tick immediately, then on a 25ms timer
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
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
    if (!this.ctx || this.def === null) return;
    const now = this.ctx.currentTime;
    // If the tab was hidden, setInterval was throttled: resync without
    // drifting so the loop stays tight.
    if (this.lastTick > 0 && now - this.lastTick > 0.5) {
      this.nextTime = now + 0.03;
    }
    this.lastTick = now;
    let guard = 0;
    while (this.nextTime < now + 0.12 && guard < 64) {
      this.scheduleStepAt(this.step, this.nextTime);
      this.step += 1;
      this.nextTime += this.stepDur;
      if (this.step >= this.totalSteps) {
        if (this.def.loop) {
          this.step = 0;
        } else {
          this.finish();
          return;
        }
      }
      guard += 1;
    }
  }

  private scheduleStepAt(step: number, t: number): void {
    scheduleStep(this.ctx, this.def, this.voices, step, t, this.stepDur, this.swingOffset, this.layers);
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
