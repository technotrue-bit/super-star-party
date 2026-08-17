/**
 * SUPER STAR PARTY — minigame screen ('minigame').
 *
 * Runs one minigame round end to end:
 *   enter()  -> read the pending entry (set by the turn loop) and build the
 *               arena: lights, party floor, the 4 live avatars, arena
 *               camera, minigame_intro, 3-2-1-GO countdown (minigame.count
 *               per tick, minigame.go + flash on GO), then the minigame
 *               runs with minigame_a/minigame_b (rng-picked).
 *   update() -> countdown -> minigame.update(dt) -> on ctx.finish(ranking):
 *               RESULTS phase — payout (winner +10), minigame:end emit,
 *               fanfare + confetti + winner banner, characters cheer/sulk,
 *               rank popup, ~3.5s later auto-return to the board (the turn
 *               loop resumes its minigame round on re-entry).
 *   exit()   -> minigame.teardown(), dispose characters, sweep every scene
 *               object added since enter, clear UI + listeners, stop music.
 *
 * Robustness: with no pending minigame (or no match) enter() bails straight
 * back to the board, and an unresolvable minigame id does the same — the
 * turn loop's resume path keeps the match moving either way.
 *
 * Determinism: the only rng consumed here is the music-track pick at GO
 * (gameplay rng via src/core/rng). Countdown/results timing is dt-driven;
 * no Math.random/Date.now/performance.now anywhere in the flow.
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { settings } from "../config/settings";
import { match } from "../core/game";
import { rng } from "../core/rng";
import { bus } from "../core/events";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { characterColor } from "../characters/roster";
import { createCharacter, type Character } from "../characters/characterFactory";
import { minigamePayout } from "../game/economy";
import {
  consumePendingMinigame,
  loadMinigame,
  type Minigame,
  type MinigameContext,
  type MinigameEntry,
} from "../minigames/framework";
import type { Screen } from "./screenManager";
import { screens } from "./screenManager";

/* ------------------------------------------------------------------ */
/*  Scoped styles (injected once; every color from the palette)        */
/* ------------------------------------------------------------------ */

let stylesInjected = false;

function injectMinigameStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById("ssp-minigame-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-minigame-styles";
  style.textContent = `
.ssp-mg-count { position:fixed; left:50%; top:36%; transform:translateX(-50%); font-size:112px; font-weight:700; color:${palette.sun}; text-shadow:6px 6px 0 ${palette.ink}, 10px 10px 0 rgba(43,29,78,.35); z-index:80; pointer-events:none; user-select:none; line-height:1; }
.ssp-mg-count--pop { animation:sspMgPop .55s cubic-bezier(.34,1.56,.64,1); }
@keyframes sspMgPop { 0% { transform:translateX(-50%) scale(.2) rotate(-10deg); opacity:0; } 100% { transform:translateX(-50%) scale(1) rotate(0deg); opacity:1; } }
.ssp-mg-count--go { color:${palette.mint}; }
.ssp-mg-flash { position:fixed; inset:0; pointer-events:none; z-index:79; opacity:0; }
.ssp-mg-results { display:flex; flex-direction:column; gap:8px; text-align:left; font-size:17px; }
.ssp-mg-results__row { background:${palette.cream}; border:3px solid ${palette.ink}; border-radius:14px; padding:8px 12px; box-shadow:0 3px 0 ${palette.ink}; }
.ssp-mg-results__row--win { background:${palette.sun}; font-weight:700; }
`;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Keep only valid, unique player ids (winner must be a real player). */
function cleanRanking(ranking: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ranking) {
    if (!Number.isInteger(id)) continue;
    if (seen.has(id)) continue;
    if (!match.players[id]) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Dispose every mesh geometry/material under a root (idempotent). */
function disposeObj(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
  });
}

/* ------------------------------------------------------------------ */
/*  Screen state                                                       */
/* ------------------------------------------------------------------ */

type MgPhase = "countdown" | "play" | "results";

interface MgScreenState {
  _active?: boolean;
  _minigame?: Minigame;
  _ctx?: MinigameContext;
  _chars?: Character[];
  _phase?: MgPhase;
  _countdownT?: number;
  _tick?: number;
  _playT?: number;
  _finished?: boolean;
  _ranking?: number[];
  _resultsT?: number;
  _presented?: boolean;
  _existing?: Set<THREE.Object3D>;
  _present: () => void;
  _beginPlay: () => void;
  _countEl?: HTMLDivElement;
  _flashEl?: HTMLDivElement;
  _onPointerDown?: (e: PointerEvent) => void;
  _onPointerMove?: (e: PointerEvent) => void;
  _onPointerUp?: (e: PointerEvent) => void;
  _onKeyDown?: (e: KeyboardEvent) => void;
}

const COUNT_TICKS = ["3", "2", "1"];

const minigameScreenImpl: MgScreenState & Screen = {
  id: "minigame",

  enter() {
    injectMinigameStyles();
    ui.clearScreen();
    this._presented = false;
    this._finished = false;

    // Robustness: no pending entry (or no live match) -> straight back to
    // the board; the turn loop's resume path continues the round.
    // Debug/critic hook: ?minigame=ID forces a specific minigame.
    let entry = consumePendingMinigame();
    const forced = new URLSearchParams(window.location.search).get("minigame");
    if (forced && match.players.length > 0) {
      entry = { id: forced, name: forced };
    }
    if (!entry || match.players.length === 0) {
      screens.goto("board");
      return;
    }

    this._active = true;

    // ---- arena inside the SHARED scene (main.ts renders world.scene with
    // world.camera — same contract as the board/showcase screens) ----
    // Snapshot existing children: on exit we sweep everything added since.
    this._existing = new Set(world.scene?.children ?? []);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2b1d4e, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(6, 14, 8);
    world.scene?.add(hemi, key);

    // Decorative party floor — the minigame builds the actual arena on top.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(13, 48),
      new THREE.MeshBasicMaterial({ color: hex(palette.grassA) })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    world.scene?.add(ground);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(12.6, 13, 48),
      new THREE.MeshBasicMaterial({ color: hex(palette.grassB) })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.01;
    world.scene?.add(ring);

    // ---- the 4 live avatars, lined up facing the arena centre ----
    this._chars = match.players.map((p, i) => {
      const ch = createCharacter(p.kind);
      const x = (i - (match.players.length - 1) / 2) * 2.4;
      ch.group.position.set(x, 0, 5.4);
      ch.setFacing(Math.PI); // front is +Z; the arena centre is -Z from here
      ch.anim.idle();
      world.scene?.add(ch.group);
      return ch;
    });

    // ---- arena camera (party angle; minigames may reposition it) ----
    const cam = world.camera!;
    const portrait = window.innerWidth / window.innerHeight < 1;
    const dist = portrait ? 46 : 32;
    const elev = 1.05; // ~60deg
    cam.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
    cam.lookAt(0, 0.4, 0);

    // ---- countdown + flash overlay elements ----
    const countEl = document.createElement("div");
    countEl.className = "ssp-mg-count";
    document.body.appendChild(countEl);
    this._countEl = countEl;
    const flashEl = document.createElement("div");
    flashEl.className = "ssp-mg-flash";
    document.body.appendChild(flashEl);
    this._flashEl = flashEl;

    // ---- input routing: pointer (normalized 0..1) + keyboard actions ----
    const px = (e: PointerEvent): [number, number] => [
      Math.min(1, Math.max(0, e.clientX / window.innerWidth)),
      Math.min(1, Math.max(0, e.clientY / window.innerHeight)),
    ];
    this._onPointerDown = (e) => {
      if (this._phase === "play") {
        const [x, y] = px(e);
        this._ctx?.input.pointer(x, y, true);
      }
    };
    this._onPointerMove = (e) => {
      if (this._phase === "play") {
        const [x, y] = px(e);
        this._ctx?.input.pointer(x, y, false);
      }
    };
    this._onPointerUp = (e) => {
      if (this._phase === "play") {
        const [x, y] = px(e);
        this._ctx?.input.pointer(x, y, false);
      }
    };
    this._onKeyDown = (e) => {
      if (this._phase !== "play") return;
      const k = e.key;
      let action: string | null = null;
      if (k === "ArrowUp" || k === "w" || k === "W") action = "up";
      else if (k === "ArrowDown" || k === "s" || k === "S") action = "down";
      else if (k === "ArrowLeft" || k === "a" || k === "A") action = "left";
      else if (k === "ArrowRight" || k === "d" || k === "D") action = "right";
      else if (k === " " || k === "Enter") action = "confirm";
      if (action) {
        e.preventDefault();
        this._ctx?.input.key(action);
      }
    };
    window.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("keydown", this._onKeyDown);

    // ---- resolve the minigame module, then run the round ----
    audio.music.play("minigame_intro", { intensity: 0.8 });
    const startRound = async (): Promise<void> => {
      const mg = await loadMinigame(entry.id);
      if (!this._active) return; // exited while loading
      if (!mg) {
        // Unregistered id — can't play anything: back to the board (the
        // turn loop's resume path continues the match).
        screens.goto("board");
        return;
      }
      this._minigame = mg;

      const self = this;
      const ctx: MinigameContext = {
        players: match.players.map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          color: characterColor(p.kind),
        })),
        characters: self._chars ?? [],
        scene: world.scene!,
        camera: world.camera!,
        rng: () => rng.next(),
        get time(): number {
          return self._playT ?? 0;
        },
        announce: (text, opts) => {
          ui.banner(text, {
            durationMs: opts?.durationMs ?? 1800,
            sound: opts?.sound === undefined ? null : opts.sound,
          });
        },
        playSfx: (name, opts) => audio.sfx.play(name, opts),
        finish: (ranking) => {
          if (self._finished || self._phase !== "play") return;
          const cleaned = cleanRanking(ranking);
          if (cleaned.length === 0) return; // junk ranking — keep playing
          self._finished = true;
          self._ranking = cleaned;
        },
        input: {
          pointer: () => {},
          key: () => {},
        },
      };
      this._ctx = ctx;

      mg.setup(ctx); // build the arena (countdown overlays it)
      this._phase = "countdown";
      this._countdownT = 0;
      this._tick = -1;
    };
    void startRound();
  },

  update(dt: number) {
    for (const ch of this._chars ?? []) ch.update(dt);

    switch (this._phase) {
      case "countdown": {
        // 4 equal beats: 3, 2, 1, GO — then play.
        this._countdownT = (this._countdownT ?? 0) + dt;
        const tick = Math.min(4, Math.floor((this._countdownT ?? 0) / (settings.minigameCountdown / 4)));
        if (tick !== this._tick) {
          this._tick = tick;
          if (tick < 3) {
            const el = this._countEl;
            if (el) {
              el.textContent = COUNT_TICKS[tick];
              el.classList.remove("ssp-mg-count--pop", "ssp-mg-count--go");
              void el.offsetHeight;
              el.classList.add("ssp-mg-count--pop");
            }
            audio.sfx.play("minigame.count");
          } else {
            const el = this._countEl;
            if (el) {
              el.textContent = "GO!";
              el.classList.remove("ssp-mg-count--pop");
              el.classList.add("ssp-mg-count--pop", "ssp-mg-count--go");
            }
            audio.sfx.play("minigame.go");
            const flash = this._flashEl;
            if (flash) {
              flash.style.background = palette.mint;
              try {
                flash.animate(
                  [{ opacity: 0 }, { opacity: 0.5, offset: 0.25 }, { opacity: 0 }],
                  { duration: 500, easing: "ease-out" }
                );
              } catch {
                flash.style.opacity = "0";
              }
            }
          }
        }
        if (tick >= 4) this._beginPlay();
        break;
      }
      case "play": {
        this._playT = (this._playT ?? 0) + dt;
        if (!this._finished) {
          this._minigame?.update(dt);
          // Safety net: a minigame that never calls finish must not hang
          // the match. Deterministic fallback ranking (player id order).
          if (!this._finished && (this._playT ?? 0) > settings.minigameTimeLimit) {
            this._finished = true;
            this._ranking = match.players.map((p) => p.id).sort((a, b) => a - b);
            console.warn("[minigames] time limit reached — forced finish");
          }
        }
        if (this._finished && this._ranking) {
          this._phase = "results";
          this._resultsT = 0.6; // short winner-reveal beat
        }
        break;
      }
      case "results": {
        this._resultsT = (this._resultsT ?? 0) - dt;
        if ((this._resultsT ?? 0) <= 0) {
          if (!this._presented) {
            this._presented = true;
            this._present();
            this._resultsT = 3.5; // hold the podium, then auto-return
          } else {
            screens.goto("board");
            return;
          }
        }
        break;
      }
      default:
        break;
    }
  },

  render() {},

  /** RESULTS beat: payout, fanfare, podium popup (runs once). */
  _present() {
    this._presented = true;
    presentResults(this);
  },

  /** GO! — play begins: minigame music (rng-picked) + minigame:start. */
  _beginPlay() {
    this._phase = "play";
    this._playT = 0;
    audio.music.play(rng.pick(["minigame_a", "minigame_b"]), { intensity: 1 });
    const mg = this._minigame;
    if (mg) bus.emit("minigame:start", { id: mg.id, name: mg.name });
  },

  exit() {
    this._active = false;
    this._minigame?.teardown();
    this._minigame = undefined;
    this._ctx = undefined;
    for (const ch of this._chars ?? []) {
      world.scene?.remove(ch.group);
      ch.dispose();
    }
    this._chars = undefined;
    // Sweep everything added since enter (lights, floor, arena objects,
    // anything a minigame forgot to remove in teardown).
    const existing = this._existing;
    if (existing && world.scene) {
      for (const obj of [...world.scene.children]) {
        if (!existing.has(obj)) {
          world.scene.remove(obj);
          disposeObj(obj);
        }
      }
    }
    this._existing = undefined;
    this._countEl?.remove();
    this._countEl = undefined;
    this._flashEl?.remove();
    this._flashEl = undefined;
    if (this._onPointerDown) window.removeEventListener("pointerdown", this._onPointerDown);
    if (this._onPointerMove) window.removeEventListener("pointermove", this._onPointerMove);
    if (this._onPointerUp) window.removeEventListener("pointerup", this._onPointerUp);
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    this._onPointerDown = undefined;
    this._onPointerMove = undefined;
    this._onPointerUp = undefined;
    this._onKeyDown = undefined;
    this._phase = undefined;
    ui.clearScreen();
    audio.music.stop(0.3);
  },
};

/* ------------------------------------------------------------------ */
/*  Results presentation (private)                                     */
/* ------------------------------------------------------------------ */

function presentResults(self: MgScreenState & Screen): void {
  const mg = self._minigame;
  const ranking = self._ranking ?? [];
  const winner = ranking[0];
  const winnerPlayer = match.players[winner];
  const coins = settings.minigameWinCoins;

  // Payout + match bookkeeping (Mini Star needs the win counted).
  minigamePayout(winner);
  if (winnerPlayer) winnerPlayer.minigameWins += 1;
  bus.emit("minigame:end", { id: mg?.id ?? "?", winner, coins });

  // Juice: fanfare, win track, confetti, banner.
  audio.sfx.play("fanfare.win");
  audio.music.play("win", { intensity: 0.9 });
  ui.confettiBurst(undefined, undefined, { count: 110, sound: null });
  ui.banner(`${winnerPlayer?.name ?? "?"} WINS!`, { durationMs: 2400, sound: null });

  // Characters react: winner cheers, everyone else sulks.
  for (const ch of self._chars ?? []) ch.anim.idle();
  self._chars?.[winner]?.anim.cheer();
  for (const p of match.players) {
    if (p.id !== winner) self._chars?.[p.id]?.anim.sad();
  }

  // Rank popup (winner row highlighted + coin prize shown).
  const ordered = [...ranking];
  for (const p of match.players) if (!ordered.includes(p.id)) ordered.push(p.id);
  const content = document.createElement("div");
  content.className = "ssp-mg-results";
  ordered.forEach((pid, i) => {
    const p = match.players[pid];
    const row = document.createElement("div");
    row.className = `ssp-mg-results__row${i === 0 ? " ssp-mg-results__row--win" : ""}`;
    row.textContent = i === 0 ? `${i + 1}. ${p?.name ?? "?"}  +${coins}c` : `${i + 1}. ${p?.name ?? "?"}`;
    content.appendChild(row);
  });
  ui.popup({
    title: `${mg?.name ?? "MINIGAME"} — RESULTS`,
    content,
    sound: null,
  });
}

export const minigameScreen = minigameScreenImpl as Screen;
