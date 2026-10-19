"""视频(或动图) -> 真 alpha 动画 webp：av 解码 + 绿键 + despill + 正反拼接无缝循环。

用法(在装有 av+PIL 的环境里跑)：
  python key_video.py <in> <out.webp> [--pingpong] [--start 0] [--frames 25]
                      [--ramp 30] [--size 422x760] [--duration 84] [--sheet sheet.png]

--pingpong：取 --frames 帧后倒放接上（N + N-2），保证首末帧完全一致 ⇒ 天然无缝。
"""
import os
import sys

import av
import numpy as np
from PIL import Image, ImageFilter

args = sys.argv[1:]
src, dst = args[0], args[1]


def opt(name, default):
    return args[args.index(name) + 1] if name in args else default


RAMP = float(opt("--ramp", 30))
pingpong = "--pingpong" in args
start = int(opt("--start", 0))
nframes = int(opt("--frames", 25))
w, h = opt("--size", "422x760").lower().split("x")
SIZE = (int(w), int(h))
DUR = int(opt("--duration", 84))
SHEET = opt("--sheet", None)

frames = []
try:
    with av.open(src) as c:
        for fr in c.decode(video=0):
            frames.append(fr.to_image().convert("RGB"))
except Exception as e:
    print("av decode failed:", e)
    raise SystemExit(1)
print("decoded", len(frames), "frames", frames[0].size if frames else None)

seg = frames[start:start + nframes]
if pingpong:
    seg = seg + seg[-2::-1]
print("segment", len(seg), "frames (pingpong=%s)" % pingpong)


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
    return rgba.resize(SIZE, Image.LANCZOS)


out = [key_one(f) for f in seg]
out[0].save(dst, format="WEBP", save_all=True, append_images=out[1:],
            duration=DUR, loop=0, quality=72, method=6)
print("saved", dst, os.path.getsize(dst) // 1024, "KB", out[0].size, len(out), "frames")

a = np.asarray(out[0])
print("corner_alpha", [int(a[y, x, 3]) for (x, y) in
                       ((0, 0), (a.shape[1] - 1, 0), (0, a.shape[0] - 1), (a.shape[1] - 1, a.shape[0] - 1))])
print("opaque_ratio %.3f" % float((a[:, :, 3] > 250).mean()))

tops, bots = [], []
for f2 in out:
    m2 = np.asarray(f2)[:, :, 3] > 8
    ys = np.where(m2.any(axis=1))[0]
    if len(ys):
        tops.append(int(ys.min()))
        bots.append(int(ys.max()))
if tops:
    print("top 振幅 %d px / 高度形变 %d px" % (max(tops) - min(tops),
                                        (max(bots) - min(bots)) - (min(tops) - min(tops))))
    print("seam f0(top=%d) vs flast(top=%d)" % (tops[0], tops[-1]))
print("frames_out", len(out))

if SHEET:
    th = 190
    cols = min(7, len(out))
    thumbs = [f.resize((f.width * th // f.height, th), Image.LANCZOS) for f in out]
    tw = thumbs[0].width
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (tw * cols, th * rows), (255, 0, 255))
    for i, t in enumerate(thumbs):
        sheet.paste(t, ((i % cols) * tw, (i // cols) * th), t)
    sheet.save(SHEET)
    print("sheet", SHEET, sheet.size)
