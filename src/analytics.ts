import { inject, track } from "@vercel/analytics";

export const GA_MEASUREMENT_ID = "G-H74B002GRX" as const;

export type AnalyticsParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Send a custom event to GA4 (gtag.js) and Vercel Web Analytics.
 * Safe in headless/Node/test environments and never touches gameplay RNG or MatchState.
 */
export function trackEvent(name: string, params?: AnalyticsParams): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, params ?? {});
    }
  } catch {
    /* analytics must never interrupt gameplay */
  }
  try {
    track(name, params);
  } catch {
    /* ignore Vercel analytics errors in non-browser/test environments */
  }
}

export function analyticsBoardName(board: string): string {
  return board.replace(/-/g, "_");
}

let matchStartedAtMs: number | null = null;

export function markMatchStarted(params: {
  board: string;
  mode: "solo" | "friends";
  players: number;
}): void {
  matchStartedAtMs = Date.now();
  trackEvent("match_started", {
    board: analyticsBoardName(params.board),
    mode: params.mode,
    players: params.players,
  });
}

export function markMatchFinished(params: {
  board: string;
  mode: "solo" | "friends";
  turns: number;
  minutes?: number;
}): void {
  const computedMinutes =
    params.minutes !== undefined
      ? Math.round(params.minutes)
      : matchStartedAtMs !== null
        ? Math.max(0, Math.round((Date.now() - matchStartedAtMs) / 60000))
        : 0;
  matchStartedAtMs = null;
  trackEvent("match_finished", {
    board: analyticsBoardName(params.board),
    mode: params.mode,
    turns: params.turns,
    minutes: computedMinutes,
  });
}

/**
 * Vercel Web Analytics. Production loads /_vercel/insights/script.js after
 * Analytics is enabled on the Vercel project and a deployment is created.
 */
inject();
