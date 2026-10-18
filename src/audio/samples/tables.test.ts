import { describe, expect, it } from "vitest";
import { VOICES } from "../music/instruments";
import { SAMPLED } from "./instruments.gen";
import { ZONES } from "./zones.gen";
import type { SetId } from "./types";

/* The generated tables against the files and sources the sample build committed. */

const files = import.meta.glob("/public/music/**/*.{webm,m4a}", { query: "?url", import: "default", eager: true });
const sources = JSON.parse(
  Object.values(import.meta.glob("/tools/samples/sources.json", { query: "?raw", import: "default", eager: true }))[0] as string,
) as Array<{ id: string; url: string; license: string; title: string; author: string; creditLine: string }>;
const credits = Object.values(import.meta.glob("/public/music/CREDITS.txt", { query: "?raw", import: "default", eager: true }))[0] as string;

const ALLOWED_LICENSES = ["CC0-1.0", "Unlicense", "CC-BY-3.0"];
const MB = 2 ** 20;
const BOARD_SETS: SetId[] = ["fairground", "cruise", "downtown"];
const MINIGAME_SETS: SetId[] = ["mg-action", "mg-puzzle", "mg-rhythm"];

/** Decoded bytes of a set: every zone's frames as 32-bit floats. A set with no instruments counts 0. */
function decodedBytes(set: SetId): number {
  let frames = 0;
  for (const [name, inst] of Object.entries(SAMPLED)) {
    if (inst.set !== set) continue;
    for (const z of ZONES[name]?.zones ?? []) frames += z.frames;
  }
  return frames * 4;
}

describe("generated sample tables", () => {
  it("SAMPLED and ZONES list the same instruments", () => {
    expect(Object.keys(ZONES).sort()).toEqual(Object.keys(SAMPLED).sort());
    for (const name of Object.keys(ZONES)) expect(ZONES[name].zones.length, name).toBeGreaterThan(0);
  });

  it("every zone file exists in both formats", () => {
    for (const [name, { zones }] of Object.entries(ZONES)) {
      for (const z of zones) {
        expect(z.file.startsWith(`${SAMPLED[name].set}/${name}/`), z.file).toBe(true);
        expect(Object.keys(files)).toContain(`/public/music/${z.file}.webm`);
        expect(Object.keys(files)).toContain(`/public/music/${z.file}.m4a`);
      }
    }
  });

  it("every instrument's source is allowed", () => {
    for (const [name, { source }] of Object.entries(ZONES)) {
      const entry = sources.find((s) => s.id === source);
      expect(entry, `${name} source ${source}`).toBeDefined();
      expect(ALLOWED_LICENSES).toContain(entry!.license);
    }
  });

  it("credits name every source; CC BY entries carry title, author, url, license url and changes", () => {
    const blocks = credits.split(/\n\s*\n/);
    for (const s of sources) {
      const block = blocks.find((b) => b.includes(s.url));
      expect(block, `credits block for ${s.id}`).toBeDefined();
      expect(block).toContain(s.creditLine);
      expect(block).toContain(s.title);
      expect(block).toContain(s.author);
      if (s.license === "CC-BY-3.0") {
        expect(block).toContain("https://creativecommons.org/licenses/by/3.0/");
        expect(block).toMatch(/Changes: \S/);
      }
    }
  });

  it("decoded caps hold", () => {
    const core = decodedBytes("core");
    for (const set of ["core", ...BOARD_SETS, ...MINIGAME_SETS] as SetId[]) {
      expect(decodedBytes(set), set).toBeLessThanOrEqual(24 * MB);
    }
    for (const set of [...BOARD_SETS, ...MINIGAME_SETS]) {
      expect(core + decodedBytes(set), `core + ${set}`).toBeLessThanOrEqual(44 * MB);
    }
  });

  it("core holds the six core instruments", () => {
    expect(Object.keys(SAMPLED).filter((k) => SAMPLED[k].set === "core").sort()).toEqual([
      "bass",
      "glock",
      "kit.core",
      "piano",
      "trombone",
      "trumpet",
    ]);
  });

  it("kits are one-shot drums with no pitch shift; melodic stand-ins are synth voices", () => {
    for (const [name, inst] of Object.entries(SAMPLED)) {
      if (inst.kind === "kit") {
        expect(inst, name).toMatchObject({ standIn: "drums", oneShot: true, maxShift: 0 });
      } else {
        expect(Object.keys(VOICES), name).toContain(inst.standIn);
        expect(inst.maxShift, name).toBe(1.5);
      }
    }
  });
});
