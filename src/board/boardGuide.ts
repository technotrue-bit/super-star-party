/**
 * SUPER STAR PARTY — "How does this board work?" Before the turn-order roll
 * the game offers a guided tour of the board, Mario Party style: the camera
 * visits each feature and a host card explains it. The stops are built from
 * the board itself (which space types it has, its skin names, its hill and
 * gate) plus a few lines a board can add of its own, so every board gets a
 * tour that matches what is actually on it.
 *
 * Text only. Never touches match state or the rng.
 */
import type { BoardDef } from "./boardData";
import type { SpaceType, StampKind } from "../core/game";
import { STAMP_LABEL } from "../core/game";
import { settings } from "../config/settings";

/** Where the camera looks for a stop. */
export type GuideFocus =
  | { kind: "overview" }
  | { kind: "space"; index: number }
  | { kind: "prize" } // the Grand Prize Balloon, wherever it is right now
  | { kind: "point"; x: number; z: number };

export interface GuideStop {
  title: string;
  body: string;
  focus: GuideFocus;
}

/** Board-specific welcome lines, keyed by board id. */
const WELCOME: Record<string, string> = {
  "fizzy-fairground":
    "Welcome to Fizzy Fairground, a carnival on its own little island! Whoever holds the most Stars after the last turn wins. Coins buy Stars, so grab every coin you can.",
  downtown:
    "Welcome to Downtown! Race around the Ring Road, cut through the side streets, and collect the most Stars by the final turn. Coins buy Stars.",
};

function firstOf(def: BoardDef, type: SpaceType): number | undefined {
  // Prefer a space on the main loop, near the start.
  const main = def.loops[0] ?? [];
  const onMain = main.find((i) => def.spaces[i]?.type === type);
  if (onMain !== undefined) return onMain;
  return def.spaces.find((s) => s.type === type)?.index;
}

/** The tour for `def`, in the order the camera visits it. */
export function boardGuide(def: BoardDef, totalTurns: number = settings.totalTurns): GuideStop[] {
  const stops: GuideStop[] = [];
  const npc = def.skin?.npc.name ?? "Grumpus";
  const stampName = (k: StampKind): string => def.skin?.stamps[k] ?? STAMP_LABEL[k];
  const has = (t: SpaceType): boolean => def.spaces.some((s) => s.type === t);

  stops.push({
    title: def.name,
    body: WELCOME[def.id] ?? `Welcome to ${def.name}! Collect the most Stars by the last turn to win. Coins buy Stars.`,
    focus: { kind: "overview" },
  });

  stops.push({
    title: "The Grand Prize Balloon",
    body: `This balloon carries the Stars. Pass it or land on it and you can buy a Star for ${settings.starCost} coins, up to ${settings.starBundleMax} at once if you can afford them. Once someone buys, it floats off to a new space.`,
    focus: { kind: "prize" },
  });

  const blue = firstOf(def, "blue");
  if (blue !== undefined) {
    stops.push({
      title: "Blue and Red Spaces",
      body: `Land on a blue space to win ${settings.blueCoin} coins. Land on a red space and you lose ${settings.redCoin}. Simple as that!`,
      focus: { kind: "space", index: blue },
    });
  }

  const green = firstOf(def, "green");
  if (green !== undefined) {
    stops.push({
      title: "Happening Spaces",
      body: "Green ? spaces set off a happening: a coin shower, a wind ride, a swap with a rival, or the balloon blowing away. Anything can happen!",
      focus: { kind: "space", index: green },
    });
  }

  const balloon = firstOf(def, "minigame_balloon");
  if (balloon !== undefined) {
    stops.push({
      title: "Minigame Balloons",
      body: "Run past a Minigame Balloon to pop it (it costs 5 or 10 coins). If anyone popped one this round, everybody plays a minigame once all four have moved. The winner takes the coins!",
      focus: { kind: "space", index: balloon },
    });
  }

  const hill = def.terrain?.hills[0];
  if (hill && def.junctions?.length) {
    const up = def.junctions[0];
    stops.push({
      title: def.id === "fizzy-fairground" ? "Starlight Rise" : "The Hill",
      body: `The inner lane runs around the top of the hill. At the ${up.label} fork you can climb the ramp, loop the hilltop, and come back down at the ${def.junctions[1]?.label ?? "rejoin"} ramp. Pick the way that gets you to the balloon first!`,
      focus: { kind: "point", x: hill.x, z: hill.z },
    });
  } else if (def.branches?.length || def.junctions?.length) {
    const fork = def.branches?.[0] ?? def.junctions?.[0];
    if (fork) {
      stops.push({
        title: "Forks in the Road",
        body: `At a fork you choose your lane. The ${fork.label} can be a shortcut to the balloon, or the long way round. Watch where the Stars are!`,
        focus: { kind: "space", index: fork.from },
      });
    }
  }

  if (def.gate) {
    const g = def.gate;
    const row = def.spaces[g.closed]?.name ?? "the detour";
    stops.push({
      title: `The ${g.label}`,
      body: `This board's big trick! The ${g.label} flips at the end of every round. Open, the Funhouse Cut skips the detour. Shut, everyone has to walk Funhouse Row, starting at ${row}, past its shop and a ${npc} space. It starts the game open.`,
      focus: { kind: "space", index: g.from },
    });
  }

  const shop = firstOf(def, "shop");
  if (shop !== undefined) {
    stops.push({
      title: "Item Shops",
      body: "Walk past a shop and you can stop to buy items: mushrooms for extra steps, double dice, warps, even items that steal Stars. Each shop's stock changes every round.",
      focus: { kind: "space", index: shop },
    });
  }

  const stamp = firstOf(def, "stamp");
  if (stamp !== undefined) {
    stops.push({
      title: "Stamp Stands",
      body: `Pass the ${stampName("shy")}, ${stampName("goomba")} and ${stampName("koopa")} stamp stands to collect their stamps. Hold all three and you win a ${settings.stampJackpot}-coin jackpot on the spot!`,
      focus: { kind: "space", index: stamp },
    });
  }

  if (has("grumpus")) {
    const g = firstOf(def, "grumpus");
    if (g !== undefined) {
      stops.push({
        title: `${npc} Spaces`,
        body: `Uh oh. Land here and ${npc} shows up to steal from the leader, shove you around, or make you spin his wheel. Every so often he's in a giving mood...`,
        focus: { kind: "space", index: g },
      });
    }
  }

  stops.push({
    title: "Ready?",
    body: `The game lasts ${totalTurns} turns. At the end, Bonus Stars go to the minigame champ and the richest player, so every coin counts. Now hit your dice block to see who goes first!`,
    focus: { kind: "overview" },
  });
  return stops;
}
