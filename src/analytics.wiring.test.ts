import { describe, expect, it } from "vitest";
import { ANALYTICS_PAGEVIEWS_ONLY } from "./analytics";

describe("vercel web analytics wiring", () => {
  it("wires pageviews-only analytics (no custom events)", () => {
    expect(ANALYTICS_PAGEVIEWS_ONLY).toBe(true);
  });
});
