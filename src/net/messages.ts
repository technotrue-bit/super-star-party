import type { CoinMultiplier, MinigamePackId } from "../minigames/packRules";

export interface SeatSlot {
  index: number;
  /** Null means this seat is a CPU. */
  peerId: string | null;
  name: string;
  kind: string;
}

export interface MatchSetup {
  seed: number;
  turns: number;
  enabledPacks: MinigamePackId[];
  coinMultiplier: CoinMultiplier;
  humanPack: MinigamePackId;
  /** Pack id per seat, already dealt by the host. */
  packs: string[];
  seats: SeatSlot[];
}

export interface OfficialMinigame {
  ranking: number[];
  coinWinners?: number[];
  minigameDice: { turn: number; ids: string[] } | null;
}

export type BoardChoice =
  | { kind: "preitem"; playerId: number; auto: true }
  | { kind: "item"; playerId: number; key: string; target?: number; give?: string; take?: string }
  | { kind: "roll"; playerId: number }
  | {
      kind: "shop";
      playerId: number;
      auto?: boolean;
      bought?: string[];
      traps?: { space: number; kind: string }[];
    }
  | { kind: "star"; playerId: number; auto?: boolean; count: number; pass?: boolean }
  | { kind: "poison"; playerId: number; auto?: boolean; use: boolean }
  | { kind: "path"; playerId: number; auto?: boolean; to?: number };

export type PartyMessage =
  | { type: "join"; code: string; peerId: string; name: string }
  | { type: "lobby"; code: string; hostId: string; seats: SeatSlot[] }
  | { type: "seat"; code: string; peerId: string; kind: string }
  | { type: "start"; code: string; setup: MatchSetup }
  | { type: "choice"; code: string; choice: BoardChoice }
  | {
      type: "hash";
      code: string;
      seq: number;
      hash: string;
      peerId: string;
      brief: string;
      label: string;
    }
  | { type: "minigame"; code: string; result: OfficialMinigame }
  | { type: "leave"; code: string; peerId: string }
  | { type: "error"; code: string; peerId: string; message: string };
