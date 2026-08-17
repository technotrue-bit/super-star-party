/**
 * SUPER STAR PARTY — minigame registry (ORCHESTRATOR stub, Wave 2).
 * Wave 3 fills REGISTRY with real minigames via registerMinigame().
 * The turn loop calls tryPickMinigame(); returning null means
 * "no minigames available yet" and the turn loop skips the round.
 */
export interface MinigameEntry {
  id: string;
  name: string;
}

const REGISTRY: MinigameEntry[] = [];
const playedThisMatch = new Set<string>();

/** Wave 3: register a minigame (id + display name). */
export function registerMinigame(entry: MinigameEntry): void {
  if (!REGISTRY.find((e) => e.id === entry.id)) REGISTRY.push(entry);
}

/** Wave 3: reset per-match played tracking. */
export function resetMinigameTracking(): void {
  playedThisMatch.clear();
}

/** Pick the next minigame for a round: first unplayed entry, else null. */
export function tryPickMinigame(): MinigameEntry | null {
  const next = REGISTRY.find((e) => !playedThisMatch.has(e.id)) ?? null;
  if (next) playedThisMatch.add(next.id);
  return next;
}

/** Debug/critic aid. */
export function minigameCount(): number {
  return REGISTRY.length;
}
