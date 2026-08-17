/**
 * Bumper Balls — module entry point.
 *
 * The minigame batch orchestrator wires the lazy loader into
 * src/minigames/index.ts (MINIGAME_MODULES); this module also registers
 * itself with the registry on import (deduped by id) so the minigame is
 * playable either way.
 */
import type { Minigame } from "../framework";
import { registerMinigame } from "../registry";

registerMinigame({ id: "bumper_balls", name: "Bumper Balls" });

/** Loader contract for the minigame registry wiring. */
export async function loadBumperBalls(): Promise<Minigame> {
  const mod = await import("./game");
  return mod.bumperBallsMinigame;
}
