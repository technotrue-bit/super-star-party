/**
 * SUPER STAR PARTY — DOM UI kit CONTRACT.
 * Wave-1 ui builder owns src/ui/** entirely; may rewrite internals but MUST
 * keep this public API. UI is DOM overlay (not canvas): crisp text, easy
 * a11y, inspectable by critics.
 *
 * Contract:
 *  ui.button(opts) -> {el, setLabel, setEnabled, setVisible, destroy}
 *      opts: {label, onClick, kind: 'primary'|'ghost'|'danger'|'gold',
 *             size: 'sm'|'md'|'lg', icon?, disabled?, sound?: sfx name}
 *  ui.banner(text, opts?) -> {el, destroy}   big center-screen title text
 *  ui.popup(opts) -> {el, destroy}           modal card {title, body, buttons}
 *  ui.toast(text, opts?)                     small corner message
 *  ui.coinCounter(targetEl, start, opts?) -> {set, add, tweenTo}
 *  ui.confettiBurst(x?, y?, opts?)           confetti particles in DOM
 *  ui.hud() -> {el, update(playerStates, opts)}  match HUD (created lazily)
 *  ui.clearScreen()                          remove all transient UI
 *  ui.theme                                     palette passthrough for styles
 *
 * Style rules (MP7 bar):
 *  - Rounded chunky buttons (radius 999px), thick 4px ink border + hard
 *    drop shadow (4px 4px 0 ink), press = translate + shadow collapse.
 *  - Fredoka font everywhere; big titles with text-shadow layers.
 *  - Every interaction plays a sound (ui.click by default).
 *  - Buttons scale 1.06 on hover, 0.96 on press with 60ms squish.
 *  - All animation via transform/opacity (GPU), 90-140ms ease-out-back.
 */
import { palette, hex } from "../config/palette";
import { audio } from "../audio/audioEngine";

/** Inject the shared stylesheet once. */
function injectStyles(): void {
  if (document.getElementById("ssp-ui-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-ui-styles";
  style.textContent = `
    .ssp-ui { position: fixed; inset: 0; pointer-events: none; z-index: 50;
      font-family: 'Fredoka', 'Comic Sans MS', sans-serif; }
    .ssp-ui * { pointer-events: auto; box-sizing: border-box; }
    .ssp-btn { font-family: inherit; font-weight: 700; color: #fff;
      background: ${palette.candy}; border: 4px solid ${palette.ink};
      border-radius: 999px; padding: 12px 28px; font-size: 22px;
      box-shadow: 0 5px 0 ${palette.ink}; cursor: pointer;
      transition: transform 90ms ease-out, box-shadow 90ms ease-out;
      text-shadow: 0 2px 0 rgba(0,0,0,0.25); user-select: none; }
    .ssp-btn:hover { transform: scale(1.06); }
    .ssp-btn:active { transform: scale(0.96) translateY(3px); box-shadow: 0 2px 0 ${palette.ink}; }
    .ssp-btn:disabled { filter: grayscale(0.7) brightness(0.8); cursor: default; transform: none; }
    .ssp-btn--gold { background: ${palette.sun}; color: ${palette.ink}; }
    .ssp-btn--ghost { background: rgba(255,255,255,0.14); color: #fff; }
    .ssp-btn--danger { background: ${palette.lava}; }
    .ssp-banner { position: absolute; left: 50%; top: 38%; transform: translate(-50%,-50%) scale(0.6);
      font-size: clamp(34px, 7vw, 72px); font-weight: 700; color: #fff;
      -webkit-text-stroke: 3px ${palette.ink};
      text-shadow: 0 5px 0 ${palette.ink}; white-space: nowrap; opacity: 0; }
    .ssp-toast { position: absolute; left: 50%; bottom: 18%; transform: translateX(-50%);
      background: ${palette.ink}; color: #fff; padding: 10px 20px; border-radius: 999px;
      font-size: 16px; box-shadow: 0 4px 0 rgba(0,0,0,0.35); }
  `;
  document.head.appendChild(style);
}

export interface ButtonOpts {
  label: string;
  onClick?: () => void;
  kind?: "primary" | "ghost" | "danger" | "gold";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  sound?: string | null; // null = silent
}

export interface PopupOpts {
  title: string;
  body?: string;
  buttons?: { label: string; onClick?: () => void; kind?: "primary" | "gold" | "danger" }[];
  sound?: string | null;
}

let uiRoot: HTMLDivElement | null = null;

function root(): HTMLDivElement {
  if (!uiRoot) {
    injectStyles();
    uiRoot = document.createElement("div");
    uiRoot.className = "ssp-ui";
    document.body.appendChild(uiRoot);
  }
  return uiRoot;
}

export const ui = {
  theme: palette,
  hex,

  button(opts: ButtonOpts) {
    const el = document.createElement("button");
    el.className = `ssp-btn ssp-btn--${opts.kind ?? "primary"}`;
    el.textContent = opts.label;
    el.style.fontSize = opts.size === "lg" ? "30px" : opts.size === "sm" ? "16px" : "22px";
    if (opts.disabled) el.disabled = true;
    el.addEventListener("click", () => {
      const sound = opts.sound === undefined ? "ui.click" : opts.sound;
      if (sound) audio.sfx.play(sound);
      opts.onClick?.();
    });
    root().appendChild(el);
    return {
      el,
      setLabel(t: string) { el.textContent = t; },
      setEnabled(on: boolean) { el.disabled = !on; },
      setVisible(on: boolean) { el.style.display = on ? "" : "none"; },
      destroy() { el.remove(); },
    };
  },

  banner(text: string, opts?: { durationMs?: number; sound?: string | null }) {
    const el = document.createElement("div");
    el.className = "ssp-banner";
    el.textContent = text;
    root().appendChild(el);
    requestAnimationFrame(() => {
      el.style.transition = "transform 260ms cubic-bezier(.34,1.56,.64,1), opacity 160ms ease-out";
      el.style.transform = "translate(-50%,-50%) scale(1)";
      el.style.opacity = "1";
    });
    const dur = opts?.durationMs ?? 1500;
    const sound = opts?.sound === undefined ? "ui.click" : opts.sound;
    if (sound) audio.sfx.play(sound);
    const timer = setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translate(-50%,-50%) scale(1.15)";
      setTimeout(() => el.remove(), 200);
    }, dur);
    return {
      el,
      destroy() { clearTimeout(timer); el.remove(); },
    };
  },

  toast(text: string, opts?: { durationMs?: number }) {
    const el = document.createElement("div");
    el.className = "ssp-toast";
    el.textContent = text;
    root().appendChild(el);
    el.style.transition = "opacity 200ms ease-out";
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 220);
    }, opts?.durationMs ?? 1600);
    return { el, destroy() { el.remove(); } };
  },

  popup(opts: PopupOpts) {
    const scrim = document.createElement("div");
    scrim.style.cssText = `position:fixed;inset:0;background:${palette.overlay};display:flex;align-items:center;justify-content:center;`;
    const card = document.createElement("div");
    card.style.cssText = `background:${palette.cream};border:5px solid ${palette.ink};border-radius:28px;padding:26px 30px;max-width:82vw;box-shadow:0 8px 0 ${palette.ink};text-align:center;color:${palette.ink};transform:scale(0.7);transition:transform 200ms cubic-bezier(.34,1.56,.64,1);`;
    const title = document.createElement("div");
    title.style.cssText = "font-size:28px;font-weight:700;margin-bottom:10px;";
    title.textContent = opts.title;
    const body = document.createElement("div");
    body.style.cssText = "font-size:17px;opacity:0.85;margin-bottom:18px;white-space:pre-line;";
    body.textContent = opts.body ?? "";
    card.append(title, body);
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:12px;justify-content:center;flex-wrap:wrap;";
    for (const b of opts.buttons ?? []) {
      const btn = ui.button({ label: b.label, kind: b.kind, onClick: b.onClick, sound: "ui.click" });
      btnRow.appendChild(btn.el);
    }
    card.appendChild(btnRow);
    scrim.appendChild(card);
    root().appendChild(scrim);
    requestAnimationFrame(() => (card.style.transform = "scale(1)"));
    const sound = opts.sound === undefined ? "ui.click" : opts.sound;
    if (sound) audio.sfx.play(sound);
    return {
      el: scrim,
      destroy() { scrim.remove(); },
    };
  },

  coinCounter(targetEl: HTMLElement, start: number, _opts?: unknown) {
    let value = start;
    targetEl.textContent = String(value);
    return {
      set(v: number) { value = v; targetEl.textContent = String(v); },
      add(delta: number) { value += delta; targetEl.textContent = String(value); },
      tweenTo(v: number, ms = 500) {
        const from = value;
        const t0 = performance.now();
        const step = (t: number) => {
          const p = Math.min(1, (t - t0) / ms);
          value = Math.round(from + (v - from) * (1 - Math.pow(1 - p, 3)));
          targetEl.textContent = String(value);
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
    };
  },

  confettiBurst(x?: number, y?: number, opts?: { count?: number; colors?: string[] }) {
    const count = opts?.count ?? 60;
    const colors = opts?.colors ?? [palette.sun, palette.candy, palette.mint, palette.bubble, palette.berry];
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      const size = 6 + Math.random() * 8;
      const cx = x ?? window.innerWidth / 2;
      const cy = y ?? window.innerHeight / 2;
      p.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;width:${size}px;height:${size * 0.6}px;background:${colors[i % colors.length]};border-radius:2px;pointer-events:none;`;
      const angle = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 240;
      const vx = Math.cos(angle) * dist;
      const vy = Math.sin(angle) * dist - 180;
      root().appendChild(p);
      p.animate(
        [
          { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
          { transform: `translate(${vx}px, ${vy + 260}px) rotate(${360 + Math.random() * 720}deg)`, opacity: 0.9 },
        ],
        { duration: 900 + Math.random() * 700, easing: "cubic-bezier(.2,.6,.4,1)" }
      ).onfinish = () => p.remove();
    }
  },

  hud() {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;right:0;top:0;padding:8px 10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;pointer-events:none;";
    root().appendChild(el);
    return {
      el,
      update(_players: unknown[], _opts?: unknown) {
        // Wave 2 wires the real HUD rendering.
      },
      destroy() { el.remove(); },
    };
  },

  clearScreen() {
    if (uiRoot) uiRoot.innerHTML = "";
  },
};
