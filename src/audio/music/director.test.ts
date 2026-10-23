import { describe, expect, it } from "vitest";
import { Director, THEME_FALLBACK, boardSet, playableId, resolveTheme } from "./director";
import type { SequencerControl } from "./director";
import type { ClockChange } from "./clock";

/** A sequencer stand-in that records every queued change. */
function fakeSeq(theme: string | null, baseBpm = 132): SequencerControl & { changes: ClockChange[] } {
  const changes: ClockChange[] = [];
  return { theme, baseBpm, changes, queueChange: (c) => void changes.push(c) };
}

describe("resolveTheme", () => {
  it.each([
    ["fizzy-fairground", "board.fairground"],
    ["cruise-ship", "board.cruise"],
    ["downtown", "board.downtown"],
    ["nope", "board.fairground"],
    [undefined, "board.fairground"],
  ])("board %s -> %s", (b, t) => expect(resolveTheme("board", { board: b })).toBe(t));

  it.each([
    ["survival", "mg.action"],
    ["race", "mg.action"],
    ["timing", "mg.action"],
    ["target", "mg.action"],
    ["collect", "mg.action"],
    ["puzzle", "mg.puzzle"],
    ["memory", "mg.puzzle"],
    ["rhythm", "mg.rhythm"],
  ])("genre %s -> %s", (g, t) => {
    expect(resolveTheme("minigame_a", { genre: g })).toBe(t);
    expect(resolveTheme("minigame_b", { genre: g })).toBe(t);
  });

  it("no genre falls back by alias", () => {
    expect(resolveTheme("minigame_a", {})).toBe("mg.action");
    expect(resolveTheme("minigame_b", {})).toBe("mg.puzzle");
  });

  it("other ids pass through", () => {
    expect(resolveTheme("title", {})).toBe("title");
    expect(resolveTheme("board.cruise", {})).toBe("board.cruise");
  });

  it("an id that is an Object.prototype key is not a board or genre", () => {
    expect(resolveTheme("board", { board: "constructor" })).toBe("board.fairground");
    expect(resolveTheme("minigame_a", { genre: "toString" })).toBe("mg.action");
  });
});

describe("playableId", () => {
  it("playableId uses the interim fallback", () => {
    expect(playableId("board.cruise", { "board.fairground": 1 })).toBe("board.fairground");
    expect(playableId("nope", {})).toBeNull();
  });

  it("a theme that exists plays as itself", () => {
    expect(playableId("board.cruise", { "board.cruise": 1, "board.fairground": 1 })).toBe("board.cruise");
  });

  it("a fallback that is missing too gives null", () => {
    expect(playableId("mg.rhythm", {})).toBeNull();
  });

  it("the interim fallback table is the Plan 1 one", () => {
    expect(THEME_FALLBACK).toEqual({
      "board.cruise": "board.fairground",
      "board.downtown": "board.fairground",
      "mg.rhythm": "mg.puzzle",
    });
  });
});

describe("boardSet", () => {
  it.each([
    ["fizzy-fairground", "fairground"],
    ["cruise-ship", "cruise"],
    ["downtown", "downtown"],
    ["nope", null],
  ])("%s -> %s", (b, s) => expect(boardSet(b)).toBe(s));
});

describe("Director", () => {
  it("remembers the board", () => {
    const d = new Director(() => null);
    expect(d.board).toBeUndefined();
    d.setBoard("cruise-ship");
    expect(d.board).toBe("cruise-ship");
  });

  it("lift is idempotent and queues fill then change", () => {
    const seq = fakeSeq("board.fairground", 132);
    const d = new Director(() => seq);
    d.lift(true);
    d.lift(true);
    expect(d.lifted).toBe(true);
    expect(seq.changes).toEqual([{ bpm: 132 * 1.06, transpose: 1, lift: true, fill: true }]);
  });

  it("lift off queues the change without fill", () => {
    const seq = fakeSeq("board.fairground", 132);
    const d = new Director(() => seq);
    d.lift(true);
    d.lift(false);
    d.lift(false);
    expect(d.lifted).toBe(false);
    expect(seq.changes).toEqual([
      { bpm: 132 * 1.06, transpose: 1, lift: true, fill: true },
      { bpm: 132, transpose: 0, lift: false },
    ]);
  });

  it("lift off before any lift does nothing", () => {
    const seq = fakeSeq("board.fairground");
    new Director(() => seq).lift(false);
    expect(seq.changes).toEqual([]);
  });

  it("lift during a non-board theme waits; the board theme starts lifted", () => {
    const seq = fakeSeq("mg.action", 140);
    const d = new Director(() => seq);
    d.lift(true);
    expect(seq.changes).toEqual([]);
    expect(d.lifted).toBe(true);
    expect(d.startOptions("board.fairground", 132)).toEqual({ bpm: expect.closeTo(139.92), transpose: 1, lift: true });
  });

  it("lift with nothing playing only records the state", () => {
    const d = new Director(() => null);
    d.lift(true);
    expect(d.lifted).toBe(true);
  });

  it("non-board themes never start lifted", () => {
    const d = new Director(() => null);
    d.lift(true);
    expect(d.startOptions("mg.action", 140)).toEqual({ bpm: 140, transpose: 0, lift: false });
    expect(d.startOptions("star_fanfare", 120)).toEqual({ bpm: 120, transpose: 0, lift: false });
  });

  it("an unlifted board theme starts at its own tempo and key", () => {
    expect(new Director(() => null).startOptions("board.fairground", 132)).toEqual({ bpm: 132, transpose: 0, lift: false });
  });
});
