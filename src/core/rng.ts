/**
 * SUPER STAR PARTY — deterministic RNG. All gameplay randomness goes through
 * this module. Never Math.random()/Date.now() in gameplay code — critics
 * replay seeded runs and must get identical results.
 */
export type RNG = () => number;

/** Mulberry32 — tiny, fast, good-enough distribution, fully seeded. */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Global game RNG — reseed per match. */
export const rng = {
  _seed: 1,
  _fn: mulberry32(1),
  /** Draws since the last reset. Debug/probe counter only; never read by gameplay. */
  _draws: 0,
  /** Reseed; returns the new seed. */
  reset(seed: number): number {
    this._seed = seed >>> 0 || 1;
    this._fn = mulberry32(this._seed);
    this._draws = 0;
    return this._seed;
  },
  next(): number {
    this._draws++;
    return this._fn();
  },
  /** Uniform int in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  },
  /** Pick one element. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  },
  /** Shuffle in place (Fisher–Yates). */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },
  get seed(): number {
    return this._seed;
  },
  /** Gameplay draws since the last reset (isolation probe). */
  get draws(): number {
    return this._draws;
  },
};

/** Deterministic easing helpers shared by movement/juice code. */
export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  elasticOut: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};
