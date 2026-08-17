/**
 * SUPER STAR PARTY — minigame module list (Wave 3).
 *
 * Each minigame batch APPENDS its lazy loader here as it lands. The
 * framework (src/minigames/framework.ts) resolves and registers every
 * module's id/name with the registry at load time, and the minigame screen
 * loads the picked minigame through the same list.
 *
 *   MINIGAME_MODULES.push(() => import("../minigames/bumperBalls/bumperBalls"));
 *
 * (the imported module's default or named export must be a `Minigame`).
 */
import type { Minigame } from "./framework";

/** Lazy loaders for every minigame module in the game. */
export const MINIGAME_MODULES: Array<() => Promise<Minigame>> = [
  // ---- Wave 3 batch 1 ----
  () => import("./bumper_balls/index").then((m) => m.loadBumperBalls()),
  () => import("./cake_dash/index").then((m) => m.loadCakeDash()),
  () => import("./coin_cannon/index").then((m) => m.loadCoinCannon()),
  () => import("./memory_match/index").then((m) => m.loadMemoryMatch()),
  // ---- Wave 3 batch 2 ----
  () => import("./drum_solo/index").then((m) => m.loadDrumSolo()),
  () => import("./balloon_pop/index").then((m) => m.loadBalloonPop()),
  () => import("./coin_grab/index").then((m) => m.loadCoinGrab()),
  () => import("./pipe_puzzle/index").then((m) => m.loadPipePuzzle()),
];
