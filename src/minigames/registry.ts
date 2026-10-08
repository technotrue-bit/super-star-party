/**
 * SUPER STAR PARTY — minigame registry with MP7 pack + roulette rules.
 *
 * Packs (carnival touches — see packRules.ts):
 * - "midway": Midway Mayhem (bumper balls, coin cannon, push of war)
 * - "sideshow": Sideshow Shenanigans (drum solo, pipe puzzle, memory match)
 * - "bigtop": Big Top Bash (cake dash, balloon pop, coin grab)
 *
 * Roulette:
 * - Only packs the host left in rotation can deal.
 * - Weighted by which players own the pack. Lucky Card (when passed) triples.
 * - No repeat inside a pack until every game in that pack has been used,
 *   then that pack's list opens up again.
 */
import { rng } from "../core/rng";
import {
  getEnabledPacks,
  packOfMinigame,
  type MinigamePackId,
  PACK_IDS,
  normalizePack,
} from "./packRules";

export interface MinigameEntry {
  id: string;
  name: string;
  /** Pack for weighting, filtering, and no-repeat-within-pack. */
  pack?: MinigamePackId;
  /** Short description for the pre-screen. */
  description?: string;
}

const REGISTRY: MinigameEntry[] = [];
const playedByPack = new Map<string, Set<string>>();

function resolvePack(entry: MinigameEntry): MinigamePackId {
  const explicit = normalizePack(entry.pack);
  if (entry.pack && explicit) return explicit;
  return packOfMinigame(entry.id) ?? "midway";
}

/** Register (called by index.ts and the framework). Re-register updates the pack. */
export function registerMinigame(entry: MinigameEntry): void {
  const pack = resolvePack(entry);
  const existing = REGISTRY.find((e) => e.id === entry.id);
  if (existing) {
    if (entry.name) existing.name = entry.name;
    existing.pack = pack;
    if (entry.description) existing.description = entry.description;
    return;
  }
  REGISTRY.push({ ...entry, pack });
}

export function resetMinigameTracking(): void {
  playedByPack.clear();
  for (const p of PACK_IDS) playedByPack.set(p, new Set());
}

export function minigameCatalog(): { id: string; name: string; pack: string }[] {
  return REGISTRY.map((e) => ({
    id: e.id,
    name: e.name,
    pack: e.pack ?? "midway",
  }));
}

// Initialize on load so the first pick never crashes on an undefined set.
resetMinigameTracking();

/**
 * MP7 roulette with pack weighting and the host's rotation filter.
 * playerPacks: which pack each player owns.
 * luckyPlayers: those with Lucky Card active this round (triple weight).
 * Games whose pack is switched off are never returned.
 */
export function tryPickMinigame(
  playerPacks: Record<number, string> = {},
  luckyPlayers: number[] = [],
): MinigameEntry | null {
  const enabled = new Set<MinigamePackId>(getEnabledPacks());
  if (enabled.size === 0) return null;

  // A pack that has dealt every one of its games may deal again.
  for (const pack of enabled) {
    const games = REGISTRY.filter((m) => m.pack === pack);
    const played = playedByPack.get(pack) ?? new Set<string>();
    playedByPack.set(pack, played);
    if (games.length > 0 && games.every((g) => played.has(g.id))) played.clear();
  }

  const available = REGISTRY.filter((m) => {
    const pack = m.pack ?? "midway";
    if (!enabled.has(pack)) return false;
    const played = playedByPack.get(pack) ?? new Set<string>();
    return !played.has(m.id);
  });
  if (available.length === 0) return null;

  const weights: number[] = [];
  let total = 0;
  for (const m of available) {
    const pack = m.pack ?? "midway";
    let w = 1;
    for (const pidStr of Object.keys(playerPacks)) {
      const pid = Number(pidStr);
      if (playerPacks[pid] === pack) w += 2;
    }
    for (const pid of luckyPlayers) {
      if (playerPacks[pid] === pack) w *= 3;
    }
    const weight = Math.max(1, w);
    weights.push(weight);
    total += weight;
  }

  let roll = rng.next() * total;
  for (let i = 0; i < available.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return take(available[i]);
  }
  return take(available[0]);
}

function take(chosen: MinigameEntry): MinigameEntry {
  const pack = chosen.pack ?? "midway";
  const set = playedByPack.get(pack) ?? new Set<string>();
  set.add(chosen.id);
  playedByPack.set(pack, set);
  return chosen;
}

export function minigameCount(): number {
  return REGISTRY.length;
}
