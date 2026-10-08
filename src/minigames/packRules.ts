/**
 * SUPER STAR PARTY — carnival minigame packs and the host's match rules.
 *
 * MP7-style setup (see RULES_ALIGNMENT.md):
 * - The host chooses which packs stay in the roulette. An off pack never deals.
 * - Each player owns one pack. The human's pick is persisted; CPUs are dealt
 *   from the enabled packs with a seed-derived stream (deterministic, and it
 *   does not consume the match rng, so dice and happenings stay put).
 * - Coin rewards scale by the persisted multiplier (×1–×4). The economy
 *   stacks the pack-owner bonus on top of that: one owner doubles the coins,
 *   and two, three, or four owners pay ×2, ×3, or ×4.
 *
 * Persistence matches music / speed: localStorage keys, read back on boot.
 */
import { settings } from "../config/settings";
import { mulberry32 } from "../core/rng";

export const PACK_IDS = ["midway", "sideshow", "bigtop"] as const;
export type MinigamePackId = (typeof PACK_IDS)[number];

export const COIN_MULTIPLIERS = [1, 2, 3, 4] as const;
export type CoinMultiplier = (typeof COIN_MULTIPLIERS)[number];

export interface MinigamePackDef {
  id: MinigamePackId;
  name: string;
  short: string;
  blurb: string;
}

export const MINIGAME_PACKS: readonly MinigamePackDef[] = [
  {
    id: "midway",
    name: "Midway Mayhem",
    short: "MAYHEM",
    blurb: "Bumpers, cannons, and shove-fests.",
  },
  {
    id: "sideshow",
    name: "Sideshow Shenanigans",
    short: "SIDESHOW",
    blurb: "Timing, memory, and puzzles.",
  },
  {
    id: "bigtop",
    name: "Big Top Bash",
    short: "BIG TOP",
    blurb: "Races, balloons, and coin chaos.",
  },
];

/**
 * Which carnival pack each minigame belongs to. The registry stamps this
 * on register, so a module that forgets `pack` still lands in the right tent.
 */
export const PACK_OF_MINIGAME: Record<string, MinigamePackId> = {
  bumper_balls: "midway",
  coin_cannon: "midway",
  push_of_war: "midway",
  drum_solo: "sideshow",
  pipe_puzzle: "sideshow",
  memory_match: "sideshow",
  cake_dash: "bigtop",
  balloon_pop: "bigtop",
  coin_grab: "bigtop",
};

export const LS_MINIGAME_PACKS = "ssp.minigamePacks";
export const LS_MINIGAME_COIN_MULT = "ssp.minigameCoinMultiplier";
export const LS_HUMAN_PACK = "ssp.humanPack";

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readKey(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    /* private mode / blocked storage — the in-memory match still works */
  }
}

/** Accept the old "bigtap" typo so a stale save still means Big Top Bash. */
export function normalizePack(id: string | null | undefined): MinigamePackId | null {
  if (!id) return null;
  const raw = id === "bigtap" ? "bigtop" : id;
  return (PACK_IDS as readonly string[]).includes(raw) ? (raw as MinigamePackId) : null;
}

export function packDef(id: MinigamePackId): MinigamePackDef {
  return MINIGAME_PACKS.find((p) => p.id === id) ?? MINIGAME_PACKS[0];
}

export function minigamesInPack(pack: MinigamePackId): string[] {
  return Object.entries(PACK_OF_MINIGAME)
    .filter(([, p]) => p === pack)
    .map(([id]) => id);
}

export function packOfMinigame(id: string): MinigamePackId | null {
  return PACK_OF_MINIGAME[id] ?? null;
}

/** Host's rotation. Always at least one pack, in catalog order. */
export function getEnabledPacks(): MinigamePackId[] {
  const raw = readKey(LS_MINIGAME_PACKS);
  if (!raw) return [...PACK_IDS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...PACK_IDS];
    const ids = PACK_IDS.filter((id) => parsed.includes(id));
    return ids.length > 0 ? [...ids] : [...PACK_IDS];
  } catch {
    return [...PACK_IDS];
  }
}

/**
 * Turn packs on or off. An empty selection is ignored so the roulette
 * always has somewhere to land. If the human's pack was switched off,
 * their pick slides to the first pack still in rotation.
 */
export function setEnabledPacks(ids: readonly string[]): MinigamePackId[] {
  const next = PACK_IDS.filter((id) => ids.some((raw) => normalizePack(raw) === id));
  if (next.length === 0) return getEnabledPacks();
  writeKey(LS_MINIGAME_PACKS, JSON.stringify(next));
  const human = normalizePack(readKey(LS_HUMAN_PACK));
  if (!human || !next.includes(human)) writeKey(LS_HUMAN_PACK, next[0]);
  return [...next];
}

export function getHumanPack(): MinigamePackId {
  const enabled = getEnabledPacks();
  const saved = normalizePack(readKey(LS_HUMAN_PACK));
  if (saved && enabled.includes(saved)) return saved;
  return enabled[0];
}

/** The human can only own a pack that is in rotation. */
export function setHumanPack(id: string): MinigamePackId {
  const pack = normalizePack(id);
  const enabled = getEnabledPacks();
  const applied = pack && enabled.includes(pack) ? pack : enabled[0];
  writeKey(LS_HUMAN_PACK, applied);
  return applied;
}

export function getMinigameCoinMultiplier(): CoinMultiplier {
  const raw = readKey(LS_MINIGAME_COIN_MULT);
  const n = raw === null ? settings.minigameCoinMultiplier : Number(raw);
  return (COIN_MULTIPLIERS as readonly number[]).includes(n) ? (n as CoinMultiplier) : 1;
}

export function setMinigameCoinMultiplier(n: number): CoinMultiplier {
  const applied = (COIN_MULTIPLIERS as readonly number[]).includes(n) ? (n as CoinMultiplier) : 1;
  writeKey(LS_MINIGAME_COIN_MULT, String(applied));
  return applied;
}

/**
 * Stamp packs onto the roster at match start.
 * Player 0 keeps the persisted human pick. Everyone else draws from the
 * enabled packs via mulberry32(seed), NOT the match rng, so a seeded
 * replay's dice stream does not shift when this feature is on.
 */
export function assignPlayerPacks(seed: number, players: { pack?: string }[]): void {
  const enabled = getEnabledPacks();
  if (players.length === 0 || enabled.length === 0) return;
  players[0].pack = getHumanPack();
  const side = ((seed ^ 0x5041434b) >>> 0) || 1;
  const roll = mulberry32(side);
  for (let i = 1; i < players.length; i++) {
    const idx = Math.floor(roll() * enabled.length);
    players[i].pack = enabled[idx];
  }
}
