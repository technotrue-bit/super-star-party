import type { MatchState } from "../core/game";

/**
 * Hash the match snapshot with controllers folded to cpu | human.
 * Local and remote are the same seat seen from two phones, so they
 * must not count as a desync.
 */
export function hashSnapshot(state: MatchState): string {
  const copy = JSON.parse(JSON.stringify(state)) as MatchState;
  for (const player of copy.players) {
    player.controller = player.controller === "cpu" ? "cpu" : "local";
  }
  return fnv1a(JSON.stringify(copy));
}

export function briefState(state: MatchState): string {
  const coins = state.players.map((p) => p.coins).join(",");
  const stars = state.players.map((p) => p.stars).join(",");
  const spaces = state.players.map((p) => p.space).join(",");
  const packs = state.players.map((p) => p.pack ?? "-").join(",");
  return `t${state.turn} ${state.phase} p${state.currentPlayer} c[${coins}] ★[${stars}] @[${spaces}] ${packs}`;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
