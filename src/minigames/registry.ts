/**
 * SUPER STAR PARTY — minigame registry with MP7 pack + roulette rules + our carnival touches.
 *
 * Packs (our own):
 * - "midway": physical/chaos (bumper_balls, push_of_war, coin_cannon, cake_dash)
 * - "sideshow": skill/timing (drum_solo, pipe_puzzle, memory_match, balloon_pop)
 * - "bigtap": party/group (coin_grab + future silly ones)
 *
 * MP7 rules:
 * - Weighted by who picked the pack
 * - No repeat inside pack until exhausted
 * - Multipliers for multiple players on same pack
 * - Lucky Card triples
 */

export interface MinigameEntry {
  id: string;
  name: string;
  /** Pack for weighting and no-repeat-within-pack. */
  pack?: "midway" | "sideshow" | "bigtap";
  /** Short description for the pre-screen. */
  description?: string;
}

const REGISTRY: MinigameEntry[] = [];
const playedByPack = new Map<string, Set<string>>();

import { rng } from "../core/rng";

/** Register (called by index.ts). */
export function registerMinigame(entry: MinigameEntry): void {
  const withPack = { ...entry, pack: entry.pack ?? "midway" as const };
  if (!REGISTRY.find((e) => e.id === withPack.id)) REGISTRY.push(withPack);
}

export function resetMinigameTracking(): void {
  playedByPack.clear();
  for (const p of ["midway", "sideshow", "bigtap"] as const) {
    playedByPack.set(p, new Set());
  }
}

// Initialize on load so first tryPickMinigame never crashes on undefined set
resetMinigameTracking();

/**
 * MP7 roulette with pack weighting.
 * playerPacks: which pack each player chose.
 * luckyPlayers: those with Lucky Card active this round (triple weight).
 */
export function tryPickMinigame(
  playerPacks: Record<number, string> = {},
  luckyPlayers: number[] = []
): MinigameEntry | null {
  const available = REGISTRY.filter((m) => {
    const pack = m.pack ?? "midway";
    const played = playedByPack.get(pack) ?? new Set();
    return !played.has(m.id);
  });
  if (available.length === 0) return null;

  const weights: number[] = [];
  let total = 0;
  for (const m of available) {
    const pack = m.pack ?? "midway";
    let w = 1;
    // Players who picked this pack get bigger slice
    Object.keys(playerPacks).forEach((pidStr) => {
      const pid = Number(pidStr);
      if (playerPacks[pid] === pack) w += 2;
    });
    // Lucky Card
    for (const pid of luckyPlayers) {
      if (playerPacks[pid] === pack) w *= 3;
    }
    weights.push(Math.max(1, w));
    total += Math.max(1, w);
  }

  let roll = rng.next() * total;
  for (let i = 0; i < available.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      const chosen = available[i];
      const pack = chosen.pack ?? "midway";
      const set = playedByPack.get(pack)!;
      set.add(chosen.id);
      return chosen;
    }
  }
  const chosen = available[0];
  const pack = chosen.pack ?? "midway";
  const set = playedByPack.get(pack)!;
  set.add(chosen.id);
  return chosen;
}

export function minigameCount(): number {
  return REGISTRY.length;
}
