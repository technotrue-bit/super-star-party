/**
 * SUPER STAR PARTY — cosmetic randomness for the lively board.
 *
 * A private fixed-seed mulberry32 stream, the same pattern die3d and the
 * results ceremony use. It never touches the match generator, so particle
 * spread, flap phases, and cloud jitter can draw as often as they like
 * without shifting a seeded replay. Nothing under src/board/lively/ may
 * import the gameplay generator; CI greps for it.
 */
export type FxRand = () => number;

/** Mulberry32 — a local copy so this folder never imports the gameplay generator. */
export function fxMulberry32(seed: number): FxRand {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared cosmetic stream. Draw order only changes looks, never outcomes. */
export const fxRand: FxRand = fxMulberry32(0x11fe5eed);

/** Uniform float in [min, max). */
export function fxRange(min: number, max: number): number {
  return min + (max - min) * fxRand();
}

/** Elastic ease-out, copied for the same reason (the shared `ease` lives beside the generator). */
export function fxElasticOut(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  return t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}
