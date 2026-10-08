/**
 * Shared room facts for the friends relay.
 *
 * The browser and the PartyServer worker both use these. The worker
 * relays PartyMessage values from src/net/messages.ts and does not
 * import the board.
 *
 * `ssp-room` is the kebab-case of the Durable Object binding `SspRoom`.
 * PartyServer routes that binding at `/parties/ssp-room/<code>`.
 */

export const PARTY_ROOM_CLASS = "SspRoom";
export const PARTY_ROOM_PATH = "ssp-room";

/** Same 4-letter codes the lobby already asks for. */
export const ROOM_CODE = /^[A-Z]{4}$/;

export const MAX_HUMANS = 4;

export const PARTY_MESSAGE_TYPES = [
  "join",
  "lobby",
  "seat",
  "start",
  "choice",
  "hash",
  "minigame",
  "leave",
  "error",
] as const;

export type PartyMessageType = (typeof PARTY_MESSAGE_TYPES)[number];

export function isPartyMessageType(value: string): value is PartyMessageType {
  return (PARTY_MESSAGE_TYPES as readonly string[]).includes(value);
}

export interface RelayEnvelope {
  type: PartyMessageType;
  code: string;
  peerId?: string;
}

/** Pull type, code, and peer id off a relay frame. The rest stays opaque. */
export function readRelayEnvelope(text: string): RelayEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.type !== "string" || !isPartyMessageType(rec.type)) return null;
  if (typeof rec.code !== "string" || !ROOM_CODE.test(rec.code)) return null;
  const peerId = typeof rec.peerId === "string" ? rec.peerId : undefined;
  return { type: rec.type, code: rec.code, peerId };
}
