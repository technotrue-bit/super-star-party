/**
 * SUPER STAR PARTY — day -> golden dusk -> night across the match (lively board, slice 3).
 *
 * A pure function of (turn, totalTurns): no clock, no randomness, no state.
 * The board eases toward the result (lively/night.ts); the target itself only
 * moves when match.turn does. Colours are 0xRRGGBB in sRGB, blended between
 * palette keyframes. The day keyframe is the boot rig in main.ts exactly, so
 * turn 1 looks like a plain board.
 */
import { palette, hex } from "../../config/palette";

export type TimePhase = "day" | "dusk" | "night";

export interface TimeOfDay {
  /** 0 at turn 1, 1 at the last turn. */
  progress: number;
  phase: TimePhase;
  /** Inside the last five turns (the same rule as the last5 camera shot). */
  last5: boolean;
  sky: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  /** Lamp and string-light glow, 0 by day. */
  lampGlow: number;
}

/** Fog far beyond this (the camera's far plane) means no fog. */
export const FOG_OFF_FAR = 400;

interface Key {
  at: number;
  sky: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  lampGlow: number;
}

const DAY = {
  sky: hex(palette.ink),
  hemiSky: hex(palette.white),
  hemiGround: hex(palette.ink),
  hemiIntensity: 1.1,
  keyColor: hex(palette.white),
  keyIntensity: 1.6,
  fogColor: hex(palette.duskSky),
  fogNear: 600,
  fogFar: 1200,
  lampGlow: 0,
};
const DUSK = {
  sky: hex(palette.duskSky),
  hemiSky: hex(palette.duskHemi),
  hemiGround: hex(palette.duskGround),
  hemiIntensity: 0.78,
  keyColor: hex(palette.duskKey),
  keyIntensity: 0.95,
  fogColor: hex(palette.duskSky),
  fogNear: 34,
  fogFar: 110,
  lampGlow: 0.6,
};
// The follow camera sits ~21 units from the active space and looks steeply
// down, so the sky barely shows: night has to live in the light on the grass.
// Fog starts past the active area and tints the top of the frame.
const NIGHT = {
  sky: hex(palette.nightSky),
  hemiSky: hex(palette.nightHemi),
  hemiGround: hex(palette.nightGround),
  hemiIntensity: 0.62,
  keyColor: hex(palette.nightKey),
  keyIntensity: 0.32,
  fogColor: hex(palette.nightSky),
  fogNear: 24,
  fogFar: 78,
  lampGlow: 1,
};

const KEYS: readonly Key[] = [
  { at: 0, ...DAY },
  { at: 0.3, ...DAY },
  { at: 0.55, ...DUSK },
  { at: 0.8, ...NIGHT },
  { at: 1, ...NIGHT },
];

/** Match progress for a turn: 0 on turn 1, 1 on the last turn (clamped). */
export function progressOf(turn: number, totalTurns: number): number {
  if (!(totalTurns > 1)) return 0;
  const p = (turn - 1) / (totalTurns - 1);
  return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

export function phaseOf(progress: number): TimePhase {
  return progress < 0.35 ? "day" : progress < 0.7 ? "dusk" : "night";
}

export function isLast5(turn: number, totalTurns: number): boolean {
  return totalTurns > 0 && turn >= totalTurns - 4;
}

function lerpHex(a: number, b: number, u: number): number {
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * u);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * u);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * u);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Fill `out` with the look at `progress` (0..1). Allocation-free, so the
 * board can sample an eased progress every frame. `phase` and `last5` are
 * left alone: they belong to the turn, not the blend.
 */
export function sampleTimeOfDay(progress: number, out: TimeOfDay): TimeOfDay {
  const p = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
  let k = 0;
  while (k < KEYS.length - 2 && p > KEYS[k + 1].at) k++;
  const a = KEYS[k];
  const b = KEYS[k + 1];
  const x = b.at > a.at ? (p - a.at) / (b.at - a.at) : 0;
  const u = x * x * (3 - 2 * x);
  out.progress = p;
  out.sky = lerpHex(a.sky, b.sky, u);
  out.hemiSky = lerpHex(a.hemiSky, b.hemiSky, u);
  out.hemiGround = lerpHex(a.hemiGround, b.hemiGround, u);
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * u;
  out.keyColor = lerpHex(a.keyColor, b.keyColor, u);
  out.keyIntensity = a.keyIntensity + (b.keyIntensity - a.keyIntensity) * u;
  out.fogColor = lerpHex(a.fogColor, b.fogColor, u);
  out.fogNear = a.fogNear + (b.fogNear - a.fogNear) * u;
  out.fogFar = a.fogFar + (b.fogFar - a.fogFar) * u;
  out.lampGlow = a.lampGlow + (b.lampGlow - a.lampGlow) * u;
  return out;
}

/** An empty record to sample into. */
export function blankTimeOfDay(): TimeOfDay {
  return {
    progress: 0,
    phase: "day",
    last5: false,
    sky: 0,
    hemiSky: 0,
    hemiGround: 0,
    hemiIntensity: 0,
    keyColor: 0,
    keyIntensity: 0,
    fogColor: 0,
    fogNear: 0,
    fogFar: 0,
    lampGlow: 0,
  };
}

/** The target look for a turn of the match. */
export function timeOfDay(turn: number, totalTurns: number): TimeOfDay {
  const progress = progressOf(turn, totalTurns);
  const out = sampleTimeOfDay(progress, blankTimeOfDay());
  out.phase = phaseOf(progress);
  out.last5 = isLast5(turn, totalTurns);
  return out;
}
