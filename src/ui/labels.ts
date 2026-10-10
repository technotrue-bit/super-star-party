/**
 * SUPER STAR PARTY — player labels (display only).
 * Derived from match.players seat controllers; nothing is stored, no rng.
 * 1 human -> "You" for the local seat, everyone else keeps the character name.
 * 2-4 humans (or any online match) -> "Player N" by seat index, same on every
 * peer; CPUs keep the character name. Never read ctx.players here: minigames
 * force those to "cpu" during playout.
 */
import { match } from "../core/game";
import { onlineMatch } from "../net/mode";

export interface SeatLabel {
  id: number;
  long: string;
  short: string;
  you: boolean;
  human: boolean;
}

interface SeatLike {
  id: number;
  name: string;
  controller?: string;
}

export function seatLabels(players: readonly SeatLike[], online = false): SeatLabel[] {
  const humans = players.filter((p) => p.controller !== "cpu").length;
  const numbered = humans >= 2 || online;
  return players.map((p) => {
    const human = p.controller !== "cpu";
    const you = p.controller === "local";
    if (numbered && human) {
      return { id: p.id, long: `Player ${p.id + 1}`, short: `P${p.id + 1}`, you, human };
    }
    if (!numbered && you) return { id: p.id, long: "You", short: "You", you, human };
    return { id: p.id, long: p.name, short: p.name, you, human };
  });
}

function labelFor(id: number): SeatLabel | undefined {
  return seatLabels(match.players, onlineMatch())[id];
}

export function playerLabel(id: number, form: "long" | "short" = "long"): string {
  const l = labelFor(id);
  return l ? l[form] : (match.players[id]?.name ?? "?");
}

export function isYou(id: number): boolean {
  return labelFor(id)?.you === true;
}

function isYouWord(id: number): boolean {
  return labelFor(id)?.long === "You";
}

/** YOUR / PLAYER 2'S / PIP'S (upper-case, for banners). */
export function labelPossessive(id: number): string {
  if (isYouWord(id)) return "YOUR";
  return `${playerLabel(id).toUpperCase()}'S`;
}

/** YOU WIN / PLAYER 2 WINS: `base` for "You", `third` for everyone else. */
export function labelDoes(id: number, base: string, third: string): string {
  return `${playerLabel(id).toUpperCase()} ${isYouWord(id) ? base : third}`;
}

const THIRD_VERB = /^([A-Z]+)S$/;
const KEEP_S = new Set(["PASS", "MISS", "BOSS", "LESS", "CROSS", "GLASS", "PRESS", "DRESS"]);

/**
 * Fix grammar of minigame announce text once the ctx name is "You":
 * "YOU WINS ..." -> "YOU WIN ...", "You's turn" -> "Your turn", "YOU IS" -> "YOU ARE".
 */
export function youGrammar(text: string): string {
  return text
    .replace(/\bYOU'S\b/g, "YOUR")
    .replace(/\bYou's\b/g, "Your")
    .replace(/\b(YOU) IS\b/g, "$1 ARE")
    .replace(/\b(You) is\b/g, "$1 are")
    .replace(/\b(YOU|You) ([A-Za-z]+)\b/g, (m, y: string, verb: string) => {
      const up = verb.toUpperCase();
      const base = THIRD_VERB.exec(up);
      if (!base || KEEP_S.has(up) || up.length < 4) return m;
      const stem = up.endsWith("ES") && /(SH|CH|SS|X|Z)ES$/.test(up) ? up.slice(0, -2) : base[1];
      return `${y} ${verb === up ? stem : stem.toLowerCase()}`;
    });
}
