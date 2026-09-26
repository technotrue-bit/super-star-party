// Frame-capture probe: payout reward verification
// Captures screenshots + reads HUD coin values at high frequency.
// Saves frames to tools/critic/frames/minigames/results-payout/
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const mgId = process.argv[2] ?? "balloon_pop";
const seed = Number(process.argv[3] ?? "7");
const framesDir = path.resolve("tools/critic/frames/minigames/results-payout");
const twin = process.argv[4] === "twin";

const run = async (label) => {
  const dir = twin ? `${framesDir}-${label}` : framesDir;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch({
    args: ["--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 120));
  });

  await page.goto(
    `http://localhost:5177/?seed=${seed}&audio=0&speed=2&minigame=${mgId}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });

  await page.evaluate((s) => {
    window.__SSP__.seed(s);
    window.__SSP__.autoplay(true);
    window.__SSP__.startMatch(
      ["pip", "bounce", "glimmer", "tusk"],
      ["Pip", "Bounce", "Glimmer", "Tusk"]
    );
  }, seed);

  // Enter minigame (retry goto for registration race)
  let launched = false;
  for (let i = 0; i < 25; i++) {
    await page.evaluate(() => window.__SSP__.goto("minigame"));
    await page.waitForTimeout(220);
    const scr = await page.evaluate(() => window.__SSP__.state().screen);
    if (scr === "minigame") { launched = true; break; }
  }
  if (!launched) {
    console.log("LAUNCH_FAILED");
    await browser.close();
    return null;
  }

  // Read before coins
  const before = await page.evaluate(() =>
    (window.__SSP__.state().match?.players ?? []).map((p) => p.coins ?? p.coin ?? 0)
  );
  console.log(`[${label}] BEFORE:`, JSON.stringify(before));

  // Capture frames + monitor state
  let frameIdx = 0;
  let prevScreen = "minigame";
  let boardStart = 0;
  const hudProg = [];
  const snap = () =>
    page.evaluate(() => {
      const st = window.__SSP__.state();
      return {
        screen: st.screen ?? "?",
        players: (st.match?.players ?? []).map((p) => p.coins ?? p.coin ?? 0),
        hud: Array.from(
          document.querySelectorAll('[aria-label="coins"]'),
          (e) => e.textContent || "?"
        ),
        reward: Array.from(document.body.children).find(
          (el) =>
            el.textContent &&
            /^\+\d+$/.test(el.textContent.trim()) &&
            el.style.zIndex === "96"
        )?.textContent || null,
        cardWinner: Array.from(document.body.children).find(
          (el) =>
            el.textContent &&
            /\+\d+c$/.test(el.textContent.trim()) &&
            !el.querySelector
        )?.textContent || null,
      };
    });

  while (frameIdx < 200) {
    await page.waitForTimeout(100);
    await page.screenshot({
      path: `${dir}/frame-${String(frameIdx).padStart(3, "0")}.png`,
    });
    frameIdx++;

    const s = await snap();

    // Track HUD progression during board phase
    if (s.screen === "board" && s.hud.length > 0) {
      hudProg.push({ frame: frameIdx, hud: s.hud, reward: s.reward });
    }

    // Log interesting transitions
    if (s.reward && frameIdx < 110) {
      console.log(`[${label}] frame ${frameIdx} REWARD:`, s.reward);
    }
    if (prevScreen === "minigame" && s.screen !== "minigame") {
      console.log(`[${label}] frame ${frameIdx}: screen -> ${s.screen}`);
      console.log(`[${label}]   coins at transition:`, JSON.stringify(s.players));
      prevScreen = s.screen;
      boardStart = frameIdx;
    }

    if (boardStart > 0 && frameIdx - boardStart > 20) break;
  }

  // Wait for settle + read final coins
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() =>
    (window.__SSP__.state().match?.players ?? []).map((p) => p.coins ?? p.coin ?? 0)
  );
  console.log(`[${label}] AFTER:`, JSON.stringify(after));

  const delta = before.map((v, i) => after[i] - v);
  console.log(`[${label}] DELTA:`, JSON.stringify(delta));
  console.log(
    `[${label}] WINNER:`,
    JSON.stringify(
      delta
        .map((d, i) => ({ player: i, delta: d, after: after[i] }))
        .filter((w) => w.delta > 0)
    )
  );

  // Show HUD rolling count-up progression
  const tuskProg = hudProg.filter((h) => (h.hud[3] || "") !== "20").slice(0, 8);
  if (tuskProg.length > 0) {
    console.log(`[${label}] HUD Tusk progression (intermediates):`, JSON.stringify(tuskProg));
  }
  console.log(`[${label}] ALL HUD:`, JSON.stringify(hudProg.slice(0, 8)));
  console.log(`[${label}] FRAMES:`, frameIdx);
  console.log(`[${label}] ERRORS:`, errors.length ? [...new Set(errors)].slice(0, 3) : "none");

  await browser.close();
  return { before, after, delta };
};

const a = await run("A");
let twinMatch = true;
if (a) {
  if (twin) {
    const b = await run("B");
    if (b) {
      twinMatch = JSON.stringify(a.delta) === JSON.stringify(b.delta);
      console.log("TWIN MATCH:", twinMatch);
      console.log("TWIN A delta:", JSON.stringify(a.delta));
      console.log("TWIN B delta:", JSON.stringify(b.delta));
    }
  }
}
