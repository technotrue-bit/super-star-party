/**
 * SUPER STAR PARTY — drum_solo: deterministic beat patterns.
 *
 * The song is a fixed 16-beat grid at 120bpm (0.5s/beat) built from four
 * 4-beat chunks: three rng-picked chunks (ctx.rng only) + an all-lanes
 * FINALE so the song always ends on a full-band crash. Every chunk keeps
 * every lane busy enough that CPUs stay competitive: lane 0 (human) is
 * present on >=3 of 4 beats, CPU lanes 1-3 on >=2 of 4.
 *
 * A beat is a 4-bit mask — bit i set = lane i has a ring that beat
 * (lane 0 = human, lanes 1-3 = CPU players 1-3). The pool deliberately
 * mixes 1-, 2-, 3- and 4-lane beats.
 */
export type BeatMask = number;

export type Chunk = readonly [BeatMask, BeatMask, BeatMask, BeatMask];

/** bit helpers (readability) */
export const LANE_HUMAN = 1; // lane 0
export const LANE_CPU1 = 2; // lane 1
export const LANE_CPU2 = 4; // lane 2
export const LANE_CPU3 = 8; // lane 3
export const ALL_LANES = 15;

/** Chunk pool: (lane0, lane1, lane2, lane3) ring counts per chunk. */
export const CHUNK_POOL: readonly Chunk[] = [
  [ALL_LANES, ALL_LANES, ALL_LANES, ALL_LANES], // FULL  — everyone, every beat  (4,4,4,4)
  [13, 3, 13, 3], // STOMP  — lead quarters, fills on 2&4        (4,2,2,2)
  [3, 7, 3, 11], // MARCH  — trio lead, call-and-fill           (4,4,2,2)
  [1, ALL_LANES, 1, ALL_LANES], // ECHO  — solo beats answered by full crashes (4,2,2,2)
  [3, 13, 3, 11], // SHUFFLE — dense interlock                   (4,3,2,2)
  [3, 7, ALL_LANES, ALL_LANES], // BUILD  — duo -> trio -> full     (4,4,3,2)
] as const;

export const CHUNK_NAMES = ["FULL", "STOMP", "MARCH", "ECHO", "SHUFFLE", "BUILD"] as const;

export const FINALE: Chunk = [ALL_LANES, ALL_LANES, ALL_LANES, ALL_LANES];

/**
 * Build the 16-beat song mask list. Consumes exactly 3 rng() draws
 * (one per non-finale chunk) in a fixed order.
 */
export function buildSong(rng: () => number): BeatMask[] {
  const masks: BeatMask[] = [];
  for (let i = 0; i < 3; i++) {
    const chunk = CHUNK_POOL[Math.floor(rng() * CHUNK_POOL.length)];
    masks.push(chunk[0], chunk[1], chunk[2], chunk[3]);
  }
  masks.push(FINALE[0], FINALE[1], FINALE[2], FINALE[3]);
  return masks;
}
