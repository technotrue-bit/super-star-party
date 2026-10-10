/**
 * SUPER STAR PARTY — board-flavoured display text.
 * The active board's skin (BoardDef.skin) renames the shared mechanics for
 * display only; with no skin these return the carnival's names unchanged.
 */
import { STAMP_LABEL, type StampKind } from "../core/game";
import { activeBoard } from "./registry";

/** Stamp display name ("Fizz" on the carnival). */
export function stampLabel(kind: StampKind): string {
  return activeBoard().skin?.stamps[kind] ?? STAMP_LABEL[kind];
}

/** Short NPC name used in banners and toasts ("Grumpus" on the carnival). */
export function npcName(): string {
  return activeBoard().skin?.npc.short ?? "Grumpus";
}

/** Full-set jackpot word, upper case ("CARNIVAL" on the carnival). */
export function jackpotWord(): string {
  return activeBoard().skin?.jackpot ?? "CARNIVAL";
}

/** Lower-case place word in happening text ("carnival" on the carnival). */
export function placeWord(): string {
  return activeBoard().skin?.place ?? "carnival";
}

/** Shop awning title ("GRUMPUS'S GUMBOOTH" on the carnival). */
export function shopTitle(): string {
  return activeBoard().skin?.shopTitle ?? "GRUMPUS'S GUMBOOTH";
}
