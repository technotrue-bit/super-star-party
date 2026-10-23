/**
 * SUPER STAR PARTY — audio helpers for the UI kit.
 * Every call is wrapped in try/catch so the UI never breaks while the audio
 * engine is a stub or unavailable. Silence is the failure mode.
 */
import { audio } from "../audio/audioEngine";

/** Play a one-shot SFX by name; null/undefined = silent. Never throws. */
export function sfx(
  name: string | null | undefined,
  opts?: { volume?: number; pitch?: number; rate?: number }
): void {
  if (!name) return;
  try {
    audio.sfx.play(name, opts);
  } catch {
    /* audio stub/unavailable — UI must keep working silently */
  }
}

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

/** Music volume (the music bus, not master). */
export function getMusicGain(): number {
  try {
    return audio.music.volume;
  } catch {
    return 1;
  }
}

export function setMusicGain(v: number): void {
  try {
    audio.music.volume = v;
  } catch {
    /* stub */
  }
}

/** SFX volume (the sfx bus, not master). */
export function getSfxGain(): number {
  try {
    return audio.sfx.volume;
  } catch {
    return 1;
  }
}

export function setSfxGain(v: number): void {
  try {
    audio.sfx.volume = v;
  } catch {
    /* stub */
  }
}
