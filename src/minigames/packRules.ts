/**
 * SUPER STAR PARTY — carnival minigame packs and the host's match rules.
 *
 * MP7-style setup (see RULES_ALIGNMENT.md):
 * - The host chooses which packs stay in the roulette. An off pack never deals.
 * - Each player owns one pack. Each local seat keeps the persisted human
 *   pick; CPU and remote seats are dealt from the enabled packs with a
 *   seed-derived stream (deterministic, and it does not consume the match
 *   rng, so dice and happenings stay put).
 * - Coin rewards scale by the persisted multiplier (×1–×4). The economy
 *   stacks the pack-owner bonus on top of that: one owner doubles the coins,
 *   and two, three, or four owners pay ×2, ×3, or ×4.
 *
 * Persistence matches music / speed: localStorage keys, read back on boot.
 */
import { settings } from "../config/settings";
import { mulberry32 } from "../core/rng";
import { defaultSeatController, type SeatController } from "../core/seat";
import { liveRules, type LiveMatchRules } from "./liveRules";
import { DEFAULT_BOARD, clearUrlBoardRule, parseBoardRule, urlBoardRule, type BoardRule } from "../board/registry";

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
export const LS_BOARD = "ssp.board";

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

/** Host's rotation from storage. Always at least one pack, in catalog order. */
function readEnabledFromStorage(): MinigamePackId[] {
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

function readCoinMultiplierFromStorage(): CoinMultiplier {
  const raw = readKey(LS_MINIGAME_COIN_MULT);
  const n = raw === null ? settings.minigameCoinMultiplier : Number(raw);
  return (COIN_MULTIPLIERS as readonly number[]).includes(n) ? (n as CoinMultiplier) : 1;
}

function readHumanPackFromStorage(enabled: readonly MinigamePackId[]): MinigamePackId {
  const saved = normalizePack(readKey(LS_HUMAN_PACK));
  if (saved && enabled.includes(saved)) return saved;
  return enabled[0];
}

/** Empty no-repeat lists, one array per pack, in catalog order. */
export function blankPlayedByPack(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of PACK_IDS) out[id] = [];
  return out;
}

/**
 * Persisted host rules. Copied onto the match at boot and at match start
 * so snapshot() sees the rotation the roulette will actually use.
 */
export function readPersistedRules(): PersistedRules {
  const enabledPacks = readEnabledFromStorage();
  return {
    enabledPacks,
    coinMultiplier: readCoinMultiplierFromStorage(),
    humanPack: readHumanPackFromStorage(enabledPacks),
    board: readBoardRule(),
  };
}

export type PersistedRules = Pick<LiveMatchRules, "enabledPacks" | "coinMultiplier" | "humanPack"> & {
  /** Board for the next match. "random" is resolved once, at match start. */
  board: BoardRule;
};

/** `?board=` wins for this page load (never saved), then storage, then the carnival. */
function readBoardRule(): BoardRule {
  return urlBoardRule() ?? parseBoardRule(readKey(LS_BOARD), LS_BOARD) ?? DEFAULT_BOARD;
}

/**
 * Save the board rule for future matches (the picker calls this). A tap also
 * drops the `?board=` override, so the choice takes effect for this page load.
 */
export function setBoardRule(rule: BoardRule): BoardRule {
  writeKey(LS_BOARD, rule);
  clearUrlBoardRule();
  return readBoardRule();
}

/** Copy storage into the live match rules. Played-minigame lists are left alone. */
export function syncPersistedRules(target: LiveMatchRules): void {
  const read = readPersistedRules();
  target.enabledPacks = read.enabledPacks;
  target.coinMultiplier = read.coinMultiplier;
  target.humanPack = read.humanPack;
}

/** Host's rotation. Always at least one pack, in catalog order. */
export function getEnabledPacks(): MinigamePackId[] {
  return [...liveRules().enabledPacks];
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
  const rules = liveRules();
  rules.enabledPacks = [...next];
  if (!next.includes(rules.humanPack)) {
    rules.humanPack = next[0];
    writeKey(LS_HUMAN_PACK, next[0]);
  }
  return [...next];
}

export function getHumanPack(): MinigamePackId {
  const rules = liveRules();
  const saved = normalizePack(rules.humanPack);
  if (saved && rules.enabledPacks.includes(saved)) return saved;
  return rules.enabledPacks[0];
}

/** The human can only own a pack that is in rotation. */
export function setHumanPack(id: string): MinigamePackId {
  const pack = normalizePack(id);
  const enabled = getEnabledPacks();
  const applied = pack && enabled.includes(pack) ? pack : enabled[0];
  writeKey(LS_HUMAN_PACK, applied);
  liveRules().humanPack = applied;
  return applied;
}

export function getMinigameCoinMultiplier(): CoinMultiplier {
  return liveRules().coinMultiplier;
}

export function setMinigameCoinMultiplier(n: number): CoinMultiplier {
  const applied = (COIN_MULTIPLIERS as readonly number[]).includes(n) ? (n as CoinMultiplier) : 1;
  writeKey(LS_MINIGAME_COIN_MULT, String(applied));
  liveRules().coinMultiplier = applied;
  return applied;
}

/**
 * Stamp packs onto the roster at match start.
 * Each local seat keeps the persisted human pick. CPU and remote seats
 * draw from the enabled packs via mulberry32(seed), NOT the match rng,
 * so a seeded replay's dice stream does not shift. With one local seat
 * at index 0 the draw order matches the old "player 0, then everyone else".
 */
export function assignPlayerPacks(
  seed: number,
  players: { pack?: string; controller?: SeatController }[],
): void {
  const enabled = getEnabledPacks();
  if (players.length === 0 || enabled.length === 0) return;
  const human = getHumanPack();
  const side = ((seed ^ 0x5041434b) >>> 0) || 1;
  const roll = mulberry32(side);
  for (let i = 0; i < players.length; i++) {
    const controller = players[i].controller ?? defaultSeatController(i);
    if (controller === "local") {
      players[i].pack = human;
      continue;
    }
    const idx = Math.floor(roll() * enabled.length);
    players[i].pack = enabled[idx];
  }
}
