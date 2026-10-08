/**
 * SUPER STAR PARTY — Rapier for contact minigames only.
 *
 * The WASM package stays out of the boot bundle. Bumper Balls, Coin Grab,
 * and Push of War call loadRapier(); every other screen keeps the hand-rolled
 * motion it already had. A failed load is warned once and those minigames
 * fall back to that motion. The world is freed when the minigame exits.
 * Dice never read a body. Gameplay draws stay on rng.ts.
 */

/** Minigames whose motion is body contact. Timing and puzzle games are not. */
export const CONTACT_MINIGAME_IDS = ["bumper_balls", "coin_grab", "push_of_war"] as const;

export function isContactMinigame(id: string): boolean {
  return (CONTACT_MINIGAME_IDS as readonly string[]).includes(id);
}

export interface RapierStatus {
  loaded: boolean;
  failed: boolean;
  /** Rigid bodies in the live minigame world. 0 on the board and after exit. */
  contactBodies: number;
  /** Contact pairs observed since this world was created. */
  contactsSeen: number;
}

/** One dynamic body on the XZ plane. */
export interface XzBody {
  setVelocity(vx: number, vz: number): void;
  pose(): { x: number; z: number; vx: number; vz: number };
  setEnabled(on: boolean): void;
}

/** A pair Rapier reported this step. b === -1 is the arena wall. */
export interface ContactHit {
  a: number;
  b: number;
  /** Closing speed along the contact normal, from the velocities before the step. */
  approach: number;
  nx: number;
  nz: number;
}

export interface BallArena {
  addBall(id: number, x: number, z: number, radius: number): XzBody;
  step(): ContactHit[];
  bodyCount(): number;
  dispose(): void;
}

/** Push of War crate, free to slide on X and stopped by the end walls. */
export interface RailCrate {
  applyPush(netForce: number): void;
  pose(): { x: number; vx: number };
  dispose(): void;
}

export interface BallArenaOptions {
  wallInner: number;
  ballRestitution: number;
  wallRestitution: number;
}

export interface RailCrateOptions {
  velocityGain: number;
  friction: number;
  range: number;
}

type LazyModule = typeof import("./rapierLazy");

let mod: LazyModule | null = null;
let loading: Promise<LazyModule> | null = null;
let failed = false;
let warned = false;
let contactBodies = 0;
let contactsSeen = 0;

export function noteBodies(count: number): void {
  contactBodies = count;
}

export function noteContacts(count: number): void {
  contactsSeen += count;
}

export function clearContactStats(): void {
  contactBodies = 0;
  contactsSeen = 0;
}

function warnLoadFailure(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("[SSP] rapier failed to load; contact minigames keep hand-rolled collision.", err);
}

export function rapierStatus(): RapierStatus {
  return {
    loaded: mod != null,
    failed,
    contactBodies,
    contactsSeen,
  };
}

/** Dynamic-import the WASM package. Safe to call more than once. */
export function loadRapier(): Promise<void> {
  if (mod) return Promise.resolve();
  if (!loading) {
    loading = import("./rapierLazy")
      .then(async (loaded) => {
        await loaded.init();
        mod = loaded;
        return loaded;
      })
      .catch((err: unknown) => {
        loading = null;
        failed = true;
        warnLoadFailure(err);
        throw err;
      });
  }
  return loading.then(() => undefined);
}

export function createBallArena(options: BallArenaOptions): BallArena | null {
  if (!mod) return null;
  return mod.createBallArena(options);
}

export function createRailCrate(options: RailCrateOptions): RailCrate | null {
  if (!mod) return null;
  return mod.createRailCrate(options);
}

/** Two balls meet and bounce. Does not replace the live minigame world. */
export async function runContactScenario(): Promise<{
  contacted: boolean;
  separated: boolean;
  minGap: number;
}> {
  await loadRapier();
  if (!mod) throw new Error("rapier did not load");
  return mod.runBallContact();
}
