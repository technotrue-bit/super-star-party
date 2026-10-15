/**
 * CONTROL LAB — a hidden test rig for the new control pads.
 *
 * Not a game: it never shows in the MINIGAMES menu or the roulette and is
 * reached only with `?minigame=control_lab&pad=<hold|swipe|twin|dial|draw>`
 * (default hold). It records every input call as a short string into
 * `__SSP__.mgProbe().inputs`, so probes can check the keyboard and touch
 * mappings without a real game in the way. After 30 s it finishes with the
 * ranking [0, 1, 2, 3].
 *
 *   hold:1:0.00   hold:0:0.80      press, release (seconds held)
 *   swipe:0.00:-1.00:0.50          dx, dy, power
 *   button:a:1    button:b:0       which, down
 *   dial:+  dial:-                 sign of one turn step
 *   draw:start  draw:move  draw:end
 *
 * Dial strings carry only the sign, so the running sum of the turn in
 * radians is on `window.__CONTROL_LAB__.dialSum` for probes that need it.
 *
 * Determinism: draws no rng; the clock is the dt it is handed.
 */
import type { Minigame, MinigameContext, MinigamePad } from "../framework";
import { registerMinigame } from "../registry";
import { mgProbeState } from "../../screens/minigameScreen";

const LAB_SECONDS = 30;
const PADS: readonly MinigamePad[] = ["hold", "swipe", "twin", "dial", "draw"];

interface LabTelemetry {
  /** Sum of every dial() delta this round, in radians. */
  dialSum: number;
}

/** The pad asked for in the URL, hold when it is absent or unknown. */
function padFromUrl(): MinigamePad {
  const asked = new URLSearchParams(window.location.search).get("pad");
  return PADS.find((p) => p === asked) ?? "hold";
}

function createControlLab(): Minigame {
  let time = 0;
  let done = false;
  let ctxRef: MinigameContext | null = null;

  const log = (line: string): void => {
    mgProbeState.inputs.push(line);
  };
  const two = (n: number): string => n.toFixed(2);

  return {
    id: "control_lab",
    name: "Control Lab",
    genre: "timing",
    hidden: true,
    pad: padFromUrl(),
    padLabels: { a: "A", b: "B" },
    howTo: "A test rig for the controls. It records every press, swipe, turn and stroke.",
    goal: "Try the controls",
    tap: null,
    steer: false,
    rules: {
      format: "ffa",
      length: "30 seconds",
      win: "Nobody wins: this is a test rig",
      touch: ["Use the control on screen"],
      keys: ["Space, arrows, Z, X, Q, E or the mouse, by pad"],
    },

    setup(ctx: MinigameContext): void {
      ctxRef = ctx;
      time = 0;
      done = false;
      const telemetry: LabTelemetry = { dialSum: 0 };
      (window as unknown as { __CONTROL_LAB__?: LabTelemetry }).__CONTROL_LAB__ = telemetry;
      ctx.input.hold = (down, heldSec) => log(`hold:${down ? 1 : 0}:${two(heldSec)}`);
      ctx.input.swipe = (dx, dy, power) => log(`swipe:${two(dx)}:${two(dy)}:${two(power)}`);
      ctx.input.button = (which, down) => log(`button:${which}:${down ? 1 : 0}`);
      ctx.input.dial = (deltaRad) => {
        telemetry.dialSum += deltaRad;
        log(`dial:${deltaRad < 0 ? "-" : "+"}`);
      };
      ctx.input.draw = (phase) => log(`draw:${phase}`);
    },

    update(dt: number): void {
      if (done || !ctxRef) return;
      time += dt;
      if (time >= LAB_SECONDS) {
        done = true;
        ctxRef.finish([0, 1, 2, 3]);
      }
    },

    teardown(): void {
      ctxRef = null;
      delete (window as unknown as { __CONTROL_LAB__?: LabTelemetry }).__CONTROL_LAB__;
    },
  };
}

registerMinigame({ id: "control_lab", name: "Control Lab", hidden: true });

export function loadControlLab(): Promise<Minigame> {
  return Promise.resolve(createControlLab());
}
