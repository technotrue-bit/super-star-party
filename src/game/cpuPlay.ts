/**
 * SUPER STAR PARTY — how the computer players play the board.
 *
 * Board CPUs always make the sensible choice. The CPU level changes two
 * things here: how often a Relaxed rival slips (its chance to slip is
 * 1 - skill, so Relaxed slips about 3 times in 10 decisions, and Normal and
 * Challenge never do), and how long it takes its turn (its roll delay is
 * divided by the skill). A slip is always a plausible mistake and draws no
 * extra rng on Normal or Challenge, so their games replay exactly.
 */
import { match } from "../core/game";
import { cpuSkillOf } from "../config/cpuLevel";
import { rng } from "../core/rng";

/** The current match's CPU speed/accuracy multiplier (1 = Normal). */
export function boardCpuSkill(): number {
  return cpuSkillOf(match.cpuLevel ?? "normal");
}

/**
 * True when a computer player slips on this decision. Only a level below
 * Normal draws from rng; Normal and Challenge return false without a draw.
 */
export function cpuSlips(): boolean {
  const skill = boardCpuSkill();
  if (skill >= 1) return false;
  return rng.next() < 1 - skill;
}
