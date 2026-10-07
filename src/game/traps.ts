/**
 * SUPER STAR PARTY — orbs sitting on spaces.
 * Placed from the shop. Fired when someone else lands on the space.
 * Coin changes go through economy.addCoins. No DOM here.
 */
import { match } from "../core/game";
import type { SpaceTrap, TrapKind } from "../core/game";
import { rng } from "../core/rng";
import { addCoins } from "./economy";

export interface TrapResult {
  kind: TrapKind;
  ownerId: number;
  victimId: number;
  message: string;
  coinsMoved?: number;
  starMoved?: boolean;
  starLost?: boolean;
  coinsLost?: number;
  itemStolen?: string;
  swapped?: boolean;
  duel?: boolean;
  /** Money Tree paid out and should leave the board. */
  harvested?: boolean;
  /** Star Shift moved the prize balloon. */
  starShifted?: boolean;
}

export function trapAt(space: number): SpaceTrap | undefined {
  return match.traps.find((t) => t.space === space);
}

export function canPlaceTrap(ownerId: number, space: number, starSpace: number, shopSpaces: number[]): boolean {
  const owner = match.players[ownerId];
  if (!owner) return false;
  if (space === owner.space) return false;
  if (space === starSpace) return false;
  if (shopSpaces.includes(space)) return false;
  if (trapAt(space)) return false;
  return true;
}

export function placeTrap(ownerId: number, space: number, kind: TrapKind): boolean {
  if (trapAt(space)) return false;
  match.traps.push({
    space,
    kind,
    ownerId,
    grown: kind === "tree" ? 0 : undefined,
    turnsLeft: kind === "circus" ? 3 : undefined,
  });
  return true;
}

/** Grow every Money Tree by 3 coins. Call once per completed round. */
export function growTrees(): void {
  for (const trap of match.traps) {
    if (trap.kind === "tree") trap.grown = (trap.grown ?? 0) + 3;
  }
}

/** Age Mini Circus tents. Removes any that have lasted 3 rounds. */
export function ageCircuses(): void {
  match.traps = match.traps.filter((trap) => {
    if (trap.kind !== "circus") return true;
    trap.turnsLeft = (trap.turnsLeft ?? 1) - 1;
    return trap.turnsLeft > 0;
  });
}

/** 1 coin to the circus owner. Returns false when the passer is broke. */
export function payCircusToll(passerId: number, ownerId: number): boolean {
  const passer = match.players[passerId];
  if (!passer || passer.coins < 1) return false;
  addCoins(passerId, -1);
  addCoins(ownerId, 1);
  return true;
}

export function consumeTrap(space: number): SpaceTrap | undefined {
  const i = match.traps.findIndex((t) => t.space === space);
  if (i < 0) return undefined;
  const [trap] = match.traps.splice(i, 1);
  return trap;
}

function stealCoins(ownerId: number, victimId: number, amount: number): number {
  const victim = match.players[victimId];
  const taken = Math.min(amount, victim?.coins ?? 0);
  if (taken <= 0) return 0;
  addCoins(victimId, -taken);
  addCoins(ownerId, taken);
  return taken;
}

export function resolveTrap(victimId: number, trap: SpaceTrap): TrapResult {
  const owner = match.players[trap.ownerId];
  const victim = match.players[victimId];
  const ownerName = owner?.name ?? "Someone";
  const base = { kind: trap.kind, ownerId: trap.ownerId, victimId };

  if (trap.kind === "coin10" || trap.kind === "coin20") {
    const amount = trap.kind === "coin10" ? 10 : 20;
    const taken = stealCoins(trap.ownerId, victimId, amount);
    return { ...base, coinsMoved: taken, message: `${ownerName} snatches ${taken} coins!` };
  }

  if (trap.kind === "star_steal") {
    if ((victim?.stars ?? 0) > 0 && owner) {
      victim.stars -= 1;
      owner.stars += 1;
      return { ...base, starMoved: true, message: `${ownerName} steals a star!` };
    }
    return { ...base, starMoved: false, message: `${ownerName}'s star snatch fizzles!` };
  }

  if (trap.kind === "wreck") {
    let starLost = false;
    if (victim && victim.stars > 0) {
      victim.stars -= 1;
      starLost = true;
    }
    const lost = Math.min(10, victim?.coins ?? 0);
    if (lost > 0) addCoins(victimId, -lost);
    return { ...base, starLost, coinsLost: lost, message: `Wreck Orb! A star and ${lost} coins vanish!` };
  }

  if (trap.kind === "snag") {
    const item = victim?.items.shift();
    if (item && owner) {
      owner.items.push(item);
      return { ...base, itemStolen: item, message: `${ownerName} snags a ${item}!` };
    }
    return { ...base, message: `${ownerName}'s snagbag comes up empty!` };
  }

  if (trap.kind === "swap") {
    if (owner && victim) {
      const tmp = owner.space;
      owner.space = victim.space;
      victim.space = tmp;
    }
    return { ...base, swapped: true, message: `${ownerName} swaps places with you!` };
  }

  if (trap.kind === "tree") {
    const grown = trap.grown ?? 0;
    if (victimId === trap.ownerId && grown > 0) {
      addCoins(trap.ownerId, grown);
      return { ...base, harvested: true, coinsMoved: grown, message: `Money Tree pays ${grown} coins!` };
    }
    return { ...base, message: `A Money Tree is growing (${grown} coins).` };
  }

  if (trap.kind === "circus") {
    return { ...base, message: `${ownerName}'s circus takes a coin a space for ${trap.turnsLeft ?? 0} turns.` };
  }

  if (trap.kind === "star_shift") {
    const stars = match.players.length
      ? [4, 15].filter((i) => i !== match.starBalloonPos)
      : [4];
    const next = stars.length ? rng.pick(stars) : 4;
    const from = match.starBalloonPos;
    match.starBalloonPos = next;
    return { ...base, starShifted: true, message: `The star jumps from space ${from + 1} to ${next + 1}!` };
  }

  match.duel = { challengerId: trap.ownerId, victimId };
  const ownerRoll = rng.int(1, 6);
  const victimRoll = rng.int(1, 6);
  const ownerWins = ownerRoll >= victimRoll;
  const winner = ownerWins ? trap.ownerId : victimId;
  const loser = ownerWins ? victimId : trap.ownerId;
  addCoins(loser, -Math.min(10, match.players[loser]?.coins ?? 0));
  addCoins(winner, 10);
  const winnerName = match.players[winner]?.name ?? "Someone";
  return {
    ...base,
    duel: true,
    message: `Duel! ${winnerName} wins ${ownerRoll}-${victimRoll} and takes 10 coins!`,
  };
}
