/**
 * SUPER STAR PARTY — shared UI stylesheet.
 * Injected exactly once, id "ssp-ui-styles". All colors come from
 * src/config/palette.ts (single source of truth). All animations animate
 * transform/opacity only (GPU-friendly). No external assets.
 */
import { palette } from "../config/palette";

let injected = false;

/** Inject the shared SSP stylesheet once (id "ssp-ui-styles"). */
export function injectStyles(): void {
  if (injected) return;
  injected = true;
  if (document.getElementById("ssp-ui-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-ui-styles";
  style.textContent = `
/* ================= SSP UI KIT — shared chrome ================= */
/* Board-screen DOM UI (ROLL button, dice, item bar — appended straight to
   document.body, outside .ssp-ui) inherits the kit's Fredoka face too. */
body {
  font-family: 'Fredoka', 'Comic Sans MS', sans-serif;
  -webkit-font-smoothing: antialiased;
}
.ssp-ui {
  position: fixed; inset: 0; z-index: 50;
  pointer-events: none;
  font-family: 'Fredoka', 'Comic Sans MS', sans-serif;
  user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.ssp-ui * { box-sizing: border-box; }
.ssp-btn, .ssp-popup, .ssp-hud-chip { pointer-events: auto; }
.ssp-hud, .ssp-banner, .ssp-toast, .ssp-confetti,
.ssp-confetti__piece, .ssp-avatar { pointer-events: none; }

/* ---------------------- buttons ---------------------- */
.ssp-btn {
  font-family: inherit; font-weight: 700; color: ${palette.white};
  background:
    linear-gradient(180deg, rgba(255,255,255,.38) 0%, rgba(255,255,255,0) 42%),
    linear-gradient(180deg, ${palette.candy} 0%, ${palette.candyDeep} 100%);
  border: 4px solid ${palette.ink}; border-radius: 999px;
  box-shadow: 0 5px 0 ${palette.ink};
  text-shadow: 0 2px 0 rgba(43,29,78,.30);
  cursor: pointer;
  min-height: 48px; padding: 10px 26px; font-size: 20px; line-height: 1.1;
  touch-action: manipulation;
  transition: transform 90ms ease-out, box-shadow 90ms ease-out,
              background-color 120ms ease-out, filter 120ms ease-out;
}
.ssp-btn:hover:not(:disabled) { transform: scale(1.06); }
.ssp-btn:active:not(:disabled) { transform: scale(0.96) translateY(3px); box-shadow: 0 2px 0 ${palette.ink}; }
.ssp-btn:disabled {
  cursor: default; opacity: .72;
  filter: grayscale(.8) brightness(.85);
  box-shadow: 0 3px 0 ${palette.inkSoft};
  border-color: ${palette.inkSoft};
}
.ssp-btn:focus-visible { outline: 3px solid ${palette.bubble}; outline-offset: 3px; }
.ssp-btn:focus:not(:focus-visible) { outline: none; }
.ssp-btn--gold {
  color: ${palette.ink};
  background:
    linear-gradient(180deg, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 42%),
    linear-gradient(180deg, ${palette.sun} 0%, ${palette.sunDeep} 100%);
  text-shadow: 0 2px 0 rgba(255,255,255,.35);
}
.ssp-btn--ghost { background: rgba(255,255,255,.16); }
.ssp-btn--ghost:hover:not(:disabled) { background: rgba(255,255,255,.30); }
.ssp-btn--danger {
  background:
    linear-gradient(180deg, rgba(255,255,255,.35) 0%, rgba(255,255,255,0) 42%),
    linear-gradient(180deg, ${palette.lava} 0%, ${palette.lavaDeep} 100%);
}
.ssp-btn--sm { min-height: 48px; padding: 6px 18px; font-size: 15px; }
.ssp-btn--md { min-height: 48px; padding: 10px 26px; font-size: 20px; }
.ssp-btn--lg { min-height: 56px; padding: 13px 38px; font-size: 26px; }
.ssp-btn__icon { margin-right: 8px; }
.ssp-btn__label { display: inline-block; }

/* ---------------------- banner ---------------------- */
.ssp-banner {
  position: absolute; left: 50%; top: 36%;
  transform: translate(-50%,-50%) scale(.6);
  opacity: 0; z-index: 80;
  font-weight: 700;
  font-size: clamp(34px, 7vw, 72px);
  line-height: 1.05; color: ${palette.white};
  text-align: center; max-width: 94vw;
  text-shadow:
    0 3px 0 ${palette.ink}, 3px 0 0 ${palette.ink}, -3px 0 0 ${palette.ink}, 0 -3px 0 ${palette.ink},
    2px 2px 0 ${palette.ink}, -2px 2px 0 ${palette.ink}, 2px -2px 0 ${palette.ink}, -2px -2px 0 ${palette.ink},
    0 6px 0 ${palette.ink};
  will-change: transform, opacity;
  transition: transform 300ms cubic-bezier(.34,1.56,.64,1), opacity 160ms ease-out;
}
.ssp-banner--show { transform: translate(-50%,-50%) scale(1); opacity: 1; }
.ssp-banner--out { transform: translate(-50%,-50%) scale(1.15) !important; opacity: 0 !important; }

/* ---------------------- toast ---------------------- */
.ssp-toast {
  position: absolute; left: 50%; bottom: calc(10% + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%) translateY(10px);
  background: ${palette.ink}; color: ${palette.white};
  border: 3px solid ${palette.cream};
  border-radius: 999px;
  padding: 10px 22px;
  font-size: 16px; font-weight: 600;
  box-shadow: 0 4px 0 rgba(0,0,0,.35);
  opacity: 0; z-index: 70;
  white-space: nowrap; max-width: 88vw;
  overflow: hidden; text-overflow: ellipsis;
  transition: opacity 220ms ease-out, transform 220ms ease-out;
}
.ssp-toast--show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* ---------------------- popup ---------------------- */
.ssp-popup {
  position: absolute; inset: 0; z-index: 60;
  background: ${palette.overlay};
  display: flex; align-items: center; justify-content: center;
  padding: calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px));
  opacity: 0; transition: opacity 180ms ease-out;
}
.ssp-popup--show { opacity: 1; }
.ssp-popup__card {
  background: linear-gradient(180deg, ${palette.white} 0%, ${palette.cream} 55%, ${palette.creamShadow} 100%);
  border: 5px solid ${palette.ink}; border-radius: 28px;
  padding: 24px 28px;
  max-width: min(88vw, 440px); max-height: min(82dvh, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px)); overflow-y: auto;
  box-shadow: 0 9px 0 ${palette.ink};
  color: ${palette.ink}; text-align: center;
  transform: rotate(-2deg) scale(.72);
  transition: transform 260ms cubic-bezier(.34,1.56,.64,1);
  will-change: transform;
}
.ssp-popup--show .ssp-popup__card { transform: rotate(0deg) scale(1); }
.ssp-popup__title { font-size: clamp(22px, 5.5vw, 30px); font-weight: 700; margin: 0 0 8px; }
.ssp-popup__body { font-size: 17px; line-height: 1.5; color: ${palette.inkSoft}; margin: 0 0 16px; white-space: pre-line; }
.ssp-popup__buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 4px; }

/* ---------------------- settings panel ---------------------- */
.ssp-settings { width: min(82vw, 340px); text-align: left; }
.ssp-settings__row { margin-bottom: 14px; }
.ssp-settings__label {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 15px; font-weight: 700; color: ${palette.ink};
  margin-bottom: 2px; letter-spacing: .04em;
}
.ssp-settings__pct { font-size: 13px; font-weight: 600; color: ${palette.inkSoft}; }
.ssp-slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 36px; background: transparent;
  touch-action: manipulation; cursor: pointer; margin: 0;
}
.ssp-slider:focus-visible { outline: 3px solid ${palette.bubble}; outline-offset: 2px; border-radius: 999px; }
.ssp-slider::-webkit-slider-runnable-track {
  height: 12px; border-radius: 999px;
  background: ${palette.creamShadow}; border: 2px solid ${palette.ink};
}
.ssp-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 26px; height: 26px; border-radius: 50%; margin-top: -5px;
  background: linear-gradient(180deg, ${palette.candy} 0%, ${palette.candyDeep} 100%);
  border: 3px solid ${palette.ink}; box-shadow: 0 3px 0 ${palette.ink};
  transition: transform 90ms ease-out;
}
.ssp-slider:active::-webkit-slider-thumb { transform: scale(1.18); }
.ssp-slider::-moz-range-track {
  height: 12px; border-radius: 999px;
  background: ${palette.creamShadow}; border: 2px solid ${palette.ink};
}
.ssp-slider::-moz-range-thumb {
  width: 26px; height: 26px; border-radius: 50%;
  background: linear-gradient(180deg, ${palette.candy} 0%, ${palette.candyDeep} 100%);
  border: 3px solid ${palette.ink}; box-shadow: 0 3px 0 ${palette.ink};
}
.ssp-slider--music::-webkit-slider-thumb { background: linear-gradient(180deg, ${palette.sun} 0%, ${palette.sunDeep} 100%); }
.ssp-slider--music::-moz-range-thumb { background: linear-gradient(180deg, ${palette.sun} 0%, ${palette.sunDeep} 100%); }
.ssp-settings__mute-row { display: flex; justify-content: center; gap: 10px; margin-top: 6px; }

/* ---------------------- avatar ---------------------- */
.ssp-avatar {
  position: relative;
  width: 48px; height: 48px; border-radius: 50%;
  border: 3px solid ${palette.ink};
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 22px; color: ${palette.white};
  text-shadow: 0 2px 0 rgba(43,29,78,.35);
  box-shadow:
    0 4px 0 rgba(43,29,78,.55),
    inset 0 -4px 0 rgba(43,29,78,.18),
    inset 0 3px 0 rgba(255,255,255,.35);
}
.ssp-avatar::after {
  content: ""; position: absolute; top: 7px; left: 10px;
  width: 13px; height: 8px; border-radius: 50%;
  background: rgba(255,255,255,.55); transform: rotate(-18deg);
}

/* ---------------------- HUD ---------------------- */
.ssp-hud {
  position: absolute; top: 0; left: 0; right: 0; z-index: 40;
  display: flex; flex-wrap: wrap; justify-content: center;
  gap: 8px;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) 8px 0;
}
.ssp-hud-chip {
  display: flex; align-items: center; gap: 6px;
  background: ${palette.cream};
  border: 3px solid ${palette.ink}; border-radius: 999px;
  padding: 4px 10px 4px 5px;
  box-shadow: 0 4px 0 ${palette.ink};
  min-height: 48px; max-width: 150px;
  transition: transform 120ms ease-out, box-shadow 120ms ease-out;
}
.ssp-hud-chip:hover { transform: scale(1.05); }
.ssp-hud-chip__avatar {
  width: 30px; height: 30px; font-size: 15px; flex: none;
  border-width: 2px;
  box-shadow: 0 2px 0 rgba(43,29,78,.5), inset 0 -2px 0 rgba(43,29,78,.18), inset 0 2px 0 rgba(255,255,255,.35);
}
.ssp-hud-chip__avatar::after { display: none; }
.ssp-hud-chip__info { display: flex; flex-direction: column; min-width: 0; }
.ssp-hud-chip__name {
  font-size: 13px; font-weight: 700; color: ${palette.ink};
  line-height: 1.15; max-width: 64px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ssp-hud-chip__stats {
  display: flex; align-items: center; gap: 3px;
  font-size: 14px; font-weight: 700; color: ${palette.ink}; line-height: 1.2;
}
.ssp-hud-chip__stats > span { display: inline-block; min-width: 9px; }
.ssp-hud-coin {
  width: 10px; height: 10px; border-radius: 50%; flex: none;
  background:
    radial-gradient(circle at 35% 30%, rgba(255,255,255,.8) 0%, rgba(255,255,255,0) 42%),
    linear-gradient(180deg, ${palette.sun} 0%, ${palette.sunDeep} 100%);
  border: 1.5px solid ${palette.ink};
}
.ssp-hud-star { color: ${palette.sun}; font-size: 11px; text-shadow: 0 1px 0 ${palette.ink}; line-height: 1; }
.ssp-hud-mini { color: ${palette.mint}; font-size: 9px; text-shadow: 0 1px 0 ${palette.ink}; line-height: 1; }
.ssp-hud-chip--active {
  box-shadow: 0 0 0 3px ${palette.sun}, 0 6px 0 ${palette.ink}, 0 0 18px rgba(255,210,63,.85);
  transform: scale(1.06);
  animation: ssp-hud-bounce 0.9s ease-in-out infinite;
}
.ssp-hud-chip--active .ssp-hud-chip__avatar { box-shadow: 0 2px 0 rgba(43,29,78,.5), 0 0 10px rgba(255,210,63,.9); }
@keyframes ssp-hud-bounce {
  0%, 100% { transform: scale(1.06) translateY(0); }
  50% { transform: scale(1.06) translateY(-4px); }
}
.ssp-hud-banner {
  position: absolute; top: calc(100% + 6px); left: 50%;
  transform: translateX(-50%) scale(.6); opacity: 0;
  font-size: clamp(20px, 4.6vw, 30px); font-weight: 700; color: ${palette.white};
  text-align: center; max-width: 92vw; white-space: nowrap;
  text-shadow:
    0 2px 0 ${palette.ink}, 2px 0 0 ${palette.ink}, -2px 0 0 ${palette.ink}, 0 -2px 0 ${palette.ink},
    2px 2px 0 ${palette.ink}, -2px 2px 0 ${palette.ink}, 2px -2px 0 ${palette.ink}, -2px -2px 0 ${palette.ink},
    0 4px 0 ${palette.ink};
  transition: transform 260ms cubic-bezier(.34,1.56,.64,1), opacity 150ms ease-out;
}
.ssp-hud-banner--show { transform: translateX(-50%) scale(1); opacity: 1; }
.ssp-hud-banner--out { transform: translateX(-50%) scale(1.12) !important; opacity: 0 !important; }

/* Phone: 2-up chips that clear the pause button and the Dynamic Island. */
@media (max-width: 520px) {
  .ssp-hud {
    justify-content: flex-start;
    padding: calc(env(safe-area-inset-top, 0px) + 8px) calc(env(safe-area-inset-right, 0px) + 70px) 0 calc(env(safe-area-inset-left, 0px) + 8px);
    gap: 6px;
  }
  .ssp-hud-chip {
    flex: 1 1 calc(50% - 8px);
    max-width: none;
    min-height: 48px;
  }
  .ssp-hud-chip__name { max-width: 88px; font-size: 14px; }
  .ssp-hud-star { font-size: 13px; }
  .ssp-hud-mini { font-size: 12px; }
}

/* ---------------------- confetti ---------------------- */
.ssp-confetti { position: absolute; inset: 0; z-index: 90; overflow: hidden; }
.ssp-confetti__piece {
  position: absolute;
  will-change: transform, opacity;
}

/* ---------------------- reduced motion ---------------------- */
@media (prefers-reduced-motion: reduce) {
  .ssp-ui, .ssp-ui * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
  document.head.appendChild(style);
}
