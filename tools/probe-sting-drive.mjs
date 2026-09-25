// Orchestrator: drive the board until a RED-space coin loss happens, then verify the sting timeline.
// Self-verifying: it first proves the landing occurred (coins drop), then reads the flash trace.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
await p.goto("http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=1");
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await p.evaluate(() => {
  window.__SSP__.seed(7);
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
});
for (let i = 0; i < 25; i++) {
  await p.evaluate(() => window.__SSP__.goto("board"));
  await p.waitForTimeout(200);
  if ((await p.evaluate(() => window.__SSP__.state().screen)) === "board") break;
}

// sampler: runs in the page, 25ms, records every .ssp-flash element + the telemetry mirror
await p.evaluate(() => {
  const log = [];
  window.__STING_LOG = log; /* published immediately — same array reference fills up live */
  const t0 = performance.now();
  const id = setInterval(() => {
    const els = Array.from(document.querySelectorAll(".ssp-flash"));
    const ops = els.map((e) => getComputedStyle(e).opacity);
    log.push({
      ms: Math.round(performance.now() - t0),
      tele: window.__SSP_FLASH ? 1 : 0,
      maxOpacity: ops.length ? String(Math.max(...ops.map((o) => parseFloat(o)))) : "0",
      n: els.length,
      coins: (window.__SSP__?.state?.()?.match?.players ?? []).map((pl) => pl.coins).join(","),
      spaces: (window.__SSP__?.state?.()?.match?.players ?? []).map((pl) => pl.space).join(","),
    });
    if (performance.now() - t0 > 40000) { clearInterval(id); window.__STING_LOG = log; }
  }, 25);
});

// drive rolls: keep forcing 6 whenever the dice phase is up (P1 starts at space 0 -> lands on space 6 = red)
let landed = false;
for (let i = 0; i < 200 && !landed; i++) {
  await p.waitForTimeout(150);
  const s = await p.evaluate(() => {
    const st = window.__SSP__.state();
    return { phase: st.match?.phase, coins: (st.match?.players ?? []).map((pl) => pl.coins).join(","), spaces: (st.match?.players ?? []).map((pl) => pl.space).join(","), tele: window.__SSP_FLASH ?? null };
  });
  if (s.phase === "dice") await p.evaluate(() => window.__SSP__.rollDice(6));
  if (s.coins !== "10,10,10,10") {
    landed = true;
    console.log(`LANDING+COIN CHANGE: coins=${s.coins} spaces=${s.spaces}`);
    if (s.tele) {
      await p.screenshot({ path: "tools/critic/frames/economy/orch-red/sting-peak.png" });
      console.log("peak frame saved while __SSP_FLASH live");
    }
  }
}
console.log("LANDED:", landed);

const out = await p.evaluate(() => {
  const log = window.__STING_LOG ?? [];
  const active = log.filter((r) => parseFloat(r.maxOpacity) > 0.05);
  const tele = log.filter((r) => r.tele === 1);
  return {
    samples: log.length,
    visible: active.length,
    visibleMs: active.length * 25,
    peak: active.length ? Math.max(...active.map((r) => parseFloat(r.maxOpacity))) : 0,
    teleFrames: tele.length,
    firstActive: active.length ? active[0].ms : null,
    lastActive: active.length ? active[active.length - 1].ms : null,
    trace: log.filter((_, i) => i % 8 === 0).map((r) => `${r.ms}:${r.maxOpacity}/t${r.tele}`).join(" "),
  };
});
console.log("TRACE:", out.trace);
console.log(`STING: samples=${out.samples} frames>5%opacity=${out.visible} (~${out.visibleMs}ms) peak=${out.peak} telemetryFrames=${out.teleFrames} window=${out.firstActive}-${out.lastActive}ms`);
console.log("ERRORS:", errs.length ? errs.slice(0, 3) : "none");
await b.close();
