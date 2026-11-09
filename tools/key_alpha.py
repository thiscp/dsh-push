"""绿底生成的视频 -> 真 alpha 动画 webp（色键 + 腐蚀 + despill），并出 QA 预览。

用法: python key.py <in.webp> <out.webp> [--pingpong] [--ramp 30] [--out-size 422x760]
       [--duration 84] [--qa C:\\Temp\\qa.png]
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageSequence

args = sys.argv[1:]
src, dst = args[0], args[1]
RAMP = 30.0
pingpong = "--pingpong" in args
out_size = (422, 760)
duration = 84
qa = None
if "--ramp" in args:
    RAMP = float(args[args.index("--ramp") + 1])
if "--out-size" in args:
    w, h = args[args.index("--out-size") + 1].lower().split("x")
    out_size = (int(w), int(h))
if "--duration" in args:
    duration = int(args[args.index("--duration") + 1])
if "--qa" in args:
    qa = args[args.index("--qa") + 1]
start = int(args[args.index("--start") + 1]) if "--start" in args else 0
nframes = int(args[args.index("--frames") + 1]) if "--frames" in args else 0

raw = Image.open(src)
frames = [f.convert("RGB") for f in ImageSequence.Iterator(raw)]
print("in_frames", len(frames), "size", raw.size)

if start or nframes:
    end = (start + nframes) if nframes else len(frames)
    frames = frames[start:end]
    print("slice", start, "..", end, "->", len(frames))

if "--pingpong" in args:
    frames = frames + frames[-2::-1]
    print("pingpong ->", len(frames), "frames")


def key_one(fr):
    a = np.asarray(fr, dtype=np.float32)
    greenness = a[:, :, 1] - np.maximum(a[:, :, 0], a[:, :, 2])
    alpha = np.clip(1.0 - greenness / RAMP, 0, 1)
    m = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.MinFilter(3))
    alpha = np.asarray(m, dtype=np.float32) / 255.0
    a = a.copy()
    cap = np.maximum(a[:, :, 0], a[:, :, 2])
    edge = alpha < 1.0
    a[:, :, 1] = np.where(edge, np.minimum(a[:, :, 1], cap), a[:, :, 1])
    rgba = Image.fromarray(np.dstack([a, alpha * 255]).astype(np.uint8), "RGBA")
    return rgba.resize(out_size, Image.LANCZOS)


out = [key_one(f) for f in frames]
out[0].save(dst, format="WEBP", save_all=True, append_images=out[1:],
            duration=duration, loop=0, quality=72, method=4)
print("saved", dst, os.path.getsize(dst) // 1024, "KB", out[0].size, len(out), "frames")

# 客观验收：四角 alpha + 不透明占比
a0 = np.asarray(out[0])
print("corner_alpha", [int(a0[y, x, 3]) for (x, y) in
                       ((0, 0), (a0.shape[1] - 1, 0), (0, a0.shape[0] - 1), (a0.shape[1] - 1, a0.shape[0] - 1))])
print("opaque_ratio %.3f" % float((a0[:, :, 3] > 250).mean()))

if qa:
    cards = []
    for name, color in (("magenta", (255, 0, 255)), ("night", (29, 43, 68))):
        c = Image.new("RGB", out_size, color)
        c.paste(out[len(out) // 2], (0, 0), out[len(out) // 2])
        cards.append(c)
    sheet = Image.new("RGB", (out_size[0] * len(cards), out_size[1]), (0, 0, 0))
    for i, c in enumerate(cards):
        sheet.paste(c, (i * out_size[0], 0))
    sheet.save(qa)
    print("qa", qa, sheet.size)
