import { describe, expect, it } from "vitest";
import { SAMPLED } from "../samples/instruments.gen";
import { ZONES } from "../samples/zones.gen";
import { midiFromHz, pickKitZone, pickZone } from "../samples/sampler";
import { TRACKS, parseSection, parseTrack, trackIds, trackSets } from "./tracks";
import type { ParsedVoice } from "./tracks";

/* Every played note lands on a recording the sampler may bend to it. */

/** Tracks the game plays; happening, grumpus and minigame_intro are never played. */
const PLAYED = [
  "title", "shop", "results", "star_fanfare", "win", "lose", "drumroll", "drumroll_hit",
  "board.fairground", "mg.action", "mg.puzzle",
];

/** A track's voices, fill and pickup, each with a label for failure messages. */
function allVoices(id: string): Array<{ v: ParsedVoice; where: string }> {
  const def = TRACKS[id];
  const label = (part: string) => (v: ParsedVoice, i: number) => ({ v, where: `${id} ${part}[${i}] ${v.style}` });
  return [
    ...parseTrack(def).map(label("voices")),
    ...parseSection(def, "fill").map(label("fill")),
    ...parseSection(def, "pickup").map(label("pickup")),
  ];
}

/** Every voice on a sampled style, across every track. */
function sampledVoices(): Array<{ id: string; name: string; v: ParsedVoice; where: string }> {
  const out = [];
  for (const id of trackIds()) {
    for (const { v, where } of allVoices(id)) {
      if (v.style.startsWith("s:")) out.push({ id, name: v.style.slice(2), v, where });
    }
  }
  return out;
}

describe("sample coverage", () => {
  it("every sampled style names an instrument in the track's sets", () => {
    for (const { id, name, where } of sampledVoices()) {
      expect(SAMPLED[name], where).toBeDefined();
      expect(trackSets(TRACKS[id]), where).toContain(SAMPLED[name].set);
    }
  });

  it("every note is within maxShift of a zone", () => {
    for (const { id, name, v, where } of sampledVoices()) {
      const inst = SAMPLED[name];
      if (inst.kind !== "melodic") continue;
      const lifts = id.startsWith("board.") ? [0, 1] : [0]; // a lifted board plays a semitone up
      for (const [b, bar] of v.bars.entries()) {
        for (const ev of bar) {
          if (ev.kind !== "note" || ev.slide) continue;
          for (const f of ev.freqs) {
            for (const lift of lifts) {
              const midi = midiFromHz(f) + v.transpose + lift;
              for (const layer of inst.velUpper.keys()) {
                const zone = pickZone(ZONES[name].zones, midi, layer, 0);
                const at = `${where} bar ${b} ${ev.token} midi ${midi} layer ${layer}`;
                expect(zone, at).not.toBeNull();
                expect(Math.abs(zone!.root! - midi), at).toBeLessThanOrEqual(inst.maxShift);
              }
            }
          }
        }
      }
    }
  });

  it("every drum token used has a kit zone", () => {
    for (const { name, v, where } of sampledVoices()) {
      const inst = SAMPLED[name];
      if (inst.kind !== "kit") continue;
      for (const bar of v.bars) {
        for (const ev of bar) {
          if (ev.kind !== "drum") continue;
          for (const layer of inst.velUpper.keys()) {
            expect(pickKitZone(ZONES[name].zones, ev.token, layer, 0), `${where} ${ev.token} layer ${layer}`).not.toBeNull();
          }
        }
      }
    }
  });

  it("played tracks use no synth styles", () => {
    for (const id of PLAYED) {
      expect(TRACKS[id], id).toBeDefined();
      for (const { v, where } of allVoices(id)) expect(v.style, where).toMatch(/^s:/);
    }
  });
});
