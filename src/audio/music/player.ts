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
}

/** Oscillator voices and synthesized drums: the sound every track had before samples. */
export const synthPlayer: NotePlayer = {
  note(ctx, out, t, style, freqs, lenSec, vel, opts) {
    VOICES[style]?.(ctx, out, t, freqs, lenSec, vel, opts);
  },
  drum(ctx, out, t, _style, token, vel) {
    drumHit(ctx, out, t, token, vel);
  },
};

/** Which engine a voice style belongs to: "s:kit.*" is a sample kit, other "s:*" a sampled instrument, the rest synth. */
export function voiceRoute(style: string): "sampled" | "kit" | "synth" {
  if (style.startsWith("s:kit.")) return "kit";
  if (style.startsWith("s:")) return "sampled";
  return "synth";
}
