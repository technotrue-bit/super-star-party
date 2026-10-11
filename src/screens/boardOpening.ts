/**
 * SUPER STAR PARTY — the match opening, Mario Party style. After the island
 * flyover:
 *
 *   1. LINE UP   — everyone hops into a row by the start space, facing the camera.
 *   2. ASK       — "Want to learn how this board works?" YES runs the tour
 *                  (boardGuide.ts): the camera visits each feature while a host
 *                  card explains it. NO goes straight on.
 *   3. ROLL      — a dice block spins over every head. Local players press HIT!
 *                  (tap / Space / Enter); CPUs hit theirs on their own.
 *   4. ORDER     — the numbers stay up, 1st..4th chips pop over the heads and
 *                  the first player is announced.
 *   5. BACK      — everyone hops back onto the start space, the camera returns
 *                  to the overview, and the turn loop starts (it deals the
 *                  starting coins, then the first turn).
 *
 * Outcome-first like the dice: the order numbers are match.orderRolls, drawn
 * by rollForTurnOrder() before any of this plays. Nothing here writes match
 * state or touches the rng; timing is wall-clock, so a slow frame rate
 * cannot stretch it.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { settings } from "../config/settings";
import { match } from "../core/game";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { onViewportChange, viewportSize } from "../ui/viewport";
import type { BoardDef } from "../board/boardData";
import type { BoardScene } from "../board/boardScene";
import { boardGuide, type GuideStop } from "../board/boardGuide";
import type { Character } from "../characters/characterFactory";
import { PLAYER_OFFSETS } from "../game/turnLoop";

export interface OpeningDeps {
  def: BoardDef;
  board: BoardScene;
  chars: Character[];
  /** The live camera: its fov and aspect size the line-up shot. */
  camera: THREE.PerspectiveCamera;
  /** Overview camera the party camera rests on (the opening ends there). */
  overview: { pos: THREE.Vector3; look: THREE.Vector3 };
  /** Where the camera is right now (the flyover's last pose). */
  from: { pos: THREE.Vector3; look: THREE.Vector3 };
  scene: THREE.Scene;
  banner(text: string, opts?: { durationMs?: number }): unknown;
  project(pos: THREE.Vector3): { x: number; y: number } | null;
  isLocal(pid: number): boolean;
  label(pid: number): string;
  onDone(): void;
}

export interface Opening {
  /** Advance (wall clock); returns the camera pose to use this frame. */
  update(): { pos: THREE.Vector3; look: THREE.Vector3 };
  dispose(): void;
}

type Phase = "lineup" | "ask" | "tour" | "back" | "roll" | "order" | "return" | "done";

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
const RANK_COLOR = [palette.sun, palette.metal, palette.wood, palette.inkSoft];

/** Dice block face: a gold block with a big ink number (or "?"). */
function blockTexture(): { tex: THREE.CanvasTexture; draw: (text: string) => void } {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (text: string): void => {
    ctx.fillStyle = palette.sun;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = palette.sunDeep;
    ctx.lineWidth = 10;
    ctx.strokeRect(9, 9, 110, 110);
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 122, 122);
    ctx.fillStyle = palette.ink;
    ctx.font = "700 76px Fredoka, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 70);
    tex.needsUpdate = true;
  };
  draw("?");
  return { tex, draw };
}

export function createOpening(d: OpeningDeps): Opening {
  const n = d.chars.length;
  const max = Math.max(n, settings.orderBlockMax);
  const startPos = d.board.spaceWorldPos(d.def.startIndex);

  // ---- line-up geometry: a row across the screen, a step toward the camera ----
  // The camera stands on the board side of the start space looking out, so
  // the row has the open loop in front of it and the scenery behind it.
  let cx = 0;
  let cz = 0;
  for (const sp of d.def.spaces) {
    cx += sp.x / d.def.spaces.length;
    cz += sp.y / d.def.spaces.length;
  }
  const toCam = new THREE.Vector3(cx - startPos.x, 0, cz - startPos.z);
  if (toCam.lengthSq() < 1e-6) toCam.copy(d.overview.pos).sub(d.overview.look).setY(0);
  toCam.normalize();
  const right = new THREE.Vector3(toCam.z, 0, -toCam.x);
  const lineCentre = startPos.clone().addScaledVector(toCam, 1.4);
  // Portrait screens see a narrow slice of the world: stand closer together
  // so the camera does not have to back off as far to fit the row.
  const gap = d.camera.aspect < 1 ? 1.35 : 1.9;
  const spots = d.chars.map((_, i) => lineCentre.clone().addScaledVector(right, (i - (n - 1) / 2) * gap));
  const faceCam = Math.atan2(toCam.x, toCam.z);
  // Tour shots look along the party camera's own heading.
  const viewDir = d.overview.pos.clone().sub(d.overview.look).setY(0).normalize();
  const lineLook = lineCentre.clone().add(new THREE.Vector3(0, 1.9, 0));
  const linePos = new THREE.Vector3();
  /**
   * Back the line-up camera off until the whole row (plus a margin for the
   * dice blocks) fits the screen's width AND the blocks fit its height. A
   * portrait phone's narrow horizontal view needs a much longer pull-back
   * than a landscape screen.
   */
  const fitLinePose = (): void => {
    const vHalf = THREE.MathUtils.degToRad(d.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.2, d.camera.aspect));
    const halfRow = ((n - 1) / 2) * gap + (gap < 1.9 ? 1.0 : 1.4); // outer characters + their blocks
    const halfTall = 2.6; // feet to the top of a dice block, about the look point
    const dist = Math.max(9, halfRow / Math.tan(hHalf), halfTall / Math.tan(vHalf)) * 1.12;
    // The further back, the higher: a long pull-back looks down over whatever
    // stands between the camera and the row (the hill and its fountain).
    linePos.copy(lineLook).addScaledVector(toCam, dist).add(new THREE.Vector3(0, 2.2 + dist * (dist > 12 ? 0.42 : 0.18), 0));
  };
  fitLinePose();

  // Home spots (the start space's 2x2 stand-off grid), where the turn loop expects them.
  const home = d.chars.map((_, i) => {
    const off = PLAYER_OFFSETS[i] ?? [0, 0];
    return new THREE.Vector3(startPos.x + off[0], startPos.y, startPos.z + off[1]);
  });
  const headY = d.chars.map((ch) => new THREE.Box3().setFromObject(ch.group).max.y - ch.group.position.y);

  // ---- camera: eases toward a target pose ------------------------------------------
  const camPos = d.from.pos.clone();
  const camLook = d.from.look.clone();
  const tgtPos = linePos.clone();
  const tgtLook = lineLook.clone();
  const out = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const aimAt = (pos: THREE.Vector3, look: THREE.Vector3): void => {
    tgtPos.copy(pos);
    tgtLook.copy(look);
  };

  // ---- characters: hop from A to B ------------------------------------------------
  const walkFrom = d.chars.map((ch) => ch.group.position.clone());
  const walkTo = spots.map((s) => s.clone());
  let walkT = 0;
  const WALK = 1.0;
  const beginWalk = (to: THREE.Vector3[]): void => {
    walkT = 0;
    d.chars.forEach((ch, i) => {
      walkFrom[i].copy(ch.group.position);
      walkTo[i].copy(to[i]);
      ch.anim.walk();
      ch.setFacing(Math.atan2(to[i].x - walkFrom[i].x, to[i].z - walkFrom[i].z));
    });
  };
  const stepWalk = (dt: number): boolean => {
    if (walkT >= WALK) return true;
    walkT = Math.min(WALK, walkT + dt);
    const u = walkT / WALK;
    const e = u * u * (3 - 2 * u);
    d.chars.forEach((ch, i) => {
      ch.group.position.lerpVectors(walkFrom[i], walkTo[i], e);
      ch.group.position.y += Math.abs(Math.sin(u * Math.PI * 3)) * 0.35 * (1 - u);
    });
    if (walkT >= WALK) {
      d.chars.forEach((ch) => ch.anim.idle());
      return true;
    }
    return false;
  };

  // ---- DOM: tour card, HIT! button, rank chips -------------------------------------
  // The layer tracks the VISIBLE viewport (visualViewport), not the layout
  // viewport: in-app and mobile browsers lay their toolbars over the bottom of
  // the page, which would hide the bottom of the host card and the HIT! button.
  const layer = document.createElement("div");
  layer.className = "ssp-opening";
  layer.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:65;";
  document.body.appendChild(layer);
  const fitLayer = (): void => {
    const vv = window.visualViewport;
    const { w, h } = viewportSize();
    layer.style.left = `${vv?.offsetLeft ?? 0}px`;
    layer.style.top = `${vv?.offsetTop ?? 0}px`;
    layer.style.width = `${w}px`;
    layer.style.height = `${h}px`;
    // The card may use everything below the top HUD strip; past that it scrolls.
    card.style.maxHeight = `${Math.max(160, h - 120)}px`;
  };
  const offViewport = onViewportChange(fitLayer);

  const card = document.createElement("div");
  card.className = "ssp-on-light";
  card.style.cssText = [
    "position:absolute",
    "left:50%",
    "bottom:calc(16px + env(safe-area-inset-bottom, 0px))",
    "transform:translateX(-50%)",
    "width:min(560px, calc(100vw - 32px))",
    "box-sizing:border-box",
    "padding:16px 18px 14px",
    `background:${palette.cream}`,
    `color:${palette.ink}`,
    `border:4px solid ${palette.ink}`,
    `box-shadow:0 6px 0 ${palette.ink}`,
    "border-radius:22px",
    "font:500 16px/1.4 Fredoka, sans-serif",
    "pointer-events:auto",
    "display:none",
    "flex-direction:column",
    "overflow:hidden",
  ].join(";");
  const cardTitle = document.createElement("div");
  cardTitle.style.cssText = `flex:0 0 auto;font:700 21px Fredoka, sans-serif;color:${palette.candyDeep};margin-bottom:6px;`;
  // The card grows with its text; only if it would outgrow the visible screen
  // does the text scroll, and the NEXT / SKIP row stays pinned below it.
  const cardBody = document.createElement("div");
  cardBody.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;";
  const cardRow = document.createElement("div");
  cardRow.style.cssText = "flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px;";
  const cardCount = document.createElement("div");
  cardCount.style.cssText = `font:600 13px Fredoka, sans-serif;color:${palette.inkSoft};`;
  const cardBtns = document.createElement("div");
  cardBtns.style.cssText = "display:flex;gap:8px;";
  cardRow.append(cardCount, cardBtns);
  card.append(cardTitle, cardBody, cardRow);
  layer.appendChild(card);
  fitLayer();

  const hitWrap = document.createElement("div");
  hitWrap.style.cssText = "position:absolute;left:50%;bottom:calc(28px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);pointer-events:auto;display:none;";
  layer.appendChild(hitWrap);

  const chips = d.chars.map(() => {
    const el = document.createElement("div");
    el.style.cssText = [
      "position:absolute",
      "transform:translate(-50%,-100%) scale(0)",
      "transition:transform 260ms cubic-bezier(.34,1.56,.64,1)",
      "padding:4px 12px",
      `border:3px solid ${palette.ink}`,
      `box-shadow:0 3px 0 ${palette.ink}`,
      "border-radius:999px",
      `color:${palette.ink}`,
      "font:700 18px Fredoka, sans-serif",
      "white-space:nowrap",
    ].join(";");
    layer.appendChild(el);
    return el;
  });

  // ---- dice blocks ----------------------------------------------------------------
  const blocks = d.chars.map(() => {
    const face = blockTexture();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.95, 0.95),
      new THREE.MeshBasicMaterial({ map: face.tex })
    );
    const shell = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: palette.ink, side: THREE.BackSide }));
    shell.scale.setScalar(1.08);
    mesh.add(shell);
    mesh.visible = false;
    d.scene.add(mesh);
    return { mesh, face, hit: false, shown: "?", spin: 0, pop: 0 };
  });
  const blockPos = (i: number): THREE.Vector3 =>
    d.chars[i].group.position.clone().add(new THREE.Vector3(0, headY[i] + 1.35 + Math.sin(t * 3 + i) * 0.08, 0));

  // ---- state ---------------------------------------------------------------------
  let phase: Phase = "lineup";
  let t = 0; // board seconds since the opening began
  let phaseT = 0;
  let tour: GuideStop[] = [];
  let stop = 0;
  let prompt: { destroy(): void } | null = null;
  let hitBtn: ReturnType<typeof ui.button> | null = null;
  const cpuHitAt = d.chars.map((_, i) => 1.2 + i * 0.55);
  const rank = match.turnOrder.slice();

  const setPhase = (p: Phase): void => {
    phase = p;
    phaseT = 0;
  };

  const focusPose = (s: GuideStop): void => {
    const f = s.focus;
    let target: THREE.Vector3 | null = null;
    if (f.kind === "space") target = d.board.spaceWorldPos(f.index);
    else if (f.kind === "prize") target = d.board.spaceWorldPos(match.starBalloonPos);
    else if (f.kind === "point") target = new THREE.Vector3(f.x, d.board.spaceWorldPos(d.def.startIndex).y, f.z);
    if (!target) {
      aimAt(d.overview.pos, d.overview.look);
      return;
    }
    const look = target.clone().add(new THREE.Vector3(0, 1.2, 0));
    // High and fairly close: above the lively cloud lanes (y ~6-9 just
    // outside the loop) so a shot of an edge space never sits inside a cloud.
    const pos = look.clone().addScaledVector(viewDir, 7.5).add(new THREE.Vector3(0, 11, 0));
    aimAt(pos, look);
  };

  const showStop = (): void => {
    const s = tour[stop];
    cardTitle.textContent = s.title;
    cardBody.textContent = s.body;
    cardCount.textContent = `${stop + 1} / ${tour.length}`;
    cardBtns.replaceChildren();
    const last = stop === tour.length - 1;
    if (!last) {
      const skip = ui.button({ label: "SKIP", kind: "ghost", size: "sm", onClick: endTour });
      cardBtns.appendChild(skip.el);
    }
    const next = ui.button({ label: last ? "LET'S PLAY!" : "NEXT", kind: last ? "gold" : "primary", size: "sm", onClick: nextStop });
    cardBtns.appendChild(next.el);
    card.style.display = "flex";
    cardBody.scrollTop = 0;
    focusPose(s);
    audio.sfx.play("ui.click");
  };
  function nextStop(): void {
    if (phase !== "tour") return;
    if (stop >= tour.length - 1) endTour();
    else {
      stop += 1;
      showStop();
    }
  }
  function endTour(): void {
    if (phase !== "tour") return;
    card.style.display = "none";
    aimAt(linePos, lineLook);
    setPhase("back");
  }

  const ask = (): void => {
    const anyLocal = d.chars.some((_, i) => d.isLocal(i));
    if (!anyLocal) {
      setPhase("roll");
      return;
    }
    setPhase("ask");
    prompt = ui.popup({
      title: `How does ${d.def.name} work?`,
      body: "Want a quick tour of the board before we roll for turn order?",
      buttons: [
        {
          label: "YES, SHOW ME!",
          kind: "gold",
          onClick: () => {
            prompt?.destroy();
            prompt = null;
            tour = boardGuide(d.def, match.totalTurns);
            stop = 0;
            setPhase("tour");
            showStop();
          },
        },
        {
          label: "NO THANKS",
          kind: "ghost",
          onClick: () => {
            prompt?.destroy();
            prompt = null;
            setPhase("roll");
          },
        },
      ],
      closeOnEsc: false,
    });
  };

  const hit = (i: number): void => {
    const b = blocks[i];
    if (b.hit) return;
    b.hit = true;
    b.pop = 0;
    b.shown = String(match.orderRolls[i] ?? 1);
    b.face.draw(b.shown);
    d.chars[i].anim.jump();
    audio.sfx.play("dice.land");
  };
  const localToHit = (): number => d.chars.findIndex((_, i) => d.isLocal(i) && !blocks[i].hit);
  const onKey = (e: KeyboardEvent): void => {
    if (phase !== "roll") return;
    // The pause menu owns the keyboard while it is up: no hitting a block
    // behind it.
    if (document.querySelector(".ssp-pause-overlay--open")) return;
    if (e.key === " " || e.key === "Enter") {
      // Keep the focused HIT! button from firing a second hit on the same press.
      e.preventDefault();
      if (e.repeat) return;
      const i = localToHit();
      if (i >= 0) hit(i);
    }
  };
  window.addEventListener("keydown", onKey);

  const startRoll = (): void => {
    banner("HIT YOUR DICE BLOCK!");
    audio.sfx.play("whoosh");
    for (const b of blocks) b.mesh.visible = true;
    if (localToHit() >= 0) {
      hitBtn = ui.button({
        label: "HIT!",
        kind: "gold",
        size: "lg",
        onClick: () => {
          const i = localToHit();
          if (i >= 0) hit(i);
        },
      });
      hitWrap.replaceChildren(hitBtn.el);
      hitWrap.style.display = "block";
    }
  };
  function banner(text: string, ms = 1400): void {
    d.banner(text, { durationMs: ms });
  }

  const placeChips = (): void => {
    for (let i = 0; i < n; i++) {
      const p = d.project(blockPos(i).add(new THREE.Vector3(0, 0.95, 0)));
      if (!p) continue;
      chips[i].style.left = `${p.x}px`;
      chips[i].style.top = `${p.y}px`;
    }
  };

  const finish = (): void => {
    if (phase === "done") return;
    setPhase("done");
    dispose();
    d.onDone();
  };

  function dispose(): void {
    (globalThis as { __SSP_OPENING?: unknown }).__SSP_OPENING = undefined;
    window.removeEventListener("keydown", onKey);
    offViewport();
    prompt?.destroy();
    prompt = null;
    layer.remove();
    for (const b of blocks) {
      d.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      ((b.mesh.children[0] as THREE.Mesh).material as THREE.Material).dispose();
      b.face.tex.dispose();
    }
  }

  beginWalk(spots);
  banner("LINE UP!", 1100);
  // Debug read-out for probes (never read by gameplay).
  (globalThis as { __SSP_OPENING?: () => unknown }).__SSP_OPENING = () => ({ phase, hits: blocks.map((b) => b.hit) });

  let lastNow = performance.now();
  return {
    update() {
      // Wall-clock, like the flyover and the old order ceremony: a slow frame
      // rate must not stretch the opening (board dt is clamped per frame).
      const now = performance.now();
      const dt = Math.min(0.5, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      t += dt;
      phaseT += dt;
      // Re-fit the line-up shot every frame: the phone may rotate mid-opening.
      if (phase !== "tour") {
        const wasLine = tgtPos.distanceToSquared(linePos) < 1e-6;
        fitLinePose();
        if (wasLine) tgtPos.copy(linePos);
      }
      const k = 1 - Math.exp(-dt * 3.2);
      camPos.lerp(tgtPos, k);
      camLook.lerp(tgtLook, k);

      switch (phase) {
        case "lineup":
          if (stepWalk(dt)) {
            d.chars.forEach((ch) => ch.setFacing(faceCam));
            if (phaseT > 1.6) ask();
          }
          break;
        case "back":
          if (phaseT > 0.9) setPhase("roll");
          break;
        case "roll": {
          if (phaseT <= dt) startRoll();
          let all = true;
          for (let i = 0; i < n; i++) {
            const b = blocks[i];
            if (!b.hit) {
              all = false;
              // Spinning block: a new number every 70 ms.
              b.spin += dt;
              if (b.spin > 0.07) {
                b.spin = 0;
                const show = String(1 + Math.floor(((t * 13.7 + i * 3.1) % max)));
                if (show !== b.shown) {
                  b.shown = show;
                  b.face.draw(show);
                }
              }
              if (!d.isLocal(i) && phaseT > cpuHitAt[i]) hit(i);
            }
          }
          if (all) {
            hitWrap.style.display = "none";
            if (phaseT > 0.1) setPhase("order");
          }
          break;
        }
        case "order":
          if (phaseT <= dt) {
            rank.forEach((pid, r) => {
              chips[pid].textContent = ORDINAL[r] ?? `${r + 1}th`;
              chips[pid].style.background = RANK_COLOR[r] ?? palette.cream;
            });
            const first = rank[0];
            banner(`${d.label(first).toUpperCase()} GOES FIRST!`, 1800);
            audio.sfx.play("crowd.cheer");
            d.chars[first]?.anim.cheer();
          }
          // Chips pop in one by one, 1st to last.
          rank.forEach((pid, r) => {
            if (phaseT > 0.25 + r * 0.3) chips[pid].style.transform = "translate(-50%,-100%) scale(1)";
          });
          if (phaseT > 2.9) {
            for (const c of chips) c.style.transform = "translate(-50%,-100%) scale(0)";
            beginWalk(home);
            aimAt(d.overview.pos, d.overview.look);
            setPhase("return");
          }
          break;
        case "return":
          if (stepWalk(dt) && phaseT > 1.3) finish();
          break;
        default:
          break;
      }

      // Blocks: bob over the heads, spin while live, pop and face the camera once hit.
      for (let i = 0; i < n; i++) {
        const b = blocks[i];
        if (!b.mesh.visible) continue;
        b.mesh.position.copy(blockPos(i));
        if (!b.hit) {
          b.mesh.rotation.set(0.35, t * 5 + i, 0);
          b.mesh.scale.setScalar(1);
        } else {
          b.pop += dt;
          b.mesh.rotation.set(0, faceCam, 0);
          const s = b.pop < 0.25 ? 1 + 0.45 * Math.sin((b.pop / 0.25) * Math.PI) : 1;
          b.mesh.scale.setScalar(phase === "return" ? Math.max(0.001, 1 - phaseT * 2.5) : s);
        }
      }
      if (phase === "order" || phase === "roll") placeChips();

      out.pos.copy(camPos);
      out.look.copy(camLook);
      return out;
    },
    dispose,
  };
}
