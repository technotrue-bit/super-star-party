/**
 * SUPER STAR PARTY — minigame module list (Wave 3a).
 *
 * Each minigame batch APPENDS its lazy loader here as it lands. The
 * framework (src/minigames/framework.ts) resolves and registers every
 * module's id/name with the registry at load time, and the minigame screen
 * loads the picked minigame through the same list.
 *
 *   MINIGAME_MODULES.push(() => import("../minigames/bumperBalls/bumperBalls"));
 *
 * (the imported module's default or named export must be a `Minigame`).
 * Empty until the first minigame batch lands — the turn loop then takes
 * its no-minigames toast path, which keeps the match flowing.
 */
import type { Minigame } from "./framework";

/** Lazy loaders for every minigame module in the game. */
export const MINIGAME_MODULES: Array<() => Promise<Minigame>> = [];
