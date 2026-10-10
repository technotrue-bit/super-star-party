/**
 * SUPER STAR PARTY — DOM UI kit (wave 1). PUBLIC CONTRACT.
 * Screens and gameplay import { ui } from "../ui/kit". The ui object keeps
 * exactly these members (plus additions):
 *
 *   ui.button(opts)      -> {el, setLabel, setEnabled, setVisible, destroy}
 *   ui.banner(text, opts?)-> {el, destroy}   [NOW QUEUED — see BannerQueue]
 *   ui.popup(opts)       -> {el, card, destroy}
 *   ui.toast(text, opts?)-> {el, destroy}    [NOW QUEUED — see BannerQueue]
 *   ui.coinCounter(el, start, opts?) -> {set, add, tweenTo, value}
 *   ui.confettiBurst(x?, y?, opts?)  (void)
 *   ui.hud()             -> {el, update(players), showBanner(text), destroy}
 *   ui.clearScreen()     (void)
 *   ui.theme             palette passthrough
 *   ui.hex(c)            hex string -> number
 *   ui.playerAvatar(kind, color?) -> HTMLElement       [ADDED]
 *   ui.settingsPanel()   -> {el, destroy}              [ADDED]
 *   ui.queue             BannerQueue                   [ADDED]
 *   ui.showFloatingNumber(x,y,delta,opts?)  (void)     [ADDED]
 *   ui.clearFeedback()   (void)                        [ADDED]
 *
 * Style: bright candy palette from config/palette.ts, deep violet ink
 * borders + hard offset shadows, cream surfaces, Fredoka. Every interaction
 * plays a sound (ui.click by default) wrapped in try/catch so a stubbed
 * audio engine can never break the UI.
 */
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";

import { palette, hex } from "../config/palette";
import { runCleanups } from "./registry";
import { clearRoot } from "./root";
import { button } from "./button";
import type { ButtonOpts } from "./button";
import { popup } from "./popup";
import type { PopupOpts } from "./popup";
import { coinCounter } from "./counter";
import { confettiBurst } from "./confetti";
import { hud, setHudBannerSink } from "./hud";
import { playerAvatar } from "./avatar";
import { settingsPanel } from "./settings";
import { sfx } from "./sound";

/* ------------------------------------------------------------------ */
/*  Feedback queue — serializes banners/toasts, caps on-screen count   */
/*                                                                  */
/*  The old banner/toast functions created elements immediately, so   */
/*  rapid-fire calls (turn loop, happenings, space effects) piled up  */
/*  13+ overlapping banners. The queue guarantees:                    */
/*    - at most 1 large banner + 1 small toast visible at a time      */
/*    - the rest wait in a FIFO queue with priority insertion         */
/*    - critical items (star, happening, minigame) jump the queue     */
/*    - overflow drops the oldest non-critical item (never critical)  */
/* ------------------------------------------------------------------ */

type FeedbackPriority = "low" | "normal" | "high" | "critical";

const PRIORITY_RANK: Record<FeedbackPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

export interface FeedbackHandle {
  el: HTMLDivElement;
  destroy(): void;
}

interface QueuedBanner {
  text: string;
  priority: FeedbackPriority;
  durationMs: number;
  style: "default" | "green" | "grumpus" | "gold";
  sound: string | null;
  handle: FeedbackHandle;
  destroyed: boolean;
}

interface QueuedToast {
  text: string;
  priority: FeedbackPriority;
  durationMs: number;
  sound: string | null;
  handle: FeedbackHandle;
  destroyed: boolean;
}

/** Max items waiting in each queue. Beyond this, oldest non-critical drops. */
const MAX_QUEUE = 14;
const DEFAULT_BANNER_MS = 1500;
const DEFAULT_TOAST_MS = 1600;

let feedbackStylesInjected = false;

function injectFeedbackStyles(): void {
  if (feedbackStylesInjected) return;
  feedbackStylesInjected = true;
  if (document.getElementById("ssp-feedback-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-feedback-styles";
  style.textContent = `
    .ssp-feedback-root {
      position: fixed; inset: 0; z-index: 82;
      pointer-events: none;
      font-family: 'Fredoka', 'Comic Sans MS', sans-serif;
      user-select: none; -webkit-user-select: none;
    }
    .ssp-fb-banner {
      position: absolute; left: 50%; top: 70px;
      transform: translateX(-50%) scale(.6); opacity: 0;
      font-size: clamp(24px, 5.5vw, 40px); font-weight: 700; color: ${palette.white};
      text-align: center; width: max-content; max-width: 92vw; box-sizing: border-box;
      white-space: normal; overflow-wrap: anywhere; text-wrap: balance; line-height: 1.12;
      text-shadow:
        0 2px 0 ${palette.ink}, 2px 0 0 ${palette.ink}, -2px 0 0 ${palette.ink}, 0 -2px 0 ${palette.ink},
        2px 2px 0 ${palette.ink}, -2px 2px 0 ${palette.ink}, 2px -2px 0 ${palette.ink}, -2px -2px 0 ${palette.ink},
        0 4px 0 ${palette.ink};
      transition: transform 260ms cubic-bezier(.34,1.56,.64,1), opacity 150ms ease-out;
    }
    .ssp-fb-banner--show { transform: translateX(-50%) scale(1); opacity: 1; }
    .ssp-fb-banner--out { transform: translateX(-50%) scale(1.12) !important; opacity: 0 !important; }
    .ssp-fb-banner--green { color: ${palette.mint}; }
    .ssp-fb-banner--grumpus { color: ${palette.lava}; }
    .ssp-fb-banner--gold { color: ${palette.sun}; }
    .ssp-fb-toast {
      position: absolute; left: 50%; bottom: calc(10% + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%) translateY(10px);
      background: ${palette.ink}; color: ${palette.white};
      border: 3px solid ${palette.cream}; border-radius: 999px;
      padding: 10px 22px; font-size: 16px; font-weight: 600;
      box-shadow: 0 4px 0 rgba(0,0,0,.35);
      opacity: 0; white-space: nowrap; max-width: 88vw;
      overflow: hidden; text-overflow: ellipsis;
      transition: opacity 220ms ease-out, transform 220ms ease-out;
    }
    .ssp-fb-toast--show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .ssp-float-num {
      position: fixed; z-index: 86; pointer-events: none;
      font-weight: 700; font-size: 32px; line-height: 1;
      text-shadow:
        0 2px 0 ${palette.ink}, 2px 0 0 ${palette.ink}, -2px 0 0 ${palette.ink}, 0 -2px 0 ${palette.ink},
        0 3px 0 ${palette.ink};
      will-change: transform, opacity;
    }
    .ssp-float-num--plus { color: ${palette.mint}; }
    .ssp-float-num--minus { color: ${palette.lava}; }
  `;
  document.head.appendChild(style);
}

/** Live floating-number elements — tracked so clearFeedback() can sweep them. */
const activeFloatingNumbers = new Set<HTMLDivElement>();

function clearFloatingNumbers(): void {
  for (const el of activeFloatingNumbers) el.remove();
  activeFloatingNumbers.clear();
}

/**
 * Floating +N / -N number at a screen position. Styled with the kit's
 * language (chunky Fredoka, ink outline, mint for +, lava for -), rises and
 * fades over ~0.8s. Capped implicitly — short-lived so they never pile up.
 */
export function showFloatingNumber(
  x: number,
  y: number,
  delta: number,
  opts?: { durationMs?: number }
): void {
  if (delta === 0) return;
  injectFeedbackStyles();
  const el = document.createElement("div");
  el.className = `ssp-float-num ${delta > 0 ? "ssp-float-num--plus" : "ssp-float-num--minus"}`;
  el.textContent = delta > 0 ? `+${delta}` : `${delta}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.transform = "translate(-50%,-50%)";
  document.body.appendChild(el);
  activeFloatingNumbers.add(el);

  const dur = opts?.durationMs ?? 800;
  const cleanup = () => {
    el.remove();
    activeFloatingNumbers.delete(el);
  };
  try {
    el.animate(
      [
        { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
        { transform: "translate(-50%,-120%) scale(1.15)", opacity: 1, offset: 0.6 },
        { transform: "translate(-50%,-150%) scale(0.9)", opacity: 0 },
      ],
      { duration: dur, easing: "cubic-bezier(.2,.55,.35,1)", fill: "both" }
    ).onfinish = cleanup;
  } catch {
    window.setTimeout(cleanup, dur);
  }
}

class BannerQueue {
  private bannerQueue: QueuedBanner[] = [];
  private toastQueue: QueuedToast[] = [];
  private activeBannerEl: HTMLDivElement | null = null;
  private activeBannerPriority = -1;
  private activeBannerTimer = 0;
  private activeToastEl: HTMLDivElement | null = null;
  private activeToastTimer = 0;
  private root: HTMLDivElement | null = null;

  private ensureRoot(): HTMLDivElement {
    if (!this.root) {
      injectFeedbackStyles();
      this.root = document.createElement("div");
      this.root.className = "ssp-feedback-root";
      document.body.appendChild(this.root);
    }
    return this.root;
  }

  banner(
    text: string,
    opts: {
      durationMs?: number;
      priority?: FeedbackPriority;
      style?: "default" | "green" | "grumpus" | "gold";
      sound?: string | null;
    } = {}
  ): FeedbackHandle {
    const el = document.createElement("div");
    el.className = "ssp-fb-banner";
    el.setAttribute("role", "status");
    el.textContent = text;
    const style = opts.style ?? "default";
    if (style === "green") el.classList.add("ssp-fb-banner--green");
    else if (style === "grumpus") el.classList.add("ssp-fb-banner--grumpus");
    else if (style === "gold") el.classList.add("ssp-fb-banner--gold");

    let destroyed = false;
    const handle: FeedbackHandle = {
      el,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        el.remove();
      },
    };

    const item: QueuedBanner = {
      text,
      priority: opts.priority ?? "normal",
      durationMs: opts.durationMs ?? DEFAULT_BANNER_MS,
      style,
      sound: opts.sound ?? null,
      handle,
      destroyed: false,
    };
    // Patch the item reference when destroy is called (for queue skipping).
    const origDestroy = handle.destroy;
    handle.destroy = () => {
      item.destroyed = true;
      origDestroy();
    };
    this.enqueueBanner(item);
    return handle;
  }

  toast(
    text: string,
    opts: {
      durationMs?: number;
      priority?: FeedbackPriority;
      sound?: string | null;
    } = {}
  ): FeedbackHandle {
    const el = document.createElement("div");
    el.className = "ssp-fb-toast";
    el.setAttribute("role", "status");
    el.textContent = text;

    let destroyed = false;
    const handle: FeedbackHandle = {
      el,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        el.remove();
      },
    };

    const item: QueuedToast = {
      text,
      priority: opts.priority ?? "normal",
      durationMs: opts.durationMs ?? DEFAULT_TOAST_MS,
      sound: opts.sound ?? null,
      handle,
      destroyed: false,
    };
    const origDestroy = handle.destroy;
    handle.destroy = () => {
      item.destroyed = true;
      origDestroy();
    };
    this.enqueueToast(item);
    return handle;
  }

  /** A happening: distinct banner style (green or grumpus) + high priority. */
  happening(
    text: string,
    opts: {
      durationMs?: number;
      kind: "green" | "grumpus";
      sound?: string | null;
    }
  ): FeedbackHandle {
    return this.banner(text, {
      durationMs: opts.durationMs,
      style: opts.kind,
      priority: "high",
      sound: opts.sound,
    });
  }

  /** Sweep everything: queues, active banners/toasts, floating numbers. */
  clear(): void {
    for (const item of this.bannerQueue) item.handle.destroy();
    this.bannerQueue = [];
    for (const item of this.toastQueue) item.handle.destroy();
    this.toastQueue = [];
    if (this.activeBannerEl) {
      window.clearTimeout(this.activeBannerTimer);
      const el = this.activeBannerEl;
      this.activeBannerEl = null;
      this.activeBannerTimer = 0;
      el.classList.remove("ssp-fb-banner--show");
      el.classList.add("ssp-fb-banner--out");
      window.setTimeout(() => el.remove(), 260);
    }
    if (this.activeToastEl) {
      window.clearTimeout(this.activeToastTimer);
      const el = this.activeToastEl;
      this.activeToastEl = null;
      this.activeToastTimer = 0;
      el.classList.remove("ssp-fb-toast--show");
      window.setTimeout(() => el.remove(), 240);
    }
    clearFloatingNumbers();
  }

  private enqueueBanner(item: QueuedBanner): void {
    // Overflow: drop the oldest non-critical item (never drop critical).
    if (this.bannerQueue.length >= MAX_QUEUE) {
      const dropIdx = this.bannerQueue.findIndex((i) => i.priority !== "critical");
      if (dropIdx >= 0) {
        this.bannerQueue[dropIdx].handle.destroy();
        this.bannerQueue.splice(dropIdx, 1);
      }
    }
    // Insert by priority (stable — same priority keeps FIFO order).
    const rank = PRIORITY_RANK[item.priority];
    let insertIdx = this.bannerQueue.length;
    for (let i = 0; i < this.bannerQueue.length; i++) {
      if (rank > PRIORITY_RANK[this.bannerQueue[i].priority]) {
        insertIdx = i;
        break;
      }
    }
    this.bannerQueue.splice(insertIdx, 0, item);
    // Preemption: a strictly higher-priority banner cuts off whatever is on screen
    // instead of stacking beside it. Space events interrupt the turn banner; the
    // turn banner never interrupts them.
    const top = this.bannerQueue[0];
    if (this.activeBannerEl && top && PRIORITY_RANK[top.priority] > this.activeBannerPriority) {
      this.hideActiveBanner();
      return;
    }
    this.maybeShowNextBanner();
  }

  private enqueueToast(item: QueuedToast): void {
    if (this.toastQueue.length >= MAX_QUEUE) {
      const dropIdx = this.toastQueue.findIndex((i) => i.priority !== "critical");
      if (dropIdx >= 0) {
        this.toastQueue[dropIdx].handle.destroy();
        this.toastQueue.splice(dropIdx, 1);
      }
    }
    const rank = PRIORITY_RANK[item.priority];
    let insertIdx = this.toastQueue.length;
    for (let i = 0; i < this.toastQueue.length; i++) {
      if (rank > PRIORITY_RANK[this.toastQueue[i].priority]) {
        insertIdx = i;
        break;
      }
    }
    this.toastQueue.splice(insertIdx, 0, item);
    this.maybeShowNextToast();
  }

  private maybeShowNextBanner(): void {
    if (this.activeBannerEl || this.bannerQueue.length === 0) return;
    const item = this.bannerQueue.shift()!;
    if (item.destroyed) {
      // Destroyed while queued — skip to the next one.
      this.maybeShowNextBanner();
      return;
    }
    const root = this.ensureRoot();
    root.appendChild(item.handle.el);
    if (item.sound) {
      try {
        sfx(item.sound);
      } catch {
        /* audio stub — banner still shows */
      }
    }
    void item.handle.el.offsetHeight;
    requestAnimationFrame(() => {
      if (item.handle.el.isConnected) item.handle.el.classList.add("ssp-fb-banner--show");
    });
    this.activeBannerEl = item.handle.el;
    this.activeBannerPriority = PRIORITY_RANK[item.priority];
    this.activeBannerTimer = window.setTimeout(() => {
      this.hideActiveBanner();
    }, item.durationMs);
  }

  private hideActiveBanner(): void {
    const el = this.activeBannerEl;
    this.activeBannerEl = null;
    this.activeBannerPriority = -1;
    this.activeBannerTimer = 0;
    if (!el) return;
    el.classList.remove("ssp-fb-banner--show");
    el.classList.add("ssp-fb-banner--out");
    window.setTimeout(() => el.remove(), 260);
    this.maybeShowNextBanner();
  }

  private maybeShowNextToast(): void {
    if (this.activeToastEl || this.toastQueue.length === 0) return;
    const item = this.toastQueue.shift()!;
    if (item.destroyed) {
      this.maybeShowNextToast();
      return;
    }
    const root = this.ensureRoot();
    root.appendChild(item.handle.el);
    if (item.sound) {
      try {
        sfx(item.sound);
      } catch {
        /* audio stub */
      }
    }
    void item.handle.el.offsetHeight;
    requestAnimationFrame(() => {
      if (item.handle.el.isConnected) item.handle.el.classList.add("ssp-fb-toast--show");
    });
    this.activeToastEl = item.handle.el;
    this.activeToastTimer = window.setTimeout(() => {
      this.hideActiveToast();
    }, item.durationMs);
  }

  private hideActiveToast(): void {
    const el = this.activeToastEl;
    this.activeToastEl = null;
    this.activeToastTimer = 0;
    if (!el) return;
    el.classList.remove("ssp-fb-toast--show");
    window.setTimeout(() => el.remove(), 240);
    this.maybeShowNextToast();
  }
}

export const queue = new BannerQueue();

/* ONE banner channel: the HUD's own showBanner() is routed through this queue,
   so a space-event banner and the turn banner can never be on screen together. */
setHudBannerSink((text, opts) => queue.banner(text, { durationMs: opts?.durationMs }))

/* ------------------------------------------------------------------ */
/*  Public ui                                                         */
/* ------------------------------------------------------------------ */

export const ui = {
  theme: palette,
  hex,

  button,
  popup,
  coinCounter,
  confettiBurst,
  hud,
  playerAvatar,
  settingsPanel,

  /** The feedback queue — primary API for banners/toasts/happenings. */
  queue: queue as BannerQueue,
  showFloatingNumber,

  /**
   * Banner — now routes through the feedback queue so calls serialize
   * instead of stacking. Returns {el, destroy} per the public contract;
   * `el` is created up front but only appended to the DOM when it reaches
   * the front of the queue.
   */
  banner: (text: string, opts?: any) => queue.banner(text, opts),
  /**
   * Toast — same queuing treatment. Returns {el, destroy}.
   */
  toast: (text: string, opts?: any) => queue.toast(text, opts),

  /** Remove all transient UI (popups, banners, toasts, confetti, HUD, feedback). */
  clearScreen() {
    queue.clear();
    runCleanups();
    clearRoot();
  },

  /** Convenience: sweep just the feedback layer (banners/toasts/floats). */
  clearFeedback() {
    queue.clear();
  },
};

export type { ButtonOpts, PopupOpts };
