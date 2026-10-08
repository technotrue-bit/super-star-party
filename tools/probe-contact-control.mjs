/**
 * probe-contact-control.mjs — phone stick and TAP for the contact minigames.
 *
 * Requires a dev server (SSP_URL, default http://127.0.0.1:5177).
 * Opens each game with __SSP__.openMinigame at a phone viewport and touch.
 *
 * SSP_EXPECT_TRANSPORT=tabs|server checks which relay the page was built
 * with. The party URL is a dev-server env var, not an env file.
 *
 * Run: node tools/probe-contact-control.mjs
 * Exits non-zero when any check fails.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.SSP_URL ?? "http://127.0.0.1:5177";
const EXPECT_TRANSPORT = (process.env.SSP_EXPECT_TRANSPORT ?? "").trim();
const VIEW = { width: 390, height: 844 };

const reasons = [];
function fail(message) {
  reasons.push(message);
  console.error(`FAIL: ${message}`);
}

function xzGap(seat) {
  return Math.hypot(seat.body.x - seat.model.x, seat.body.z - seat.model.z);
}

function gap(seat) {
  return Math.hypot(seat.body.x - seat.model.x, seat.body.y - seat.model.y, seat.body.z - seat.model.z);
}

async function boot(page) {
  await page.goto(`${BASE}/?audio=0&fx=off&seed=7`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state?.()?.screen === "title", null, { timeout: 45000 });
}

async function openGame(page, id) {
  await page.evaluate((gameId) => window.__SSP__.openMinigame(gameId), id);
  await page.waitForFunction(
    (gameId) => {
      const st = window.__SSP__?.state?.();
      if (!st || st.screen !== "minigame" || st.isWiping) return false;
      if (gameId === "bumper_balls") return window.__BB__?.seats?.length === 4;
      if (gameId === "coin_grab") return window.__CG__?.seats?.length === 4;
      return !!window.__POW__;
    },
    id,
    { timeout: 45000 },
  );
}

async function readMirror(page, id) {
  return page.evaluate((gameId) => {
    const mirror = gameId === "bumper_balls" ? window.__BB__ : gameId === "coin_grab" ? window.__CG__ : window.__POW__;
    const party = window.__SSP__.party();
    return {
      online: party.online,
      transport: party.transport,
      seats: mirror?.seats ?? null,
      pow: gameId === "push_of_war"
        ? { contributions: mirror?.contributions ?? null, solo: mirror?.solo ?? null, t: mirror?.t ?? null }
        : null,
    };
  }, id);
}

async function waitForStick(page) {
  await page.waitForFunction(() => {
    const stick = document.querySelector(".ssp-touch.ssp-touch--on .ssp-stick");
    if (!stick) return false;
    const r = stick.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  }, null, { timeout: 45000 });
}

async function localSeat(page, id) {
  const snap = await readMirror(page, id);
  const seats = snap.seats ?? [];
  return seats.find((seat) => seat.controller === "local") ?? null;
}

/** Sim seconds the stick stays down. Short enough that a slow frame cannot walk off the ring. */
const DRAG_SIM_SEC = 0.2;
/**
 * Degrees the screen delta may lean off the intended axis.
 * Coin grab's camera squashes vertical pixels, so a pure ground move
 * can pick up a little screen-x without leaving the intended direction.
 */
const AXIS_TOLERANCE_DEG = 35;
const MIN_AXIS_PX = 6;

function mirrorTime(gameId) {
  const mirror = gameId === "bumper_balls" ? window.__BB__ : window.__CG__;
  return mirror?.t ?? 0;
}

async function simTime(page, id) {
  return page.evaluate(mirrorTime, id);
}

async function releasePointer(page) {
  await page.mouse.up().catch(() => {});
}

/**
 * Park the local seat and hold every CPU still.
 * The hook is ignored unless a probe sets it, so a normal round never takes this path.
 */
async function placeLocal(page, id, x, z) {
  await releasePointer(page);
  await page.evaluate(({ x: px, z: pz }) => {
    const hook = (window.__SSP_CONTACT__ ??= {});
    hook.freezeCpu = true;
    hook.placeLocal = { x: px, z: pz };
  }, { x, z });
  await page.waitForFunction(
    ({ gameId, x: px, z: pz }) => {
      const mirror = gameId === "bumper_balls" ? window.__BB__ : window.__CG__;
      const seat = mirror?.seats?.find((s) => s.controller === "local" && s.alive !== false);
      if (!seat) return false;
      return Math.hypot(seat.body.x - px, seat.body.z - pz) <= 0.3;
    },
    { gameId: id, x, z },
    { timeout: 8000 },
  );
}

async function waitSim(page, id, start, simSec) {
  await page.waitForFunction(
    ({ gameId, start: t0, need }) => {
      const mirror = gameId === "bumper_balls" ? window.__BB__ : window.__CG__;
      return (mirror?.t ?? 0) - t0 >= need;
    },
    { gameId: id, start, need: simSec },
    { timeout: 8000 },
  );
}

/**
 * Drag the thumb stick and return the local seat's screen delta.
 * dx/dy are CSS pixels from the stick center (screen +y down).
 * The hold is sim time, not wall clock, and the pointer moves in one step
 * so a slow runner cannot keep the stick down while Playwright interpolates.
 */
async function dragStick(page, id, dx, dy, simSec) {
  const box = await page.locator(".ssp-stick").boundingBox();
  if (!box) throw new Error("move stick is not on screen");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy);
  const before = await localSeat(page, id);
  const start = await simTime(page, id);
  try {
    await waitSim(page, id, start, simSec);
  } finally {
    await releasePointer(page);
  }
  const after = await localSeat(page, id);
  if (!before?.screen || !after?.screen) return null;
  return {
    dx: after.screen.x - before.screen.x,
    dy: after.screen.y - before.screen.y,
    alive: after.alive,
  };
}

function axisAngleDeg(primary, other) {
  return (Math.atan2(Math.abs(other), Math.abs(primary)) * 180) / Math.PI;
}

function assertMoved(id, name, moved, expect) {
  if (!moved) {
    fail(`${id} ${name}: no local seat during the drag`);
    return;
  }
  const primary = expect.axis === "x" ? moved.dx : moved.dy;
  const other = expect.axis === "x" ? moved.dy : moved.dx;
  const angle = expect.axis === "both" ? null : axisAngleDeg(primary, other);
  console.log(
    `   ${name}: screen Δ (${moved.dx.toFixed(1)}, ${moved.dy.toFixed(1)}) alive=${moved.alive}` +
      (angle == null ? "" : ` off-axis=${angle.toFixed(0)}°`),
  );
  if (expect.axis === "both") {
    if (!(moved.dx >= MIN_AXIS_PX && moved.dy <= -MIN_AXIS_PX)) {
      fail(`${id} diagonal: wanted up-right on screen, got Δ (${moved.dx.toFixed(1)}, ${moved.dy.toFixed(1)})`);
    }
    return;
  }
  const rightWay = expect.sign < 0 ? primary <= -MIN_AXIS_PX : primary >= MIN_AXIS_PX;
  if (!rightWay || angle > AXIS_TOLERANCE_DEG) {
    fail(`${id} ${name}: wanted ${expect.label} on screen, got Δ (${moved.dx.toFixed(1)}, ${moved.dy.toFixed(1)})`);
  }
}

/**
 * Model-vs-body gap for seats that are still in.
 * A knockout fall swings the model after alive flips false, so those seats are skipped.
 * Bounce's idle fidget lifts the group by about 0.14 for under a second, and the walk
 * hop does the same while a seat is moving. Measure a frame where every living model
 * is back on its body. The ground gap is still required on that frame.
 */
async function assertAliveGap(page, id, when) {
  const deadline = Date.now() + 8000;
  let snap = null;
  let settled = false;
  while (Date.now() < deadline) {
    snap = await readMirror(page, id);
    const alive = (snap.seats ?? []).filter((seat) => seat.alive);
    settled = alive.length > 0 && alive.every((seat) => gap(seat) <= 0.05 && xzGap(seat) <= 0.05);
    if (settled) break;
    await page.waitForTimeout(40);
  }
  for (const seat of snap?.seats ?? []) {
    if (!seat.alive) continue;
    const d = gap(seat);
    const xz = xzGap(seat);
    console.log(`   seat ${seat.id} alive gap=${d.toFixed(4)} xz=${xz.toFixed(4)} ${when}`);
    if (!settled && (xz > 0.05 || d > 0.05)) {
      fail(`${id} seat ${seat.id}: model and body are ${d.toFixed(3)} apart (xz ${xz.toFixed(3)}) ${when}`);
    }
  }
}

async function checkArena(page, id) {
  console.log(`\n${id}`);
  await boot(page);
  await openGame(page, id);
  await page.evaluate(() => {
    const hook = (window.__SSP_CONTACT__ ??= {});
    hook.freezeCpu = true;
  });
  const snap = await readMirror(page, id);
  console.log(`   online=${snap.online} transport=${snap.transport}`);
  if (snap.online !== false) fail(`${id}: match is online`);
  if (EXPECT_TRANSPORT && snap.transport !== EXPECT_TRANSPORT) {
    fail(`${id}: party transport is ${snap.transport}, wanted ${EXPECT_TRANSPORT}`);
  }
  const seats = snap.seats ?? [];
  const seat0 = seats.find((seat) => seat.id === 0);
  if (!seat0 || seat0.controller !== "local") {
    fail(`${id}: seat 0 is not local (${JSON.stringify(seats.map((s) => [s.id, s.controller]))})`);
  }
  if (seats.length !== 4) fail(`${id}: expected 4 seats, got ${seats.length}`);
  for (const seat of seats) {
    if (!seat.alive) continue;
    const d = gap(seat);
    const xz = xzGap(seat);
    console.log(
      `   seat ${seat.id} ${seat.controller} alive=${seat.alive} gap=${d.toFixed(4)} xz=${xz.toFixed(4)} body=(${seat.body.x},${seat.body.z}) model=(${seat.model.x},${seat.model.z})`,
    );
    if (xz > 0.05 || d > 0.05) {
      fail(`${id} seat ${seat.id}: model and body are ${d.toFixed(3)} apart (xz ${xz.toFixed(3)})`);
    }
  }

  await waitForStick(page);
  const drags = [
    { name: "up", dx: 0, dy: -52, axis: "y", sign: -1, label: "up" },
    { name: "left", dx: -52, dy: 0, axis: "x", sign: -1, label: "left" },
    { name: "down", dx: 0, dy: 52, axis: "y", sign: 1, label: "down" },
    { name: "right", dx: 52, dy: 0, axis: "x", sign: 1, label: "right" },
    { name: "diagonal", dx: 40, dy: -40, axis: "both", sign: 1, label: "up-right" },
  ];
  for (const drag of drags) {
    await placeLocal(page, id, 0, 0);
    const moved = await dragStick(page, id, drag.dx, drag.dy, DRAG_SIM_SEC);
    assertMoved(id, drag.name, moved, drag);
    await assertAliveGap(page, id, "after " + drag.name);
  }

  // Survival is its own check: a short shove toward the middle must leave Pip in.
  await placeLocal(page, id, 0, 1.5);
  const toward = await dragStick(page, id, 0, -52, 0.15);
  const survived = await localSeat(page, id);
  console.log(
    `   toward centre: screen Δ (${toward ? toward.dx.toFixed(1) : "?"}, ${toward ? toward.dy.toFixed(1) : "?"}) alive=${survived?.alive}`,
  );
  if (!survived?.alive) fail(`${id}: local seat was knocked out by a short drag toward the centre`);
  else if (!toward || !(toward.dy < -MIN_AXIS_PX)) {
    fail(`${id}: drag toward the centre did not move up on screen`);
  } else {
    console.log("   local seat still alive");
  }
  await assertAliveGap(page, id, "after the survival drag");
}

async function checkPush(page) {
  console.log("\npush_of_war");
  await boot(page);
  await openGame(page, "push_of_war");
  const snap = await readMirror(page, "push_of_war");
  console.log(`   online=${snap.online} transport=${snap.transport} solo=${snap.pow?.solo}`);
  if (snap.online !== false) fail("push_of_war: match is online");
  if (EXPECT_TRANSPORT && snap.transport !== EXPECT_TRANSPORT) {
    fail(`push_of_war: party transport is ${snap.transport}, wanted ${EXPECT_TRANSPORT}`);
  }
  await waitForStick(page);
  const before = await page.evaluate(() => window.__POW__?.contributions?.[0] ?? null);
  const box = await page.locator(".ssp-act").boundingBox();
  if (!box) {
    fail("push_of_war: TAP button is not on screen");
    return;
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    pip: window.__POW__?.contributions?.[0] ?? null,
    solo: window.__POW__?.solo ?? null,
    all: window.__POW__?.contributions ?? null,
  }));
  console.log(`   Pip push ${before} -> ${after.pip} (solo seat ${after.solo}) contributions=${JSON.stringify(after.all)}`);
  if (typeof before !== "number" || typeof after.pip !== "number" || !(after.pip > before)) {
    fail(`push_of_war: TAP did not increase Pip's push (${before} -> ${after.pip})`);
  } else if (after.solo === 0 && after.pip < before + 1.5) {
    fail(`push_of_war: Pip is solo and a TAP only added ${(after.pip - before).toFixed(2)}`);
  } else {
    console.log("   TAP increased Pip's push");
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEW, hasTouch: true });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err).slice(0, 240)));

try {
  console.log(`contact control probe @ ${BASE} viewport ${VIEW.width}x${VIEW.height}`);
  await checkArena(page, "bumper_balls");
  await checkArena(page, "coin_grab");
  await checkPush(page);
  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
} catch (err) {
  fail(err?.message ?? String(err));
} finally {
  await browser.close();
}

if (reasons.length) {
  console.error(`\n${reasons.length} check(s) failed`);
  process.exit(1);
}
console.log("\ncontact control probe passed");
