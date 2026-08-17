/**
 * SUPER STAR PARTY — settings panel popup.
 * Chunky sliders for music + SFX volume (call the audio engine, wrapped in
 * try/catch so a stubbed engine never breaks the UI), a mute toggle and a
 * close button. Esc also closes.
 */
import { injectStyles } from "./styles";
import { button } from "./button";
import { popup } from "./popup";
import {
  sfx,
  getMasterGain,
  setMasterGain,
  getMusicGain,
  setMusicGain,
  getSfxGain,
  setSfxGain,
} from "./sound";

export interface SettingsPanelHandle {
  el: HTMLElement;
  destroy(): void;
}

export function settingsPanel(): SettingsPanelHandle {
  injectStyles();

  let lastMaster = 0.8;
  try {
    const g = getMasterGain();
    if (g > 0.001) lastMaster = g;
  } catch {
    /* ignore */
  }
  let muted = false;
  try {
    muted = getMasterGain() <= 0.001;
  } catch {
    /* ignore */
  }

  const body = document.createElement("div");
  body.className = "ssp-settings";

  function sliderRow(
    label: string,
    initial: number,
    apply: (v: number) => void,
    musicStyle: boolean
  ): { row: HTMLDivElement; input: HTMLInputElement } {
    const row = document.createElement("div");
    row.className = "ssp-settings__row";

    const lab = document.createElement("div");
    lab.className = "ssp-settings__label";
    const labName = document.createElement("span");
    labName.textContent = label;
    const pct = document.createElement("span");
    pct.className = "ssp-settings__pct";
    const fmt = (v: number): string => `${Math.round(v * 100)}%`;
    pct.textContent = fmt(initial);
    lab.append(labName, pct);

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(initial);
    input.className = `ssp-slider${musicStyle ? " ssp-slider--music" : ""}`;
    input.setAttribute("aria-label", `${label} volume`);

    input.addEventListener("input", () => {
      const v = Number(input.value);
      pct.textContent = fmt(v);
      try {
        apply(v);
      } catch {
        /* audio stub — UI never breaks */
      }
    });
    input.addEventListener("change", () => sfx("ui.click"));

    row.append(lab, input);
    return { row, input };
  }

  const musicRow = sliderRow("MUSIC", getMusicGain(), (v) => setMusicGain(v), true);
  const sfxRow = sliderRow("SFX", getSfxGain(), (v) => setSfxGain(v), false);
  body.append(musicRow.row, sfxRow.row);

  const muteBtn = button({
    label: muted ? "UNMUTE" : "MUTE",
    kind: "ghost",
    sound: "ui.click",
    onClick: () => {
      muted = !muted;
      try {
        if (muted) {
          const g = getMasterGain();
          if (g > 0.001) lastMaster = g;
          setMasterGain(0);
        } else {
          setMasterGain(lastMaster > 0.001 ? lastMaster : 0.8);
        }
      } catch {
        /* ignore */
      }
      muteBtn.setLabel(muted ? "UNMUTE" : "MUTE");
      muteBtn.el.setAttribute("aria-pressed", String(muted));
    },
  });
  muteBtn.el.setAttribute("aria-pressed", String(muted));

  const pop = popup({ title: "SETTINGS", sound: "ui.click", closeOnEsc: true });

  const closeBtn = button({
    label: "CLOSE",
    kind: "gold",
    sound: "ui.back",
    onClick: () => pop.destroy(),
  });

  const btnRow = document.createElement("div");
  btnRow.className = "ssp-settings__mute-row";
  btnRow.append(muteBtn.el, closeBtn.el);
  body.appendChild(btnRow);

  pop.card.appendChild(body);

  try {
    musicRow.input.focus();
  } catch {
    /* ignore */
  }

  return { el: pop.el, destroy: pop.destroy };
}
