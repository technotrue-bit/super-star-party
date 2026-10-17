import { describe, expect, it } from "vitest";
import { audio } from "./audioEngine";
import { SFX, resolvePitch } from "./sfx/sounds";

describe("audio volumes", () => {
  it("keeps music and sfx volume separate from master", () => {
    const master = audio.master.gain;
    audio.music.volume = 0.2;
    audio.sfx.volume = 0.7;
    expect(audio.music.volume).toBe(0.2);
    expect(audio.sfx.volume).toBe(0.7);
    expect(audio.master.gain).toBe(master);
  });

  it("clamps volumes to 0..1 and ignores NaN", () => {
    audio.music.volume = 1.8;
    expect(audio.music.volume).toBe(1);
    audio.sfx.volume = -0.5;
    expect(audio.sfx.volume).toBe(0);
    audio.sfx.volume = 0.4;
    audio.sfx.volume = Number.NaN;
    expect(audio.sfx.volume).toBe(0.4);
  });
});

describe("sfx pitch", () => {
  it("reads pitch as semitones", () => {
    expect(resolvePitch({ pitch: 7 })).toBe(7);
    expect(resolvePitch(undefined)).toBe(0);
  });

  it("reads rate as a frequency multiplier", () => {
    expect(resolvePitch({ rate: 2 })).toBeCloseTo(12);
    expect(resolvePitch({ rate: 0.5 })).toBeCloseTo(-12);
    expect(resolvePitch({ rate: 1 })).toBe(0);
  });

  it("adds rate and pitch together", () => {
    expect(resolvePitch({ rate: 2, pitch: -5 })).toBeCloseTo(7);
  });

  it("ignores a rate that is not positive", () => {
    expect(resolvePitch({ rate: 0, pitch: 3 })).toBe(3);
    expect(resolvePitch({ rate: -1 })).toBe(0);
  });
});

/* Source guards: the two mistakes that silently broke sounds before. */

const sources = import.meta.glob<string>(["../**/*.ts", "!../**/*.test.ts", "!../**/*.d.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const files = Object.entries(sources).map(([path, text]) => ({ rel: path.slice(3), text }));

describe("sfx call sites", () => {
  it("only name registered sounds", () => {
    expect(files.some((f) => f.rel === "game/turnLoop.ts")).toBe(true);
    const call = /(?:\bsfx|sfx\.play|playSfx|\bsound:|tapSfx:)\s*\(?\s*"([a-zA-Z0-9_.]+)"/g;
    const unknown: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(call)) {
        if (!SFX[m[1]]) unknown.push(`${f.rel}: "${m[1]}"`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("never pass a multiplier as pitch (use rate)", () => {
    // pitch is semitones, so 0.5..1.9 is almost always a multiplier written
    // in the wrong field: it plays a fraction of a semitone sharp.
    const fractional = /\bpitch:\s*(?:0?\.\d+|1\.\d+)\b/g;
    const hits: string[] = [];
    for (const f of files) {
      if (f.rel.startsWith("audio")) continue;
      for (const m of f.text.matchAll(fractional)) hits.push(`${f.rel}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
});
