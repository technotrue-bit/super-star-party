/**
 * ROW ROW RUMBLE — a 2-vs-2 canoe race on the TWIN pad.
 *
 * Two canoes, two paddlers each, race down a jungle river of calm reaches,
 * white-water rapids and waterfalls. Every paddler alternates LEFT and RIGHT:
 * a press on the other side 0.25 to 0.7 s after the last one is a stroke (the
 * nearer 0.4 s the stronger); the same side twice swings the canoe toward the
 * rocks; faster than 0.25 s does nothing. A canoe is driven by the sum of both
 * its paddlers; a collision slows it for a second. The first canoe past the flag
 * wins and both of its paddlers are paid.
 *
 * The local player is paddler one of the left-hand canoe; their partner is drawn
 * from the other seats. CPU paddlers alternate at cpuTwinPeriod(0.42, skill) and,
 * when the canoe is yawed past 10 degrees, stroke the correcting side twice.
 *
 * Determinism: fixed 1/60 s steps with an integer step index. A button press is
 * queued with the sim clock and judged on the next step; the CPU, the rocks and
 * the river are functions of the step clock and ctx.rng. Presentation (particles,
 * paddles, the follow camera) never feeds back into the sim. The camera glides
 * down the river after the leader: no shake. Telemetry: window.__ROWRUMBLE__.
 */
import * as THREE from "three";
import { automatedSeatIds, cpuSkill, isLocalPlayer, isPracticeBeat, type Minigame, type MinigameContext } from "../framework";
import { registerMinigame } from "../registry";
import { box as frameBox, frameMinigame } from "../framing";
import { createFollowCamera, type FollowCamera } from "../followCamera";
import { palette } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import type { Character } from "../../characters/characterFactory";
import { buildCanoe, createFx, createKit, SEAT_Z, type CanoeView, type Fx, type Kit, type PaddleView } from "./art";
import { buildJungle, type JungleEnvironment } from "./environment";
import { mountRaceHud, type RaceHud } from "./hud";
import {
  COURSE_LEN,
  LANE_X,
  TIME_CAP,
  assignTeams,
  cpuStep,
  flowAt,
  judgePress,
  leaderTeam,
  makeCourse,
  newCanoe,
  newCpuSeat,
  newPaddler,
  rankPlayers,
  riverSlope,
  riverY,
  stepCanoe,
  type Canoe,
  type Course,
  type CpuSeat,
  type Paddler,
  type PressResult,
  type Side,
} from "./rules";

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 12;

/** The framework force-finishes a round still running at this game time (s). */
const TIME_LIMIT = 52;
/** After the line, the winners cheer this long before the result shows (s). */
const POST_FINISH = 2.4;
/** Seconds one stroke takes to swing through the water. */
const STROKE_ANIM = 0.38;
/** Paddler size in the canoe. */
const CHAR_SCALE = 1.05;
/** How far past the flag the camera follows (m). */
const CAM_OVERRUN = 6;

const TEAM_STYLE = [
  { name: "ORANGE", hull: palette.sunDeep, trim: palette.cream },
  { name: "VIOLET", hull: palette.berry, trim: palette.cream },
] as const;

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

interface Seat {
  id: number;
  name: string;
  team: 0 | 1;
  /** 0 stern, 1 bow. */
  role: 0 | 1;
  cpu: boolean;
  pad: Paddler;
  brain: CpuSeat | null;
  char: Character | null;
  paddle: PaddleView;
  /** Smoothed lean, for the paddler's body. */
  leanX: number;
  leanZ: number;
}

interface TeamState {
  idx: 0 | 1;
  laneX: number;
  canoe: Canoe;
  view: CanoeView;
  seats: Seat[];
  corrUntil: number;
  /** Presentation: smoothed pitch/roll, a bump wobble, a stroke surge, spray clock. */
  pitch: number;
  roll: number;
  shake: number;
  surge: number;
  sprayT: number;
  phase: number;
}

interface PendingPress {
  side: Side;
  t: number;
}

interface State {
  ctx: MinigameContext;
  root: THREE.Group;
  kit: Kit;
  fx: Fx;
  env: JungleEnvironment;
  hud: RaceHud;
  course: Course;
  teams: [TeamState, TeamState];
  seats: Seat[];
  human: Seat | null;
  coin: 0 | 1;
  follow: FollowCamera;
  followOff: THREE.Vector3;
  lookOff: THREE.Vector3;
  followTarget: THREE.Vector3;
  events: PendingPress[];
  edges: { a: number; b: number };
  step: number;
  simTime: number;
  presT: number;
  /** Team that crossed first, once someone has. */
  winner: 0 | 1 | null;
  winT: number;
  pace: [number, number];
  ranking: number[] | null;
  coinWinners: number[];
  finished: boolean;
  log: string[];
}

let round: State | null = null;

const scratch = new THREE.Vector3();
const bladePos = new THREE.Vector3();

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const ease = (u: number): number => {
  const c = clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
};

function note(st: State, line: string): void {
  st.log.push(line);
  if (st.log.length > 60) st.log.splice(0, st.log.length - 40);
}

function strokesById(st: State): number[] {
  const out: number[] = [];
  for (const s of st.seats) out[s.id] = s.pad.strokes;
  return out;
}

/** The human's next side, or null if they have not pressed yet. */
function nextSide(p: Paddler): Side | null {
  return p.last === "a" ? "b" : p.last === "b" ? "a" : null;
}

/* ------------------------------------------------------------------ */
/*  The sim                                                            */
/* ------------------------------------------------------------------ */

function applyPress(st: State, seat: Seat, side: Side, t: number, sum: { v: number[]; yaw: number[] }): PressResult {
  const r = judgePress(seat.pad, side, t);
  sum.v[seat.team] += r.impulse;
  sum.yaw[seat.team] += r.yaw;
  const team = st.teams[seat.team];
  // The paddle goes in on this side; a stroke bites, a mistake just flaps.
  const p = seat.paddle;
  p.side = side === "a" ? -1 : 1;
  p.t = 0;
  p.dip = true;
  if (r.kind === "same" || r.kind === "rushed") team.shake = Math.max(team.shake, r.kind === "same" ? 0.5 : 0.25);
  if (r.kind === "stroke" || r.kind === "start") team.surge = Math.min(1, team.surge + 0.5);
  if (seat === st.human) {
    st.hud.press(r);
    note(st, `P${seat.id} ${r.kind} ${side} g=${Number.isFinite(r.gap) ? r.gap.toFixed(2) : "-"} ${r.grade ?? ""}`.trim());
    if (r.kind === "stroke") st.ctx.playSfx("whoosh", { volume: 0.45, pitch: 0.9 + Math.min(0.3, seat.pad.streak * 0.03) });
    else if (r.kind === "same") st.ctx.playSfx("boing", { volume: 0.35, pitch: 0.8 });
  }
  return r;
}

function stepFixed(st: State): void {
  const t = st.step * FIXED_DT;
  const ctx = st.ctx;
  const sum = { v: [0, 0], yaw: [0, 0] };

  if (st.winner === null) {
    // Human presses queued since the last step.
    const human = st.human;
    for (const e of st.events) if (human) applyPress(st, human, e.side, e.t, sum);
    st.events.length = 0;

    // CPU paddlers.
    const skill = cpuSkill();
    for (const seat of st.seats) {
      if (!seat.brain) continue;
      const team = st.teams[seat.team];
      const r = cpuStep(seat.brain, seat.pad, team.canoe.yaw, t, team.corrUntil, skill, ctx.rng);
      team.corrUntil = r.corrUntil;
      if (r.side) applyPress(st, seat, r.side, t, sum);
    }
  } else {
    st.events.length = 0;
  }

  // The canoes.
  for (const team of st.teams) {
    const c = team.canoe;
    // After the line the winners rest on their paddles and glide to a stop.
    const coast = st.winner !== null && st.winner === team.idx;
    const bump = stepCanoe(c, FIXED_DT, st.course, team.laneX, coast ? 0 : sum.v[team.idx], coast ? 0 : sum.yaw[team.idx]);
    if (bump) {
      team.shake = 1;
      note(st, `C${team.idx} bump ${bump.kind} s=${bump.s.toFixed(1)}`);
      st.fx.crash(bump.x, riverY(bump.s) + 0.1, -bump.s, bump.dir);
      st.fx.ring(bump.x, riverY(bump.s) + 0.08, -bump.s, 1.3, palette.white);
      if (team.seats.some((s) => s === st.human)) st.ctx.playSfx("land", { volume: 0.7, pitch: 0.7 });
      for (const s of team.seats) s.char?.anim.squash();
    }
    if (c.finishT === null && c.s >= COURSE_LEN) c.finishT = t;
  }

  // The line.
  if (st.winner === null) {
    const [a, b] = st.teams;
    const done = [a, b].filter((x) => x.canoe.finishT !== null);
    if (done.length > 0) {
      // Whoever got furthest past the line this step (a tie goes to the coin).
      const win = done.length === 1 ? done[0].idx : leaderTeam([a.canoe.s, b.canoe.s], st.coin);
      callRace(st, win, t, false);
    } else if (t >= TIME_CAP) {
      callRace(st, leaderTeam([a.canoe.s, b.canoe.s], st.coin), t, true);
    }
  }
}

function callRace(st: State, win: 0 | 1, t: number, timeUp: boolean): void {
  const ctx = st.ctx;
  st.winner = win;
  st.winT = t;
  const team = st.teams[win];
  st.pace = [st.teams[0].canoe.s / Math.max(0.1, t), st.teams[1].canoe.s / Math.max(0.1, t)];
  if (!timeUp) st.pace[win] = COURSE_LEN / Math.max(0.1, team.canoe.finishT ?? t);
  const ids: [number[], number[]] = [st.teams[0].seats.map((s) => s.id), st.teams[1].seats.map((s) => s.id)];
  st.ranking = rankPlayers(ids, win, strokesById(st));
  st.coinWinners = ids[win].slice();
  note(st, `win team ${win} t=${t.toFixed(2)} ${timeUp ? "time" : "line"}`);
  const mine = st.human ? st.human.team === win : false;
  ctx.announce(timeUp ? "TIME!" : mine ? "YOUR TEAM WINS!" : `${TEAM_STYLE[win].name} WINS!`, { durationMs: 1900, sound: null });
  ctx.playSfx(mine ? "fanfare.win" : "crowd.cheer", { volume: 0.7 });
  st.env.celebrate();
  const v = team.view.root.position;
  st.fx.confetti(v.x, v.y + 1.5, v.z, 36);
  st.fx.ring(v.x, v.y + 0.08, v.z, 2.2, palette.sun);
  for (const s of st.seats) {
    if (!s.char) continue;
    if (s.team === win) s.char.anim.cheer();
    else s.char.anim.sad();
  }
}

/* ------------------------------------------------------------------ */
/*  Presentation                                                       */
/* ------------------------------------------------------------------ */

function placeTeam(st: State, team: TeamState, dt: number, t: number): void {
  const c = team.canoe;
  const v = team.view;
  const speed = c.v * flowAt(c.s);
  const y = riverY(c.s);
  v.root.position.set(c.x, y, -c.s);
  v.root.rotation.y = -c.yaw;

  // Pitch follows the river (the falls tip the bow down); roll leans into the paddles.
  const pitchGoal = Math.atan(riverSlope(c.s)) * 0.85 - team.surge * 0.025;
  team.pitch += (pitchGoal - team.pitch) * Math.min(1, dt * 9);
  let rollGoal = -c.yaw * 0.25;
  for (const s of team.seats) rollGoal += -s.paddle.side * 0.05 * (s.paddle.t < STROKE_ANIM ? 1 : 0.3);
  team.roll += (rollGoal - team.roll) * Math.min(1, dt * 10);
  team.shake = Math.max(0, team.shake - dt * 1.8);
  team.surge = Math.max(0, team.surge - dt * 2.4);
  const wobble = Math.sin(t * 38 + team.phase) * team.shake * 0.1;
  v.body.rotation.set(team.pitch + Math.sin(t * 2.1 + team.phase) * 0.012, 0, team.roll + wobble);
  v.body.position.y = 0.14 + Math.sin(t * 2.6 + team.phase) * 0.025 + team.surge * 0.02;
  v.root.updateMatrixWorld(true);

  // Foam V: longer and brighter with speed.
  v.wake.scale.set(1, 1, clamp(0.35 + speed / 6, 0.3, 1.6));

  // Bow spray while moving.
  team.sprayT -= dt;
  if (team.sprayT <= 0 && speed > 2.5) {
    team.sprayT = 0.07;
    scratch.set(0, 0, -1.9);
    v.root.localToWorld(scratch);
    st.fx.spray(scratch.x, y + 0.1, scratch.z, -speed);
  }

  // Pennant flaps.
  v.flagCloth.rotation.y = Math.sin(t * 9 + team.phase) * 0.35;

  for (const seat of team.seats) {
    movePaddle(st, team, seat, dt);
    const ch = seat.char;
    if (!ch) continue;
    scratch.set(0, 0.17, SEAT_Z[seat.role]);
    v.body.localToWorld(scratch);
    ch.group.position.copy(scratch);
    ch.setFacing(Math.PI - c.yaw);
    const p = seat.paddle;
    const reach = clamp(p.sweep, -0.6, 0.7);
    seat.leanX += (-0.1 + reach * 0.35 - seat.leanX) * Math.min(1, dt * 14);
    const inWater = p.t < STROKE_ANIM ? 1 : 0;
    seat.leanZ += (-p.side * 0.12 * inWater - seat.leanZ) * Math.min(1, dt * 12);
    if (st.winner === null || st.winner !== team.idx) ch.group.rotation.set(team.pitch * 0.8 + seat.leanX, 0, team.roll + seat.leanZ);
    else ch.group.rotation.set(team.pitch * 0.8, 0, team.roll);
  }
}

function movePaddle(st: State, team: TeamState, seat: Seat, dt: number): void {
  const p = seat.paddle;
  p.t += dt;
  const u = p.t / STROKE_ANIM;
  const lifted = 1.28;
  const dipped = 0.8;
  const resting = st.winner !== null && st.winner === team.idx;
  const wet = !resting && u < 1;
  const tiltGoal = p.side * (resting ? 1.5 : wet ? dipped : lifted);
  const sweepGoal = wet ? -0.5 + 1.1 * ease(u) : resting ? 0 : -0.15;
  p.tilt += (tiltGoal - p.tilt) * Math.min(1, dt * 20);
  p.sweep += (sweepGoal - p.sweep) * Math.min(1, dt * 24);
  p.root.position.set(0, 1.12, SEAT_Z[seat.role]);
  p.root.rotation.z = p.tilt;
  p.swing.rotation.x = p.sweep;
  if (p.dip && u > 0.12) {
    p.dip = false;
    p.root.updateMatrixWorld(true);
    p.blade.getWorldPosition(bladePos);
    const k = seat.pad.last === (p.side < 0 ? "a" : "b") ? 1 : 0;
    const power = k && seat.pad.streak > 0 ? 1 : 0.35;
    st.fx.splash(bladePos.x, riverY(-bladePos.z) + 0.05, bladePos.z, power, p.side);
    if (seat === st.human) {
      const good = seat.pad.streak > 0 && st.log.length > 0 && /perfect/.test(st.log[st.log.length - 1]);
      st.fx.ring(bladePos.x, riverY(-bladePos.z) + 0.07, bladePos.z, good ? 1.1 : 0.7, good ? palette.sun : palette.white);
    }
  }
}

function updateVisuals(st: State, dt: number): void {
  st.presT += dt;
  const t = st.presT;
  const lead = Math.max(st.teams[0].canoe.s, st.teams[1].canoe.s);

  // The camera glides after the leader's course progress and nothing else.
  const target = clamp(lead, 0, COURSE_LEN + CAM_OVERRUN);
  st.followTarget.set(st.lookOff.x, riverY(target) + st.lookOff.y, st.lookOff.z - target);
  st.follow.update(dt, st.followTarget);

  for (const team of st.teams) placeTeam(st, team, dt, t);
  st.env.update(t, dt, lead);
  st.fx.update(dt);

  // HUD.
  const human = st.human;
  const now = st.step * FIXED_DT + st.simTime;
  st.hud.tick(human ? nextSide(human.pad) : null, human ? now - human.pad.lastT : 0);
  st.hud.progress(st.teams[0].canoe.s / COURSE_LEN, st.teams[1].canoe.s / COURSE_LEN);
  for (const s of st.seats) st.ctx.hud.score(s.id, s.pad.strokes);
}

function publish(st: State): void {
  const w = window as unknown as { __ROWRUMBLE__?: unknown };
  const byId = (pick: (p: Paddler) => number): number[] => {
    const out: number[] = [];
    for (const s of st.seats) out[s.id] = pick(s.pad);
    return out;
  };
  const teamOf: number[] = [];
  for (const s of st.seats) teamOf[s.id] = s.team;
  w.__ROWRUMBLE__ = {
    t: st.step * FIXED_DT,
    step: st.step,
    finished: st.finished,
    tFinish: st.finished ? st.winT + POST_FINISH : null,
    winnerTeam: st.winner,
    teams: st.teams.map((tm) => tm.seats.map((s) => s.id)),
    teamOf,
    human: st.human ? st.human.id : -1,
    dist: st.teams.map((tm) => Math.round(tm.canoe.s * 100) / 100),
    pace: st.pace.map((p) => Math.round(p * 1000) / 1000),
    yaw: st.teams.map((tm) => Math.round(tm.canoe.yaw * 1000) / 1000),
    bumps: st.teams.map((tm) => tm.canoe.bumps),
    strokes: byId((p) => p.strokes),
    same: byId((p) => p.same),
    rushed: byId((p) => p.rushed),
    late: byId((p) => p.late),
    presses: byId((p) => p.presses),
    edges: { ...st.edges },
    coinWinners: st.finished ? st.coinWinners : null,
    log: st.log.slice(-12),
  };
}

/* ------------------------------------------------------------------ */
/*  Minigame                                                           */
/* ------------------------------------------------------------------ */

const rowRumble: Minigame = {
  id: "row_rumble",
  name: "Row Row Rumble",
  genre: "race",
  pad: "twin",
  padLabels: { a: "LEFT", b: "RIGHT" },
  timeLimit: TIME_LIMIT,
  howTo: "Tap LEFT and RIGHT in turn to paddle. Same side twice turns the canoe.",
  goal: "Your canoe crosses the finish first.",
  tap: null,
  steer: false,
  rules: {
    format: "2v2",
    length: "About 40 seconds",
    win: "The first canoe past the flag wins, and both paddlers share the prize",
    touch: ["Tap LEFT, then RIGHT, then LEFT... about twice a second", "The same side twice turns the canoe toward the rocks"],
    keys: ["Z or Left arrow: paddle LEFT", "X or Right arrow: paddle RIGHT, alternate them"],
  },

  setup(ctx: MinigameContext) {
    const root = new THREE.Group();
    root.name = "row_rumble:root";
    ctx.scene.add(root);
    const kit = createKit();
    const fx = createFx(kit, root);

    // The river. Everything below draws from ctx.rng in a fixed order, once.
    const course = makeCourse(ctx.rng);
    const env = buildJungle(ctx.scene, root, kit, fx, course);

    const ids = ctx.players.map((p) => p.id);
    const humanInfo = isAutoplay() ? undefined : ctx.players.find((p) => isLocalPlayer(ctx.players, p.id));
    const localId = humanInfo ? humanInfo.id : -1;
    const [mine, theirs] = assignTeams(ids, localId, ctx.rng);
    const coin = ctx.rng() < 0.5 ? 0 : 1;
    const automated = new Set(automatedSeatIds(ctx.players, isAutoplay()));

    const makeTeam = (idx: 0 | 1): TeamState => {
      const style = TEAM_STYLE[idx];
      const view = buildCanoe(kit, style.hull, style.trim);
      root.add(view.root);
      const canoe = newCanoe(idx === 0 ? -LANE_X : LANE_X);
      return { idx, laneX: canoe.x, canoe, view, seats: [], corrUntil: 0, pitch: 0, roll: 0, shake: 0, surge: 0, sprayT: 0, phase: idx * 2.1 };
    };
    const teams: [TeamState, TeamState] = [makeTeam(0), makeTeam(1)];

    const seats: Seat[] = [];
    [mine, theirs].forEach((members, ti) => {
      members.forEach((id, role) => {
        const info = ctx.players.find((p) => p.id === id);
        const cpu = automated.has(id) || id !== localId;
        const team = teams[ti];
        const seat: Seat = {
          id,
          name: info?.name ?? `P${id}`,
          team: ti as 0 | 1,
          role: role as 0 | 1,
          cpu,
          pad: newPaddler(),
          brain: cpu ? newCpuSeat(ctx.rng) : null,
          char: ctx.characters[id] ?? null,
          paddle: team.view.paddles[role],
          leanX: 0,
          leanZ: 0,
        };
        seat.paddle.side = role === 0 ? 1 : -1;
        seat.paddle.tilt = seat.paddle.side * 1.28;
        team.seats.push(seat);
        seats.push(seat);
        const ch = seat.char;
        if (ch) {
          ch.group.scale.setScalar(CHAR_SCALE);
          ch.anim.idle();
        }
      });
    });
    seats.sort((p, q) => p.id - q.id);

    // The camera: fit the first stretch of river, then follow the leader's progress.
    const y0 = riverY(0);
    const followOff = new THREE.Vector3();
    const lookOff = new THREE.Vector3();
    frameMinigame(
      ctx.camera,
      () => ({
        box: frameBox([-4.9, y0 - 0.2, -19], [4.9, y0 + 2.8, 4]),
        dir: window.innerWidth / window.innerHeight < 1 ? new THREE.Vector3(0, 8.8, 6.6) : new THREE.Vector3(0, 6.4, 8.2),
        fov: 50,
        insets: { top: 92 },
      }),
      (f) => {
        followOff.copy(f.pos).sub(f.look);
        lookOff.set(f.look.x, f.look.y - y0, f.look.z);
      },
    );
    const follow = createFollowCamera(ctx.camera, { offset: followOff });

    const hud = mountRaceHud({
      colors: [TEAM_STYLE[0].hull, TEAM_STYLE[1].hull],
      labels: { a: "LEFT", b: "RIGHT" },
      flag: "🏁",
    });

    const st: State = {
      ctx, root, kit, fx, env, hud, course, teams, seats,
      human: seats.find((s) => !s.cpu) ?? null,
      coin: coin as 0 | 1,
      follow, followOff, lookOff, followTarget: new THREE.Vector3(),
      events: [], edges: { a: 0, b: 0 },
      step: 0, simTime: 0, presT: 0,
      winner: null, winT: 0, pace: [0, 0], ranking: null, coinWinners: [], finished: false, log: [],
    };
    round = st;

    ctx.hud.unit("strokes");
    for (const s of seats) {
      ctx.hud.score(s.id, 0);
      ctx.hud.tag(s.id, TEAM_STYLE[s.team].name);
    }
    ctx.hud.timer(null);

    // ---- input: LEFT and RIGHT. Each press is one attempt; holding does nothing. ----
    ctx.input.button = (which, down) => {
      if (!down || isPracticeBeat() || st.winner !== null || !st.human) return;
      if (which === "a") st.edges.a++;
      else st.edges.b++;
      st.events.push({ side: which, t: st.step * FIXED_DT + st.simTime });
    };
    ctx.input.pointer = () => {};
    ctx.input.key = () => {};

    for (const team of teams) placeTeam(st, team, 1 / 60, 0);
    st.followTarget.set(lookOff.x, y0 + lookOff.y, lookOff.z);
    st.follow.update(0, st.followTarget);
    publish(st);
  },

  update(dt: number) {
    const st = round;
    if (!st) return;
    if (!isPracticeBeat() && !st.finished) {
      st.simTime += dt;
      let steps = 0;
      while (st.simTime >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        stepFixed(st);
        st.simTime -= FIXED_DT;
        st.step++;
        steps++;
        if (st.winner !== null && st.step * FIXED_DT >= st.winT + POST_FINISH && st.ranking) {
          st.finished = true;
          for (const s of st.seats) {
            if (!s.char) continue;
            s.char.group.rotation.set(0, 0, 0);
            s.char.group.scale.setScalar(1);
          }
          note(st, `finish ${st.ranking.join(",")}`);
          st.ctx.finish(st.ranking, st.coinWinners);
          break;
        }
      }
      if (steps >= MAX_STEPS_PER_FRAME && st.simTime >= FIXED_DT) st.simTime = 0;
    }
    if (!st.finished) updateVisuals(st, dt);
    publish(st);
  },

  teardown() {
    const st = round;
    if (!st) return;
    st.hud.destroy();
    st.env.dispose();
    st.fx.dispose();
    for (const s of st.seats) {
      if (!s.char) continue;
      s.char.group.rotation.set(0, 0, 0);
      s.char.group.scale.setScalar(1);
    }
    st.kit.dispose();
    st.root.removeFromParent();
    round = null;
    (window as unknown as { __ROWRUMBLE__?: unknown }).__ROWRUMBLE__ = undefined;
  },
};

registerMinigame({ id: rowRumble.id, name: rowRumble.name });

export function loadRowRumble(): Promise<Minigame> {
  return Promise.resolve(rowRumble);
}

export default rowRumble;
