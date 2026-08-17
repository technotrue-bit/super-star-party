/**
 * SUPER STAR PARTY — modal popup.
 * Scrim (palette.overlay) + cream card with 5px ink border, radius 28px,
 * hard offset shadow, elastic back-ease pop-in. Buttons row built from
 * ui.button. Esc closes by default; a11y: role=dialog, aria-modal, first
 * button focused.
 */
import { injectStyles } from "./styles";
import { root } from "./root";
import { button } from "./button";
import { sfx } from "./sound";
import { onCleanup } from "./registry";

export interface PopupButtonOpts {
  label: string;
  onClick?: () => void;
  kind?: "primary" | "gold" | "danger" | "ghost";
}

export interface PopupOpts {
  title: string;
  body?: string;
  /** Custom DOM content appended after the body, before the buttons. */
  content?: HTMLElement;
  buttons?: PopupButtonOpts[];
  sound?: string | null;
  closeOnEsc?: boolean;
}

export interface PopupHandle {
  el: HTMLDivElement;
  card: HTMLDivElement;
  destroy(): void;
}

export function popup(opts: PopupOpts): PopupHandle {
  injectStyles();
  const scrim = document.createElement("div");
  scrim.className = "ssp-popup";
  scrim.setAttribute("role", "dialog");
  scrim.setAttribute("aria-modal", "true");
  scrim.setAttribute("aria-label", opts.title);

  const card = document.createElement("div");
  card.className = "ssp-popup__card";

  const title = document.createElement("div");
  title.className = "ssp-popup__title";
  title.textContent = opts.title;

  const body = document.createElement("div");
  body.className = "ssp-popup__body";
  body.textContent = opts.body ?? "";

  card.append(title, body);
  if (opts.content) card.appendChild(opts.content);

  const btns = opts.buttons ?? [];
  if (btns.length > 0) {
    const btnRow = document.createElement("div");
    btnRow.className = "ssp-popup__buttons";
    for (const b of btns) {
      const handle = button({
        label: b.label,
        kind: b.kind ?? "primary",
        onClick: b.onClick,
        sound: "ui.click",
      });
      btnRow.appendChild(handle.el);
    }
    card.appendChild(btnRow);
  }

  scrim.appendChild(card);
  root().appendChild(scrim);

  void scrim.offsetHeight;
  requestAnimationFrame(() => scrim.classList.add("ssp-popup--show"));

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("keydown", onKey);
    scrim.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && opts.closeOnEsc !== false) destroy();
  };
  window.addEventListener("keydown", onKey);
  onCleanup(destroy);

  const sound = opts.sound === undefined ? "ui.click" : opts.sound;
  sfx(sound);

  const firstBtn = scrim.querySelector<HTMLButtonElement>("button");
  if (firstBtn) firstBtn.focus();

  return { el: scrim, card, destroy };
}
