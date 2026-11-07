/**
 * SUPER STAR PARTY — the party being set up on the menus.
 *
 * Title -> PLAY -> PARTY -> character select -> board menu -> line-up -> board.
 * Character select stores the seats here instead of starting the match, so
 * the board menu can still change the board. The line-up starts the match
 * (startMatch reads the saved board rule then) and plays the jump into the
 * board.
 */
import type { SeatController } from "../core/seat";

export interface PartySetup {
  kinds: string[];
  names: string[];
  controllers: SeatController[];
  /** `?seed=` when one was given (seeded replays); otherwise the match draws its own. */
  seed?: number;
}

let pending: PartySetup | null = null;

export function setPartySetup(setup: PartySetup | null): void {
  pending = setup;
}

/** The seats picked on character select, or null when none have been picked. */
export function partySetup(): PartySetup | null {
  return pending;
}
