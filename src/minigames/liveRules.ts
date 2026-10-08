import type { CoinMultiplier, MinigamePackId } from "./packRules";

/**
 * Pack rotation, the human's pack, the coin multiplier, and the
 * no-repeat lists. The live match owns this object so snapshot()
 * includes it. Readers call liveRules() after the match binds it.
 */
export interface LiveMatchRules {
  enabledPacks: MinigamePackId[];
  coinMultiplier: CoinMultiplier;
  humanPack: MinigamePackId;
  playedByPack: Record<string, string[]>;
}

let bound: LiveMatchRules | null = null;

export function bindLiveRules(rules: LiveMatchRules): void {
  bound = rules;
}

export function peekLiveRules(): LiveMatchRules | null {
  return bound;
}

export function liveRules(): LiveMatchRules {
  if (!bound) throw new Error("match rules are not bound");
  return bound;
}
