/**
 * SUPER STAR PARTY — small ink pill toast, bottom-center.
 * Fades in, holds, fades out, auto-dismisses. Passive (pointer-events none).
 */
import { injectStyles } from "./styles";
import { root } from "./root";
import { sfx } from "./sound";

export interface ToastOpts {
  durationMs?: number;
  sound?: string | null;
}

export interface ToastHandle {
  el: HTMLDivElement;
  destroy(): void;
}

export function toast(text: string, opts?: ToastOpts): ToastHandle {
  injectStyles();
  const el = document.createElement("div");
  el.className = "ssp-toast";
  el.setAttribute("role", "status");
  el.textContent = text;
  root().appendChild(el);

  void el.offsetHeight;
  requestAnimationFrame(() => el.classList.add("ssp-toast--show"));

  sfx(opts?.sound === undefined ? null : opts.sound);

  const dur = opts?.durationMs ?? 1600;
  const timer = window.setTimeout(() => {
    el.classList.remove("ssp-toast--show");
    window.setTimeout(() => el.remove(), 240);
  }, dur);

  return {
    el,
    destroy() {
      window.clearTimeout(timer);
      el.remove();
    },
  };
}
