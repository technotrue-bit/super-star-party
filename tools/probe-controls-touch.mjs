// Probe: phone (touch) UI for the new control pads, through the hidden control_lab minigame.
// A 390x844 mobile context drives real touches with CDP Input.dispatchTouchEvent and reads the
// calls back from __SSP__.mgProbe().inputs (and window.__CONTROL_LAB__.dialSum for the dial):
//   hold   press the big button ~700 ms -> hold:1:0.00, hold:0:<~held>; the charge ring fills while
//          held; a long hold is capped at 1.5; a cancelled touch ends the hold
//   swipe  flick up -> one swipe:0.00:-1.00:<p>, 0 < p <= 1; a tap and a short drag log nothing
//   twin   two fingers on the two buttons -> button:a:1, b:1, a:0, b:0; the stick is hidden
//   dial   circle a finger clockwise around the wheel -> positive turns, counter-clockwise -> negative
//   draw   drag -> draw:start, >=5 draw:move, draw:end
// Review Focus cases:
//   hold + second finger  (steer=1)  touch 2 works the stick and lifts: no extra hold:1, no hold:0
//                                     until touch 1 lifts
//   swipe from a pad button (steer=1) a swipe that starts on the stick logs no swipe
//   hold-through-GO                   a finger put down during the countdown and still down at GO starts
//                                     the hold at GO (hold:1:0.00 once), and the charge counts from GO
//   rotate                            844x390 mid-round: the dial still turns the right way and the
//                                     camera reframes once, then stays fixed
// Prints PASS touch <case> or FAIL touch <case> ...; exit code 1 on any fail.
import { chromium } from "@playwright/test";

const ONLY = process.argv.slice(2);
const BASE = "http://127.0.0.1:5177/";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
let failed = false;

// `early(page, cdp)` runs once, at the first countdown / practice / go phase, before play begins.
async function boot(query, early) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 150)));
  await page.goto(`${BASE}?seed=7&audio=0&minigame=control_lab&${query}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__SSP__.seed(7);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  const t0 = Date.now();
  let phase = "";
  let earlyDone = false;
  while (Date.now() - t0 < 60000) {
    phase = await page.evaluate(() => window.__SSP__.mgProbe().phase);
    if (phase === "play") break;
    if (phase === "vs-splash") await page.keyboard.press("Space");
    else if (phase === "") await page.getByText("START MINI GAME").click({ timeout: 2500 }).catch(() => {});
    else if (early && !earlyDone && (phase === "countdown" || phase === "practice" || phase === "go")) {
      earlyDone = true;
      await early(page, cdp);
    }
    await page.waitForTimeout(early && !earlyDone ? 40 : 150);
  }
  if (early && !earlyDone) throw new Error("never saw a countdown phase for the early touch");
  if (phase !== "play") throw new Error(`never reached play (phase=${phase || "none"})`);
  // The browser's own pointer timestamps, so timing is judged against events, not wall clock.
  await page.evaluate(() => {
    window.__ptr = [];
    for (const type of ["pointerdown", "pointerup", "pointercancel"]) {
      window.addEventListener(type, (e) => window.__ptr.push({ type, id: e.pointerId, t: e.timeStamp, el: e.target?.className }), true);
    }
  });
  return { ctx, page, cdp };
}

const inputs = (page) => page.evaluate(() => [...window.__SSP__.mgProbe().inputs]);
const dialSum = (page) => page.evaluate(() => window.__CONTROL_LAB__?.dialSum ?? NaN);
const cam = (page) => page.evaluate(() => window.__SSP__.mgProbe().cam);
const centerOf = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === "none" || r.width === 0) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }, sel);
const visible = async (page, sel) => (await centerOf(page, sel)) !== null;

// CDP: touchEnd and touchCancel carry the points that ended (the others stay down).
// This rig takes ~800 ms to deliver one touch event, so a swipe or a hold judged on arrival time
// would be nonsense. Each event therefore carries its own timestamp, `dt` seconds after the last
// one, and the pads read it from PointerEvent.timeStamp as they do on a real phone. dt = null
// sends no timestamp: the event is stamped on arrival, in real time.
const send = (cdp, type, pts, dt = 0.02) => {
  const params = { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) };
  if (dt !== null) {
    // A first finger down starts a fresh gesture clock at "now"; the rest follow dt apart.
    if (type === "touchStart" && pts.length === 1) cdp.__t = Date.now() / 1000;
    cdp.__t = (cdp.__t ?? Date.now() / 1000) + dt;
    params.timestamp = cdp.__t;
  }
  return cdp.send("Input.dispatchTouchEvent", params);
};
const P = (id, x, y) => ({ id, x, y });

async function holdCases(page, cdp) {
  const b = await centerOf(page, ".ssp-hold");
  if (!b) return "no .ssp-hold button on a hold pad";
  if (Math.abs(b.w - 120) > 2) return `hold button is ${b.w}px, want 120`;
  if (await visible(page, ".ssp-stick")) return "stick is showing on a hold pad without steer";
  await send(cdp, "touchStart", [P(1, b.x, b.y)], null);
  await page.waitForTimeout(400);
  // Read the ring and how long the finger has really been down in the same
  // instant: on a slow runner the hold can already be past holdMax here, and
  // a full ring is then correct, not a failure.
  const ring1 = await page.evaluate(() => {
    const down = (window.__ptr ?? []).filter((e) => e.type === "pointerdown").at(-1);
    return {
      offset: Number(document.querySelector(".ssp-hold__fill")?.getAttribute("stroke-dashoffset") ?? "NaN"),
      held: down ? (performance.now() - down.t) / 1000 : null,
    };
  });
  await page.waitForTimeout(300);
  await send(cdp, "touchEnd", [P(1, b.x, b.y)], null);
  await page.waitForTimeout(200);
  const a = await inputs(page);
  const m = a.length === 2 && a[0] === "hold:1:0.00" && /^hold:0:(\d+\.\d\d)$/.exec(a[1]);
  if (!m) return `hold gave ${JSON.stringify(a)}`;
  const ptr = await page.evaluate(() => window.__ptr);
  const down = ptr.find((e) => e.type === "pointerdown");
  const up = ptr.find((e) => e.type === "pointerup");
  const real = (up.t - down.t) / 1000;
  // The hold reports the browser's own press-to-release time, capped at holdMax.
  if (Math.abs(Number(m[1]) - Math.min(real, 1.5)) > 0.1) return `held ${real.toFixed(2)} s but hold reported ${m[1]}`;
  if (!(ring1.offset < 100)) return `charge ring did not fill while held (dashoffset ${ring1.offset})`;
  if (ring1.held !== null) {
    // The ring paints (1 - held/holdMax) * 100 each frame; allow a few frames of lag.
    const want = (1 - Math.min(1, ring1.held / 1.5)) * 100;
    if (Math.abs(ring1.offset - want) > 20) {
      return `charge ring at ${ring1.offset.toFixed(0)} after ${ring1.held.toFixed(2)} s held, want about ${want.toFixed(0)}`;
    }
  }
  const ring2 = await page.evaluate(() => Number(document.querySelector(".ssp-hold__fill")?.getAttribute("stroke-dashoffset") ?? "NaN"));
  if (!(ring2 >= 99)) return `charge ring did not empty on release (dashoffset ${ring2})`;
  // A long hold is capped at holdMax (1.5 s).
  const n0 = (await inputs(page)).length;
  await send(cdp, "touchStart", [P(1, b.x, b.y)]);
  await send(cdp, "touchEnd", [P(1, b.x, b.y)], 2.5);
  await page.waitForTimeout(200);
  const d = (await inputs(page)).slice(n0);
  const dm = d.length === 2 && /^hold:0:(\d+\.\d\d)$/.exec(d[1]);
  if (!dm) return `long hold gave ${JSON.stringify(d)}`;
  if (Number(dm[1]) > 1.5 || Number(dm[1]) < 1.4) return `2.5 s hold reported ${dm[1]}, want the 1.50 cap`;
  // A cancelled touch ends the hold too.
  const n1 = (await inputs(page)).length;
  await send(cdp, "touchStart", [P(1, b.x, b.y)]);
  await send(cdp, "touchCancel", [], 0.3);
  await page.waitForTimeout(200);
  const c = (await inputs(page)).slice(n1);
  if (c.length !== 2 || c[0] !== "hold:1:0.00" || !/^hold:0:/.test(c[1])) return `cancelled touch gave ${JSON.stringify(c)}`;
  return null;
}

// A finger down on the hold button during the countdown and kept there through GO.
async function holdEarly(page, cdp) {
  const b = await centerOf(page, ".ssp-hold");
  if (!b) throw new Error("no .ssp-hold button during the countdown");
  await page.evaluate(() => {
    window.addEventListener("pointerdown", (e) => { window.__pid = e.pointerId; window.__downT = performance.now(); }, true);
    // When play began, by the page's own clock.
    new MutationObserver(() => {
      if (document.body.dataset.mgPhase === "play" && !window.__goT) window.__goT = performance.now();
    }).observe(document.body, { attributes: true, attributeFilter: ["data-mg-phase"] });
  });
  await send(cdp, "touchStart", [P(1, b.x, b.y)], null);
}
async function holdThroughGo(page, cdp) {
  const b = await centerOf(page, ".ssp-hold");
  if (!b) return "no .ssp-hold button";
  const mid = await inputs(page);
  if (JSON.stringify(mid) !== JSON.stringify(["hold:1:0.00"])) return `finger held through GO gave ${JSON.stringify(mid)}, want [hold:1:0.00] once`;
  // This rig needs ~1 s to deliver a touch event, which would eat the whole check, so lift the
  // finger with a pointerup raised in the page: the release reaches the pad at once.
  const t = await page.evaluate(() => {
    const at = performance.now();
    document.querySelector(".ssp-hold").dispatchEvent(new PointerEvent("pointerup", { pointerId: window.__pid, bubbles: true }));
    return { sinceGo: (at - window.__goT) / 1000, sinceDown: (at - window.__downT) / 1000 };
  });
  await page.waitForTimeout(100);
  const end = await inputs(page);
  const m = end.length === 2 && /^hold:0:(\d+\.\d\d)$/.exec(end[1]);
  if (!m) return `release after GO gave ${JSON.stringify(end)}`;
  // The finger was down for the whole countdown (over the 1.5 s cap), so a charge counted from the press would read 1.50:
  // the charge must count from GO only.
  if (!(t.sinceDown > 1.6)) return `rig: finger was down only ${t.sinceDown.toFixed(2)} s, cannot tell GO from the press`;
  if (Math.abs(Number(m[1]) - Math.min(1.5, t.sinceGo)) > 0.15) return `charge ${m[1]} s, want the ${t.sinceGo.toFixed(2)} s since GO (finger down ${t.sinceDown.toFixed(2)} s)`;
  await send(cdp, "touchEnd", [P(1, b.x, b.y)], null); // the real finger comes up: no extra input
  await page.waitForTimeout(100);
  if ((await inputs(page)).length !== 2) return `the real lift after the release added input: ${JSON.stringify(await inputs(page))}`;
  // A fresh press still works.
  await send(cdp, "touchStart", [P(2, b.x, b.y)]);
  await send(cdp, "touchEnd", [P(2, b.x, b.y)], 0.3);
  await page.waitForTimeout(200);
  const again = (await inputs(page)).slice(2);
  if (again.length !== 2 || again[0] !== "hold:1:0.00") return `a press after the pre-charge gave ${JSON.stringify(again)}`;
  return null;
}

async function swipeCases(page, cdp) {
  const z = await centerOf(page, ".ssp-swipe");
  if (!z) return "no .ssp-swipe layer on a swipe pad";
  if (z.w < 380 || z.h < 800) return `swipe layer is ${z.w}x${z.h}, not full screen`;
  if (await visible(page, ".ssp-act") || (await visible(page, ".ssp-stick"))) return "buttons showing on a swipe pad without steer";
  // Flick up.
  await send(cdp, "touchStart", [P(1, 250, 600)]);
  for (let i = 1; i <= 6; i++) {
    await send(cdp, "touchMove", [P(1, 250, 600 - i * 50)]);
  }
  await send(cdp, "touchEnd", [P(1, 250, 300)]);
  await page.waitForTimeout(200);
  const a = await inputs(page);
  const m = a.length === 1 && /^swipe:(-?\d\.\d\d):(-?\d\.\d\d):(\d\.\d\d)$/.exec(a[0]);
  if (!m) return `flick up gave ${JSON.stringify(a)}`;
  if (Math.abs(Number(m[1])) > 0.05 || Number(m[2]) > -0.95) return `flick up direction ${m[1]},${m[2]}, want 0,-1`;
  if (!(Number(m[3]) > 0 && Number(m[3]) <= 1)) return `power ${m[3]} out of (0,1]`;
  // A flick down-right is a unit vector (+y down).
  await send(cdp, "touchStart", [P(1, 100, 300)]);
  for (let i = 1; i <= 6; i++) {
    await send(cdp, "touchMove", [P(1, 100 + i * 40, 300 + i * 40)]);
  }
  await send(cdp, "touchEnd", [P(1, 340, 540)]);
  await page.waitForTimeout(200);
  const b = (await inputs(page)).slice(1);
  const bm = b.length === 1 && /^swipe:(-?\d\.\d\d):(-?\d\.\d\d):/.exec(b[0]);
  if (!bm || Math.abs(Number(bm[1]) - 0.71) > 0.06 || Math.abs(Number(bm[2]) - 0.71) > 0.06) return `diagonal flick gave ${JSON.stringify(b)}`;
  // A tap and a 20 px wiggle (under 6% of the height) are not swipes.
  const n = (await inputs(page)).length;
  await send(cdp, "touchStart", [P(1, 200, 400)]);
  await send(cdp, "touchEnd", [P(1, 200, 400)]);
  await page.waitForTimeout(100);
  await send(cdp, "touchStart", [P(1, 200, 400)]);
  await send(cdp, "touchMove", [P(1, 215, 410)]);
  await page.waitForTimeout(40);
  await send(cdp, "touchEnd", [P(1, 215, 410)]);
  await page.waitForTimeout(200);
  const c = (await inputs(page)).slice(n);
  if (c.length) return `tap or wiggle logged ${JSON.stringify(c)}`;
  // A slow drag (6% of the height taking over a second) is a drag, not a swipe at 400 ms.
  const t = await page.evaluate(() => document.querySelector(".ssp-swipe") !== null);
  if (!t) return "swipe layer vanished";
  return null;
}

async function twinCases(page, cdp) {
  const a = await centerOf(page, ".ssp-twin--a");
  const b = await centerOf(page, ".ssp-twin--b");
  if (!a || !b) return "no twin buttons on a twin pad";
  if (Math.abs(a.w - 110) > 2 || Math.abs(b.w - 110) > 2) return `twin buttons are ${a.w}/${b.w}px, want 110`;
  if (!(a.x < 195 && b.x > 195)) return `twin buttons not left and right (${a.x}, ${b.x})`;
  if (a.y < 600 || b.y < 600) return "twin buttons are not at the bottom";
  if (await visible(page, ".ssp-stick")) return "stick is showing on a twin pad without steer";
  const labels = await page.evaluate(() => [".ssp-twin--a", ".ssp-twin--b"].map((s) => document.querySelector(s)?.textContent?.trim()));
  if (labels[0] !== "A" || labels[1] !== "B") return `labels ${JSON.stringify(labels)}, want A and B (the lab's padLabels)`;
  await send(cdp, "touchStart", [P(1, a.x, a.y)]);
  await page.waitForTimeout(60);
  await send(cdp, "touchStart", [P(1, a.x, a.y), P(2, b.x, b.y)]);
  await page.waitForTimeout(60);
  await send(cdp, "touchEnd", [P(1, a.x, a.y)]);
  await page.waitForTimeout(60);
  await send(cdp, "touchEnd", [P(2, b.x, b.y)]);
  await page.waitForTimeout(200);
  const got = await inputs(page);
  const want = ["button:a:1", "button:b:1", "button:a:0", "button:b:0"];
  if (JSON.stringify(got) !== JSON.stringify(want)) return `twin gave ${JSON.stringify(got)}`;
  return null;
}

// Circle a finger around the wheel. dir +1 is clockwise on screen. Returns the turn actually made.
async function circle(page, cdp, id, c, r, from, sweep, dir) {
  const steps = Math.max(6, Math.round(sweep / (Math.PI / 12))); // 15 degrees a step
  const pt = (ang) => P(id, c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r);
  await send(cdp, "touchStart", [pt(from)]);
  await page.waitForTimeout(40);
  for (let i = 1; i <= steps; i++) {
    await send(cdp, "touchMove", [pt(from + dir * sweep * (i / steps))]);
  }
  await page.waitForTimeout(150);
  await send(cdp, "touchEnd", [pt(from + dir * sweep)]);
  await page.waitForTimeout(200);
}

async function dialCases(page, cdp) {
  const w = await centerOf(page, ".ssp-dial");
  if (!w) return "no .ssp-dial wheel on a dial pad";
  if (Math.abs(w.w - 170) > 2) return `dial wheel is ${w.w}px, want 170`;
  if (w.x < 195 || w.y < 600) return "dial wheel is not bottom-right";
  const s0 = await dialSum(page);
  await circle(page, cdp, 1, w, 55, 0, Math.PI, 1);
  const s1 = await dialSum(page);
  if (Math.abs((s1 - s0) - Math.PI) > Math.PI * 0.2) return `clockwise half turn summed ${(s1 - s0).toFixed(2)} rad, want +${Math.PI.toFixed(2)}`;
  await circle(page, cdp, 1, w, 55, Math.PI / 2, Math.PI * 0.75, -1);
  const s2 = await dialSum(page);
  if (Math.abs((s2 - s1) + Math.PI * 0.75) > Math.PI * 0.75 * 0.2) return `counter-clockwise 3/4 turn summed ${(s2 - s1).toFixed(2)} rad, want -${(Math.PI * 0.75).toFixed(2)}`;
  const a = await inputs(page);
  if (!a.length || !a.every((s) => s === "dial:+" || s === "dial:-")) return `dial inputs not dial:+/-: ${JSON.stringify(a.slice(0, 4))}`;
  // A touch that does not turn sends nothing.
  const n = a.length;
  await send(cdp, "touchStart", [P(1, w.x + 55, w.y)]);
  await page.waitForTimeout(150);
  await send(cdp, "touchEnd", [P(1, w.x + 55, w.y)]);
  await page.waitForTimeout(150);
  if ((await inputs(page)).length !== n) return "a still finger on the wheel turned the dial";
  return null;
}

async function drawCases(page, cdp) {
  const l = await centerOf(page, ".ssp-draw");
  if (!l) return "no .ssp-draw layer on a draw pad";
  if (l.w < 380 || l.h < 800) return `draw layer is ${l.w}x${l.h}, not full screen`;
  await send(cdp, "touchStart", [P(1, 100, 300)]);
  for (let i = 1; i <= 10; i++) {
    await send(cdp, "touchMove", [P(1, 100 + i * 15, 300 + i * 20)]);
  }
  await send(cdp, "touchEnd", [P(1, 250, 500)]);
  await page.waitForTimeout(200);
  const a = await inputs(page);
  const moves = a.filter((s) => s === "draw:move").length;
  if (a[0] !== "draw:start" || a[a.length - 1] !== "draw:end" || moves < 5 || a.length !== moves + 2) {
    return `draw gave ${a.length} entries, ${moves} moves, first ${a[0]}, last ${a[a.length - 1]}`;
  }
  const inked = await page.evaluate(() => {
    const c = document.querySelector(".ssp-draw canvas");
    return !!c && c.width > 0;
  });
  if (!inked) return "no chalk canvas on the draw layer";
  return null;
}

// Review Focus 1: a second finger on the stick during a hold.
async function holdSecondFinger(page, cdp) {
  const b = await centerOf(page, ".ssp-hold");
  const s = await centerOf(page, ".ssp-stick");
  if (!b) return "no .ssp-hold button";
  if (!s) return "stick missing on a steer=1 hold pad";
  await send(cdp, "touchStart", [P(1, b.x, b.y)]);
  await page.waitForTimeout(250);
  await send(cdp, "touchStart", [P(1, b.x, b.y), P(2, s.x, s.y)]);
  for (let i = 1; i <= 6; i++) {
    await send(cdp, "touchMove", [P(1, b.x, b.y), P(2, s.x + i * 8, s.y - i * 6)]);
  }
  const knob = await page.evaluate(() => document.querySelector(".ssp-stick__knob")?.style.transform ?? "");
  if (!/translate\(/.test(knob) || /translate\(0px, 0px\)/.test(knob)) return `stick did not move with the second finger (knob ${JSON.stringify(knob)})`;
  await send(cdp, "touchEnd", [P(2, s.x + 48, s.y - 36)]);
  await page.waitForTimeout(300);
  const mid = await inputs(page);
  if (JSON.stringify(mid) !== JSON.stringify(["hold:1:0.00"])) return `before touch 1 lifted: ${JSON.stringify(mid)}, want only hold:1`;
  await send(cdp, "touchEnd", [P(1, b.x, b.y)]);
  await page.waitForTimeout(200);
  const end = await inputs(page);
  if (end.length !== 2 || !/^hold:0:/.test(end[1])) return `after touch 1 lifted: ${JSON.stringify(end)}`;
  // And the other way round: lifting the hold finger leaves the stick alone.
  await send(cdp, "touchStart", [P(2, s.x, s.y)]);
  await send(cdp, "touchStart", [P(2, s.x, s.y), P(1, b.x, b.y)]);
  await page.waitForTimeout(150);
  await send(cdp, "touchEnd", [P(1, b.x, b.y)]);
  await page.waitForTimeout(150);
  await send(cdp, "touchMove", [P(2, s.x + 30, s.y)]);
  await page.waitForTimeout(100);
  const knob2 = await page.evaluate(() => document.querySelector(".ssp-stick__knob")?.style.transform ?? "");
  await send(cdp, "touchEnd", [P(2, s.x + 30, s.y)]);
  if (/translate\(0px, 0px\)/.test(knob2) || !/translate\(/.test(knob2)) return "stick stopped working after the hold finger lifted";
  return null;
}

// Review Focus 2: a swipe that starts on a pad button, and a tap on it.
async function swipeFromButton(page, cdp) {
  const s = await centerOf(page, ".ssp-stick");
  if (!s) return "stick missing on a steer=1 swipe pad";
  await send(cdp, "touchStart", [P(1, s.x, s.y)]);
  for (let i = 1; i <= 6; i++) {
    await send(cdp, "touchMove", [P(1, s.x, s.y - i * 60)]);
  }
  await send(cdp, "touchEnd", [P(1, s.x, s.y - 360)]);
  await page.waitForTimeout(200);
  await send(cdp, "touchStart", [P(1, s.x, s.y)]);
  await send(cdp, "touchEnd", [P(1, s.x, s.y)]);
  await page.waitForTimeout(200);
  const none = await inputs(page);
  if (none.length) return `a swipe or tap on the stick logged ${JSON.stringify(none)}`;
  // Positive control: the same flick on the open play area does swipe.
  await send(cdp, "touchStart", [P(1, 250, 600)]);
  for (let i = 1; i <= 6; i++) {
    await send(cdp, "touchMove", [P(1, 250, 600 - i * 50)]);
  }
  await send(cdp, "touchEnd", [P(1, 250, 300)]);
  await page.waitForTimeout(200);
  const a = await inputs(page);
  if (a.length !== 1 || !a[0].startsWith("swipe:")) return `swipe on the play area gave ${JSON.stringify(a)}`;
  return null;
}

// Review Focus 4: rotate mid-round.
async function rotate(page, cdp) {
  const w0 = await centerOf(page, ".ssp-dial");
  if (!w0) return "no .ssp-dial wheel";
  const c0 = await cam(page);
  const s0 = await dialSum(page);
  await circle(page, cdp, 1, w0, 55, 0, Math.PI, 1);
  const s1 = await dialSum(page);
  if (!(s1 - s0 > Math.PI * 0.8)) return `portrait clockwise gave ${(s1 - s0).toFixed(2)} rad`;
  if (JSON.stringify(await cam(page)) !== JSON.stringify(c0)) return "the camera moved from dial input in portrait";
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  const c1 = await cam(page);
  const moved = Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]);
  if (!(moved > 0.05)) return `camera did not reframe on rotation (moved ${moved.toFixed(4)})`;
  const w1 = await centerOf(page, ".ssp-dial");
  if (!w1) return "dial wheel vanished after rotation";
  if (w1.x < 422 || w1.y < 195) return `wheel not bottom-right after rotation (${w1.x.toFixed(0)},${w1.y.toFixed(0)})`;
  await circle(page, cdp, 1, w1, 55, Math.PI, Math.PI * 0.75, -1);
  const s2 = await dialSum(page);
  if (!(s2 - s1 < -Math.PI * 0.75 * 0.8)) return `landscape counter-clockwise gave ${(s2 - s1).toFixed(2)} rad, want about -${(Math.PI * 0.75).toFixed(2)}`;
  await circle(page, cdp, 1, w1, 55, 0, Math.PI / 2, 1);
  const s3 = await dialSum(page);
  if (!(s3 - s2 > Math.PI / 2 * 0.8)) return `landscape clockwise gave ${(s3 - s2).toFixed(2)} rad`;
  await page.waitForTimeout(400);
  const c2 = await cam(page);
  if (JSON.stringify(c2) !== JSON.stringify(c1)) return `camera moved again after the reframe: ${JSON.stringify(c1)} -> ${JSON.stringify(c2)}`;
  return null;
}

const CASES = [
  ["hold", "pad=hold", holdCases],
  ["swipe", "pad=swipe", swipeCases],
  ["twin", "pad=twin", twinCases],
  ["dial", "pad=dial", dialCases],
  ["draw", "pad=draw", drawCases],
  ["hold+second-finger", "pad=hold&steer=1", holdSecondFinger],
  ["swipe-from-button", "pad=swipe&steer=1", swipeFromButton],
  ["rotate", "pad=dial", rotate],
  ["hold-through-GO", "pad=hold", holdThroughGo, holdEarly],
];

for (const [name, query, fn, early] of CASES) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  let why;
  let env;
  try {
    env = await boot(query, early);
    why = await fn(env.page, env.cdp);
  } catch (e) {
    why = `threw ${String(e).slice(0, 200)}`;
  }
  if (why) failed = true;
  console.log(why ? `FAIL touch ${name} ${why}` : `PASS touch ${name}`);
  await env?.ctx.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
