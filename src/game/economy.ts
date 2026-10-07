/**
 * SUPER STAR PARTY — economy: coins, stars, bonus stars, final ranking.
 *
 * Owned by the economy builder (wave 2). Deterministic: every tie-break goes
 * through `rng`, always consumed in FIXED order — mini-star tie first, then
 * coin-star tie (then runner-up re-picks) — so seeded runs replay identically.
 * Event-driven: coin/star changes are announced on the bus; screens and the
 * audio crowd react to them. MP7-faithful: star cost 20, +10 minigame payout,
 * two end-of-match bonus stars (Mini Star = most minigame wins, Coin Star =
 * most coins), one bonus star per player.
 */
import { match } from "../core/game";
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
  bonus: BonusStarKind[]; // which bonus stars this player won ("mini" | "coin")
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

type Scoreable = { coins: number; minigameWins: number };

/** Players tied at the max of `score(p)`; a single leader wins outright. */
function leaders(score: (p: Scoreable) => number): number[] {
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
function runnerUpLeaders(score: (p: Scoreable) => number, excludeId: number): number[] {
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
 * End-of-match bonus stars — exactly two, MP7 style:
 *   "mini" — most minigame wins
 *   "coin" — most coins
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

  // Our touch: third bonus star — Stamp Star for most stamps collected
  const stampIds = leaders((p) => (p as any).stamps?.length ?? 0);
  const stamp = pickAmong(stampIds);

  return [
    { star: "mini", playerId: mini },
    { star: "coin", playerId: coin },
    { star: "stamp", playerId: stamp },
  ];
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
 * Award 30 coins if the player just collected their 3rd distinct stamp.
 * Can be called from turn loop on landing/passing a stamp space.
 * Returns true if jackpot paid.
 */
export function awardStampJackpot(playerId: number): boolean {
  const p = match.players[playerId];
  if (!p) return false;
  const distinct = new Set(p.stamps);
  if (distinct.size >= 3) {
    addCoins(playerId, 30);
    bus.emit("stamp:jackpot", { player: playerId, amount: 30 });
    audio.sfx.play("coin.gain", { pitch: 10 });
    audio.sfx.play("crowd.cheer");
    return true;
  }
  return false;
}
