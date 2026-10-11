/**
 * SUPER STAR PARTY — drum_solo: the song chart.
 *
 * Every player drums the SAME chart (fair: nobody gets an easier lane).
 * The chart is 16 beats at 120bpm built from four 4-beat chunks. Each beat
 * is one of:
 *   "Q" a note on the beat,
 *   "E" two eighth notes (on the beat and half a beat later),
 *   "R" a rest.
 * The first chunk is always a gentle one, the last is a fixed fill, the two
 * in between are picked with ctx.rng (exactly 3 draws).
 */
export type BeatKind = "Q" | "E" | "R";
export type Chunk = readonly [BeatKind, BeatKind, BeatKind, BeatKind];

/** Gentle openers: quarters, at most one pair. */
export const OPENERS: readonly Chunk[] = [
  ["Q", "Q", "Q", "Q"],
  ["Q", "Q", "E", "Q"],
  ["Q", "R", "Q", "Q"],
];

/** Middle chunks: pairs and rests make it a rhythm, not a metronome. */
export const MIDDLES: readonly Chunk[] = [
  ["Q", "E", "Q", "R"],
  ["E", "Q", "E", "Q"],
  ["Q", "R", "E", "Q"],
  ["E", "E", "Q", "R"],
  ["Q", "Q", "E", "E"],
  ["R", "E", "Q", "E"],
];

export const FINALE: Chunk = ["E", "Q", "E", "Q"];

/** Note times in beats (0-based, fractional for the second eighth). */
export function buildChart(rng: () => number): number[] {
  const chunks: Chunk[] = [
    OPENERS[Math.floor(rng() * OPENERS.length)],
    MIDDLES[Math.floor(rng() * MIDDLES.length)],
    MIDDLES[Math.floor(rng() * MIDDLES.length)],
    FINALE,
  ];
  const notes: number[] = [];
  chunks.forEach((chunk, c) => {
    chunk.forEach((kind, i) => {
      const beat = c * 4 + i;
      if (kind === "Q") notes.push(beat);
      else if (kind === "E") notes.push(beat, beat + 0.5);
    });
  });
  return notes;
}
