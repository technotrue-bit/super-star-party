// SUPER STAR PARTY — the fundamental of a recorded note, for the sample build's pitch check
// (tools/samples/build.mjs). Pure maths on mono float samples: no I/O.
//
// 1. A Hann-windowed spectrum of half a second, from 30 ms past the peak (after the strike).
// 2. Subharmonic summation (Hermes, 1988) picks the fundamental: each candidate scores the spectrum
//    at its first harmonics, each weighted 0.84x the one below, less what lies halfway between
//    them. A candidate an octave low predicts harmonics that are not there; one an octave high
//    finds the odd harmonics halfway between its own. That settles the octave of a bass or a
//    trombone pedal whose fundamental is faint, and of a glockenspiel whose overtones are not
//    harmonics at all.
// 3. The fine value comes from the strongest of the first six harmonics: the peak of the spectrum
//    within 25 cents of it, searched in 0.05-cent steps, divided by its harmonic number. Harmonics
//    below 150 Hz give way to the strongest one above, unless that one is more than 20 dB down:
//    room and body resonances crowd a low fundamental (a plucked bass's wanders by 40 cents while
//    its third harmonic holds steady), but a bass whose upper harmonics are gone has only it.

const SKIP_SEC = 0.03;
const SPAN_SEC = 0.5;
const FFT_SIZE = 1 << 17;
/** How far the candidates reach beyond the expected pitch, in semitones each way (so two octaves off still shows). */
const REACH_SEMIS = 27;
const CANDIDATE_STEP_CENTS = 5;
const HARMONIC_WEIGHT = 0.84;
const MAX_HARMONICS = 12;
/** Harmonics above this are not scored. */
const TOP_HZ = 12000;
/** A harmonic reads as the strongest bin within this many cents of where it should be. */
const NEAR_CENTS = 15;
/** The fine value comes from one of the first FINE_HARMONICS harmonics; see 3. above. */
const FINE_HARMONICS = 6;
const FINE_FLOOR_HZ = 150;
const FINE_FLOOR_MARGIN = 0.1; // 20 dB
const FINE_SPAN_CENTS = 25;

const midiOf = (hz) => 69 + 12 * Math.log2(hz / 440);
const hzOf = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** In-place radix-2 FFT of (re, im), whose length is a power of two. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Magnitude of the spectrum of `seg` at `hz`. */
function magnitudeAt(seg, hz, sampleRate) {
  const w = (2 * Math.PI * hz) / sampleRate;
  // Rotate a phasor instead of calling cos/sin per sample.
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  let re = 0;
  let im = 0;
  let pr = 1;
  let pi = 0;
  for (let n = 0; n < seg.length; n++) {
    re += seg[n] * pr;
    im -= seg[n] * pi;
    const nr = pr * cw - pi * sw;
    pi = pr * sw + pi * cw;
    pr = nr;
  }
  return Math.hypot(re, im);
}

/**
 * The pitch `x` (mono, `sampleRate`) sounds at, as a fractional MIDI note, searched within
 * REACH_SEMIS of `expectedMidi`. `harmonic` is the one the fine value came from; `edge` is true
 * when its peak sat at the edge of the fine search (the value is then the coarse one, to 5 cents).
 */
export function measurePitch(x, sampleRate, expectedMidi) {
  let peak = 0;
  let at = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > peak) {
      peak = v;
      at = i;
    }
  }
  const len = Math.min(Math.round(SPAN_SEC * sampleRate), FFT_SIZE);
  let start = at + Math.round(SKIP_SEC * sampleRate);
  if (start + len > x.length) start = Math.max(0, x.length - len);
  const seg = new Float64Array(Math.min(len, x.length - start));
  for (let n = 0; n < seg.length; n++) seg[n] = x[start + n] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (seg.length - 1)));

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  re.set(seg);
  fft(re, im);
  const bins = FFT_SIZE / 2;
  const mag = new Float64Array(bins);
  let top = 0;
  for (let i = 0; i < bins; i++) {
    mag[i] = Math.hypot(re[i], im[i]);
    if (mag[i] > top) top = mag[i];
  }
  const binHz = sampleRate / FFT_SIZE;
  /** The strongest bin within NEAR_CENTS of `hz`, relative to the spectrum's peak. */
  const near = (hz) => {
    const r = 2 ** (NEAR_CENTS / 1200);
    const lo = Math.max(1, Math.floor(hz / r / binHz));
    const hi = Math.min(bins - 1, Math.max(lo, Math.ceil((hz * r) / binHz)));
    let m = 0;
    for (let i = lo; i <= hi; i++) if (mag[i] > m) m = mag[i];
    return m / top;
  };
  const harmonicsOf = (f) => Math.max(1, Math.min(MAX_HARMONICS, Math.floor(TOP_HZ / f)));

  let coarse = hzOf(expectedMidi);
  let best = -1;
  for (let c = -REACH_SEMIS * 100; c <= REACH_SEMIS * 100; c += CANDIDATE_STEP_CENTS) {
    const f = hzOf(expectedMidi + c / 100);
    let score = 0;
    let w = 1;
    for (let k = 1; k <= harmonicsOf(f); k++, w *= HARMONIC_WEIGHT) score += w * (near(k * f) - near((k - 0.5) * f));
    if (score > best) {
      best = score;
      coarse = f;
    }
  }

  const strongest = (from) => {
    let best = from;
    for (let k = from + 1; k <= Math.min(FINE_HARMONICS, harmonicsOf(coarse)); k++) {
      if (near(k * coarse) > near(best * coarse)) best = k;
    }
    return best;
  };
  let harmonic = strongest(1);
  const floor = Math.ceil(FINE_FLOOR_HZ / coarse);
  if (harmonic < floor && floor <= Math.min(FINE_HARMONICS, harmonicsOf(coarse))) {
    const above = strongest(floor);
    if (near(above * coarse) >= FINE_FLOOR_MARGIN * near(harmonic * coarse)) harmonic = above;
  }
  let fine = 0;
  let fineMag = -1;
  const scan = (centre, half, step) => {
    for (let c = -half; c <= half + 1e-9; c += step) {
      const f = centre * 2 ** (c / 1200);
      const m = magnitudeAt(seg, f, sampleRate);
      if (m > fineMag) {
        fineMag = m;
        fine = f;
      }
    }
  };
  const centre = coarse * harmonic;
  scan(centre, FINE_SPAN_CENTS, 1);
  const edge = Math.abs(1200 * Math.log2(fine / centre)) >= FINE_SPAN_CENTS - 1;
  scan(fine, 1.5, 0.05);
  const f0 = edge ? coarse : fine / harmonic;
  return { midi: midiOf(f0), hz: f0, harmonic, edge };
}
