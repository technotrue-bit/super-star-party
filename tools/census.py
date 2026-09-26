#!/usr/bin/env python3
"""Census: red-channel mean + strongly-red pixel share over a burst vs pre-frame."""
import sys
from PIL import Image
import numpy as np

def load(path):
    im = Image.open(path).convert("RGB")
    return np.asarray(im, dtype=np.float32)

def census(arr):
    # arr shape: HxWx3, float
    R, G, B = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    red_mean = float(R.mean())
    # "strongly red": red channel clearly dominant and bright enough
    strongly_red = (R > 120) & (R > G * 1.15) & (R > B * 1.15) & (R - G > 25)
    red_share = float(strongly_red.sum()) / float(R.size) * 100.0
    return red_mean, red_share

def main():
    args = sys.argv[1:]
    if not args:
        print("usage: census.py <pre.png> <flash1.png> [flash2.png ...]")
        sys.exit(1)
    pre = load(args[0])
    pre_rm, pre_rs = census(pre)
    print(f"PRE  {args[0]}")
    print(f"   red-channel mean = {pre_rm:.2f}")
    print(f"   strongly-red share = {pre_rs:.3f}%")
    print()
    best_rm = pre_rm
    best_rs = pre_rs
    best_delta_rm = 0
    best_delta_rs = 0
    for p in args[1:]:
        arr = load(p)
        rm, rs = census(arr)
        drm = rm - pre_rm
        drs = rs - pre_rs
        marker = ""
        if drm > best_delta_rm:
            best_delta_rm = drm; best_rm = rm
        if drs > best_delta_rs:
            best_delta_rs = drs; best_rs = rs
        if drm > 8 or drs > 3:
            marker = "  <-- PEAK"
        print(f"FLASH {p}")
        print(f"   red-channel mean = {rm:.2f}  (delta {drm:+.2f})")
        print(f"   strongly-red share = {rs:.3f}%  (delta {drs:+.3f}%)")
        print(f"{marker}")
    print()
    print(f"PEAK red-channel delta: {best_delta_rm + pre_rm - pre_rm:+.2f} (peak mean {best_rm:.2f} - pre {pre_rm:.2f} = {best_rm - pre_rm:+.2f})")
    print(f"PEAK red-share delta:   {best_rs - pre_rs:+.3f}% (peak {best_rs:.3f}% - pre {pre_rs:.3f}%)")

if __name__ == "__main__":
    main()
