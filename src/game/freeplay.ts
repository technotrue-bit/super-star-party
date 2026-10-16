/**
 * SUPER STAR PARTY — minigame free play.
 *
 * Title -> MINIGAMES -> character select -> minigame menu -> ready screen ->
 * the minigame -> back to the menu. While free play is on, the character
 * select starts a throwaway match (so the minigame screen has its four
 * players) and every "back to the board" exit returns to the menu instead.
 */
import { PACK_OF_MINIGAME } from "../minigames/packRules";

let active = false;
let picked: string | null = null;

export function setFreeplay(on: boolean): void {
  active = on;
  if (!on) picked = null;
}

export function isFreeplay(): boolean {
  return active;
}

/** The minigame chosen on the menu, for the ready screen. */
export function pickFreeplayMinigame(id: string): void {
  picked = id;
}

export function freeplayMinigame(): string | null {
  return picked;
}

/** Every minigame, grouped by pack (Mayhem, Sideshow, Big Top). */
export function freeplayCatalog(): { id: string; pack: string }[] {
  const order = ["midway", "sideshow", "bigtop"];
  return Object.entries(PACK_OF_MINIGAME)
    .map(([id, pack]) => ({ id, pack }))
    .sort((a, b) => order.indexOf(a.pack) - order.indexOf(b.pack));
}

/** URL of a minigame's menu picture or its looping gameplay clip. */
export function minigameMediaUrl(id: string, kind: "thumb" | "clip"): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base}minigames/${id}${kind === "thumb" ? "-thumb" : ""}.webp`;
}

/** "coin_grab" -> "Coin Grab" until the module's real name has loaded. */
export function prettyMinigameId(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
