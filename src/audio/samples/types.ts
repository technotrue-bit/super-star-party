/**
 * SUPER STAR PARTY — sampled instruments: the shapes shared by the sample
 * build (which writes the tables) and the sampler (which reads them).
 * Types only: safe to import anywhere.
 */

/** A downloadable bundle of sample files. "core" is always fetched; the rest load per track or minigame. */
export type SetId = "core" | "fairground" | "cruise" | "downtown" | "mg-action" | "mg-puzzle" | "mg-rhythm";

/** One instrument as the player sees it. A voice style `s:<name>` names the instrument `<name>`. */
export interface SampledInstrument {
  set: SetId;
  /** "melodic" picks a zone by pitch; "kit" picks one by drum token. */
  kind: "melodic" | "kit";
  /** Name of the synth voice (a key of VOICES) that plays a note whose buffer is not loaded. */
  standIn: string;
  /** True: the sample plays to its end whatever the note length. False: it is held for the note, then released. */
  oneShot: boolean;
  /** Fade-out in seconds after a held note ends, or at the tail of a one-shot. */
  release: number;
  /** Instrument loudness, multiplied by note velocity. */
  gain: number;
  /** Upper velocity bound of each layer, ascending. A velocity above every bound uses the last layer. */
  velUpper: number[];
  /** Farthest the sampler may pitch a zone, in semitones. Set by the sample build; the player only picks the nearest zone. */
  maxShift: number;
  /** Longest a one-shot plays, in seconds; 0 for no cap. */
  maxLen: number;
}

/** One recorded sample of an instrument. */
export interface Zone {
  /** MIDI note the sample was recorded at (melodic instruments). */
  root?: number;
  /** Drum token the sample answers to (kits). */
  token?: string;
  /** Velocity layer, an index into `velUpper`. */
  layer: number;
  /** Round-robin slot among samples with the same root (or token) and layer. */
  rr: number;
  /** Pitch correction in cents added on playback (positive plays higher), for a recording that is off its root. */
  tune: number;
  frames: number;
  file: string;
}

export interface InstrumentZones {
  source: string;
  zones: Zone[];
}

/** A decoded sample ready to play. */
export interface LoadedBuffer {
  buffer: AudioBuffer;
  /** Seconds into the buffer where playback begins. */
  start: number;
}
