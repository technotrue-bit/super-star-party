// Records the short gameplay clips and thumbnails the minigame menu shows.
//
// For each minigame: an all-CPU match opens it, steps the game at a fixed
// 60 Hz (so a slow headless GPU still makes a smooth clip), and screenshots
// every 5th step for CLIP_SEC seconds of play. Frames become a looping
// animated WebP (public/minigames/<id>.webp) plus a still thumbnail
// (public/minigames/<id>-thumb.webp). Needs Python 3 with Pillow for the
// encode. Re-run after changing how a minigame looks:
//
//   node tools/capture-minigame-clips.mjs            (every minigame)
//   SSP_ONLY=coin_grab,drum_solo node tools/capture-minigame-clips.mjs
//   node tools/capture-minigame-clips.mjs slingshot_summit        (ids as arguments)
//
// SSP_URL picks the dev server (default http://127.0.0.1:5177).
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const OUT = join(ROOT, "public", "minigames");
const TMP = join(ROOT, ".clip-frames");
const CLIP_SEC = Number(process.env.SSP_CLIP_SEC ?? 4);
const FPS = 12;
const STEP = Math.round(60 / FPS); // 60 Hz sim steps between frames
const W = 640;
const H = 400;
const IDS = [
  "bumper_balls",
  "cake_dash",
  "coin_cannon",
  "memory_match",
  "drum_solo",
  "balloon_pop",
  "coin_grab",
  "pipe_puzzle",
  "push_of_war",
  "quick_draw",
  "slingshot_summit",
  "pie_flick",
  "row_rumble",
  "crank_coaster",
];
const only = process.env.SSP_ONLY ? process.env.SSP_ONLY.split(",") : process.argv.length > 2 ? process.argv.slice(2) : null;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let failed = 0;
for (const id of IDS.filter((x) => !only || only.includes(x))) {
  const dir = join(TMP, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/?seed=11&screen=board&audio=0&intro=0&minigame=${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__SSP__?.state?.().match?.players?.length === 4, null, { timeout: 45000 });
    // Four CPUs (so every seat is in the action), then open the forced minigame.
    await page.evaluate(() => {
      window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"], ["cpu", "cpu", "cpu", "cpu"]);
    });
    await page.waitForFunction(() => window.__SSP__.state().screen === "board", null, { timeout: 45000 });
    await page.evaluate(() => {
      window.__SSP__.autoplay(true);
      window.__SSP__.goto("minigame");
      // A clean clip: no controls hint, seat tags, banners or toasts.
      const st = document.createElement("style");
      st.textContent = ".ssp-mg-goal,.ssp-seat-tags,.ssp-mg-practice,.ssp-fb-banner,.ssp-fb-toast,.ssp-toast{display:none!important}";
      document.head.appendChild(st);
    });
    await page.waitForSelector("#mg-start-btn", { timeout: 45000 });
    await page.click("#mg-start-btn");
    // Step through the vs splash, countdown and practice to live play.
    const live = await page.evaluate(async () => {
      for (let i = 0; i < 6000; i++) {
        if (document.body.dataset.mgPhase === "play") return true;
        window.__SSP__.advance(2);
        if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      return false;
    });
    if (!live) throw new Error("never reached play");
    // A beat into play so there is action on screen from frame one.
    await page.evaluate(() => window.__SSP__.advance(15));
    // Record while the game is live; a quick game (a CPU race, a short chart)
    // can end before CLIP_SEC, and its results podium is not gameplay.
    const want = Math.round(CLIP_SEC * FPS);
    let frames = 0;
    for (; frames < want; frames++) {
      const live = await page.evaluate((n) => {
        window.__SSP__.advance(n);
        return document.body.dataset.mgPhase === "play";
      }, STEP);
      if (!live) break;
      await page.screenshot({ path: join(dir, `${String(frames).padStart(3, "0")}.png`) });
    }
    if (frames < 12) throw new Error(`only ${frames} frames of play`);
    const py = `
import glob, sys
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + "/*.png"))
def crop(im):
    w, h = im.size
    cw, ch = int(w * 0.84), int(h * 0.84)
    x, y = (w - cw) // 2, 0  # keep the score chips, drop the bottom controls hint
    return im.crop((x, y, x + cw, y + ch))
frames = [crop(Image.open(f).convert("RGB")).resize((400, 250), Image.LANCZOS) for f in files]
frames[0].save(sys.argv[2], save_all=True, append_images=frames[1:], duration=int(1000 / ${FPS}), loop=0, quality=62, method=4)
frames[len(frames) * 2 // 5].save(sys.argv[3], quality=78)
`;
    const enc = spawnSync("python3", ["-c", py, dir, join(OUT, `${id}.webp`), join(OUT, `${id}-thumb.webp`)], { encoding: "utf8" });
    if (enc.status !== 0) throw new Error(`encode failed: ${enc.stderr.slice(0, 300)}`);
    console.log(`ok   ${id}: ${frames} frames${errors.length ? ` (page errors: ${errors[0]})` : ""}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${id}: ${String(err).slice(0, 200)}`);
  }
  await page.close();
  rmSync(dir, { recursive: true, force: true });
}
await browser.close();
rmSync(TMP, { recursive: true, force: true });
writeFileSync(join(OUT, "README.txt"), "Generated by tools/capture-minigame-clips.mjs. Re-run it after changing how a minigame looks.\n");
process.exit(failed ? 1 : 0);
