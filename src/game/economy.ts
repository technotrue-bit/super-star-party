/**
 * SUPER STAR PARTY — economy: coins, stars, bonus stars, final ranking.
 *
 * Owned by the economy builder (wave 2). Deterministic: every tie-break goes
 * through `rng`, always consumed in FIXED order — mini-star tie first, then
 * coin-star tie (then runner-up re-picks) — so seeded runs replay identically.
 * Event-driven: coin/star changes are announced on the bus; screens and the
 * audio crowd react to them. MP7-faithful: star cost 20, +10 minigame payout,
 * Mini Star and Coin Star (one each; a player cannot win both), plus a
 * Stamp Star in the ranking once anyone has collected a stamp.
 */
import { match, STAMP_KINDS, type PlayerState, type StampKind } from "../core/game";
import { rng } from "../core/rng";
import { bus } from "../core/events";
import { audio } from "../audio/audioEngine";
import { settings } from "../config/settings";

export type BonusStarKind = "mini" | "coin" | "stamp";

export interface BonusStarAward {
  star: BonusStarKind;
  playerId: number;
}

export interface FinalRankEntry {
  playerId: number;
  stars: number; // match stars + 1 per bonus star won
  coins: number;
  bonus: BonusStarKind[]; // which bonus stars this player won
}

/* ------------------------------------------------------------------ */
/*  Coins                                                              */
/* ------------------------------------------------------------------ */

/**
 * Add `delta` coins to a player (negative = lose). Clamps at 0 — a player can
 * never go below zero coins. Emits `coins:change` {player, delta, total} with
 * the ACTUAL applied delta (a -5 loss at 2 coins emits delta -2, total 0), and
 * plays coin.gain / coin.lose unless `silent`. Returns the new total. A no-op
 * (clamped to no change, or explicit delta 0) emits nothing and plays nothing.
 */
export function addCoins(playerId: number, delta: number, opts?: { silent?: boolean }): number {
  const p = match.players[playerId];
  if (!p || delta === 0) return p?.coins ?? 0;
  const before = p.coins;
  const after = Math.max(0, before + delta);
  const applied = after - before;
  if (applied === 0) return before; // already at 0 and losing more — nothing changes
  p.coins = after;
  bus.emit("coins:change", { player: playerId, delta: applied, total: after });
  if (!opts?.silent) {
    audio.sfx.play(applied > 0 ? "coin.gain" : "coin.lose");
  }
  return after;
}

/** Current coin count for a player (0 for unknown ids). */
export function playerCoins(playerId: number): number {
  return match.players[playerId]?.coins ?? 0;
}

/* ------------------------------------------------------------------ */
/*  Stars                                                              */
/* ------------------------------------------------------------------ */

/**
 * Buy a star at the star space: costs settings.starCost (20) coins, +1 star.
 * Fails (returns false, no side effects) when the player has fewer coins.
 * On success emits `star:buy` {player, star, total} where `star` is the
 * player's NEW star count and `total` is their REMAINING coins after the
 * purchase, and plays the star.get fanfare at full volume.
 */
export function tryBuyStar(playerId: number): boolean {
  const p = match.players[playerId];
  if (!p || p.coins < settings.starCost) return false;
  p.coins -= settings.starCost;
  p.stars += 1;
  bus.emit("star:buy", { player: playerId, star: p.stars, total: p.coins });
  audio.sfx.play("star.get", { volume: 1 });
  // Our touch: after purchase, move the Prize Balloon to a new random spot (not current)
  movePrizeBalloon(playerId);
  return true;
}

/** Move the Prize Balloon (Star Balloon) to a new location after purchase. Carnival re-inflate touch. */
export function movePrizeBalloon(buyerId: number): void {
  const current = match.starBalloonPos;
  const candidates = [4, 15]; // the two classic star space indices
  const others = candidates.filter((i) => i !== current);
  match.starBalloonPos = others.length > 0 ? rng.pick(others) : candidates[0];
  bus.emit("star:balloon_moved", { from: current, to: match.starBalloonPos, by: buyerId });
}

/** Current star count for a player (0 for unknown ids). */
export function playerStars(playerId: number): number {
  return match.players[playerId]?.stars ?? 0;
}

/* ------------------------------------------------------------------ */
/*  Minigame payout                                                    */
/* ------------------------------------------------------------------ */

/**
 * Award the minigame winner settings.minigameWinCoins (10) coins. Silent by
 * design — the minigame flow plays the winner fanfare itself.
 */
export function minigamePayout(winnerId: number): void {
  addCoins(winnerId, settings.minigameWinCoins, { silent: true });
}

/* ------------------------------------------------------------------ */
/*  Bonus stars + final ranking                                        */
/* ------------------------------------------------------------------ */

/** Players tied at the max of `score(p)`; a single leader wins outright. */
function leaders(score: (p: PlayerState) => number): number[] {
  const players = match.players;
  let best = -Infinity;
  let ids: number[] = [];
  for (const p of players) {
    const s = score(p);
    if (s > best) {
      best = s;
      ids = [p.id];
    } else if (s === best) {
      ids.push(p.id);
    }
  }
  return ids;
}

/** Max-`score` players among everyone EXCEPT `excludeId` (bonus runner-up). */
function runnerUpLeaders(score: (p: PlayerState) => number, excludeId: number): number[] {
  const players = match.players.filter((p) => p.id !== excludeId);
  let best = -Infinity;
  let ids: number[] = [];
  for (const p of players) {
    const s = score(p);
    if (s > best) {
      best = s;
      ids = [p.id];
    } else if (s === best) {
      ids.push(p.id);
    }
  }
  return ids;
}

/** rng.pick among ties; no rng consumed when there is a single leader. */
function pickAmong(ids: number[]): number {
  return ids.length > 1 ? rng.pick(ids) : ids[0];
}

/**
 * End-of-match bonus stars, MP7 style:
 *   "mini" — most minigame wins
 *   "coin" — most coins
 *   "stamp" — most stamps collected, only when that count is above zero
 * Ties are broken deterministically with rng (mini tie consumed FIRST, then
 * coin tie — fixed order for replay). One bonus star per player: if the same
 * player would win both, the coin star goes to the richest runner-up.
 */
export function computeBonusStars(): BonusStarAward[] {
  const miniIds = leaders((p) => p.minigameWins);
  const mini = pickAmong(miniIds);

  const coinIds = leaders((p) => p.coins);
  let coin = pickAmong(coinIds);

  if (coin === mini) {
    // MP rule: never two bonus stars for one player — coin star to runner-up.
    const runnersUp = runnerUpLeaders((p) => p.coins, mini);
    coin = runnersUp.length > 0 ? pickAmong(runnersUp) : mini; // degenerate 1-player match
  }

  const awards: BonusStarAward[] = [
    { star: "mini", playerId: mini },
    { star: "coin", playerId: coin },
  ];

  // Stamp Star only when someone actually collected a stamp. A full set cashed
  // in for the jackpot still counts via stampsCollected. The finale ceremony
  // announces Mini and Coin; this award is in the ranking math only for now.
  const stampIds = leaders((p) => p.stampsCollected);
  const bestStamps = Math.max(...match.players.map((p) => p.stampsCollected), 0);
  if (bestStamps > 0 && stampIds.length > 0) {
    awards.push({ star: "stamp", playerId: pickAmong(stampIds) });
  }

  return awards;
}

/**
 * Final results: every player's total stars (match stars + 1 per bonus star
 * won), coins, and the list of bonus stars they won. Sorted: stars desc,
 * coins desc, minigame wins desc, then rng tie-break (stable per run, in
 * fixed order) if still fully tied. Deterministic for a given seed.
 */
export function finalRanking(): FinalRankEntry[] {
  const bonus = computeBonusStars();

  const entries: FinalRankEntry[] = match.players.map((p) => {
    const won = bonus.filter((b) => b.playerId === p.id).map((b) => b.star);
    return {
      playerId: p.id,
      stars: p.stars + won.length,
      coins: p.coins,
      bonus: won,
    };
  });

  entries.sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars;
    if (b.coins !== a.coins) return b.coins - a.coins;
    const wa = match.players[a.playerId]?.minigameWins ?? 0;
    const wb = match.players[b.playerId]?.minigameWins ?? 0;
    return wb - wa;
  });

  // Resolve exact ties (same stars, coins, wins) deterministically: shuffle
  // each contiguous tied run with rng in array order — replay-identical.
  let runStart = 0;
  while (runStart < entries.length) {
    let runEnd = runStart + 1;
    while (runEnd < entries.length && sameScore(entries[runStart], entries[runEnd])) runEnd++;
    if (runEnd - runStart > 1) {
      const run = entries.slice(runStart, runEnd);
      rng.shuffle(run);
      entries.splice(runStart, run.length, ...run);
    }
    runStart = runEnd;
  }

  return entries;
}

function sameScore(a: FinalRankEntry, b: FinalRankEntry): boolean {
  if (a.stars !== b.stars || a.coins !== b.coins) return false;
  return (match.players[a.playerId]?.minigameWins ?? 0) === (match.players[b.playerId]?.minigameWins ?? 0);
}

/* ------------------------------------------------------------------ */
/*  Stamp jackpot (our carnival touch + MP7 stamp rule)               */
/* ------------------------------------------------------------------ */

/**
 * Give the player a stamp kind they do not already hold.
 * When the held set reaches all three, pay the Carnival Jackpot immediately
 * and clear the held stamps so the coins are in hand for a later stop on
 * this same move (a star buy checks coins after pass effects resolve).
 * Duplicate stamps are a no-op. Returns whether a new stamp was added and
 * whether the jackpot paid.
 */
export function grantStamp(playerId: number, kind: StampKind): { added: boolean; jackpot: boolean } {
  const p = match.players[playerId];
  if (!p) return { added: false, jackpot: false };
  if (p.stamps.includes(kind)) return { added: false, jackpot: false };
  p.stamps.push(kind);
  p.stampsCollected += 1;
  bus.emit("stamp:collected", { player: playerId, kind, total: p.stampsCollected });
  const jackpot = awardStampJackpot(playerId);
  return { added: true, jackpot };
}

/**
 * Pay the Carnival Jackpot if the player is holding every stamp kind.
 * Clears the held set on payout so the same set cannot pay twice.
 * Coins stay — a star space later in the same move can spend them.
 */
export function awardStampJackpot(playerId: number): boolean {
  const p = match.players[playerId];
  if (!p) return false;
  const distinct = new Set(p.stamps);
  if (distinct.size < STAMP_KINDS.length) return false;
  const amount = settings.stampJackpot;
  addCoins(playerId, amount);
  p.stamps = [];
  bus.emit("stamp:jackpot", { player: playerId, amount });
  audio.sfx.play("crowd.cheer");
  return true;
}

/**
 * Pop a minigame balloon: the player pays the listed price (as many coins
 * as they have, never below zero) and the round is flagged for a minigame.
 * A player with no coins still pops it — the midway does not refuse a pop.
 * Returns the coins actually paid.
 */
export function popMinigameBalloon(playerId: number, listed: 5 | 10): number {
  const p = match.players[playerId];
  if (!p) return 0;
  const before = p.coins;
  addCoins(playerId, -listed);
  const paid = before - (match.players[playerId]?.coins ?? before);
  match.minigameTriggeredThisRound = true;
  bus.emit("balloon:popped", { player: playerId, coins: paid, listed });
  audio.sfx.play("pop");
  return paid;
}
