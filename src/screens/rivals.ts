/**
 * SUPER STAR PARTY — who the local hero plays against (character select).
 *
 * A lineup is the roster indices of the CPU rivals, one per seat after the
 * hero. These helpers keep it valid: no character twice, and never the hero.
 * Pure functions, no state: the select screen owns the lineup.
 */

/** The default rivals for a hero: the first `count` other heroes in roster order. */
export function defaultRivals(hero: number, count: number, rosterSize: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < rosterSize && out.length < count; i++) if (i !== hero) out.push(i);
  return out;
}

/**
 * Make `rivals` valid for `hero`. A rival who is now the hero hands their
 * seat to `prevHero` (the old hero joins the rivals, so a swap of hero just
 * trades places); duplicates and out-of-range picks fall back to the first
 * free heroes in roster order. Returns a new array of length `count`.
 */
export function reconcileRivals(
  rivals: readonly number[],
  hero: number,
  prevHero: number | null,
  count: number,
  rosterSize: number,
): number[] {
  const out: number[] = [];
  const taken = new Set<number>([hero]);
  for (let s = 0; s < count; s++) {
    let r = rivals[s];
    if (r === hero && prevHero !== null && !taken.has(prevHero) && !rivals.includes(prevHero)) r = prevHero;
    if (r === undefined || r < 0 || r >= rosterSize || taken.has(r)) r = -1;
    out.push(r);
    if (r >= 0) taken.add(r);
  }
  for (let s = 0; s < count; s++) {
    if (out[s] >= 0) continue;
    for (let i = 0; i < rosterSize; i++) {
      if (!taken.has(i)) {
        out[s] = i;
        taken.add(i);
        break;
      }
    }
  }
  return out;
}

/**
 * Put `pick` in rival seat `slot`. If `pick` already sits in another seat the
 * two seats swap, so the lineup never holds anyone twice. Picking the hero is
 * ignored. Returns a new array.
 */
export function chooseRival(rivals: readonly number[], slot: number, pick: number, hero: number): number[] {
  const out = [...rivals];
  if (pick === hero || slot < 0 || slot >= out.length || out[slot] === pick) return out;
  const other = out.indexOf(pick);
  if (other >= 0) out[other] = out[slot];
  out[slot] = pick;
  return out;
}
