import { describe, expect, it } from "vitest";
import { TRACKS, parseBar, parseSection, parseTrack, trackIds, trackSets } from "./tracks";
import type { TrackDef, VoiceDef } from "./tracks";

/** A 2-bar, 120 BPM track with one drums voice (plus any overrides). */
function def(over: Partial<TrackDef> & { liftVoice?: boolean } = {}): TrackDef {
  const { liftVoice, ...rest } = over;
  const voices: VoiceDef[] = [
    { style: "drums", pattern: ["K:4 S:4 K:4 S:4", "K:4 S:4 K:4 S:4"] },
  ];
  if (liftVoice) {
    voices.push({ style: "drums", layer: "lift", pattern: ["h:16", "h:16"] });
  }
  return { id: "t", bpm: 120, swing: 0.5, loop: true, voices, ...rest };
}

describe("tracks", () => {
  it("every registered track parses", () => {
    for (const id of trackIds()) expect(() => parseTrack(TRACKS[id])).not.toThrow();
  });

  it("rejects a bar that does not sum to 16 steps", () => {
    expect(() => parseBar("C4:4 D4:4", 0)).toThrow(/sums to 8/);
  });

  it("trackSets defaults to core", () => {
    expect(trackSets(def({}))).toEqual(["core"]);
    expect(trackSets(def({ sets: ["core", "cruise"] }))).toEqual(["core", "cruise"]);
  });

  it("fill and pickup parse as one-bar sections outside voices", () => {
    const d = def({ fill: [{ style: "drums", pattern: ["K:4 S:4 K:4 S:4"] }] }); // voices have 2 bars
    expect(parseSection(d, "fill")).toHaveLength(1);
    expect(parseSection(d, "fill")[0].barCount).toBe(1);
    expect(parseSection(d, "pickup")).toEqual([]);
    expect(() => parseTrack(d)).not.toThrow();
    expect(() => parseSection(def({ fill: [{ style: "drums", pattern: ["K:16", "K:16"] }] }), "fill")).toThrow(/one bar/);
  });

  it("lift is a valid layer", () => {
    expect(parseTrack(def({ liftVoice: true })).some((v) => v.layer === "lift")).toBe(true);
  });
});
