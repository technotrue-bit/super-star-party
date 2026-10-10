/**
 * SUPER STAR PARTY — board picker: Carnival / Downtown / Random.
 * One small segmented row plus a one-line blurb for the selected option.
 * Used by character select (inside the Match settings card) and by the
 * host's friends lobby. Taps save through setBoardRule().
 */
import { palette } from "../config/palette";
import { audio } from "../audio/audioEngine";
import { BOARDS, boardIds, type BoardRule } from "../board/registry";
import { readPersistedRules, setBoardRule } from "../minigames/packRules";

const RANDOM_BLURB = "A surprise board each match";

/** Short button labels. The carnival reads "Carnival"; others use the registry name. */
export function boardRuleLabel(rule: BoardRule): string {
  if (rule === "random") return "Random";
  if (rule === "fizzy-fairground") return "Carnival";
  return BOARDS[rule].name;
}

export function boardRuleBlurb(rule: BoardRule): string {
  return rule === "random" ? RANDOM_BLURB : BOARDS[rule].blurb;
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById("ssp-board-picker-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-board-picker-styles";
  style.textContent = `
    .ssp-bp { display: flex; flex-direction: column; gap: 4px; font-family: 'Fredoka', 'Comic Sans MS', sans-serif; color: ${palette.ink}; }
    .ssp-bp__row { display: flex; gap: 5px; }
    .ssp-bp-btn {
      font-family: inherit; flex: 1 1 0; min-width: 0;
      min-height: 34px; padding: 0 6px;
      font-size: 13px; font-weight: 700; line-height: 1;
      border-radius: 12px; border: 3px solid ${palette.ink};
      background: ${palette.white}; color: ${palette.ink};
      box-shadow: 2px 2px 0 ${palette.ink}; cursor: pointer;
    }
    .ssp-bp-btn:active { transform: translateY(1px); box-shadow: 1px 1px 0 ${palette.ink}; }
    .ssp-bp-btn--on { background: ${palette.sun}; box-shadow: 0 0 0 2px ${palette.candy}, 2px 2px 0 2px ${palette.ink}; }
    .ssp-bp__blurb { margin: 0; font-size: 12px; font-weight: 600; line-height: 1.2; color: ${palette.inkSoft}; }
    .ssp-bp--compact .ssp-bp-btn { min-height: 30px; font-size: 12px; }
    .ssp-bp--compact .ssp-bp__blurb { font-size: 11px; }
  `;
  document.head.appendChild(style);
}

export interface BoardPickerHandle {
  el: HTMLElement;
  refresh(): void;
  destroy(): void;
}

/** `onChange` fires after a tap has been saved (the friends host re-broadcasts the lobby). */
export function mountBoardPicker(opts?: { compact?: boolean; onChange?: (rule: BoardRule) => void }): BoardPickerHandle {
  injectStyles();
  const root = document.createElement("div");
  root.className = `ssp-bp${opts?.compact ? " ssp-bp--compact" : ""}`;

  const paint = (): void => {
    root.replaceChildren();
    const current = readPersistedRules().board;
    const row = document.createElement("div");
    row.className = "ssp-bp__row";
    const rules: BoardRule[] = [...boardIds(), "random"];
    for (const rule of rules) {
      const on = rule === current;
      const b = document.createElement("button");
      b.type = "button";
      b.className = `ssp-bp-btn${on ? " ssp-bp-btn--on" : ""}`;
      b.textContent = boardRuleLabel(rule);
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("data-ssp-role", "board");
      b.setAttribute("data-ssp-board", rule);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          audio.sfx.play("pop");
        } catch {
          /* audio stub */
        }
        setBoardRule(rule);
        paint();
        opts?.onChange?.(rule);
      });
      row.appendChild(b);
    }
    const blurb = document.createElement("p");
    blurb.className = "ssp-bp__blurb";
    blurb.textContent = boardRuleBlurb(current);
    root.append(row, blurb);
  };

  paint();
  return { el: root, refresh: paint, destroy: () => root.remove() };
}
