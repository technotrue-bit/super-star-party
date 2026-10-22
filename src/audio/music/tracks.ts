/**
 * SUPER STAR PARTY — track data + step-pattern parser.
 * Pure data module: NO DOM / Web Audio imports, so it can be imported by
 * node tooling (tools/audio-selfcheck.mjs) for validation.
 *
 * Pattern grammar (one string per bar, 16 sixteenth-note steps each):
 *   `C5:2`        note C5, length 2 steps
 *   `-:1`         rest, 1 step
 *   `{C4,E4,G4}:4`  chord (several frequencies at once), 4 steps
 *   `K:1 S:2`     drum tokens (single letter, no octave digits)
 *   `D4:8:0.9:-2` note, len 8, velocity 0.9, slide -2 semitones (trombone)
 * Bar length MUST sum to 16 steps (validated at parse time + selfcheck).
 *
 * Drum tokens: K kick, S snare, H accented hat, h light hat, O open hat,
 * C crash, T tambourine, B shaker, W woodblock, L glock bell, R rimshot,
 * Q count tick, D low tom.
 */

export type Layer = "base" | "perc2" | "counter" | "bright" | "lift";

export interface StepEvent {
  s: number; // step within the bar (0..15)
  kind: "note" | "drum" | "rest";
  freqs: number[]; // note/chord: frequencies; drums: [] (token carries the hit)
  token: string; // drum token or note name (debug)
  len: number; // length in 16th steps
  vel: number; // 0..1
  slide: number; // semitones to glide to over the note (trombone etc.)
}

export interface VoiceDef {
  style: string; // synth voice (see instruments.ts) or `s:<name>`, a sampled instrument (see samples/instruments.gen.ts)
  pattern?: string[]; // one string per bar
  chords?: string[]; // one chord name per bar (harmony voice)
  source?: number; // index of another voice whose pattern this one reuses
  layer?: Layer; // which intensity layer it belongs to
  transpose?: number; // semitone offset (octave layers, or an octave that fits an instrument's zones)
  gain?: number; // extra velocity multiplier
}

export interface TrackDef {
  id: string;
  bpm: number;
  swing: number; // 0.5 = straight; 0.62 = light shuffle; 0.7 = heavy
  loop: boolean;
  voices: VoiceDef[];
  sets?: string[]; // sample sets the track needs; defaults to ["core"]
  fill?: VoiceDef[]; // one-bar section (e.g. a drum fill), outside voices
  pickup?: VoiceDef[]; // one-bar section leading into the loop, outside voices
}

export interface ParsedVoice {
  style: string;
  layer: Layer;
  transpose: number;
  gain: number;
  bars: StepEvent[][]; // one array per bar
  barCount: number;
  chordNames: string[];
}

export const DRUM_TOKENS = new Set([
  "K", "S", "H", "h", "O", "C", "T", "B", "W", "L", "R", "Q", "D",
]);

/** Chord voicings for the harmony (pad) voice, as MIDI notes; parsing turns them into Hz. */
export const CHORDS: Record<string, number[]> = {
  C: [48, 52, 55, 60], // C3 E3 G3 C4
  G: [43, 47, 50, 55], // G2 B2 D3 G3
  Am: [45, 48, 52, 57], // A2 C3 E3 A3
  F: [41, 45, 48, 53], // F2 A2 C3 F3
  Dm: [38, 41, 45, 50], // D2 F2 A2 D3
  Bb: [46, 50, 53, 58], // Bb2 D3 F3 Bb3
  A: [33, 37, 41, 45], // A2 C#3 E3 A3
};

const NOTE_SEMIS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** Note name -> MIDI number (C4 = 60). Throws on garbage (dev-time safety). */
export function noteToMidi(name: string): number {
  const m = /^([A-G][#b]?)(\d+)$/.exec(name);
  if (!m) throw new Error(`bad note name '${name}'`);
  const semis = NOTE_SEMIS[m[1]];
  if (semis === undefined) throw new Error(`bad note name '${name}'`);
  return (Number(m[2]) + 1) * 12 + semis;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** One bar string -> StepEvent[] (validates 16-step sum). */
export function parseBar(str: string, barIndex: number): StepEvent[] {
  const tokens = str.trim().split(/\s+/).filter(Boolean);
  const out: StepEvent[] = [];
  let s = 0;
  for (const tok of tokens) {
    const m = /^(\{[^}]+\}|-|[A-Za-z]|[A-G][#b]?\d+)(?::(\d+))?(?::([0-9.]+))?(?::(-?\d+))?$/.exec(tok);
    if (!m) throw new Error(`parseBar: bad token '${tok}' in bar ${barIndex}`);
    const head = m[1];
    const len = m[2] ? Number(m[2]) : 1;
    const vel = m[3] !== undefined ? Number(m[3]) : 0.8;
    const slide = m[4] !== undefined ? Number(m[4]) : 0;
    if (len < 1 || len > 16 || s + len > 16) {
      throw new Error(`parseBar: '${tok}' overflows bar ${barIndex}`);
    }
    if (head === "-") {
      out.push({ s, kind: "rest", freqs: [], token: "-", len, vel, slide });
    } else if (head.startsWith("{")) {
      const inner = head.slice(1, -1).split(",");
      const freqs = inner.map((n) => midiToFreq(noteToMidi(n.trim())));
      out.push({ s, kind: "note", freqs, token: head, len, vel, slide });
    } else if (DRUM_TOKENS.has(head)) {
      out.push({ s, kind: "drum", freqs: [], token: head, len, vel, slide });
    } else if (/^[A-G][#b]?\d+$/.test(head)) {
      out.push({ s, kind: "note", freqs: [midiToFreq(noteToMidi(head))], token: head, len, vel, slide });
    } else {
      throw new Error(`parseBar: unknown token '${tok}' in bar ${barIndex}`);
    }
    s += len;
  }
  if (s !== 16) {
    throw new Error(`parseBar: bar ${barIndex} sums to ${s} steps, need 16 ('${str}')`);
  }
  return out;
}

/** Parse a list of voices; every voice must have the same bar count. */
function parseVoices(defId: string, voices: VoiceDef[]): ParsedVoice[] {
  const out: ParsedVoice[] = [];
  let barCount = -1;
  for (const v of voices) {
    let bars: StepEvent[][] = [];
    let chordNames: string[] = [];
    if (v.source !== undefined) {
      const src = out[v.source];
      if (!src) throw new Error(`track ${defId}: voice ${v.source} not yet parsed for source ref`);
      bars = src.bars;
      chordNames = src.chordNames;
    } else if (v.pattern) {
      bars = v.pattern.map((b, i) => parseBar(b, i));
    } else if (v.chords) {
      chordNames = v.chords;
      bars = v.chords.map((c) => {
        const midis = CHORDS[c];
        if (!midis) throw new Error(`unknown chord '${c}' in track ${defId}`);
        return [{ s: 0, kind: "note", freqs: midis.map(midiToFreq), token: c, len: 16, vel: 0.8, slide: 0 }];
      });
    } else {
      throw new Error(`track ${defId}: voice ${out.length} has no pattern/chords/source`);
    }
    if (barCount === -1) barCount = bars.length;
    else if (bars.length !== barCount) {
      throw new Error(`track ${defId}: voice '${v.style}' has ${bars.length} bars, expected ${barCount}`);
    }
    out.push({
      style: v.style,
      layer: v.layer ?? "base",
      transpose: v.transpose ?? 0,
      gain: v.gain ?? 1,
      bars,
      barCount,
      chordNames,
    });
  }
  return out;
}

/** Validate + parse a whole track definition. */
export function parseTrack(def: TrackDef): ParsedVoice[] {
  const out = parseVoices(def.id, def.voices);
  if (out.length === 0) throw new Error(`track ${def.id}: no voices`);
  return out;
}

/** The sample sets a track needs loaded; ["core"] unless it names its own. */
export function trackSets(def: TrackDef): string[] {
  return def.sets ?? ["core"];
}

/** Parse a track's one-bar `fill` or `pickup` section ([] when absent). */
export function parseSection(def: TrackDef, which: "fill" | "pickup"): ParsedVoice[] {
  const out = parseVoices(def.id, def[which] ?? []);
  if (out.some((v) => v.barCount !== 1)) {
    throw new Error(`track ${def.id}: ${which} must be one bar`);
  }
  return out;
}

export function trackStepCount(def: TrackDef): number {
  return parseTrack(def)[0].barCount * 16;
}

/* ------------------------------------------------------------------ */
/*  TRACKS — the musical core. Bright, bouncy, mischievous.           */
/* ------------------------------------------------------------------ */

export const TRACKS: Record<string, TrackDef> = {
  /* Upbeat party swing. I-V-vi-IV in C. Call + answer phrases. */
  title: {
    id: "title",
    bpm: 128,
    swing: 0.62,
    loop: true,
    voices: [
      {
        style: "s:trumpet",
        layer: "base",
        pattern: [
          "E5:2 G5:2 E5:2 C5:2 E5:2 D5:2 C5:2 G4:2",
          "G4:2 B4:2 D5:2 G5:2 D5:2 B4:2 G4:2 A4:2",
          "A4:2 C5:2 E5:2 A5:2 E5:2 C5:2 A4:2 B4:2",
          "F4:2 A4:2 C5:2 F5:2 C5:2 A4:2 F4:2 G4:2",
          "E5:2 G5:2 E5:2 C5:2 E5:2 D5:2 C5:2 G4:2",
          "B4:2 D5:2 G5:2 D5:2 B4:2 G4:2 F#4:2 A4:2",
          "A4:2 C5:2 E5:2 A5:2 G5:2 E5:2 C5:2 D5:2",
          "F4:2 A4:2 C5:2 F5:2 D5:2 G4:2 B4:2 D5:2",
        ],
      },
      { style: "s:piano", layer: "base", chords: ["C", "G", "Am", "F", "C", "G", "Am", "F"] },
      {
        style: "s:bass",
        layer: "base",
        pattern: [
          "C2:8 G2:8",
          "G1:8 D2:8",
          "A1:8 E2:8",
          "F1:8 C2:8",
          "C2:8 G2:8",
          "G1:8 D2:8",
          "A1:8 E2:8",
          "F1:8 G1:8",
        ],
      },
      {
        style: "s:kit.core",
        layer: "base",
        pattern: [
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
        ],
      },
      {
        style: "s:kit.core",
        layer: "perc2",
        pattern: [
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
        ],
      },
      {
        style: "s:trombone",
        layer: "counter",
        transpose: -12, // an octave down: the trombone's zones stop at 69
        pattern: [
          "C5:2 E5:2 C5:2 G4:2 C5:2 B4:2 G4:2 E4:2",
          "B4:2 D5:2 B4:2 G4:2 B4:2 A4:2 G4:2 F#4:2",
          "A4:2 C5:2 A4:2 E4:2 A4:2 G4:2 E4:2 C4:2",
          "F4:2 A4:2 F4:2 C4:2 F4:2 E4:2 C4:2 A3:2",
          "C5:2 E5:2 C5:2 G4:2 C5:2 B4:2 G4:2 E4:2",
          "B4:2 D5:2 B4:2 G4:2 B4:2 A4:2 G4:2 F#4:2",
          "A4:2 C5:2 A4:2 E4:2 A4:2 G4:2 E4:2 C4:2",
          "F4:2 A4:2 F4:2 C4:2 B4:2 D5:2 B4:2 G4:2",
        ],
      },
      { style: "s:glock", layer: "bright", source: 0, transpose: 12, gain: 0.55 },
    ],
  },

  /* Bouncy carnival calliope. Swung skip-rhythm hook, call + answer, oom-pah bass. */
  "board.fairground": {
    id: "board.fairground",
    bpm: 132,
    swing: 0.62,
    loop: true,
    voices: [
      {
        style: "s:glock",
        layer: "base",
        transpose: 12,
        pattern: [
          "-:1 E5:3 G5:1 E5:3 G5:1 C6:3 G5:1 C6:3",
          "G5:1 C6:3 E6:1 C6:3 G5:3 E5:1 D5:3 -:1",
          "A5:1 F5:3 A5:1 F5:3 C6:3 A5:1 F5:3 -:1",
          "D6:1 B5:3 D6:1 G5:3 B5:1 G5:3 D5:1 G5:3",
          "E5:1 G5:3 E5:1 G5:3 C6:3 G5:1 C6:3 E5:1",
          "A5:1 C6:3 E6:1 C6:3 A5:3 E5:1 A5:1 C6:3",
          "F6:1 A5:3 F6:1 A5:3 F5:3 A5:1 F5:3 -:1",
          "G5:5 B5:1 D6:3 B5:1 G5:3 D5:1 E5:1 G5:1",
        ],
      },
      { style: "s:piano", layer: "base", chords: ["C", "C", "F", "G", "C", "Am", "F", "G"] },
      {
        style: "s:bass",
        layer: "base",
        pattern: [
          "C2:4 {C3,E3,G3}:4 C2:4 {C3,E3,G3}:4",
          "C2:4 {C3,E3,G3}:4 C2:4 {C3,E3,G3}:4",
          "F2:4 {F2,A2,C3}:4 F2:4 {F2,A2,C3}:4",
          "G2:4 {G2,B2,D3}:4 G2:4 {G2,B2,D3}:4",
          "C2:4 {C3,E3,G3}:4 C2:4 {C3,E3,G3}:4",
          "A2:4 {A2,C3,E3}:4 A2:4 {A2,C3,E3}:4",
          "F2:4 {F2,A2,C3}:4 F2:4 {F2,A2,C3}:4",
          "G2:4 {G2,B2,D3}:4 G2:4 {G2,B2,D3}:4",
        ],
      },
      {
        style: "s:kit.core",
        layer: "base",
        pattern: [
          "K:2 H:1 h:1 S:2 H:1 h:1 K:2 H:1 h:1 S:2 H:1 h:1",
          "K:2 H:1 h:1 S:2 H:1 h:1 K:2 H:1 h:1 S:2 H:1 h:1",
          "K:2 H:1 h:1 S:2 H:1 h:1 K:2 H:1 h:1 S:2 H:1 h:1",
          "K:2 H:1 h:1 S:2 H:1 h:1 K:2 H:1 h:1 S:2 H:1 h:1",
          "K:2 H:1 h:1 S:2 H:1 h:1 K:2 H:1 h:1 S:2 H:1 h:1",
          "K:2 H:1 h:1 S:2 H:1 h:1 K:2 H:1 h:1 S:2 H:1 h:1",
          "K:2 H:1 h:1 S:2 H:1 h:1 K:2 H:1 h:1 S:2 H:1 h:1",
          "K:2 H:1 h:1 S:2 H:1 h:1 K:1 S:1 K:1 S:1 K:2 S:2",
        ],
      },
      {
        style: "s:kit.core",
        layer: "perc2",
        pattern: [
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
        ],
      },
      {
        style: "s:glock",
        layer: "counter",
        transpose: 12,
        pattern: [
          "C5:6 G5:6 E5:4",
          "E5:6 C5:6 G5:4",
          "F5:6 C5:6 A5:4",
          "D5:6 G5:6 B5:4",
          "C5:6 G5:6 E5:4",
          "A5:6 E5:6 C5:4",
          "F5:6 C5:6 A5:4",
          "D5:6 G5:6 B5:4",
        ],
      },
      // bright: a unison doubling; another octave would take F6 (and E6, lifted) past the glock's zones (112)
      { style: "s:glock", layer: "bright", source: 0, transpose: 12, gain: 0.5 },
    ],
  },

  /* High-energy hype. Driving 8ths, Am-F-C-G. */
  "mg.action": {
    id: "mg.action",
    bpm: 140,
    swing: 0.5,
    loop: true,
    voices: [
      {
        style: "s:trumpet",
        layer: "base",
        // bars 5-8 repeat bars 1-4 at their octave (they were an octave up, to G6; the trumpet's zones stop at 88)
        pattern: [
          "A4:1 A4:1 C5:1 A4:1 E5:2 A4:1 C5:1 A4:1 G4:1 A4:1 B4:1 C5:1 D5:1 E5:1 -:1",
          "F4:1 F4:1 A4:1 F4:1 C5:2 F4:1 A4:1 F4:1 E4:1 F4:1 G4:1 A4:1 B4:1 C5:1 D5:1",
          "C5:1 C5:1 E5:1 C5:1 G5:2 C5:1 E5:1 C5:1 B4:1 C5:1 D5:1 E5:1 F5:1 G5:1 -:1",
          "G4:1 G4:1 B4:1 G4:1 D5:2 G4:1 B4:1 G4:1 F#4:1 G4:1 A4:1 B4:1 C5:1 D5:1 -:1",
          "A4:1 A4:1 C5:1 A4:1 E5:2 A4:1 C5:1 A4:1 G4:1 A4:1 B4:1 C5:1 D5:1 E5:1 -:1",
          "F4:1 F4:1 A4:1 F4:1 C5:2 F4:1 A4:1 F4:1 E4:1 F4:1 G4:1 A4:1 B4:1 C5:1 D5:1",
          "C5:1 C5:1 E5:1 C5:1 G5:2 E5:1 C5:1 G4:1 A4:1 G4:1 E4:1 G4:1 C5:1 E5:1 G5:1",
          "G4:1 G4:1 B4:1 G4:1 D5:2 B4:1 G4:1 D4:1 E4:1 F#4:1 G4:1 A4:1 B4:1 D5:1 B4:1",
        ],
      },
      { style: "s:piano", layer: "base", chords: ["Am", "F", "C", "G", "Am", "F", "C", "G"] },
      {
        style: "s:bass",
        layer: "base",
        pattern: [
          "A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 A2:2 A3:2",
          "F2:2 F3:2 F2:2 F3:2 F2:2 F3:2 F2:2 F3:2",
          "C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 C3:2 C4:2",
          "G2:2 G3:2 G2:2 G3:2 G2:2 G3:2 G2:2 G3:2",
          "A2:2 A3:2 A2:2 A3:2 A2:2 E3:2 A2:2 A3:2",
          "F2:2 F3:2 F2:2 F3:2 F2:2 C3:2 F2:2 F3:2",
          "C3:2 C4:2 C3:2 C4:2 C3:2 G3:2 C3:2 C4:2",
          "G2:2 G3:2 G2:2 G3:2 G2:2 D3:2 G2:2 G3:2",
        ],
      },
      {
        style: "s:kit.core",
        layer: "base",
        pattern: [
          "K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1 K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1",
          "K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1 K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1",
          "K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1 K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1",
          "K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1 K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1",
          "K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1 K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1",
          "K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1 K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1",
          "K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1 K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1",
          "K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1 K:1 H:1 K:1 h:1 S:1 H:1 K:1 h:1",
        ],
      },
      {
        style: "s:kit.core",
        layer: "perc2",
        pattern: [
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
        ],
      },
      {
        style: "s:trumpet",
        layer: "counter",
        pattern: [
          "-:2 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1",
          "-:2 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1",
          "-:2 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1",
          "-:2 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1",
          "-:2 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1 {A4,C5,E5}:1 -:1",
          "-:2 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1",
          "-:2 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1 {G4,C5,E5}:1 -:1",
          "-:2 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1",
        ],
      },
      { style: "s:trombone", layer: "counter", source: 5, transpose: -12 }, // the stab's trombone half, an octave down to fit its zones
      // bright: two octaves over the lead; at +12, bar 8's D4 falls below the glock's zones
      { style: "s:glock", layer: "bright", source: 0, transpose: 24, gain: 0.5 },
    ],
  },

  /* Quirky comedic staccato. C-F-G-C, woodblocks, chromatic spice. */
  "mg.puzzle": {
    id: "mg.puzzle",
    bpm: 118,
    swing: 0.5,
    loop: true,
    voices: [
      {
        style: "s:trumpet",
        layer: "base",
        transpose: -12, // an octave down: F6 is past the trumpet's zones (88)
        pattern: [
          "C5:1 -:1 E5:1 -:1 G5:1 -:1 C6:1 -:1 G5:1 F#5:1 G5:1 -:1 E5:1 -:1 C5:1 -:1",
          "E5:1 -:1 G5:1 -:1 C6:1 -:1 E6:1 -:1 D6:1 C#6:1 D6:1 C6:1 B5:1 -:1 G5:1 -:1",
          "F5:1 -:1 A5:1 -:1 C6:1 -:1 A5:1 -:1 G5:1 F#5:1 G5:1 -:1 A5:1 -:1 F5:1 -:1",
          "G5:1 -:1 B5:1 -:1 D6:1 -:1 B5:1 -:1 A5:1 Ab5:1 G5:1 F#5:1 G5:1 -:1 -:1 -:1",
          "C5:1 -:1 E5:1 -:1 G5:1 -:1 C6:1 -:1 B5:1 -:1 G5:1 F#5:1 G5:1 -:1 E5:1 -:1",
          "F5:1 -:1 A5:1 -:1 C6:1 -:1 A5:1 -:1 G5:1 -:1 E5:1 F5:1 G5:1 -:1 -:1 -:1",
          "G5:1 -:1 B5:1 -:1 D6:1 -:1 F6:1 -:1 E6:1 Eb6:1 D6:1 C#6:1 D6:1 -:1 B5:1 -:1",
          "C5:1 C#5:1 D5:1 D#5:1 E5:1 F5:1 F#5:1 G5:1 G#5:1 A5:1 A#5:1 B5:1 {C5,E5,G5}:4:0.95",
        ],
      },
      { style: "s:piano", layer: "base", chords: ["C", "C", "F", "G", "C", "F", "G", "C"] },
      {
        style: "s:bass",
        layer: "base",
        pattern: [
          "C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 C3:2 C4:2",
          "C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 C3:2 C4:2",
          "F2:2 F3:2 F2:2 F3:2 F2:2 F3:2 F2:2 F3:2",
          "G2:2 G3:2 G2:2 G3:2 G2:2 G3:2 G2:2 G3:2",
          "C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 C3:2 C4:2",
          "F2:2 F3:2 F2:2 F3:2 F2:2 F3:2 F2:2 F3:2",
          "G2:2 G3:2 G2:2 G3:2 G2:2 G3:2 G2:2 G3:2",
          "C3:2 C4:2 C3:2 C4:2 G2:2 G3:2 C3:2 C4:2",
        ],
      },
      {
        style: "s:kit.core",
        layer: "base",
        pattern: [
          "K:2 -:1 W:1 S:2 -:1 W:1 K:2 -:1 W:1 S:2 -:1 W:1",
          "K:2 -:1 W:1 S:2 -:1 W:1 K:2 -:1 W:1 S:2 -:1 W:1",
          "K:2 -:1 W:1 S:2 -:1 W:1 K:2 -:1 W:1 S:2 -:1 W:1",
          "K:2 -:1 W:1 S:2 -:1 W:1 K:2 -:1 W:1 S:2 -:1 W:1",
          "K:2 -:1 W:1 S:2 -:1 W:1 K:2 -:1 W:1 S:2 -:1 W:1",
          "K:2 -:1 W:1 S:2 -:1 W:1 K:2 -:1 W:1 S:2 -:1 W:1",
          "K:2 -:1 W:1 S:2 -:1 W:1 K:2 -:1 W:1 S:2 -:1 W:1",
          "K:2 -:1 W:1 S:2 -:1 W:1 K:2 -:1 W:1 S:2 -:1 W:1",
        ],
      },
      {
        style: "s:kit.core",
        layer: "perc2",
        pattern: [
          "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2",
          "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2",
          "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2",
          "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2",
          "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2",
          "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2",
          "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2",
          "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2",
        ],
      },
      {
        style: "s:piano",
        layer: "counter",
        pattern: [
          "{C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1",
          "{C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1",
          "{F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1",
          "{G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1",
          "{C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1",
          "{F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1 {F4,A4,C5}:1 -:1",
          "{G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1 {G4,B4,D5}:1 -:1",
          "{C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1 {C4,E4,G4}:1 -:1",
        ],
      },
      { style: "s:glock", layer: "bright", source: 0, transpose: 12, gain: 0.5 },
    ],
  },

  /* Magical sparkle. Glockenspiel sine arps, Am-F-C-G, mystery. */
  happening: {
    id: "happening",
    bpm: 104,
    swing: 0.5,
    loop: true,
    voices: [
      {
        style: "glock",
        layer: "base",
        pattern: [
          "-:2 A4:2 C5:3 E5:1 A5:2 -:2 E5:2 -:2",
          "A5:2 E5:3 C5:1 A4:2 -:4 C5:2 -:2",
          "-:2 F4:2 A4:2 C5:2 F5:2 -:2 A4:2 C5:2",
          "F5:2 C5:2 A4:2 F4:2 -:4 A4:2 -:2",
          "-:2 C5:2 E5:2 G5:2 C6:3 E6:1 -:2 E6:2",
          "E6:2 C6:3 G5:1 E5:2 -:4 G5:2 -:2",
          "-:2 G4:2 B4:2 D5:2 G5:2 -:2 F#5:2 -:2",
          "G5:2 D5:3 B4:1 G4:2 -:4 G4:2 -:2",
        ],
      },
      { style: "pad", layer: "base", chords: ["Am", "F", "C", "G", "Am", "F", "C", "G"] },
      {
        style: "bassSine",
        layer: "base",
        pattern: [
          "A1:8 A2:8",
          "F1:8 F2:8",
          "C2:8 C3:8",
          "G1:8 G2:8",
          "A1:8 A2:8",
          "F1:8 F2:8",
          "C2:8 C3:8",
          "G1:8 G2:8",
        ],
      },
      {
        style: "drums",
        layer: "base",
        pattern: [
          "K:8 B:2 B:2 L:2 B:2",
          "K:8 B:2 B:2 L:2 B:2",
          "K:8 B:2 B:2 L:2 B:2",
          "K:8 B:2 B:2 L:2 B:2",
          "K:8 B:2 B:2 L:2 B:2",
          "K:8 B:2 B:2 L:2 B:2",
          "K:8 B:2 B:2 L:2 B:2",
          "K:8 B:2 B:2 L:2 B:2",
        ],
      },
      {
        style: "drums",
        layer: "perc2",
        pattern: [
          "L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1",
          "L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1",
          "L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1",
          "L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1",
          "L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1",
          "L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1",
          "L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1",
          "L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1 L:1 B:1",
        ],
      },
      {
        style: "sparkle",
        layer: "counter",
        pattern: [
          "L:2 -:2 L:2 -:2 L:2 -:2 L:2 -:2",
          "L:2 -:2 L:2 -:2 L:2 -:2 L:2 -:2",
          "L:2 -:2 L:2 -:2 L:2 -:2 L:2 -:2",
          "L:2 -:2 L:2 -:2 L:2 -:2 L:2 -:2",
          "L:2 -:2 L:2 -:2 L:2 -:2 L:2 -:2",
          "L:2 -:2 L:2 -:2 L:2 -:2 L:2 -:2",
          "L:2 -:2 L:2 -:2 L:2 -:2 L:2 -:2",
          "L:2 -:2 L:2 -:2 L:2 -:2 L:2 -:2",
        ],
      },
      { style: "glock", layer: "bright", source: 0, transpose: 12, gain: 0.5 },
    ],
  },

  /* Goofy-menacing. Wobbly saw bass, minor-2nd stabs, Dm-Bb-A. */
  grumpus: {
    id: "grumpus",
    bpm: 92,
    swing: 0.5,
    loop: true,
    voices: [
      {
        style: "menaceLead",
        layer: "base",
        pattern: [
          "D4:2 D4:2 F4:2 D4:2 A3:2 D4:2 -:2 F4:2",
          "E4:2 Eb4:2 D4:2 C#4:2 D4:4 -:4",
          "Bb3:2 D4:2 F4:2 D4:2 Bb3:2 F4:2 A3:2 Bb3:2",
          "A3:2 C#4:2 E4:2 C#4:2 A3:2 E4:2 G#3:2 A3:2",
          "D4:2 D4:2 F4:2 D4:2 A3:2 D4:2 -:2 F4:2",
          "G4:2 F4:2 Eb4:2 D4:2 C4:2 D4:2 -:4",
          "Bb3:2 D4:2 F4:2 Bb4:2 A4:2 F4:2 D4:2 Bb3:2",
          "A3:2 C#4:2 E4:2 A4:2 G#4:2 E4:2 C#4:2 A3:2",
        ],
      },
      { style: "pad", layer: "base", chords: ["Dm", "Dm", "Bb", "A", "Dm", "Dm", "Bb", "A"] },
      {
        style: "bassWobble",
        layer: "base",
        pattern: [
          "D2:8 D2:8",
          "D2:8 D2:8",
          "Bb1:8 Bb1:8",
          "A1:8 A1:8",
          "D2:8 D2:8",
          "D2:8 D2:8",
          "Bb1:8 Bb1:8",
          "A1:8 A1:8",
        ],
      },
      {
        style: "drums",
        layer: "base",
        pattern: [
          "K:4 -:2 D:2 S:4 -:2 D:2",
          "K:4 -:2 D:2 S:4 -:2 D:2",
          "K:4 -:2 D:2 S:4 -:2 D:2",
          "K:4 -:2 D:2 S:4 -:2 D:2",
          "K:4 -:2 D:2 S:4 -:2 D:2",
          "K:4 -:2 D:2 S:4 -:2 D:2",
          "K:4 -:2 D:2 S:4 -:2 D:2",
          "K:4 -:2 D:2 S:4 -:2 D:2",
        ],
      },
      {
        style: "drums",
        layer: "perc2",
        pattern: [
          "D:8 D:8",
          "D:8 D:8",
          "D:8 D:8",
          "D:8 D:8",
          "D:8 D:8",
          "D:8 D:8",
          "D:8 D:8",
          "D:8 D:8",
        ],
      },
      {
        style: "stab",
        layer: "counter",
        pattern: [
          "{D4,Eb4}:4 -:4 {D4,Eb4}:4 -:4",
          "{D4,Eb4}:4 -:4 {D4,Eb4}:4 -:4",
          "{Bb3,B4}:4 -:4 {Bb3,B4}:4 -:4",
          "{A3,Bb3}:4 -:4 {A3,Bb3}:4 -:4",
          "{D4,Eb4}:4 -:4 {D4,Eb4}:4 -:4",
          "{D4,Eb4}:4 -:4 {D4,Eb4}:4 -:4",
          "{Bb3,B4}:4 -:4 {Bb3,B4}:4 -:4",
          "{A3,Bb3}:4 -:4 {A3,Bb3}:4 -:4",
        ],
      },
    ],
  },

  /* Cheeky shop. Light swing, music-box plucks, C-F-C-G. */
  shop: {
    id: "shop",
    bpm: 112,
    swing: 0.58,
    loop: true,
    voices: [
      {
        style: "s:glock",
        layer: "base",
        transpose: 12,
        pattern: [
          "E5:1 E5:1 G5:1 C6:1 G5:1 E5:1 G5:1 E5:1 C5:1 E5:1 G5:1 E5:1 D5:1 C5:1 D5:1 E5:1",
          "F5:1 F5:1 A5:1 C6:1 A5:1 F5:1 A5:1 F5:1 C5:1 F5:1 A5:1 F5:1 E5:1 F5:1 G5:1 A5:1",
          "E5:1 E5:1 G5:1 C6:1 G5:1 E5:1 G5:1 E5:1 C5:1 E5:1 G5:1 E5:1 D5:1 E5:1 F5:1 G5:1",
          "G5:1 G5:1 B5:1 D6:1 B5:1 G5:1 B5:1 G5:1 D5:1 G5:1 B5:1 G5:1 F#5:1 G5:1 A5:1 B5:1",
          "C6:1 B5:1 C6:1 E6:1 C6:1 G5:1 E5:1 G5:1 C6:1 B5:1 C6:1 E6:1 D6:1 C6:1 B5:1 G5:1",
          "F5:1 G5:1 A5:1 C6:1 A5:1 G5:1 F5:1 A5:1 C6:1 A5:1 F5:1 E5:1 F5:1 A5:1 C6:1 A5:1",
          "G5:1 A5:1 B5:1 C6:1 D6:1 C6:1 B5:1 A5:1 G5:1 A5:1 B5:1 C6:1 E6:1 D6:1 C6:1 B5:1",
          "B5:1 D6:1 G6:1 D6:1 B5:1 G5:1 D5:1 B4:1 G4:1 B4:1 D5:1 G5:1 B5:1 D6:1 B5:1 G5:1",
        ],
      },
      { style: "s:piano", layer: "base", chords: ["C", "F", "C", "G", "C", "F", "C", "G"] },
      {
        style: "s:bass",
        layer: "base",
        pattern: [
          "C3:2 G2:2 C3:2 G2:2 C3:2 G2:2 C3:2 G2:2",
          "F2:2 C3:2 F2:2 C3:2 F2:2 C3:2 F2:2 C3:2",
          "C3:2 G2:2 C3:2 G2:2 C3:2 G2:2 C3:2 G2:2",
          "G2:2 D3:2 G2:2 D3:2 G2:2 D3:2 G2:2 D3:2",
          "C3:2 G2:2 C3:2 G2:2 C3:2 G2:2 C3:2 G2:2",
          "F2:2 C3:2 F2:2 C3:2 F2:2 C3:2 F2:2 C3:2",
          "C3:2 G2:2 C3:2 G2:2 C3:2 G2:2 C3:2 G2:2",
          "G2:2 D3:2 G2:2 D3:2 G2:2 D3:2 G2:2 D3:2",
        ],
      },
      {
        style: "s:kit.core",
        layer: "base",
        pattern: [
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
          "K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1 K:1 H:1 h:1 H:1 S:1 H:1 h:1 H:1",
        ],
      },
      {
        style: "s:kit.core",
        layer: "perc2",
        pattern: [
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
        ],
      },
      {
        style: "s:glock",
        layer: "counter",
        transpose: 12,
        pattern: [
          "C5:4 E5:4 G5:4 E5:4",
          "F5:4 A5:4 C6:4 A5:4",
          "C5:4 E5:4 G5:4 E5:4",
          "G5:4 B5:4 D6:4 B5:4",
          "C6:4 G5:4 E5:4 G5:4",
          "F5:4 A5:4 C6:4 A5:4",
          "C6:4 E6:4 G6:4 E6:4",
          "G5:4 B5:4 D6:4 G5:4",
        ],
      },
      // bright: a unison doubling; another octave would take the top G6 past the glock's zones (112)
      { style: "s:glock", layer: "bright", source: 0, transpose: 12, gain: 0.5 },
    ],
  },

  /* Triumphant results. Rising brass fanfare, C-F-C-G, big ending. */
  results: {
    id: "results",
    bpm: 120,
    swing: 0.5,
    loop: true,
    voices: [
      {
        style: "s:trumpet",
        layer: "base",
        transpose: -12, // an octave down: the fanfare climbs to D7, past the trumpet's zones (88)
        pattern: [
          "C5:1 -:1 C5:1 -:1 E5:1 -:1 G5:1 -:1 C6:4 -:4",
          "F5:1 -:1 F5:1 -:1 A5:1 -:1 C6:1 -:1 F6:4 -:4",
          "E5:1 -:1 E5:1 -:1 G5:1 -:1 C6:1 -:1 E6:4 -:4",
          "D5:1 -:1 D5:1 -:1 F#5:1 -:1 A5:1 -:1 D6:4 -:4",
          "C6:2 G5:2 E5:2 C5:2 E5:2 G5:2 C6:2 E6:2",
          "F5:2 A5:2 C6:2 F6:2 A6:2 F6:2 C6:2 A5:2",
          "G5:2 B5:2 D6:2 G6:2 B6:2 D7:2 B6:2 G6:2",
          "C6:2 G5:2 E5:2 G5:2 C6:4 {C6,E6,G6}:4",
        ],
      },
      { style: "s:piano", layer: "base", chords: ["C", "F", "C", "G", "C", "F", "G", "C"] },
      {
        style: "s:bass",
        layer: "base",
        pattern: [
          "C2:8 G2:8",
          "F1:8 C2:8",
          "C2:8 G2:8",
          "G1:8 D2:8",
          "C2:8 G2:8",
          "F1:8 C2:8",
          "G1:8 D2:8",
          "C2:8 G2:8",
        ],
      },
      {
        style: "s:kit.core",
        layer: "base",
        pattern: [
          "C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1",
          "C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1",
          "C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1",
          "C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1",
          "C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1",
          "C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1",
          "C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1",
          "C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1 C:1 K:1 -:1 S:1",
        ],
      },
      {
        style: "s:kit.core",
        layer: "perc2",
        pattern: [
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
          "O:2 B:2 O:2 B:2 O:2 B:2 O:2 B:2",
        ],
      },
      {
        style: "s:trumpet",
        layer: "counter",
        pattern: [
          "{C4,E4,G4}:4 -:4 {C4,E4,G4}:4 -:4",
          "{F4,A4,C5}:4 -:4 {F4,A4,C5}:4 -:4",
          "{C4,E4,G4}:4 -:4 {C4,E4,G4}:4 -:4",
          "{G4,B4,D5}:4 -:4 {G4,B4,D5}:4 -:4",
          "{C4,E4,G4}:4 -:4 {C4,E4,G4}:4 -:4",
          "{F4,A4,C5}:4 -:4 {F4,A4,C5}:4 -:4",
          "{G4,B4,D5}:4 -:4 {G4,B4,D5}:4 -:4",
          "-:8 {C5,E5,G5}:8",
        ],
      },
      { style: "s:trombone", layer: "counter", source: 5, transpose: -12 }, // the stab's trombone half, an octave down to fit its zones
      // bright: two octaves over the trumpet, which plays an octave down
      { style: "s:glock", layer: "bright", source: 0, transpose: 12, gain: 0.5 },
    ],
  },

  /* 5s star flourish: ascending arp + shimmer + drum fill, resolves. */
  star_fanfare: {
    id: "star_fanfare",
    bpm: 168,
    swing: 0.5,
    loop: false,
    voices: [
      {
        style: "s:trumpet",
        layer: "base",
        transpose: -12, // an octave down: the arpeggios climb to D7, past the trumpet's zones (88)
        pattern: [
          "C5:1 E5:1 G5:1 C6:1 E6:1 G6:1 C7:1 -:1 C7:2 -:6",
          "F5:1 A5:1 C6:1 F6:1 A6:1 C7:1 -:2 C7:2 -:6",
          "G5:1 B5:1 D6:1 G6:1 B6:1 D7:1 {C6,E6,G6,C7}:2 {C5,E5,G5,C6}:8",
        ],
      },
      { style: "s:piano", layer: "base", chords: ["C", "F", "C"] },
      {
        style: "s:bass",
        layer: "base",
        pattern: [
          "C2:4 C3:4 C2:4 G2:4",
          "F2:4 F3:4 F2:4 C3:4",
          "G2:4 G3:4 C2:8",
        ],
      },
      {
        style: "s:kit.core",
        layer: "base",
        pattern: [
          "H:2 H:2 H:2 H:2 H:2 H:2 H:2 H:2",
          "K:1 S:1 K:1 S:1 K:1 S:1 K:1 S:1 K:1 S:1 K:1 S:1 K:1 S:1 K:2",
          "C:2 -:2 C:2 -:2 C:4 K:2 K:2",
        ],
      },
      {
        style: "s:glock",
        layer: "counter",
        pattern: [
          "C7:2 -:2 G6:2 -:2 E6:2 -:2 C7:2 -:2",
          "F6:2 -:2 C7:2 -:2 A6:2 -:2 F6:2 -:2",
          "G6:2 -:2 D7:2 -:2 {C7,E7,G7}:8",
        ],
      },
    ],
  },

  /* Countdown: 3-2-1 rising ticks, then GO chord (~2.8s). */
  minigame_intro: {
    id: "minigame_intro",
    bpm: 86,
    swing: 0.5,
    loop: false,
    voices: [
      { style: "blip", layer: "base", gain: 2.5, pattern: ["C5:2 D5:2 E5:2 G5:2 A5:2 G5:2 E5:2 D5:2"] },
      { style: "stab", layer: "base", gain: 2.5, pattern: ["-:8 {C5,E5,G5}:4 C5:4"] },
      { style: "bassSine", layer: "base", gain: 1.5, pattern: ["C2:8 G2:8"] },
      { style: "drums", layer: "base", pattern: ["Q:2 Q:2 Q:2 Q:2 Q:2 Q:2 Q:2 Q:2"] },
    ],
  },

  /* ~6s victory jingle: rising fanfare C-G-F-C, big final chord. */
  win: {
    id: "win",
    bpm: 160,
    swing: 0.5,
    loop: false,
    voices: [
      {
        style: "s:trumpet",
        layer: "base",
        transpose: -12, // an octave down: G6 is past the trumpet's zones (88)
        pattern: [
          "C5:2 E5:2 G5:2 C6:2 E6:4 -:4",
          "D5:2 F#5:2 A5:2 D6:2 G6:4 -:4",
          "C5:2 F5:2 A5:2 C6:2 F6:4 -:4",
          "G5:2 B5:2 D6:2 G6:2 {C6,E6,G6}:8",
        ],
      },
      { style: "s:piano", layer: "base", chords: ["C", "G", "F", "C"] },
      {
        style: "s:bass",
        layer: "base",
        pattern: [
          "C2:8 G2:8",
          "G1:8 D2:8",
          "F1:8 C2:8",
          "G2:8 C2:8",
        ],
      },
      {
        style: "s:kit.core",
        layer: "base",
        pattern: [
          "C:2 -:2 K:2 S:2 K:2 -:2 S:2 -:2",
          "C:2 -:2 K:2 S:2 K:2 -:2 S:2 -:2",
          "C:2 -:2 K:2 S:2 K:2 -:2 S:2 -:2",
          "C:2 -:2 K:2 S:1 S:1 S:1 S:1 K:2 -:2 K:2",
        ],
      },
      {
        style: "s:kit.core",
        layer: "perc2",
        pattern: [
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
          "T:2 B:2 T:2 B:2 T:2 B:2 T:2 B:2",
        ],
      },
      {
        style: "s:trumpet",
        layer: "counter",
        pattern: [
          "{C4,E4,G4}:4 -:4 {C4,E4,G4}:4 -:4",
          "{G4,B4,D5}:4 -:4 {G4,B4,D5}:4 -:4",
          "{F4,A4,C5}:4 -:4 {F4,A4,C5}:4 -:4",
          "-:8 {C5,E5,G5}:8",
        ],
      },
      { style: "s:trombone", layer: "counter", source: 5, transpose: -12 }, // the stab's trombone half, an octave down to fit its zones
    ],
  },

  /* Finale suspense: a snare roll that swells over two bars, low tom pulse.
     Loops until the reveal stops it (played on the stinger bus). */
  drumroll: {
    id: "drumroll",
    bpm: 132,
    swing: 0.5,
    loop: true,
    voices: [
      {
        style: "s:kit.core",
        layer: "base",
        pattern: [
          "S:1:0.35 S:1:0.3 S:1:0.38 S:1:0.32 S:1:0.42 S:1:0.36 S:1:0.45 S:1:0.4 S:1:0.5 S:1:0.44 S:1:0.52 S:1:0.47 S:1:0.56 S:1:0.5 S:1:0.6 S:1:0.55",
          "S:1:0.62 S:1:0.57 S:1:0.66 S:1:0.6 S:1:0.7 S:1:0.64 S:1:0.74 S:1:0.68 S:1:0.78 S:1:0.72 S:1:0.82 S:1:0.76 S:1:0.88 S:1:0.8 S:1:0.95 S:1:0.9",
        ],
      },
      { style: "s:kit.core", layer: "base", pattern: ["D:4:0.5 -:4 D:4:0.55 -:4", "D:4:0.6 -:4 D:4:0.7 D:2:0.75 D:2:0.85"] },
    ],
  },

  /* The reveal hit after a drumroll: crash, kick, and a bright brass stab. */
  drumroll_hit: {
    id: "drumroll_hit",
    bpm: 132,
    swing: 0.5,
    loop: false,
    voices: [
      { style: "s:kit.core", layer: "base", pattern: ["C:8:1 K:4:1 -:4"] },
      { style: "s:trumpet", layer: "base", gain: 1.6, pattern: ["{C5,E5,G5}:4 -:2 {C5,E5,G5,C6}:6 -:4"] },
      // the stab's trombone half, two octaves down: one octave still leaves C6 at 72, past its zones (69)
      { style: "s:trombone", layer: "base", gain: 1.6, source: 1, transpose: -24 },
      { style: "s:bass", layer: "base", gain: 1.4, pattern: ["C2:8 -:8"] },
    ],
  },

  /* ~4s comedic trombone fall: wah-wah-wah with slides. */
  lose: {
    id: "lose",
    bpm: 112,
    swing: 0.5,
    loop: false,
    voices: [
      { style: "s:trombone", layer: "base", pattern: ["D4:8:1:-2 C4:8:1:-2", "Bb3:8:1:-2 A3:8:1:-3"] },
      { style: "s:trombone", layer: "base", transpose: -12, gain: 0.8, pattern: ["D3:8:0.9:-2 C3:8:0.9:-2", "Bb2:8:0.9:-2 A2:8:0.9:-3"] },
      { style: "s:kit.core", layer: "base", pattern: ["-:16", "-:12 D:4"] },
    ],
  },
};

export const TRACK_ORDER = [
  "title", "board.fairground", "mg.action", "mg.puzzle", "happening", "grumpus",
  "shop", "results", "star_fanfare", "minigame_intro", "win", "lose",
  "drumroll", "drumroll_hit",
];

export function trackIds(): string[] {
  return TRACK_ORDER.filter((id) => TRACKS[id]);
}

/** Validate every track at module load (cheap; ~2k events total). */
for (const id of trackIds()) {
  const def = TRACKS[id];
  parseTrack(def);
  parseSection(def, "fill");
  parseSection(def, "pickup");
}
