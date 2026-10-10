/**
 * SUPER STAR PARTY — happenings: green-space events + Grumpus events.
 * Wave 2 (happenings builder). Every event is:
 *   - deterministic  (all randomness through rng, never Math.random)
 *   - dramatic       (big banner text + sound, often movement)
 *   - fair-ish       (comeback potential; Grumpus punishes the leader)
 *   - side-effect-safe (ALL coin changes flow through economy.addCoins so
 *     'coins:change' events + gain/lose sounds stay consistent)
 * The turn loop consumes HappeningOutcome to move characters and pays out
 * coinsDelta. match.events doubles as the no-repeat tracker for green
 * events AND the per-player flag store for star_magnet / lucky_penny
 * (sentinels 'freeStar:<id>' / 'doubleBlue:<id>', cleared by
 * consumeFreeStar / consumeDoubleBlue).
 */

import { rng } from "../core/rng";
import { bus } from "../core/events";
import { match, type PlayerState } from "../core/game";
import { audio } from "../audio/audioEngine";
import { ahead } from "../board/boardData";
import { activeBoard } from "../board/registry";
import { npcName, placeWord } from "../board/boardText";
import { addCoins, movePrizeBalloon } from "./economy";

/** What the turn loop needs to apply after a happening resolves. */
export interface HappeningOutcome {
  label: string; // short label (toasts / happening event)
  message: string; // one-line explainer
  coinsDelta: number; // net coin change for the acting player
  moveTo?: number; // absolute space index to move the acting player to
  moveBy?: number; // relative move for the acting player (used instead of moveTo)
  moveOtherTo?: number; // teleport ANOTHER player here (spot/leader swaps)
  banner: string; // big banner text for the screen
}

/* ------------------------------------------------------------------ */
/*  Board helpers                                                      */
/* ------------------------------------------------------------------ */

/** Wrap a space index into [0, board size) for the active board. */
function wrap(n: number): number {
  const size = activeBoard().spaces.length;
  return ((n % size) + size) % size;
}

function emitHappening(playerId: number, eventId: string, label: string): void {
  bus.emit("happening:event", { player: playerId, eventId, label });
}

function activeOthers(playerId: number): PlayerState[] {
  return match.players.filter((p) => p.active && p.id !== playerId);
}

/** The richest OTHER active player (Grumpus's favorite victim); -1 if none. */
function richestOtherId(playerId: number): number {
  const others = activeOthers(playerId);
  if (others.length === 0) return -1;
  const sorted = [...others].sort((a, b) => b.coins - a.coins || a.id - b.id);
  return sorted[0].id;
}

/** Swap two players' board positions in match state; returns [theirOld, myOld]. */
function swapSpaces(a: PlayerState, b: PlayerState): [number, number] {
  const aOld = a.space;
  const bOld = b.space;
  a.space = bOld;
  b.space = aOld;
  return [bOld, aOld];
}

/* ------------------------------------------------------------------ */
/*  Flag store (star_magnet / lucky_penny) — lives in match.events      */
/* ------------------------------------------------------------------ */

function setFlag(key: string, playerId: number): void {
  match.events.push(`${key}:${playerId}`);
}

function consumeFlag(key: string, playerId: number): boolean {
  const flag = `${key}:${playerId}`;
  const i = match.events.indexOf(flag);
  if (i === -1) return false;
  match.events.splice(i, 1);
  return true;
}

/** True if playerId has a free star waiting; consumes it. Turn loop: check on landing on a star space. */
export function consumeFreeStar(playerId: number): boolean {
  return consumeFlag("freeStar", playerId);
}

/** True if playerId's next blue space pays double; consumes it. Turn loop: check on landing on a blue space. */
export function consumeDoubleBlue(playerId: number): boolean {
  return consumeFlag("doubleBlue", playerId);
}

/* ------------------------------------------------------------------ */
/*  Green-space events (no repeats until all used, then reshuffle)      */
/* ------------------------------------------------------------------ */

const GREEN_EVENTS: readonly string[] = [
  "wind_ride",
  "coin_shower",
  "coin_tax",
  "spot_swap",
  "star_magnet",
  "lucky_penny",
  "banana_peel",
  "express_pass",
  "star_dance",
  "balloon_breeze",
];

/** Pick the next green event: rng.pick among ids not yet used this match. */
function pickGreenEvent(): string {
  const used = match.events.filter((e) => GREEN_EVENTS.includes(e));
  let pool: string[];
  if (used.length >= GREEN_EVENTS.length) {
    // All used: reshuffle (clear only green ids, keep flag sentinels).
    match.events = match.events.filter((e) => !GREEN_EVENTS.includes(e));
    pool = [...GREEN_EVENTS];
  } else {
    pool = GREEN_EVENTS.filter((id) => !used.includes(id));
  }
  const id = rng.pick(pool);
  match.events.push(id);
  return id;
}

/**
 * Resolve a green-space happening for the acting player on `spaceIndex`.
 * Mutates match (flags, swaps, coins via addCoins) and returns the outcome
 * the turn loop applies (movement + banner).
 */
export function resolveGreen(playerId: number, spaceIndex: number): HappeningOutcome {
  const player = match.players[playerId];
  // The board's place word (display only; "carnival" on the carnival).
  const place = placeWord();
  if (!player) {
    // Never happens (currentPlayer always exists); safe no-op fallback.
    return { label: "?", message: `The ${place} takes a breath.`, coinsDelta: 0, banner: "..." };
  }
  const eventId = pickGreenEvent();
  const s = wrap(spaceIndex);

  switch (eventId) {
    case "wind_ride": {
      const dist = rng.int(3, 6);
      audio.sfx.play("happening.magic");
      audio.sfx.play("whoosh");
      emitHappening(playerId, eventId, "Gusty Gale!");
      return {
        label: "Gusty Gale!",
        message: `A ${place} gale sweeps you ${dist} spaces forward!`,
        coinsDelta: 0,
        moveTo: ahead(activeBoard(), s, dist),
        banner: "GUSTY GALE!",
      };
    }
    case "coin_shower": {
      const amount = rng.int(5, 10);
      addCoins(playerId, amount);
      audio.sfx.play("coin.gain", { pitch: 7 }); // second, higher ching — the shower
      audio.sfx.play("happening.magic");
      emitHappening(playerId, eventId, "Coin Shower!");
      return {
        label: "Coin Shower!",
        message: `Coins rain from the sky! +${amount} coins!`,
        coinsDelta: amount,
        banner: "COIN SHOWER!",
      };
    }
    case "coin_tax": {
      addCoins(playerId, -3);
      audio.sfx.play("happening.magic");
      audio.sfx.play("sad");
      emitHappening(playerId, eventId, "Popcorn Tax!");
      return {
        label: "Popcorn Tax!",
        message: "The popcorn vendor demands 3 coins. No refunds.",
        coinsDelta: -3,
        banner: "POPCORN TAX!",
      };
    }
    case "spot_swap": {
      const others = activeOthers(playerId);
      if (others.length === 0) {
        emitHappening(playerId, eventId, "Musical Chairs!");
        return {
          label: "Musical Chairs!",
          message: "The music stops... but there's no one else to swap with.",
          coinsDelta: 0,
          banner: "MUSICAL CHAIRS!",
        };
      }
      const other = rng.pick(others);
      const [myNew, otherNew] = swapSpaces(player, other);
      audio.sfx.play("happening.magic");
      audio.sfx.play("whoosh");
      emitHappening(playerId, eventId, "Musical Chairs!");
      return {
        label: "Musical Chairs!",
        message: `The music stops — you swap spots with ${other.name}!`,
        coinsDelta: 0,
        moveTo: myNew,
        moveOtherTo: otherNew,
        banner: "MUSICAL CHAIRS!",
      };
    }
    case "star_magnet": {
      setFlag("freeStar", playerId);
      audio.sfx.play("happening.magic");
      audio.sfx.play("pop");
      emitHappening(playerId, eventId, "Next star is free!");
      return {
        label: "Next star is free!",
        message: "A golden glow surrounds you — your next star costs nothing!",
        coinsDelta: 0,
        banner: "STAR MAGNET!",
      };
    }
    case "lucky_penny": {
      setFlag("doubleBlue", playerId);
      audio.sfx.play("happening.magic");
      audio.sfx.play("coin.gain", { pitch: 12 });
      emitHappening(playerId, eventId, "Next blue pays double!");
      return {
        label: "Next blue pays double!",
        message: "Your lucky penny shines — your next blue space pays double!",
        coinsDelta: 0,
        banner: "LUCKY PENNY!",
      };
    }
    case "banana_peel": {
      audio.sfx.play("happening.magic");
      audio.sfx.play("boing");
      emitHappening(playerId, eventId, "Banana Peel!");
      return {
        label: "Banana Peel!",
        message: "Sliiip! You slide back 2 spaces.",
        coinsDelta: 0,
        moveBy: -2,
        banner: "BANANA PEEL!",
      };
    }
    case "express_pass": {
      audio.sfx.play("happening.magic");
      audio.sfx.play("whoosh");
      emitHappening(playerId, eventId, "Express Pass!");
      return {
        label: "Express Pass!",
        message: "An express ticket zips you 6 spaces ahead!",
        coinsDelta: 0,
        moveTo: ahead(activeBoard(), s, 6),
        banner: "EXPRESS PASS!",
      };
    }
    case "star_dance": {
      const target = match.starBalloonPos;
      addCoins(playerId, 3);
      const spot = activeBoard().spaces[wrap(target)];
      if (target !== s && spot) {
        audio.sfx.play("happening.magic");
        audio.sfx.play("crowd.aah");
        audio.sfx.play("whoosh");
        emitHappening(playerId, eventId, "Star Dance!");
        return {
          label: "Star Dance!",
          message: `The Grand Prize Balloon calls you! +3 coins, and you float to ${spot.name}!`,
          coinsDelta: 3,
          moveTo: target,
          banner: "STAR DANCE!",
        };
      }
      audio.sfx.play("happening.magic");
      emitHappening(playerId, eventId, "Star Dance!");
      return {
        label: "Star Dance!",
        message: "You are already under the Grand Prize Balloon. Still, +3 coins!",
        coinsDelta: 3,
        banner: "STAR DANCE!",
      };
    }
    case "balloon_breeze": {
      const from = match.starBalloonPos;
      const to = movePrizeBalloon(playerId);
      const fromName = activeBoard().spaces[wrap(from)]?.name ?? (place === "carnival" ? "the midway" : `the ${place}`);
      const toName = activeBoard().spaces[wrap(to)]?.name ?? "a new spot";
      audio.sfx.play("happening.magic");
      audio.sfx.play("whoosh");
      emitHappening(playerId, eventId, "Balloon Breeze!");
      return {
        label: "Balloon Breeze!",
        message: `A gust pops the Grand Prize Balloon off ${fromName} and it reinflates at ${toName}!`,
        coinsDelta: 0,
        banner: "BALLOON BREEZE!",
      };
    }
    default: {
      // Unreachable (pool only contains the ids above); deterministic safe fallback.
      emitHappening(playerId, eventId, "Whimsy!");
      return {
        label: "Whimsy!",
        message: `Something strange happens. The ${place} giggles.`,
        coinsDelta: 0,
        banner: "WHIMSY!",
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Grumpus events (weighted pool, gift is rare)                       */
/* ------------------------------------------------------------------ */

const GRUMPUS_EVENTS: ReadonlyArray<{ id: string; weight: number }> = [
  { id: "grumpus_gamble", weight: 40 }, // Wheel of Woe
  { id: "grumpus_shove", weight: 24 }, // Shove back 3
  { id: "grumpus_steal", weight: 20 }, // Tax the leader
  { id: "grumpus_swap", weight: 12 }, // Swap with the leader
  { id: "grumpus_gift", weight: 4 }, // ...why?
];

/** Weighted pick over the Grumpus pool. */
function pickGrumpusEvent(): string {
  const total = GRUMPUS_EVENTS.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng.next() * total;
  for (const e of GRUMPUS_EVENTS) {
    roll -= e.weight;
    if (roll < 0) return e.id;
  }
  return "grumpus_gamble";
}

/**
 * Resolve a Grumpus-space happening. GOOFY-MENACING: the big grumpy bear
 * laughs, then steals, shoves, gambles — or, once in a blue moon, gives.
 */
export function resolveGrumpus(playerId: number, spaceIndex: number): HappeningOutcome {
  const player = match.players[playerId];
  // The board's NPC name (display only; "Grumpus" on the carnival).
  const G = npcName();
  const GU = G.toUpperCase();
  if (!player) {
    return { label: "?", message: `${G} squints at the empty space.`, coinsDelta: 0, banner: "..." };
  }
  const eventId = pickGrumpusEvent();
  const s = wrap(spaceIndex);

  switch (eventId) {
    case "grumpus_gamble": {
      const roll = rng.next();
      let delta: number;
      let message: string;
      if (roll < 0.5) {
        delta = -10;
        message = `The wheel lands on... 10 COINS GONE! ${G} cackles.`;
      } else if (roll < 0.75) {
        delta = -5;
        message = "The wheel lands on... 5 coins vanish into the fur.";
      } else if (roll < 0.9) {
        delta = 0;
        message = `The wheel lands on... nothing? ${G} shrugs. Lucky you.`;
      } else {
        delta = player.coins;
        message =
          delta > 0
            ? `DOUBLE! The wheel flips and your ${delta} coins DOUBLE!`
            : `DOUBLE... of zero is zero. ${G} is unimpressed.`;
      }
      addCoins(playerId, delta);
      audio.sfx.play("grumpus.laugh");
      if (delta > 0) audio.sfx.play("crowd.aah");
      else if (delta < 0) audio.sfx.play("sad");
      emitHappening(playerId, eventId, `${G} Wheel of Woe!`);
      return {
        label: `${G} Wheel of Woe!`,
        message,
        coinsDelta: delta,
        banner: "WHEEL OF WOE!",
      };
    }
    case "grumpus_shove": {
      audio.sfx.play("grumpus.laugh");
      audio.sfx.play("sad");
      emitHappening(playerId, eventId, `${G} Shove!`);
      return {
        label: `${G} Shove!`,
        message: `${G} shoves you back 3 spaces. Rude!`,
        coinsDelta: 0,
        moveBy: -3,
        banner: `${GU} SHOVE!`,
      };
    }
    case "grumpus_steal": {
      const target = richestOtherId(playerId);
      if (target === -1) {
        emitHappening(playerId, eventId, `${G} Tax!`);
        return {
          label: `${G} Tax!`,
          message: `${G} finds no pockets to pick. Suspicious.`,
          coinsDelta: 0,
          banner: `${GU} TAX!`,
        };
      }
      const leader = match.players[target];
      addCoins(target, -5);
      addCoins(playerId, 5);
      audio.sfx.play("grumpus.laugh");
      audio.sfx.play("crowd.aah");
      emitHappening(playerId, eventId, `${G} Tax!`);
      return {
        label: `${G} Tax!`,
        message: `${G} takes 5 coins from ${leader.name} and drops them in your lap!`,
        coinsDelta: 5,
        banner: `${GU} TAX!`,
      };
    }
    case "grumpus_swap": {
      const target = richestOtherId(playerId);
      if (target === -1) {
        emitHappening(playerId, eventId, `${G} Swap!`);
        return {
          label: `${G} Swap!`,
          message: `${G} looks for someone to swap with. No one. ${G === "Grumpus" ? "He huffs." : "Huff!"}`,
          coinsDelta: 0,
          banner: `${GU} SWAP!`,
        };
      }
      const leader = match.players[target];
      const [myNew, otherNew] = swapSpaces(player, leader);
      audio.sfx.play("grumpus.laugh");
      audio.sfx.play("whoosh");
      emitHappening(playerId, eventId, `${G} Swap!`);
      return {
        label: `${G} Swap!`,
        message: `${G} hauls you onto ${leader.name}'s spot — and vice versa!`,
        coinsDelta: 0,
        moveTo: myNew,
        moveOtherTo: otherNew,
        banner: `${GU} SWAP!`,
      };
    }
    case "grumpus_gift": {
      for (const p of match.players) {
        if (p.active && p.id !== playerId) addCoins(p.id, 5);
      }
      audio.sfx.play("grumpus.laugh");
      audio.sfx.play("crowd.ooh");
      emitHappening(playerId, eventId, "...why?");
      return {
        label: "...why?",
        message: `${G}... gives everyone else 5 coins? Why? WHY?`,
        coinsDelta: 0,
        banner: "...WHY?",
      };
    }
    default: {
      emitHappening(playerId, eventId, `${G} Grumbles!`);
      return {
        label: `${G} Grumbles!`,
        message: `${G} grumbles and rolls over. Nothing happens.`,
        coinsDelta: 0,
        banner: `${GU} GRUMBLES!`,
      };
    }
  }
}
