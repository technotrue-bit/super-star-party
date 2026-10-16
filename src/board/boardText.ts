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

/** Shop name in help text ("Shop" on the carnival). */
export function shopName(): string {
  return activeBoard().skin?.shopName ?? "Shop";
}

/** Shop popup title ("GUMBALL SHOP" on the carnival). */
export function shopPopupTitle(): string {
  return activeBoard().skin?.shopName?.toUpperCase() ?? "GUMBALL SHOP";
}

/** Free-item giver's full name, or null on the carnival (its help text never named one). */
export function giverName(): string | null {
  return activeBoard().skin?.giver?.name ?? null;
}

/** Banner when the giver hands over a free item ("FIZZY BARKER!" on the carnival). */
export function giverBanner(): string {
  return activeBoard().skin?.giver?.banner ?? "FIZZY BARKER!";
}

/** Gift toast for `item` (a display name). */
export function giverGift(item: string): string {
  const line = activeBoard().skin?.giver?.gift;
  return line ? line.replace("{item}", item) : `Aw, tough luck kid, here's a ${item} on the house!`;
}

/** Toast when the giver finds the bag full. */
export function giverFull(): string {
  return activeBoard().skin?.giver?.full ?? "Aw, tough luck kid, your bag's already full!";
}
