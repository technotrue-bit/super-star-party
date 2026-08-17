/**
 * SUPER STAR PARTY — one-shot synth primitives for SFX.
 * Everything is pure Web Audio node graph, scheduled precisely at `t`.
 * Each builder returns a stop() closure so audio.sfx.stopAll() can cut
 * active sounds instantly.
 */

import { getNoiseBuffer } from "../music/instruments";

export type StopFn = () => void;

export interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  slideTo?: number; // target frequency (glide)
  slideTime?: number; // seconds for the glide
  vibRate?: number;
  vibDepth?: number; // cents
  attack?: number;
  decay?: number; // exp decay tau after attack
  hold?: number; // sustained plateau before decay (used with sustain)
  sustain?: number;
  partials?: Array<{ mult: number; amp: number }>;
  stopAfter?: number; // force-stop the osc after N seconds
}

/** A tone with an exponential-ish envelope. */
export function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  freq: number,
  dur: number,
  o: ToneOpts = {},
): StopFn {
  const type = o.type ?? "sine";
  const vol = o.vol ?? 0.5;
  const attack = o.attack ?? 0.004;
  const decay = o.decay ?? 0.1;
  const stopAt = t + (o.stopAfter ?? dur) + 0.05;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  if (o.hold !== undefined && o.sustain !== undefined) {
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol * o.sustain), t + attack + o.hold);
    g.gain.setValueAtTime(Math.max(0.001, vol * o.sustain), t + attack + o.hold + Math.max(0.02, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, dur));
  }
  g.connect(out);

  const oscs: OscillatorNode[] = [];
  const main = ctx.createOscillator();
  main.type = type;
  main.frequency.setValueAtTime(freq, t);
  if (o.slideTo && o.slideTo !== freq) {
    main.frequency.exponentialRampToValueAtTime(o.slideTo, t + (o.slideTime ?? 0.1));
  }
  main.connect(g);
  main.start(t);
  main.stop(stopAt);
  oscs.push(main);

  for (const p of o.partials ?? []) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * p.mult, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo * p.mult, t + (o.slideTime ?? 0.1));
    const pg = ctx.createGain();
    pg.gain.value = p.amp;
    osc.connect(pg);
    pg.connect(g);
    osc.start(t);
    osc.stop(stopAt);
    oscs.push(osc);
  }

  if (o.vibRate && o.vibDepth) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibRate;
    const lg = ctx.createGain();
    lg.gain.value = o.vibDepth;
    lfo.connect(lg);
    for (const osc of oscs) lg.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(stopAt);
  }

  return () => {
    try {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    } catch {
      /* context gone */
    }
  };
}

export interface NoiseOpts {
  vol?: number;
  type?: BiquadFilterType;
  freq?: number;
  q?: number;
  sweepTo?: number;
  attack?: number;
}

/** A filtered noise burst with fast attack / exp decay. */
export function noise(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  dur: number,
  o: NoiseOpts = {},
): StopFn {
  const vol = o.vol ?? 0.3;
  const attack = o.attack ?? 0.005;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.freq ?? 1000, t);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.04, dur));
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + dur + 0.05);
  return () => {
    try {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    } catch {
      /* context gone */
    }
  };
}

/** Quick arpeggio of tones. Notes: [freq, dur] pairs. */
export function arp(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  notes: Array<[number, number]>,
  o: { vol?: number; type?: OscillatorType; gap?: number } = {},
): StopFn {
  const stops: StopFn[] = [];
  let tt = t;
  for (const [freq, dur] of notes) {
    stops.push(
      tone(ctx, out, tt, freq, dur, {
        type: o.type ?? "sine",
        vol: o.vol ?? 0.4,
        decay: Math.min(0.35, dur),
      }),
    );
    tt += o.gap ?? 0.055;
  }
  return () => {
    for (const s of stops) s();
  };
}

/** Cha-ching style two-note (coin). */
export function kaching(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  root: number,
  vol: number,
): StopFn {
  const stops: StopFn[] = [];
  stops.push(
    tone(ctx, out, t, root, 0.3, {
      type: "sine",
      vol: vol * 0.7,
      decay: 0.16,
      partials: [{ mult: 2, amp: 0.3 }],
    }),
  );
  stops.push(
    tone(ctx, out, t + 0.09, root * 1.5, 0.55, {
      type: "sine",
      vol: vol,
      decay: 0.28,
      partials: [
        { mult: 2, amp: 0.35 },
        { mult: 3, amp: 0.12 },
      ],
      vibRate: 5,
      vibDepth: 6,
    }),
  );
  stops.push(noise(ctx, out, t + 0.09, 0.08, { type: "highpass", freq: 6000, vol: vol * 0.12 }));
  return () => {
    for (const s of stops) s();
  };
}
