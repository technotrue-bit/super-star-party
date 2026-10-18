/**
 * SUPER STAR PARTY — the decided end of a match.
 *
 * The turn loop decides the final results once, when the last turn's
 * minigame is done, and every presenter reads this record. The finale
 * ceremony never calls computeBonusStars()/finalRanking() itself: those draw
 * the gameplay rng on ties, so calling them again could disagree with what
 * was decided (and would shift the seeded stream).
 */
import { match } from "../core/game";
import { computeBonusStars, finalRanking } from "./economy";
import type { BonusStarAward, BonusStarKind, FinalRankEntry } from "./economy";

/** Per-player numbers as they stood when the match ended (before bonus stars). */
export interface FinalPlayerStats {
  playerId: number;
  /** Stars earned on the board, before any bonus star. */
  boardStars: number;
  coins: number;
  minigameWins: number;
  stampsCollected: number;
}

export interface FinalResults {
  /** Final order, winner first (stars include bonus stars). */
  ranking: FinalRankEntry[];
  /** Bonus stars in announce order: mini, coin, then stamp when awarded. */
  bonuses: BonusStarAward[];
  /** Indexed by player id. */
  stats: FinalPlayerStats[];
}

let decided: FinalResults | null = null;

const ANNOUNCE_ORDER: BonusStarKind[] = ["mini", "coin", "stamp"];

/**
 * Decide the match's final results and keep them. Draws the gameplay rng
 * exactly as the turn loop always has (a bonus pass, then the ranking pass),
 * so a seeded match ends the same way it did before the finale existed. The
 * bonus stars announced are the ones the ranking counted.
 */
export function decideFinalResults(): FinalResults {
  // Kept for replay identity: the first pass is the one older builds showed
  // on the board; the ranking below re-runs it and is the official answer.
  computeBonusStars();
  const ranking = finalRanking();
  const bonuses: BonusStarAward[] = [];
  for (const star of ANNOUNCE_ORDER) {
    const holder = ranking.find((r) => r.bonus.includes(star));
    if (holder) bonuses.push({ star, playerId: holder.playerId });
  }
  const stats = match.players.map((p) => {
    const entry = ranking.find((r) => r.playerId === p.id);
    return {
      playerId: p.id,
      boardStars: entry ? entry.stars - entry.bonus.length : p.stars,
      coins: p.coins,
      minigameWins: p.minigameWins,
      stampsCollected: p.stampsCollected,
    };
  });
  decided = { ranking, bonuses, stats };
  return decided;
}

/** The decided results, or null when no match has ended since the last clear. */
export function finalResults(): FinalResults | null {
  return decided;
}

export function clearFinalResults(): void {
  decided = null;
}
