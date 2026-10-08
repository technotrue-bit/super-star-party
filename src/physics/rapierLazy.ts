/**
 * Loaded only from a contact minigame (or the debug contact scenario).
 * One fixed 1/60 s step per call. Bodies are created in caller order.
 */
import RAPIER from "@dimforge/rapier3d-compat";
// Package exports hide the wasm file. A relative import lets Vite emit it.
// fileURLToPath is not required here: this is an asset URL, not a Node path.
import wasmUrl from "../../node_modules/@dimforge/rapier3d-compat/dist/rapier_wasm3d_bg.wasm?url";
import {
  clearContactStats,
  noteBodies,
  noteContacts,
  type BallArena,
  type BallArenaOptions,
  type ContactHit,
  type RailCrate,
  type RailCrateOptions,
  type XzBody,
} from "./contact";

const STEP = 1 / 60;
const WALL_SEGMENTS = 32;
const WALL_THICK = 0.4;

type InitFn = (opts?: { module_or_path?: string }) => Promise<void>;

let starting: Promise<void> | null = null;

export function init(): Promise<void> {
  if (!starting) {
    const initRapier = RAPIER.init as InitFn;
    starting = initRapier({ module_or_path: wasmUrl }).catch((err: unknown) => {
      starting = null;
      throw err;
    });
  }
  return starting;
}

interface BallRec {
  id: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  pre: { x: number; z: number; vx: number; vz: number };
}

function yawToRadial(phi: number): { x: number; y: number; z: number; w: number } {
  const theta = Math.PI / 2 - phi;
  return { x: 0, y: Math.sin(theta / 2), z: 0, w: Math.cos(theta / 2) };
}

export function createBallArena(options: BallArenaOptions): BallArena {
  clearContactStats();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = STEP;
  const balls: BallRec[] = [];
  const wallHandles = new Set<number>();
  let staticBodies = 0;

  const inner = options.wallInner;
  const arc = (2 * Math.PI * inner) / WALL_SEGMENTS;
  for (let i = 0; i < WALL_SEGMENTS; i++) {
    const phi = (i / WALL_SEGMENTS) * Math.PI * 2;
    const radius = inner + WALL_THICK / 2;
    const fixed = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(Math.cos(phi) * radius, 0.55, Math.sin(phi) * radius)
        .setRotation(yawToRadial(phi)),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(arc * 0.55, 1.2, WALL_THICK / 2)
        .setRestitution(options.wallRestitution)
        .setFriction(0),
      fixed,
    );
    wallHandles.add(collider.handle);
    staticBodies++;
  }

  const publish = (): void => {
    noteBodies(staticBodies + balls.length);
  };
  publish();

  return {
    addBall(id, x, z, radius): XzBody {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, radius, z)
          .lockRotations()
          .enabledTranslations(true, false, true)
          .setCanSleep(false),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.ball(radius)
          .setRestitution(options.ballRestitution)
          .setFriction(0)
          .setDensity(1),
        body,
      );
      const rec: BallRec = { id, body, collider, pre: { x, z, vx: 0, vz: 0 } };
      balls.push(rec);
      publish();
      return {
        setVelocity(vx, vz) {
          body.setLinvel({ x: vx, y: 0, z: vz }, true);
          const t = body.translation();
          rec.pre = { x: t.x, z: t.z, vx, vz };
        },
        pose() {
          const t = body.translation();
          const v = body.linvel();
          return { x: t.x, z: t.z, vx: v.x, vz: v.z };
        },
        setEnabled(on) {
          body.setEnabled(on);
        },
      };
    },
    step() {
      world.step();
      const hits: ContactHit[] = [];
      const ordered = [...balls].sort((a, b) => a.id - b.id);
      const byId = new Map(ordered.map((ball) => [ball.id, ball]));
      for (const ball of ordered) {
        if (!ball.body.isEnabled()) continue;
        world.contactPairsWith(ball.collider, (other) => {
          if (wallHandles.has(other.handle)) {
            const pre = ball.pre;
            const d = Math.hypot(pre.x, pre.z);
            const nx = d > 1e-6 ? pre.x / d : 1;
            const nz = d > 1e-6 ? pre.z / d : 0;
            const approach = pre.vx * nx + pre.vz * nz;
            hits.push({ a: ball.id, b: -1, approach: approach > 0 ? approach : 0, nx, nz });
            return;
          }
          const otherId = ordered.find((candidate) => candidate.collider.handle === other.handle)?.id;
          if (otherId == null || otherId <= ball.id) return;
          const otherBall = byId.get(otherId);
          if (!otherBall) return;
          const dx = otherBall.pre.x - ball.pre.x;
          const dz = otherBall.pre.z - ball.pre.z;
          const dist = Math.hypot(dx, dz);
          const nx = dist > 1e-6 ? dx / dist : 1;
          const nz = dist > 1e-6 ? dz / dist : 0;
          const rv =
            (otherBall.pre.vx - ball.pre.vx) * nx + (otherBall.pre.vz - ball.pre.vz) * nz;
          hits.push({
            a: ball.id,
            b: otherId,
            approach: rv < 0 ? -rv : 0,
            nx,
            nz,
          });
        });
      }
      hits.sort((p, q) => p.a - q.a || p.b - q.b);
      noteContacts(hits.length);
      publish();
      return hits;
    },
    bodyCount() {
      return staticBodies + balls.length;
    },
    dispose() {
      world.free();
      noteBodies(0);
    },
  };
}

export function createRailCrate(options: RailCrateOptions): RailCrate {
  clearContactStats();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = STEP;
  const damping = (1 / options.friction - 1) / STEP;
  // Impulse is scaled so one Rapier step matches the minigame's discrete
  // update: v += force * gain; v *= friction; x += v. Rapier damps inside
  // the step, so the impulse carries one extra friction factor.
  const impulseScale = options.velocityGain * 60 * options.friction;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0, 0)
      .lockRotations()
      .enabledTranslations(true, false, false)
      .setLinearDamping(damping)
      .setCanSleep(false),
  );
  const crate = world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.01, 0.2, 0.2).setMass(1).setFriction(0).setRestitution(0),
    body,
  );
  let bodies = 1;
  for (const sign of [-1, 1]) {
    const stop = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(sign * (options.range + 0.25), 0, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 0.5, 0.5).setFriction(0).setRestitution(0),
      stop,
    );
    bodies++;
  }
  noteBodies(bodies);

  return {
    applyPush(netForce) {
      body.applyImpulse({ x: netForce * impulseScale, y: 0, z: 0 }, true);
      world.step();
      let contacts = 0;
      world.contactPairsWith(crate, () => {
        contacts++;
      });
      noteContacts(contacts);
      noteBodies(bodies);
    },
    pose() {
      return { x: body.translation().x, vx: body.linvel().x / 60 };
    },
    dispose() {
      world.free();
      noteBodies(0);
    },
  };
}

/** Headless two-ball bounce. Leaves the minigame world stats alone. */
export function runBallContact(): { contacted: boolean; separated: boolean; minGap: number } {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = STEP;
  const make = (x: number, vx: number) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 0.5, 0)
        .lockRotations()
        .enabledTranslations(true, false, true)
        .setCanSleep(false)
        .setLinvel(vx, 0, 0),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.ball(0.5).setRestitution(0.4).setFriction(0).setDensity(1),
      body,
    );
    return { body, collider };
  };
  const a = make(-2, 4);
  const b = make(2, -4);
  let minGap = Infinity;
  let contacted = false;
  for (let i = 0; i < 90; i++) {
    world.step();
    const gap = Math.abs(a.body.translation().x - b.body.translation().x) - 1;
    if (gap < minGap) minGap = gap;
    let hit = false;
    world.contactPairsWith(a.collider, () => {
      hit = true;
    });
    if (hit) contacted = true;
  }
  const endGap = Math.abs(a.body.translation().x - b.body.translation().x) - 1;
  const separated = endGap > 0.2 && a.body.linvel().x < 0 && b.body.linvel().x > 0;
  const touched = contacted || minGap < 0.05;
  world.free();
  return { contacted: touched, separated, minGap };
}
