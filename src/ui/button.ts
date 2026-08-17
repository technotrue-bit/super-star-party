/**
 * SUPER STAR PARTY — chunky candy buttons.
 * Pill shape, 4px ink border, hard offset shadow, hover scale 1.06,
 * press squish (scale 0.96 + translateY(3px) + shadow collapse).
 * Real <button> elements: keyboard focusable, aria-label support.
 */
import { injectStyles } from "./styles";
import { root } from "./root";
import { sfx } from "./sound";

export interface ButtonOpts {
  label: string;
  onClick?: () => void;
  kind?: "primary" | "ghost" | "danger" | "gold";
  size?: "sm" | "md" | "lg";
  icon?: string;
  disabled?: boolean;
  /** SFX name played on click; null = silent. Default "ui.click". */
  sound?: string | null;
  ariaLabel?: string;
}

export interface ButtonHandle {
  el: HTMLButtonElement;
  setLabel(t: string): void;
  setEnabled(on: boolean): void;
  setVisible(on: boolean): void;
  destroy(): void;
}

export function button(opts: ButtonOpts): ButtonHandle {
  injectStyles();
  const el = document.createElement("button");
  el.type = "button";
  el.className = `ssp-btn ssp-btn--${opts.kind ?? "primary"} ssp-btn--${opts.size ?? "md"}`;
  if (opts.disabled) el.disabled = true;
  if (opts.ariaLabel) el.setAttribute("aria-label", opts.ariaLabel);

  const labelSpan = document.createElement("span");
  labelSpan.className = "ssp-btn__label";
  labelSpan.textContent = opts.label;

  if (opts.icon) {
    const iconSpan = document.createElement("span");
    iconSpan.className = "ssp-btn__icon";
    iconSpan.textContent = opts.icon;
    iconSpan.setAttribute("aria-hidden", "true");
    el.append(iconSpan, labelSpan);
  } else {
    el.appendChild(labelSpan);
  }

  el.addEventListener("click", () => {
    const sound = opts.sound === undefined ? "ui.click" : opts.sound;
    sfx(sound);
    opts.onClick?.();
  });

  root().appendChild(el);

  return {
    el,
    setLabel(t: string) {
      labelSpan.textContent = t;
    },
    setEnabled(on: boolean) {
      el.disabled = !on;
    },
    setVisible(on: boolean) {
      el.style.display = on ? "" : "none";
    },
    destroy() {
      el.remove();
    },
  };
}
