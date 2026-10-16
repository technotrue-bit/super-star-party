/**
 * SUPER STAR PARTY — how good the computer players are.
 *
 * One setting for the whole table: Relaxed, Normal or Challenge. It lives on
 * the match (like the board and the coin bonus), so an online room runs the
 * same CPU on every phone: the host's choice travels in the match setup.
 *
 * `skill` scales the CPU's speed and accuracy in minigames: 1 is the tuned
 * Normal game (the Monte-Carlo balance is unchanged), above 1 is sharper and
 * faster, below 1 slower and sloppier. Games only ever divide or multiply a
 * tuning constant by it, and keep the same number of random draws, so the
 * seeded replay of a match is still the same match at a given level.
 */

export const CPU_LEVELS = ["relaxed", "normal", "challenge"] as const;
export type CpuLevel = (typeof CPU_LEVELS)[number];

export const CPU_LEVEL_DEFS: Record<CpuLevel, { name: string; skill: number; blurb: string }> = {
  relaxed: { name: "Relaxed", skill: 0.7, blurb: "Rivals are slower and miss more. Great for learning." },
  normal: { name: "Normal", skill: 1, blurb: "The balanced game." },
  challenge: { name: "Challenge", skill: 1.3, blurb: "Rivals are quick and sharp. Bring your A-game." },
};

const LS_CPU = "ssp.cpuLevel";

export function isCpuLevel(v: unknown): v is CpuLevel {
  return typeof v === "string" && (CPU_LEVELS as readonly string[]).includes(v);
}

/** The level saved on this device (Normal when none, or when storage is blocked). */
export function storedCpuLevel(): CpuLevel {
  try {
    const v = localStorage.getItem(LS_CPU);
    return isCpuLevel(v) ? v : "normal";
  } catch {
    return "normal";
  }
}

export function setStoredCpuLevel(level: CpuLevel): void {
  try {
    localStorage.setItem(LS_CPU, level);
  } catch {
    /* storage blocked: the choice lasts this page only */
  }
}

/** Speed/accuracy multiplier for a level. */
export function cpuSkillOf(level: CpuLevel): number {
  return CPU_LEVEL_DEFS[level].skill;
}
