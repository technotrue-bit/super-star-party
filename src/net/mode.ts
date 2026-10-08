/**
 * Online-match flags. Solo leaves these off, so the roulette and the
 * turn loop keep the one-human path.
 *
 * CPU seats run the same local AI on every peer (same seed). Human
 * choices are relayed. Contact minigames are not dealt while online.
 */

let online = false;
let playout = false;
let assist = readAssistFlag();

function readAssistFlag(): boolean {
  try {
    if (typeof location === "undefined") return false;
    return new URLSearchParams(location.search).get("partyAssist") === "1";
  } catch {
    return false;
  }
}

export function onlineMatch(): boolean {
  return online;
}

export function setOnlineMatch(on: boolean): void {
  online = on;
  if (!on) playout = false;
}

/** Host minigame: every seat is CPU for this playout. Ranking is official. */
export function cpuPlayout(): boolean {
  return playout;
}

export function setCpuPlayout(on: boolean): void {
  playout = on;
}

/**
 * Playtest aid. Local human seats publish the CPU choice and every peer
 * applies that same choice. Solo ignores it.
 */
export function partyAssist(): boolean {
  return assist;
}

export function setPartyAssist(on: boolean): void {
  assist = on;
}
