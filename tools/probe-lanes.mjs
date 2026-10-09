// Lane look + cost probe.
//
// Opens the board (?lively=0, seed 7) at 390x844 and 430x932, waits for the
// local dice phase with the party camera at rest, then renders fixed,
// deterministic camera framings straight to the canvas (bypassing the party
// camera rig and post FX) and saves PNGs:
//   <w>-full.png      whole board from a fixed high angle
//   <w>-junction.png  close-up of the outer->inner junction (6 -> 32)
//   <w>-curve.png     close-up of the sharpest outer-loop corner
//   <w>-shortcut.png  close-up of the bent shortcut (20 -> 26)
// It also reports the lane cost: draw calls and triangles of lane meshes
// (meshes tagged userData.lane, or, on the old code, the ShapeGeometry
// capsules parented straight to the board group), plus whole-frame perf().
//
//   SSP_SHOTS=/workspace/ssp-lanes/after node tools/probe-lanes.mjs
//   SSP_LANE_MAX_CALLS=3 (default) gate; SSP_LANE_MAX_TRIS=6000 (default) gate
//
// Prints JSON. Exits 1 on a page error or a failed gate (gate off with SSP_LANE_GATE=0).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const URL = `${BASE}/?seed=7&screen=board&audio=0&lively=0`;
const SHOTS = process.env.SSP_SHOTS ?? "/tmp/ssp-lanes";
const GATE = process.env.SSP_LANE_GATE !== "0";
const MAX_CALLS = Number(process.env.SSP_LANE_MAX_CALLS ?? 3);
const MAX_TRIS = Number(process.env.SSP_LANE_MAX_TRIS ?? 6000);
const WIDTHS = [
  [390, 844],
  [430, 932],
];
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const fail = (m) => {
  failures.push(m);
  console.log(`FAIL ${m}`);
};

async function settle(page) {
  let last = null;
  let still = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const st = await page.evaluate(() => {
      const s = window.__SSP__.state();
      const m = s.match ?? {};
      const who = m.players?.[m.currentPlayer];
      const local = who ? (who.controller ?? (m.currentPlayer === 0 ? "local" : "cpu")) === "local" : false;
      return { phase: m.phase, local, cam: JSON.stringify(s.camera?.pos ?? null) };
    });
    still = st.phase === "dice" && st.local && st.cam === last ? still + 1 : 0;
    last = st.cam;
    if (still >= 4) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const browser = await chromium.launch();
const out = { url: URL, shots: SHOTS, widths: {} };
try {
  for (const [w, h] of WIDTHS) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__SSP__?.state?.().screen === "board", null, { timeout: 45000 });
    await page.waitForTimeout(3000);
    const settled = await settle(page);
    const perf = await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(window.__SSP__.perf()))))
    );
    const res = await page.evaluate(async () => {
      // Import the SAME main.ts module instance the app booted from (after an
      // HMR update Vite serves it as /src/main.ts?t=..., and a plain import
      // would boot a second app).
      const urls = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .filter((n) => /\/src\/main\.ts(\?|$)/.test(n));
      const mainUrl = urls.find((u) => u.includes("?t=")) ?? urls[0] ?? "/src/main.ts";
      const { world } = await import(mainUrl);
      if (document.querySelectorAll("canvas").length > 1) return { error: "second app booted" };
      const { renderer, scene } = world;
      let board = null;
      scene.traverse((o) => {
        if (!board && typeof o.name === "string" && o.name.startsWith("board:")) board = o;
      });
      if (!board) return { error: "no board group" };
      const { fizzyFairground: def } = await import("/src/board/boardData.ts");
      const P = (i) => {
        const s = def.spaces[i];
        const v = world.camera.position.clone().set(s.x, 0, s.y);
        return board.localToWorld(v);
      };
      // ---- lane cost ----
      const tagged = [];
      board.traverse((o) => {
        if (o.isMesh && o.userData?.lane) tagged.push(o);
      });
      const lanes = tagged.length
        ? tagged
        : board.children.filter((o) => o.isMesh && o.geometry?.type === "ShapeGeometry");
      let calls = 0;
      let tris = 0;
      for (const m of lanes) {
        if (!m.visible) continue;
        const g = m.geometry;
        const inst = m.isInstancedMesh ? m.count : 1;
        const groups = Array.isArray(m.material) && g.groups.length ? g.groups.length : 1;
        calls += groups;
        tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * inst;
        if (m.castShadow) calls += groups; // shadow pass
      }
      // ---- framings ----
      const cam = world.camera.clone();
      const n = def.loops[0].length;
      // sharpest outer corner
      let best = 0;
      let bestAng = -1;
      for (let k = 0; k < n; k++) {
        const a = P(def.loops[0][(k + n - 1) % n]);
        const b = P(def.loops[0][k]);
        const c = P(def.loops[0][(k + 1) % n]);
        const d1 = b.clone().sub(a).normalize();
        const d2 = c.clone().sub(b).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, d1.dot(d2))));
        // Sharpest turn, ties broken away from the start space (tokens stand there).
        const score = ang * 10 + b.distanceTo(P(def.startIndex ?? 0)) * 0.01;
        if (score > bestAng + 1e-3) {
          bestAng = score;
          best = def.loops[0][k];
        }
      }
      const pts = def.spaces.map((_, i) => P(i));
      const min = pts[0].clone();
      const max = pts[0].clone();
      for (const p of pts) {
        min.min(p);
        max.max(p);
      }
      const ctr = min.clone().add(max).multiplyScalar(0.5);
      const halfW = (max.x - min.x) / 2 + 1.6;
      const hfov = 2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect);
      const dist = (halfW / Math.tan(hfov / 2)) * 1.12 + 2;
      const mid = (i, j) => P(i).add(P(j)).multiplyScalar(0.5);
      const frames = {
        full: { target: ctr, dist, elev: 68, yaw: 0 },
        junction: { target: mid(6, 32), dist: 9, elev: 50, yaw: 20 },
        curve: { target: P(best), dist: 9, elev: 50, yaw: -25 },
        shortcut: { target: mid(20, 26), dist: 11, elev: 55, yaw: 10 },
      };
      const imgs = {};
      for (const [name, f] of Object.entries(frames)) {
        const e = (f.elev * Math.PI) / 180;
        const y = (f.yaw * Math.PI) / 180;
        cam.position.set(
          f.target.x + Math.sin(y) * Math.cos(e) * f.dist,
          f.target.y + Math.sin(e) * f.dist,
          f.target.z + Math.cos(y) * Math.cos(e) * f.dist
        );
        cam.up.set(0, 1, 0);
        cam.lookAt(f.target);
        cam.updateMatrixWorld();
        renderer.setRenderTarget(null);
        renderer.render(scene, cam);
        imgs[name] = renderer.domElement.toDataURL("image/png");
      }
      return {
        lanes: { meshes: lanes.length, tagged: tagged.length > 0, calls, tris: Math.round(tris) },
        corner: best,
        imgs,
      };
    });
    if (res.error) {
      fail(`${w}: ${res.error}`);
    } else {
      for (const [name, url] of Object.entries(res.imgs)) {
        writeFileSync(join(SHOTS, `${w}-${name}.png`), Buffer.from(url.split(",")[1], "base64"));
      }
      delete res.imgs;
    }
    out.widths[w] = { settled, frame: { calls: perf.calls, triangles: perf.triangles }, ...res, errors };
    if (errors.length) fail(`${w}: page errors ${errors.join(" | ")}`);
    if (GATE && res.lanes) {
      if (res.lanes.calls > MAX_CALLS) fail(`${w}: lane calls ${res.lanes.calls} > ${MAX_CALLS}`);
      if (res.lanes.tris > MAX_TRIS) fail(`${w}: lane tris ${res.lanes.tris} > ${MAX_TRIS}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
out.ok = failures.length === 0;
out.failures = failures;
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
