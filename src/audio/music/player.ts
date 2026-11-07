/**
 * SUPER STAR PARTY — note players.
 *
 * The sequencer decides what sounds and when; a NotePlayer decides how it
 * sounds. synthPlayer is the original oscillator engine; a sampler player
 * plugs in through the same two methods.
 */

import { VOICES, drumHit } from "./instruments";
import type { VoiceOpts } from "./instruments";

export interface NotePlayer {
  note(
    ctx: BaseAudioContext,
    out: AudioNode,
    t: number,
    style: string,
    freqs: number[],
    lenSec: number,
    vel: number,
    opts: VoiceOpts,
  ): void;
  drum(
    ctx: BaseAudioContext,
    out: AudioNode,
    t: number,
    style: string,
    token: string,
    vel: number,
  ): void;
  /**
   * Longest a note on `style` may sound past its written end, in seconds: a release, or the ring
   * of a one-shot (a drum's end is its start). A one-shot track ends once its notes have rung
   * out; without this method it ends with its last step.
   */
  tail?(style: string): number;
}

/** Longest any synth voice sounds past its written end: a 0.35 s release, a 0.55 s crash. */
export const SYNTH_TAIL = 0.6;

/** Oscillator voices and synthesized drums: the sound every track had before samples. */
export const synthPlayer: NotePlayer & { tail(style: string): number } = {
  note(ctx, out, t, style, freqs, lenSec, vel, opts) {
    VOICES[style]?.(ctx, out, t, freqs, lenSec, vel, opts);
  },
  drum(ctx, out, t, _style, token, vel) {
    drumHit(ctx, out, t, token, vel);
  },
  tail: () => SYNTH_TAIL,
};

/** Which engine a voice style belongs to: "s:kit.*" is a sample kit, other "s:*" a sampled instrument, the rest synth. */
export function voiceRoute(style: string): "sampled" | "kit" | "synth" {
  if (style.startsWith("s:kit.")) return "kit";
  if (style.startsWith("s:")) return "sampled";
  return "synth";
}
