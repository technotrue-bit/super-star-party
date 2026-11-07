import { describe, expect, it, vi } from "vitest";
import {
  GA_MEASUREMENT_ID,
  analyticsBoardName,
  markMatchFinished,
  markMatchStarted,
  trackEvent,
} from "./analytics";
import { rng } from "./core/rng";

describe("GA4 + Vercel analytics wiring", () => {
  it("exports the Super Star Party GA4 measurement ID", () => {
    expect(GA_MEASUREMENT_ID).toBe("G-H74B002GRX");
  });

  it("normalizes board ids to snake_case", () => {
    expect(analyticsBoardName("fizzy-fairground")).toBe("fizzy_fairground");
    expect(analyticsBoardName("downtown")).toBe("downtown");
    expect(analyticsBoardName("cruise-ship")).toBe("cruise_ship");
  });

  it("is a no-op when window is undefined and never consumes gameplay rng", () => {
    rng.reset(42);
    const before = rng.draws;
    expect(() => trackEvent("hero_picked", { hero: "pip" })).not.toThrow();
    expect(rng.draws).toBe(before);
  });

  it("forwards custom events to window.gtag when available", () => {
    const gtag = vi.fn();
    const prevWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = { gtag };
    try {
      trackEvent("hero_picked", { hero: "pip" });
      trackEvent("friends_room_created", { board: "fizzy_fairground" });
      trackEvent("friends_room_joined", { players_in_room: 3 });
      markMatchStarted({ board: "cruise-ship", mode: "solo", players: 4 });
      markMatchFinished({ board: "cruise-ship", mode: "solo", turns: 10, minutes: 12.4 });

      expect(gtag).toHaveBeenCalledWith("event", "hero_picked", { hero: "pip" });
      expect(gtag).toHaveBeenCalledWith("event", "friends_room_created", { board: "fizzy_fairground" });
      expect(gtag).toHaveBeenCalledWith("event", "friends_room_joined", { players_in_room: 3 });
      expect(gtag).toHaveBeenCalledWith("event", "match_started", {
        board: "cruise_ship",
        mode: "solo",
        players: 4,
      });
      expect(gtag).toHaveBeenCalledWith("event", "match_finished", {
        board: "cruise_ship",
        mode: "solo",
        turns: 10,
        minutes: 12,
      });
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as Record<string, unknown>).window;
      } else {
        (globalThis as Record<string, unknown>).window = prevWindow;
      }
    }
  });
});
