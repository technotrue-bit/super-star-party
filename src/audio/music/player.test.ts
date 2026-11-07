import { afterEach, describe, expect, it, vi } from "vitest";
import * as instruments from "./instruments";
import { synthPlayer, voiceRoute } from "./player";

const ctx = {} as BaseAudioContext;
const out = {} as AudioNode;

describe("voiceRoute", () => {
  it("routes styles", () => {
    expect(voiceRoute("s:marimba")).toBe("sampled");
    expect(voiceRoute("s:kit.core")).toBe("kit");
    expect(voiceRoute("pad")).toBe("synth");
    expect(voiceRoute("drums")).toBe("synth");
  });
});

describe("synthPlayer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("plays a note through the oscillator voice for its style", () => {
    const voice = vi.spyOn(instruments.VOICES, "pad").mockImplementation(() => {});
    synthPlayer.note(ctx, out, 1.5, "pad", [220, 330], 0.5, 0.7, { step: 0.125, slide: 0 });
    expect(voice).toHaveBeenCalledExactlyOnceWith(ctx, out, 1.5, [220, 330], 0.5, 0.7, { step: 0.125, slide: 0 });
  });

  it("stays silent for a style with no oscillator voice", () => {
    expect(() => synthPlayer.note(ctx, out, 0, "s:marimba", [440], 1, 1, { step: 0.125 })).not.toThrow();
  });

  it("plays a drum token through the synth drum kit, whatever the style", () => {
    const hit = vi.spyOn(instruments, "drumHit").mockImplementation(() => {});
    synthPlayer.drum(ctx, out, 2, "drums", "K", 0.6);
    synthPlayer.drum(ctx, out, 3, "s:kit.core", "S", 0.4);
    expect(hit.mock.calls).toEqual([
      [ctx, out, 2, "K", 0.6],
      [ctx, out, 3, "S", 0.4],
    ]);
  });
});
