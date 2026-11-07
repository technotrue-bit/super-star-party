// tools/render-music.mjs — bake music tracks to WAV for the Captain to
// listen. Runs the REAL audio engine in a browser page (OfflineAudioContext),
// downloads each render as 16-bit PCM WAV into tools/music/.
// Usage: node tools/render-music.mjs [--lift] [track ...]   (default: every track in TRACK_ORDER)
//   Each render lasts one pass of the track (bars x 240 / bpm, capped at 120 s).
//   --lift  also renders each board.* track lifted, as <id>-lift.wav.
// Needs `npm run dev` on port 5177. CHROMIUM_PATH points Playwright at a
// Chromium binary when its bundled browser is not installed.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const lift = args.includes("--lift");
const wanted = args.filter((a) => a !== "--lift");

const outDir = "tools/music";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 200)));
await page.goto("http://localhost:5177/?screen=title&audio=1", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

// Load the real engine in-page, unlock a context, and read each track's length.
const ready = await page.evaluate(async () => {
  try {
    const { audio } = await import("/src/audio/audioEngine.ts");
    const { TRACKS, parseTrack, trackIds } = await import("/src/audio/music/tracks.ts");
    audio.unlock();
    const seconds = {};
    for (const id of trackIds()) {
      seconds[id] = Math.min(120, (parseTrack(TRACKS[id])[0].barCount * 240) / TRACKS[id].bpm);
    }
    return { ok: true, tracks: trackIds(), seconds };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
});
console.log("ENGINE:", JSON.stringify(ready.ok ? { ok: true, tracks: ready.tracks } : ready));
if (!ready.ok) {
  console.log("audio engine not importable — is the audio builder's code landed yet?");
  await browser.close();
  process.exit(1);
}

const tracks = wanted.length ? wanted : ready.tracks;
const jobs = tracks.flatMap((track) => {
  const normal = { track, lifted: false, file: `${track}.wav` };
  return lift && track.startsWith("board.") ? [normal, { track, lifted: true, file: `${track}-lift.wav` }] : [normal];
});

for (const job of jobs) {
  const seconds = ready.seconds[job.track];
  if (seconds === undefined) {
    console.log(`FAIL ${job.track}: not in TRACK_ORDER`);
    continue;
  }
  const result = await page.evaluate(
    async ({ name, seconds, lifted }) => {
      try {
        const { audio } = await import("/src/audio/audioEngine.ts");
        const blob = await audio.renderTrack(name, seconds, { lift: lifted });
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return { ok: true, b64: btoa(bin), size: bytes.length };
      } catch (e) {
        return { ok: false, err: String(e).slice(0, 300) };
      }
    },
    { name: job.track, seconds, lifted: job.lifted },
  );
  if (result.ok) {
    fs.writeFileSync(path.join(outDir, job.file), Buffer.from(result.b64, "base64"));
    console.log(`OK ${job.file}  ${(result.size / 1024).toFixed(0)} KB  (${seconds.toFixed(2)}s)`);
  } else {
    console.log(`FAIL ${job.file}: ${result.err}`);
  }
}
await browser.close();
console.log("RENDER_DONE ->", outDir);
