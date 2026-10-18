/**
 * SUPER STAR PARTY — sampler.
 *
 * Pure zone maths (which recording answers a note, and how far to bend it)
 * plus a NotePlayer that plays decoded buffers. A note whose buffer is not
 * loaded falls back, note by note, to the oscillator voice it replaces, so
 * a track never goes quiet while samples stream in.
 *
 * Import-safe in node: nothing touches Web Audio until a note is played.
 */

import { VOICES, drumHit } from "../music/instruments";
import { synthPlayer, voiceRoute } from "../music/player";
import type { NotePlayer } from "../music/player";
import type { InstrumentZones, LoadedBuffer, SampledInstrument, Zone } from "./types";

/** Nearest MIDI note to a frequency (A4 = 440 Hz = 69). */
export function midiFromHz(hz: number): number {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

/** The velocity layer for `vel`: the first whose upper bound covers it, the last when it is above all. */
export function layerFor(velUpper: number[], vel: number): number {
  for (let i = 0; i < velUpper.length; i++) if (vel <= velUpper[i]) return i;
  return velUpper.length - 1;
}

/** One of `candidates` by round-robin slot, cycling with `counter`. */
function cycle(candidates: Zone[], counter: number): Zone | null {
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.rr - b.rr);
  return candidates[counter % candidates.length];
}

/** The zone for a pitched note: nearest root on the layer (the higher root on a tie), then the round robin for `rrCounter`. */
export function pickZone(zones: Zone[], midi: number, layer: number, rrCounter: number): Zone | null {
  let best: number | undefined;
  for (const z of zones) {
    if (z.layer !== layer || z.root === undefined) continue;
    if (best === undefined) {
      best = z.root;
      continue;
    }
    const d = Math.abs(z.root - midi);
    const bestD = Math.abs(best - midi);
    if (d < bestD || (d === bestD && z.root > best)) best = z.root;
  }
  if (best === undefined) return null;
  return cycle(
    zones.filter((z) => z.layer === layer && z.root === best),
    rrCounter,
  );
}

/** The zone for a drum token on the layer, then the round robin for `rrCounter`. */
export function pickKitZone(zones: Zone[], token: string, layer: number, rrCounter: number): Zone | null {
  return cycle(
    zones.filter((z) => z.layer === layer && z.token === token),
    rrCounter,
  );
}

/** Playback rate that moves a zone's recording to `midi`. */
export function rateFor(midi: number, zone: Zone): number {
  return 2 ** ((midi - (zone.root ?? midi) + zone.tune / 100) / 12);
}

export type Resolved =
  | { kind: "sample"; instrument: string; zone: Zone; buf: LoadedBuffer }
  | { kind: "standIn"; standIn: string };

/** The instrument a voice style names: `s:kit.core` names `kit.core`. */
function instrumentName(style: string): string {
  return style.startsWith("s:") ? style.slice(2) : style;
}

/**
 * What plays a pitched note on a sampled style: the loaded sample, or the
 * synth voice that stands in for it. An unknown instrument has no stand-in
 * (`standIn: ""`) and stays silent.
 */
export function resolveNote(
  table: Record<string, SampledInstrument>,
  zones: Record<string, InstrumentZones>,
  style: string,
  midi: number,
  vel: number,
  rr: number,
  buffer: (inst: string, z: Zone) => LoadedBuffer | null,
): Resolved {
  const name = instrumentName(style);
  const inst = table[name];
  if (!inst) return { kind: "standIn", standIn: "" };
  const zone = pickZone(zones[name]?.zones ?? [], midi, layerFor(inst.velUpper, vel), rr);
  const buf = zone && buffer(name, zone);
  if (!zone || !buf) return { kind: "standIn", standIn: inst.standIn };
  return { kind: "sample", instrument: name, zone, buf };
}

/** Schedule one decoded sample: start at `t` from `buf.start`, bent by `rate`, shaped by the instrument's envelope. */
function playSample(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  inst: SampledInstrument,
  buf: LoadedBuffer,
  rate: number,
  lenSec: number,
  vel: number,
  slide: number | undefined,
): void {
  const src = ctx.createBufferSource();
  src.buffer = buf.buffer;
  src.playbackRate.setValueAtTime(rate, t);
  if (slide) src.playbackRate.exponentialRampToValueAtTime(rate * 2 ** (slide / 12), t + lenSec);

  // Gain holds at its peak until `holdEnd`, then ramps to silence by `end`.
  let holdEnd: number;
  let end: number;
  if (inst.oneShot) {
    const natural = (buf.buffer.duration - buf.start) / rate;
    end = t + (inst.maxLen > 0 ? Math.min(natural, inst.maxLen) : natural);
    holdEnd = end - Math.min(inst.release, end - t);
  } else {
    holdEnd = t + lenSec;
    end = holdEnd + inst.release;
  }
  const peak = inst.gain * vel;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.setValueAtTime(peak, holdEnd);
  g.gain.linearRampToValueAtTime(0, end);

  src.connect(g);
  g.connect(out);
  src.start(t, buf.start);
  src.stop(end + 0.02);
}

/**
 * The sampler: `s:<name>` styles play recorded samples, everything else goes
 * to the oscillator engine. `zones` is read per event so tables can load
 * after the player is made; `buffer` returns a decoded buffer or null while
 * it is still loading. Round-robin counters live in the player, one per
 * instrument. `onStandIn` fires each time a synth voice or drum covers for a
 * sample that is not there.
 */
export function createSamplerPlayer(deps: {
  table: Record<string, SampledInstrument>;
  zones: () => Record<string, InstrumentZones>;
  buffer: (inst: string, z: Zone) => LoadedBuffer | null;
  onStandIn: () => void;
}): NotePlayer {
  const { table, buffer, onStandIn } = deps;
  const counters = new Map<string, number>();
  const warned = new Set<string>();

  /** Round-robin position of an instrument's next sample. */
  const rrOf = (name: string): number => counters.get(name) ?? 0;
  /** Advance an instrument past a sample that played; stand-ins do not count. */
  const played = (name: string): void => void counters.set(name, rrOf(name) + 1);

  function warnUnknown(name: string): void {
    if (warned.has(name)) return;
    warned.add(name);
    console.warn(`sampler: no instrument "${name}" in the sample table`);
  }

  return {
    note(ctx, out, t, style, freqs, lenSec, vel, opts) {
      const route = voiceRoute(style);
      if (route === "synth") return synthPlayer.note(ctx, out, t, style, freqs, lenSec, vel, opts);
      if (route === "kit") return; // kits answer drum tokens, not pitches

      const name = instrumentName(style);
      const zones = deps.zones();
      for (const freq of freqs) {
        const midi = midiFromHz(freq);
        const r = resolveNote(table, zones, style, midi, vel, rrOf(name), buffer);
        if (r.kind === "sample") {
          played(name);
          playSample(ctx, out, t, table[name], r.buf, rateFor(midi, r.zone), lenSec, vel, opts.slide);
        } else if (r.standIn) {
          VOICES[r.standIn]?.(ctx, out, t, [freq], lenSec, vel, opts);
          onStandIn();
        } else {
          warnUnknown(name);
        }
      }
    },

    drum(ctx, out, t, style, token, vel) {
      if (voiceRoute(style) !== "kit") return synthPlayer.drum(ctx, out, t, style, token, vel);

      const name = instrumentName(style);
      const inst = table[name];
      if (!inst) warnUnknown(name);
      const zone = inst ? pickKitZone(deps.zones()[name]?.zones ?? [], token, layerFor(inst.velUpper, vel), rrOf(name)) : null;
      const buf = zone ? buffer(name, zone) : null;
      if (!inst || !buf) {
        drumHit(ctx, out, t, token, vel);
        onStandIn();
        return;
      }
      played(name);
      playSample(ctx, out, t, inst, buf, 1, 0, vel, undefined);
    },
  };
}
