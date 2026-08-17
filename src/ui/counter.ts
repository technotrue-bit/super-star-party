/**
 * SUPER STAR PARTY — coin counter.
 * set/add/tweenTo with cubic ease-out (~500ms default) plus a little
 * scale pop and a coin cha-ching sound when the value changes.
 */
import { sfx } from "./sound";

export interface CoinCounterOpts {
  durationMs?: number;
  /** Play coin.gain / coin.lose on change. Default true. */
  sound?: boolean;
}

export interface CoinCounterHandle {
  set(v: number): void;
  add(delta: number): void;
  tweenTo(v: number, ms?: number): void;
  /** Current displayed value (read-only-ish). */
  value(): number;
}

const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);

export function coinCounter(
  targetEl: HTMLElement,
  start: number,
  opts?: CoinCounterOpts
): CoinCounterHandle {
  let value = Math.max(0, Math.round(start));
  const withSound = opts?.sound ?? true;

  const render = (): void => {
    targetEl.textContent = String(value);
  };

  const pop = (): void => {
    try {
      targetEl.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.28)", offset: 0.35 },
          { transform: "scale(1)" },
        ],
        { duration: 220, easing: "cubic-bezier(.34,1.56,.64,1)" }
      );
    } catch {
      /* animation unavailable — counter still works */
    }
  };

  const playCoin = (delta: number): void => {
    if (!withSound) return;
    sfx(delta >= 0 ? "coin.gain" : "coin.lose");
  };

  render();

  return {
    set(v: number) {
      const next = Math.max(0, Math.round(v));
      if (next === value) return;
      value = next;
      render();
      pop();
    },
    add(delta: number) {
      const prev = value;
      const next = Math.max(0, Math.round(value + delta));
      if (next === prev) return;
      value = next;
      render();
      pop();
      playCoin(delta);
    },
    tweenTo(v: number, ms = opts?.durationMs ?? 500) {
      const from = value;
      const to = Math.max(0, Math.round(v));
      if (from === to) return;
      const t0 = performance.now();
      const dur = Math.max(1, ms);
      const step = (t: number): void => {
        const p = Math.min(1, (t - t0) / dur);
        value = Math.round(from + (to - from) * easeOutCubic(p));
        render();
        if (p < 1) {
          requestAnimationFrame(step);
        } else {
          pop();
          playCoin(to - from);
        }
      };
      requestAnimationFrame(step);
    },
    value() {
      return value;
    },
  };
}
