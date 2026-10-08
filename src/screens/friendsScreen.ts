/**
 * SUPER STAR PARTY — friends lobby. 4-letter code, 2–4 humans, CPUs
 * fill the empty seats. The host starts the match.
 */
import { roster } from "../characters/roster";
import { palette } from "../config/palette";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { screens } from "./screenManager";
import type { Screen } from "./screenManager";
import {
  createRoom,
  cycleSeatKind,
  joinRoom,
  partyView,
  setPartyHooks,
  setPlannedTurns,
  startFromLobby,
  subscribeParty,
} from "../net/session";

const TURN_CHOICES = [3, 5, 10];

let styleInjected = false;

function injectStyles(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.id = "ssp-friends-styles";
  style.textContent = `
    .ssp-friends {
      position: fixed; inset: 0; z-index: 70;
      display: flex; align-items: center; justify-content: center;
      padding: calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px));
      font-family: Fredoka, sans-serif;
      box-sizing: border-box;
    }
    .ssp-friends__card {
      width: min(440px, 94vw);
      max-height: min(90vh, 760px);
      overflow: auto;
      background: ${palette.cream};
      border: 5px solid ${palette.ink};
      border-radius: 28px;
      box-shadow: 0 8px 0 ${palette.ink};
      padding: 20px 18px 22px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .ssp-friends__title {
      margin: 0; text-align: center; color: ${palette.ink};
      font-size: clamp(26px, 7vw, 36px); line-height: 1;
    }
    .ssp-friends__blurb {
      margin: 0; text-align: center; color: ${palette.ink}; font-size: 15px;
    }
    .ssp-friends__code {
      text-align: center; letter-spacing: 8px;
      font-size: 40px; font-weight: 700; color: ${palette.candy};
      text-shadow: 2px 2px 0 ${palette.ink};
    }
    .ssp-friends__row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
    .ssp-friends__seat {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      background: ${palette.white}; border: 3px solid ${palette.ink}; border-radius: 16px;
      padding: 8px 10px; font-weight: 700; color: ${palette.ink};
    }
    .ssp-friends__input {
      width: 100%; box-sizing: border-box;
      font-family: inherit; font-size: 28px; font-weight: 700;
      letter-spacing: 8px; text-align: center; text-transform: uppercase;
      border: 4px solid ${palette.ink}; border-radius: 16px; padding: 8px;
      color: ${palette.ink}; background: ${palette.white};
    }
    .ssp-friends__err { color: ${palette.lava}; font-weight: 700; text-align: center; margin: 0; }
  `;
  document.head.appendChild(style);
}

const friendsImpl = {
  id: "friends",
  _root: undefined as HTMLDivElement | undefined,
  _off: undefined as (() => void) | undefined,
  _input: undefined as HTMLInputElement | undefined,

  enter() {
    injectStyles();
    ui.clearScreen();
    setPartyHooks({
      onStart: () => screens.goto("board"),
      onLeave: () => screens.goto("title"),
    });
    const root = document.createElement("div");
    root.className = "ssp-friends";
    document.body.appendChild(root);
    this._root = root;
    this._off = subscribeParty(() => this._render());
    this._render();
  },

  _render() {
    const root = this._root;
    if (!root) return;
    const view = partyView();
    const card = document.createElement("div");
    card.className = "ssp-friends__card";

    const title = document.createElement("h1");
    title.className = "ssp-friends__title";
    title.textContent = "WITH FRIENDS";
    const blurb = document.createElement("p");
    blurb.className = "ssp-friends__blurb";
    blurb.textContent = "Friends-only room. Share the 4-letter code. Empty seats are CPUs.";
    card.append(title, blurb);

    if (!view.code) {
      const create = ui.button({
        label: "CREATE ROOM",
        kind: "gold",
        size: "lg",
        onClick: () => {
          audio.sfx.play("pop");
          createRoom();
        },
      });
      create.el.dataset.party = "create";
      const input = document.createElement("input");
      input.className = "ssp-friends__input";
      input.maxLength = 4;
      input.placeholder = "CODE";
      input.setAttribute("aria-label", "Room code");
      input.dataset.party = "code";
      input.autocapitalize = "characters";
      this._input = input;
      const join = ui.button({
        label: "JOIN",
        kind: "primary",
        size: "lg",
        onClick: () => {
          const err = joinRoom(input.value);
          if (err) {
            const note = root.querySelector(".ssp-friends__err");
            if (note) note.textContent = err;
          }
        },
      });
      join.el.dataset.party = "join";
      const back = ui.button({
        label: "BACK",
        kind: "ghost",
        size: "md",
        onClick: () => screens.goto("title"),
      });
      card.append(create.el, input, join.el, back.el);
    } else if (view.seats.length === 0) {
      const wait = document.createElement("p");
      wait.className = "ssp-friends__blurb";
      wait.textContent = `Joining ${view.code}…`;
      card.append(wait);
    } else {
      const code = document.createElement("div");
      code.className = "ssp-friends__code";
      code.dataset.partyCode = view.code;
      code.textContent = view.code;
      const humans = document.createElement("p");
      humans.className = "ssp-friends__blurb";
      humans.dataset.partyHumans = String(view.humans);
      humans.textContent = `${view.humans} human${view.humans === 1 ? "" : "s"} · CPUs fill the rest`;
      card.append(code, humans);

      for (const seat of view.seats) {
        const row = document.createElement("div");
        row.className = "ssp-friends__seat";
        const who = roster.find((c) => c.key === seat.kind);
        const label = document.createElement("span");
        const tag = seat.peerId === view.peerId ? "YOU" : seat.peerId ? seat.name : "CPU";
        label.textContent = `P${seat.index + 1} ${who?.name ?? seat.kind} · ${tag}`;
        row.appendChild(label);
        const mine = seat.peerId === view.peerId;
        const cpu = seat.peerId === null;
        if (mine || (view.host && cpu)) {
          const cycle = ui.button({
            label: "CHAR",
            kind: "ghost",
            size: "sm",
            onClick: () => cycleSeatKind(seat.index),
          });
          cycle.el.dataset.partySeat = String(seat.index);
          row.appendChild(cycle.el);
        }
        card.appendChild(row);
      }

      if (view.host) {
        const turns = document.createElement("div");
        turns.className = "ssp-friends__row";
        for (const n of TURN_CHOICES) {
          const btn = ui.button({
            label: `${n} TURNS`,
            kind: view.turns === n ? "gold" : "ghost",
            size: "sm",
            onClick: () => setPlannedTurns(n),
          });
          btn.el.dataset.partyTurns = String(n);
          turns.appendChild(btn.el);
        }
        card.appendChild(turns);
        const start = ui.button({
          label: "START MATCH",
          kind: "gold",
          size: "lg",
          disabled: view.humans < 2,
          onClick: () => {
            const err = startFromLobby();
            if (err) lobbyError(card, err);
          },
        });
        start.el.dataset.party = "start";
        card.appendChild(start.el);
      } else {
        const wait = document.createElement("p");
        wait.className = "ssp-friends__blurb";
        wait.textContent = "Waiting for the host to start.";
        card.appendChild(wait);
      }
    }

    if (view.error) {
      const err = document.createElement("p");
      err.className = "ssp-friends__err";
      err.textContent = view.error;
      card.appendChild(err);
    }

    root.replaceChildren(card);
  },

  update() {},
  render() {},

  exit() {
    this._off?.();
    this._off = undefined;
    this._root?.remove();
    this._root = undefined;
  },
};

function lobbyError(card: HTMLElement, text: string): void {
  let err = card.querySelector(".ssp-friends__err");
  if (!err) {
    err = document.createElement("p");
    err.className = "ssp-friends__err";
    card.appendChild(err);
  }
  err.textContent = text;
}

export const friendsScreen = friendsImpl as Screen;
