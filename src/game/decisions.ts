/**
 * One source for the choices a seat makes on its turn.
 *
 * A local seat returns { pending: true } and the turn loop keeps the
 * touch UI. Autoplay makes that same seat take the CPU choice, except
 * the roll: the ROLL button stays the input and the autoplay hook
 * clicks it (the CPU timer would draw rng the human turn does not).
 * A remote seat always returns pending or "wait". Nothing resolves it
 * yet — there is no session and no socket.
 */
import { playerController } from "../core/game";
import { isAutoplay } from "../core/debug";
import { rng } from "../core/rng";
import { decideShopPurchase, pickAutoItem, type ShopDecision } from "./items";
import { sensibleStarCount } from "./economy";

export interface PendingDecision {
  pending: true;
}

export type RollDecision =
  | { mode: "button" }
  | { mode: "timer"; delay: number }
  | { mode: "wait" };

export type ItemDecision = { key: string | null } | PendingDecision;
export type AimDecision = "picker" | "rng" | "wait";
export type ShopChoice = { decision: ShopDecision | null } | PendingDecision;
export type StarChoice = { count: number } | PendingDecision;
export type PoisonChoice = { use: boolean } | PendingDecision;
export type PathChoice = { to: number } | PendingDecision;

export interface DecisionSource {
  /** Local seats use the ROLL button, including under autoplay. Does not draw rng. */
  usesRollButton(playerId: number): boolean;
  /** Touch prompts (item bar, shop, star, poison, path). False under autoplay. */
  choosesLocally(playerId: number): boolean;
  /**
   * How this seat rolls. CPU timers draw rng here (0.9–1.5s).
   * Call once per dice arm — a second call would shift the stream.
   */
  roll(playerId: number): RollDecision;
  /** One pre-roll item, or null to roll with nothing. Pending keeps the item bar. */
  preRollItem(playerId: number): ItemDecision;
  /**
   * Aimed items. "rng" means call useItem without a target so it draws
   * the rival. "picker" keeps the touch list. "wait" is the remote stub.
   */
  aim(playerId: number): AimDecision;
  shop(playerId: number): ShopChoice;
  /** CPUs buy every star they can pay for, up to the bundle cap. */
  starBundle(playerId: number): StarChoice;
  /** CPUs spend a Sour Mushroom. A local seat pending gets the touch prompt. */
  poison(holderId: number): PoisonChoice;
  /**
   * Junction. `hops` is consulted only for an automatic seat, so a local
   * prompt does not walk the board before the player chooses.
   */
  path(
    playerId: number,
    stay: number,
    branch: number,
    hops: (space: number) => number,
  ): PathChoice;
}

export function isPending(value: object): value is PendingDecision {
  return "pending" in value && (value as PendingDecision).pending === true;
}

function automatic(playerId: number): boolean {
  const seat = playerController(playerId);
  if (seat === "remote") return false;
  if (seat === "local") return isAutoplay();
  return true;
}

export const decisions: DecisionSource = {
  usesRollButton(playerId) {
    return playerController(playerId) === "local";
  },

  choosesLocally(playerId) {
    return playerController(playerId) === "local" && !isAutoplay();
  },

  roll(playerId) {
    const seat = playerController(playerId);
    if (seat === "local") return { mode: "button" };
    if (seat === "remote") return { mode: "wait" };
    return { mode: "timer", delay: 0.9 + rng.next() * 0.6 };
  },

  preRollItem(playerId) {
    if (!automatic(playerId)) return { pending: true };
    return { key: pickAutoItem(playerId) };
  },

  aim(playerId) {
    const seat = playerController(playerId);
    if (seat === "remote") return "wait";
    if (seat === "local" && !isAutoplay()) return "picker";
    return "rng";
  },

  shop(playerId) {
    if (!automatic(playerId)) return { pending: true };
    return { decision: decideShopPurchase(playerId) };
  },

  starBundle(playerId) {
    if (!automatic(playerId)) return { pending: true };
    return { count: sensibleStarCount(playerId) };
  },

  poison(holderId) {
    if (!automatic(holderId)) return { pending: true };
    return { use: true };
  },

  path(playerId, stay, branch, hops) {
    if (!automatic(playerId)) return { pending: true };
    return { to: hops(branch) < hops(stay) ? branch : stay };
  },
};
