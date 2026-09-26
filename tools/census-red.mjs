"""PIL census on red sting burst frames with 3D WebGL flash."""
from PIL import Image
import os

OUT = "D:/Play Games/super-star-party/tools/critic/frames/economy/orch-red"

def census(p):
    if not os.path.exists(p):
        return None
    img = Image.open(p).convert("RGB")
    px = img.load()
    w, h = img.size
    r_sum = g_sum = b_sum = 0
    red_pixel_count = 0
    total = w * h
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            r_sum += r
            g_sum += g
            b_sum += b
            # red-pixel share: R is the max channel and significantly larger than G
            if r > 140 and r - g > 20:
                red_pixel_count += 1
    return {
        "r_mean": round(r_sum / total, 2),
        "g_mean": round(g_sum / total, 2),
        "b_mean": round(b_sum / total, 2),
        "red_share": round(red_pixel_count / total * 100, 2),
    }

frames = {}
for fn in sorted(os.listdir(OUT)):
    if fn.endswith(".png"):
        info = census(os.path.join(OUT, fn))
        if info:
            frames[fn] = info

baseline = frames.get("r5-s001-red-pre-turn.png", {})
print(f"Baseline: {baseline}")
print()
for fn, info in frames.items():
    if "pre-turn" in fn:
        continue
    dr = info["r_mean"] - baseline.get("r_mean", info["r_mean"])
    drs = info["red_share"] - baseline.get("red_share", info["red_share"])
    bar = "#" * int(info["red_share"] * 10)
    print(f"{fn:55s} R={info['r_mean']:6.1f} G={info['g_mean']:6.1f} B={info['b_mean']:6.1f}  red%={info['red_share']:5.2f}  dR={dr:+.1f}  dRed%={drs:+.2f}  {bar}")

print()
rmax = max(v["r_mean"] for k, v in frames.items() if "pre-turn" not in k)
rmini = min(v["red_share"] for k, v in frames.items() if "pre-turn" not in k)
rmaxi = max(v["red_share"] for k, v in frames.items() if "pre-turn" not in k)
rmini_val = min(v["r_mean"] for k, v in frames.items() if "pre-turn" not in k)
print(f"Peak burst R mean: {rmax} (baseline {baseline.get('r_mean', '?')}, delta {rmax - baseline.get('r_mean', rmax):.1f})")
print(f"Min burst R mean:  {rmini_val}")
print(f"Peak burst red%:   {rmaxi} (baseline {baseline.get('red_share', '?')}, delta {rmaxi - baseline.get('red_share', rmaxi):.2f})")
