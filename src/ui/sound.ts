/**
 * SUPER STAR PARTY — audio helpers for the UI kit.
 * Every call is wrapped in try/catch so the UI never breaks while the audio
 * engine is a stub or unavailable. Silence is the failure mode.
 */
import { audio } from "../audio/audioEngine";

/** Play a one-shot SFX by name; null/undefined = silent. Never throws. */
export function sfx(
  name: string | null | undefined,
  opts?: { volume?: number; pitch?: number }
): void {
  if (!name) return;
  try {
    audio.sfx.play(name, opts);
  } catch {
    /* audio stub/unavailable — UI must keep working silently */
  }
}

type Gainish = { gain?: { value: number } };

export function getMasterGain(): number {
  try {
    return audio.master.gain;
  } catch {
    return 1;
  }
}

export function setMasterGain(v: number): void {
  try {
    audio.master.gain = v;
  } catch {
    /* stub */
  }
}

/**
 * Music volume. Prefers the music bus gain when the wave-1 engine exposes
 * one; otherwise falls back to the master gain.
 */
export function getMusicGain(): number {
  try {
    const m = audio.music as unknown as Gainish;
    if (typeof m?.gain?.value === "number") return m.gain.value;
    return audio.master.gain;
  } catch {
    return 1;
  }
}

export function setMusicGain(v: number): void {
  try {
    const m = audio.music as unknown as Gainish;
    if (m?.gain) m.gain.value = v;
    else audio.master.gain = v;
  } catch {
    /* stub */
  }
}

/** SFX volume — same pattern as music. */
export function getSfxGain(): number {
  try {
    const s = audio.sfx as unknown as Gainish;
    if (typeof s?.gain?.value === "number") return s.gain.value;
    return audio.master.gain;
  } catch {
    return 1;
  }
}

export function setSfxGain(v: number): void {
  try {
    const s = audio.sfx as unknown as Gainish;
    if (s?.gain) s.gain.value = v;
    else audio.master.gain = v;
  } catch {
    /* stub */
  }
}
