import { describe, expect, it } from "vitest";
import { screens, type Screen } from "./screenManager";

function fakeScreen(id: string) {
  const calls: string[] = [];
  const screen: Screen = {
    id,
    enter: () => calls.push("enter"),
    exit: () => calls.push("exit"),
    update: () => calls.push("update"),
    render: () => calls.push("render"),
  };
  return { screen, calls };
}

describe("screen manager", () => {
  it("drives no screen until the boot goto has entered one", () => {
    // The title is pre-registered as current while the other screen chunks
    // load. Ticking it then moved the shared camera's near plane out to its
    // far orbit, and Pick a Hero later drew nothing (a blank hero preview).
    const title = fakeScreen("title");
    const select = fakeScreen("select");
    screens.register(title.screen);
    screens.update(1 / 60);
    screens.render();
    expect(title.calls).toEqual([]);

    screens.register(select.screen);
    screens.goto("select");
    screens.update(1 / 60);
    screens.render();
    expect(title.calls).toEqual([]);
    expect(select.calls).toEqual(["enter", "update", "render"]);
  });
});
