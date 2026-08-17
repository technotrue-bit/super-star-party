/**
 * SUPER STAR PARTY — instrument voices (all synthesis, zero samples).
 * Each voice: (ctx, out, t, freqs, lenSec, vel, opts) -> void
 *   ctx    BaseAudioContext (live or offline)
 *   out    destination node (layer gain)
 *   t      start time (seconds)
 *   freqs  one or more frequencies (chords)
 *   lenSec note length in seconds
 *   vel    velocity 0..1
 *   opts   { step: seconds per 16th, slide: semitone glide target }
 *
 * Gain staging is deliberately conservative — the master limiter chain
 * (threshold -6dB, ratio 4, makeup +3dB) keeps the mix around a -14 LUFS
 * feel with peaks near -3..-6 dBFS. No harsh clipping, ever.
 */

export interface VoiceOpts {
  step: number; // seconds per 16th step
  slide?: number; // semitones to glide to over the note
}

export type VoiceFn = (
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  freqs: number[],
  lenSec: number,
  vel: number,
  opts: VoiceOpts,
) => void;

/** Shared: noise buffer per context (cached). */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (buf) return buf;
  const len = Math.floor(ctx.sampleRate * 2);
  buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

/** One-shot noise burst through a filter. */
function noiseHit(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  dur: number,
  vol: number,
  type: BiquadFilterType,
  freq: number,
  q = 1,
  sweepTo?: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** Simple oscillator note with ADSR-ish envelope + optional vibrato. */
function note(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  freq: number,
  lenSec: number,
  vel: number,
  o: {
    type?: OscillatorType;
    detune?: number;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
    vibRate?: number;
    vibDepth?: number; // cents
    vibDelay?: number;
    filterFreq?: number;
    filterQ?: number;
    filterEnv?: number; // Hz of filter opening (adds attack brightness)
    slideTo?: number; // ratio (freq multiplier) to glide to
    partials?: Array<{ mult: number; amp: number }>;
  },
): void {
  const a = o.attack ?? 0.006;
  const d = o.decay ?? 0.08;
  const sus = o.sustain ?? 0.7;
  const r = o.release ?? 0.05;
  const end = t + Math.max(0.05, lenSec);
  const peak = vel * (o.type === "sine" ? 1 : 0.9);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * sus), t + a + d);
  g.gain.setValueAtTime(Math.max(0.001, peak * sus), end);
  g.gain.exponentialRampToValueAtTime(0.0001, end + r);

  let node: AudioNode = g;
  if (o.filterFreq) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = o.filterQ ?? 0.8;
    const base = o.filterFreq;
    f.frequency.setValueAtTime(base + (o.filterEnv ?? 0), t);
    if (o.filterEnv) f.frequency.exponentialRampToValueAtTime(Math.max(40, base), t + a + d);
    g.connect(f);
    node = f;
  }
  node.connect(out);

  const oscs: OscillatorNode[] = [];
  const baseOsc = ctx.createOscillator();
  baseOsc.type = o.type ?? "sine";
  baseOsc.detune.value = o.detune ?? 0;
  if (o.slideTo && o.slideTo !== freq) {
    baseOsc.frequency.setValueAtTime(freq, t);
    baseOsc.frequency.exponentialRampToValueAtTime(o.slideTo, t + Math.max(0.08, lenSec * 0.85));
  } else {
    baseOsc.frequency.setValueAtTime(freq, t);
  }
  baseOsc.connect(g);
  baseOsc.start(t);
  baseOsc.stop(end + r + 0.03);
  oscs.push(baseOsc);

  for (const p of o.partials ?? []) {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(freq * p.mult, t);
    const pg = ctx.createGain();
    pg.gain.value = p.amp;
    osc.connect(pg);
    pg.connect(g);
    osc.start(t);
    osc.stop(end + r + 0.03);
    oscs.push(osc);
  }

  if (o.vibRate && o.vibDepth) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibRate;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(o.vibDepth, t + (o.vibDelay ?? 0.12));
    lfo.connect(lg);
    for (const osc of oscs) lg.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end + r + 0.03);
  }
}

/* ------------------------------------------------------------------ */
/*  Melody voices                                                      */
/* ------------------------------------------------------------------ */

/** Bright square lead with vibrato (title swing). */
export const swingLead: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "square",
      attack: 0.007,
      decay: 0.06,
      sustain: 0.72,
      release: 0.05,
      vibRate: 5.4,
      vibDepth: 7,
      vibDelay: 0.14,
      filterFreq: 3400,
      filterEnv: 2200,
      partials: [{ mult: 2, amp: 0.12 }],
    });
  }
};

/** Calliope lead: square + triangle sub + strong vibrato (board). */
export const calliope: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "square",
      attack: 0.012,
      decay: 0.05,
      sustain: 0.78,
      release: 0.06,
      vibRate: 5.8,
      vibDepth: 11,
      vibDelay: 0.08,
      filterFreq: 2900,
      filterEnv: 1800,
      partials: [
        { mult: 0.5, amp: 0.5 }, // triangle sub an octave down
        { mult: 2, amp: 0.16 },
      ],
    });
  }
};

/** Driving detuned-saw lead (minigame_a). */
export const hypeLead: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "sawtooth",
      attack: 0.005,
      decay: 0.07,
      sustain: 0.8,
      release: 0.04,
      filterFreq: 3000,
      filterEnv: 2600,
      partials: [{ mult: 1, amp: 0.7 }], // extra detuned saw layer
    });
    note(ctx, out, t, f * 1.008, lenSec, vel * 0.7, {
      type: "sawtooth",
      attack: 0.005,
      decay: 0.07,
      sustain: 0.8,
      release: 0.04,
      filterFreq: 3000,
    });
  }
};

/** Staccato square, dry + snappy (minigame_b comedy). */
export const staccatoLead: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, Math.min(lenSec, 0.16), vel, {
      type: "square",
      attack: 0.004,
      decay: 0.03,
      sustain: 0.55,
      release: 0.02,
      filterFreq: 3600,
      filterEnv: 1500,
      partials: [{ mult: 2, amp: 0.1 }],
    });
  }
};

/** Glockenspiel: sine + inharmonic partials, long decay (happening). */
export const glock: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel * 1.15, {
      type: "sine",
      attack: 0.002,
      decay: 0.06,
      sustain: 0.35,
      release: 0.3,
      partials: [
        { mult: 2.01, amp: 0.32 },
        { mult: 4.16, amp: 0.14 },
      ],
    });
  }
};

/** Music box pluck: sine + octave, fast decay (shop). */
export const musicbox: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "sine",
      attack: 0.002,
      decay: 0.04,
      sustain: 0.3,
      release: 0.16,
      partials: [
        { mult: 2, amp: 0.4 },
        { mult: 4, amp: 0.1 },
      ],
    });
  }
};

/** Short sine blip (countdown tones). */
export const blip: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, Math.min(lenSec, 0.22), vel, {
      type: "sine",
      attack: 0.003,
      decay: 0.04,
      sustain: 0.5,
      release: 0.05,
      partials: [{ mult: 2, amp: 0.25 }],
    });
  }
};
/** Triumphant brass: 3 detuned saws + triangle body. */
export const brass: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "sawtooth",
      attack: 0.02,
      decay: 0.06,
      sustain: 0.85,
      release: 0.09,
      vibRate: 5,
      vibDepth: 5,
      vibDelay: 0.1,
      filterFreq: 2400,
      filterEnv: 1600,
      partials: [
        { mult: 0.5, amp: 0.4 }, // triangle sub octave
        { mult: 1.014, amp: 0.8 }, // detuned saw
        { mult: 0.992, amp: 0.7 }, // detuned saw
      ],
    });
  }
};

/** Goofy trombone: saw + wobble + slide (lose). */
export const trombone: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    const slideRatio = o.slide ? f * Math.pow(2, o.slide / 12) : f;
    note(ctx, out, t, f, lenSec, vel, {
      type: "sawtooth",
      attack: 0.03,
      decay: 0.08,
      sustain: 0.9,
      release: 0.12,
      slideTo: slideRatio,
      vibRate: 6.2,
      vibDepth: 18,
      vibDelay: 0.05,
      filterFreq: 950,
      filterQ: 2,
      partials: [{ mult: 1.005, amp: 0.5 }],
    });
    // growl layer
    note(ctx, out, t, f * 1.005, lenSec, vel * 0.35, {
      type: "square",
      attack: 0.05,
      decay: 0.05,
      sustain: 0.7,
      release: 0.1,
      slideTo: slideRatio * 1.005,
      filterFreq: 700,
    });
  }
};

/** Menacing low lead (grumpus): dark square with slow vibrato. */
export const menaceLead: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "square",
      attack: 0.02,
      decay: 0.05,
      sustain: 0.8,
      release: 0.08,
      vibRate: 4.4,
      vibDepth: 14,
      vibDelay: 0.1,
      filterFreq: 1600,
      partials: [{ mult: 0.5, amp: 0.5 }],
    });
  }
};

/* ------------------------------------------------------------------ */
/*  Bass voices                                                        */
/* ------------------------------------------------------------------ */

/** Swing oom-pah: triangle + sine sub, warm. */
export const bassSwing: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "triangle",
      attack: 0.008,
      decay: 0.05,
      sustain: 0.85,
      release: 0.05,
      partials: [{ mult: 0.5, amp: 0.6 }],
    });
  }
};

/** Calliope oom-pah bass: plucky square (chord stabs included). */
export const bassOom: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel * 0.85, {
      type: "square",
      attack: 0.004,
      decay: 0.06,
      sustain: 0.6,
      release: 0.04,
      filterFreq: 1100,
      partials: [{ mult: 0.5, amp: 0.5 }],
    });
  }
};

/** Driving 8th-note saw bass. */
export const bassDrive: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "sawtooth",
      attack: 0.004,
      decay: 0.05,
      sustain: 0.75,
      release: 0.03,
      filterFreq: 750,
      partials: [{ mult: 1.006, amp: 0.6 }],
    });
  }
};

/** Bouncy staccato square bass (minigame_b). */
export const bassBounce: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, Math.min(lenSec, 0.14), vel, {
      type: "square",
      attack: 0.003,
      decay: 0.03,
      sustain: 0.5,
      release: 0.02,
      filterFreq: 1000,
    });
  }
};

/** Soft sine bass (happening). */
export const bassSine: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "sine",
      attack: 0.03,
      decay: 0.06,
      sustain: 0.9,
      release: 0.12,
    });
  }
};

/** Grumpus wobble bass: saw + filter LFO + tremolo. */
export const bassWobble: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    const end = t + Math.max(0.2, lenSec);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.9, t + 0.03);
    g.gain.setValueAtTime(vel * 0.9, end - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.06);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(520, t);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 210;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(t);
    lfo.stop(end + 0.1);

    // tremolo
    const trem = ctx.createOscillator();
    trem.frequency.value = 5.6;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.12;
    trem.connect(tremGain);
    tremGain.connect(g.gain);
    trem.start(t);
    trem.stop(end + 0.1);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f, t);
    osc.connect(filter);
    filter.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(end + 0.1);
  }
};

/** Pizzicato pluck bass (shop). */
export const bassPizz: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "triangle",
      attack: 0.002,
      decay: 0.05,
      sustain: 0.25,
      release: 0.1,
      partials: [{ mult: 2, amp: 0.12 }],
    });
  }
};

/** Marching triangle bass (results / fanfares). */
export const bassMarch: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "triangle",
      attack: 0.006,
      decay: 0.04,
      sustain: 0.8,
      release: 0.05,
      partials: [{ mult: 0.5, amp: 0.5 }],
    });
  }
};

/* ------------------------------------------------------------------ */
/*  Harmony + texture voices                                           */
/* ------------------------------------------------------------------ */

/** Warm pad: detuned saws + triangle through a lowpass. */
export const pad: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel * 0.55, {
      type: "sawtooth",
      attack: 0.1,
      decay: 0.15,
      sustain: 0.8,
      release: 0.3,
      filterFreq: 1500,
      filterQ: 0.6,
      partials: [
        { mult: 1.007, amp: 0.6 },
        { mult: 0.993, amp: 0.6 },
        { mult: 0.5, amp: 0.4 },
      ],
    });
  }
};

/** Soft triangle counter-melody (title). */
export const counterSoft: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel * 0.8, {
      type: "triangle",
      attack: 0.01,
      decay: 0.04,
      sustain: 0.7,
      release: 0.06,
      filterFreq: 2400,
    });
  }
};

/** Short chord stab (minigame_a counter, grumpus clusters). */
export const stab: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, Math.min(lenSec, 0.18), vel, {
      type: "sawtooth",
      attack: 0.004,
      decay: 0.05,
      sustain: 0.5,
      release: 0.04,
      filterFreq: 2200,
      filterQ: 1.2,
      partials: [{ mult: 1.01, amp: 0.6 }],
    });
  }
};

/** Cheeky oompah chords (minigame_b counter). */
export const oompah: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, Math.min(lenSec, 0.12), vel, {
      type: "square",
      attack: 0.003,
      decay: 0.03,
      sustain: 0.45,
      release: 0.02,
      filterFreq: 1800,
      partials: [{ mult: 2, amp: 0.15 }],
    });
  }
};

/** Sparkle: high sine + shimmer noise (star fanfare, happening). */
export const sparkle: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, lenSec, vel, {
      type: "sine",
      attack: 0.002,
      decay: 0.05,
      sustain: 0.4,
      release: 0.35,
      partials: [
        { mult: 2.01, amp: 0.25 },
        { mult: 4.1, amp: 0.1 },
      ],
    });
  }
  if (freqs.length > 0) {
    noiseHit(ctx, out, t, Math.min(0.3, lenSec), vel * 0.1, "bandpass", 7800, 0.7);
  }
};

/** Brass chord stab (results counter). */
export const brassStab: VoiceFn = (ctx, out, t, freqs, lenSec, vel, o) => {
  for (const f of freqs) {
    note(ctx, out, t, f, Math.min(lenSec, 0.3), vel * 0.9, {
      type: "sawtooth",
      attack: 0.008,
      decay: 0.08,
      sustain: 0.6,
      release: 0.06,
      filterFreq: 2100,
      filterQ: 1,
      partials: [
        { mult: 1.012, amp: 0.7 },
        { mult: 0.988, amp: 0.6 },
      ],
    });
  }
};

/* ------------------------------------------------------------------ */
/*  Drums                                                              */
/* ------------------------------------------------------------------ */

export const drumVoice: VoiceFn = (ctx, out, t, _freqs, lenSec, vel, o) => {
  void lenSec;
  void o;
  void _freqs;
  // drum events carry their token via the single-element freqs trick:
  // freqs[0] = 0 marker + token in opts; handled by caller instead.
};

/**
 * Trigger a single drum hit by token. Used by the sequencer when a voice
 * with style 'drums' fires a drum event.
 */
export function drumHit(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  token: string,
  vel: number,
): void {
  switch (token) {
    case "K": {
      // kick: pitch-swept sine + click
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(44, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.42 * vel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.25);
      noiseHit(ctx, out, t, 0.02, 0.1 * vel, "highpass", 1400);
      break;
    }
    case "S": {
      noiseHit(ctx, out, t, 0.13, 0.27 * vel, "bandpass", 1800, 1.1);
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(190, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.15 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.08);
      break;
    }
    case "H": {
      noiseHit(ctx, out, t, 0.05, 0.2 * vel, "highpass", 7500);
      break;
    }
    case "h": {
      noiseHit(ctx, out, t, 0.035, 0.13 * vel, "highpass", 7500);
      break;
    }
    case "O": {
      noiseHit(ctx, out, t, 0.2, 0.2 * vel, "highpass", 6200);
      break;
    }
    case "C": {
      noiseHit(ctx, out, t, 0.55, 0.26 * vel, "highpass", 5200);
      noiseHit(ctx, out, t, 0.3, 0.15 * vel, "lowpass", 300);
      break;
    }
    case "T": {
      noiseHit(ctx, out, t, 0.1, 0.2 * vel, "bandpass", 6400, 1.4);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(6200, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.08 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.09);
      break;
    }
    case "B": {
      noiseHit(ctx, out, t, 0.04, 0.11 * vel, "bandpass", 4300, 1.6);
      break;
    }
    case "W": {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(780, t);
      osc.frequency.exponentialRampToValueAtTime(640, t + 0.045);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.07);
      break;
    }
    case "L": {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(2093, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.55);
      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(4208, t);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.05 * vel, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc2.connect(g2);
      g2.connect(out);
      osc2.start(t);
      osc2.stop(t + 0.35);
      break;
    }
    case "R": {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(1900, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.05);
      noiseHit(ctx, out, t, 0.025, 0.12 * vel, "bandpass", 3200, 1.5);
      break;
    }
    case "Q": {
      // countdown tick: metallic blip
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(1250, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.2 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.05);
      noiseHit(ctx, out, t, 0.02, 0.1 * vel, "bandpass", 2400, 2);
      break;
    }
    case "D": {
      // low tom boom
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(52, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.27 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.35);
      break;
    }
    default:
      break;
  }
}

export const VOICES: Record<string, VoiceFn> = {
  swingLead,
  calliope,
  hypeLead,
  staccatoLead,
  glock,
  musicbox,
  blip,
  brass,
  trombone,
  menaceLead,
  bassSwing,
  bassOom,
  bassDrive,
  bassBounce,
  bassSine,
  bassWobble,
  bassPizz,
  bassMarch,
  pad,
  counterSoft,
  stab,
  oompah,
  sparkle,
  brassStab,
  drums: drumVoice,
};
