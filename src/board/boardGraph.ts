import type { BoardDef } from "./boardData";

/** The edges the walking rules read (BoardDef.next). Pure: no match state, no rng. */
export type GraphDef = Pick<BoardDef, "next" | "startIndex">;

/** Spaces reachable in one hop: [stay] or [stay, branch]. Off-board falls back to the start (same as stayOf). */
export function successors(def: GraphDef, space: number): number[] {
  return def.next[space] ?? [def.startIndex];
}

/** Next space on the same lane (the stay edge). */
export function stayNext(def: GraphDef, space: number): number {
  return successors(def, space)[0];
}

/** Fewest hops from `from` to `target` (BFS, a fork takes the shorter way). null when unreachable within `cap`. */
export function distanceTo(def: GraphDef, from: number, target: number, cap = 200): number | null {
  if (from === target) return 0;
  const seen = new Set<number>([from]);
  let frontier: number[] = [from];
  let d = 0;
  while (frontier.length > 0 && d < cap) {
    d += 1;
    const next: number[] = [];
    for (const s of frontier) {
      for (const c of successors(def, s)) {
        if (c === target) return d;
        if (!seen.has(c)) {
          seen.add(c);
          next.push(c);
        }
      }
    }
    frontier = next;
  }
  return null;
}
