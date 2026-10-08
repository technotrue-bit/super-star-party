/**
 * SCAFFOLD ONLY. Do not deploy. Do not spend Cloudflare.
 *
 * A future PartyServer / Durable Object would relay the same
 * PartyMessage values that src/net/relay.ts already delivers over
 * BroadcastChannel. This file is not imported by the game, has no
 * wrangler config, and is not part of the build.
 *
 * The room object would:
 *   - keep the 4-letter code, host id, and seats
 *   - reject a fifth human
 *   - broadcast lobby, start, choice, hash, minigame, and leave
 *   - treat a non-host leave as CPU takeover
 *   - stop the room if the host leaves (no handoff in this spike)
 */
export const PARTY_SCAFFOLD = "not-deployed";
