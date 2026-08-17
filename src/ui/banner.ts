/**
 * SUPER STAR PARTY — big center-screen banner.
 * White fill, ink stroke via layered text-shadows, elastic pop-in
 * (cubic-bezier(.34,1.56,.64,1)), hold, then pop-out (scale 1.15 + fade).
 * durationMs 0 = persistent (stays until destroyed / clearScreen).
 */
import { injectStyles } from "./styles";
import { root } from "./root";
import { sfx } from "./sound";

export interface BannerOpts {
  durationMs?: number;
  sound?: string | null;
}

export interface BannerHandle {
  el: HTMLDivElement;
  destroy(): void;
}

export function banner(text: string, opts?: BannerOpts): BannerHandle {
  injectStyles();
  const el = document.createElement("div");
  el.className = "ssp-banner";
  el.setAttribute("role", "status");
  el.textContent = text;
  root().appendChild(el);

  // Force a reflow so the pop-in transition actually runs from scale(.6).
  void el.offsetHeight;
  requestAnimationFrame(() => el.classList.add("ssp-banner--show"));

  const sound = opts?.sound === undefined ? "ui.click" : opts.sound;
  sfx(sound);

  const dur = opts?.durationMs ?? 1500;
  let timer = 0;
  if (dur > 0) {
    timer = window.setTimeout(() => {
      el.classList.remove("ssp-banner--show");
      el.classList.add("ssp-banner--out");
      window.setTimeout(() => el.remove(), 240);
    }, dur);
  }

  return {
    el,
    destroy() {
      window.clearTimeout(timer);
      el.remove();
    },
  };
}
