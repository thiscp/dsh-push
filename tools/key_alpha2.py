"""精细抠像 v2：软过渡 + 背景反解（unmultiply despill），不做 1px 腐蚀。

旧版 key_alpha.py 的两个粗糙点：
  1. MinFilter(3) 1px 腐蚀 — 为去掉抗锯齿绿环，但它同时**啃掉发丝/蕾丝/羽毛**这类细结构；
  2. despill 用 "G 不得超过 max(R,B)" 硬切 — 只能压住绿，无法还原被绿污染的真实颜色。

v2 做法（纯绿底 (0,255,0) 上数学精确）：
  * alpha 两阈值软过渡：绿度 g = G - max(R,B)；g >= LO → 全透明，g <= HI → 全不透明，中间线性；
  * **反解前景色**：合成方程 C = a*F + (1-a)*BG ⇒ F = (C - (1-a)*BG) / a，取 BG=(0,255,0)。
    这一步把"半透明像素里混进来的绿"按比例减掉，等价于正确的 premultiply 反演，
    比硬切 G 上限干净得多（发丝边缘不会再有一圈绿灰）；
  * alpha 做 0.6px 高斯羽化（只动 alpha，不动颜色），消除块状台阶；
  * 默认不腐蚀；需要时可 --erode 1 显式开启。

用法: python key_alpha2.py <in.webp> <out.webp> [--lo 8] [--hi 30] [--erode 0]
        [--start N] [--frames N] [--pingpong] [--duration 84] [--size 422x760]
        [--fit] [--qa out.png]
  --fit：按**全帧并集**包围盒统一裁剪再等比装入目标尺寸（所有帧用同一矩形，不会逐帧缩放抖动）
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageSequence

args = sys.argv[1:]
src, dst = args[0], args[1]


def opt(name, default):
    return args[args.index(name) + 1] if name in args else default


LO = float(opt("--lo", 8))
HI = float(opt("--hi", 30))
ERODE = int(opt("--erode", 0))
start = int(opt("--start", 0))
nframes = int(opt("--frames", 0))
DUR = int(opt("--duration", 84))
do_fit = "--fit" in args
do_pp = "--pingpong" in args
QA = opt("--qa", None)
w, h = opt("--size", "422x760").lower().split("x")
SIZE = (int(w), int(h))
GREEN = np.array([0.0, 255.0, 0.0], dtype=np.float32)

raw = Image.open(src)
frames = [f.convert("RGB") for f in ImageSequence.Iterator(raw)]
print("in_frames", len(frames), "size", raw.size)
if start or nframes:
    end = start + nframes if nframes else len(frames)
    frames = frames[start:end]
    print("slice", start, "..", end, "->", len(frames))
if do_pp:
    frames = frames + frames[-2::-1]
    print("pingpong ->", len(frames), "frames")


def key_one(fr):
    a = np.asarray(fr, dtype=np.float32)
    g = a[:, :, 1] - np.maximum(a[:, :, 0], a[:, :, 2])      # 绿度
    alpha = np.clip((HI - g) / max(1e-6, (HI - LO)), 0.0, 1.0)
    if ERODE > 0:
        m = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(
            ImageFilter.MinFilter(ERODE * 2 + 1))
        alpha = np.asarray(m, dtype=np.float32) / 255.0
    # 羽化 alpha（只动 alpha）
    m = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.6))
    alpha = np.asarray(m, dtype=np.float32) / 255.0
    # 反解前景色：F = (C - (1-a)*BG)/a
    a3 = alpha[:, :, None]
    safe = np.maximum(a3, 1e-3)
    f = (a - (1.0 - a3) * GREEN[None, None, :]) / safe
    # 反解只能去绿，不许把绿通道压到红蓝之下——否则 R/B 原样保留而 G=0，边缘会发紫。
    # 这道下限钳制是"软边"与"不发紫"能同时成立的关键。
    fb = np.minimum(f[:, :, 0], f[:, :, 2])
    f[:, :, 1] = np.maximum(f[:, :, 1], fb)
    f = np.clip(f, 0, 255)
    f = np.where(a3 > 0.004, f, 0)                            # 完全透明处清零
    return Image.fromarray(np.dstack([f, alpha * 255]).astype(np.uint8), "RGBA")


out = [key_one(f) for f in frames]

# 全帧并集包围盒（统一裁剪，避免逐帧缩放抖动）
if do_fit:
    boxes = []
    for im2 in out:
        bb = im2.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()
        if bb:
            boxes.append(bb)
    if boxes:
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        mw = max(4, int((x1 - x0) * 0.04))
        mh = max(4, int((y1 - y0) * 0.04))
        x0 = max(0, x0 - mw); y0 = max(0, y0 - mh)
        x1 = min(out[0].width, x1 + mw); y1 = min(out[0].height, y1 + mh)
        cw, ch = x1 - x0, y1 - y0
        s = min(SIZE[0] / cw, SIZE[1] / ch)
        nw, nh = max(1, int(cw * s)), max(1, int(ch * s))
        ox, oy = (SIZE[0] - nw) // 2, (SIZE[1] - nh) // 2
        fitted = []
        for im2 in out:
            c = im2.crop((x0, y0, x1, y1)).resize((nw, nh), Image.LANCZOS)
            canvas = Image.new("RGBA", SIZE, (0, 0, 0, 0))
            canvas.alpha_composite(c, (ox, oy))
            fitted.append(canvas)
        out = fitted
        print("fit union bbox (%d,%d)-(%d,%d) -> %dx%d in %s" % (x0, y0, x1, y1, nw, nh, SIZE))
else:
    out = [im2.resize(SIZE, Image.LANCZOS) for im2 in out]

out[0].save(dst, format="WEBP", save_all=True, append_images=out[1:],
            duration=DUR, loop=0, quality=82, method=6)
print("saved", dst, os.path.getsize(dst) // 1024, "KB", out[0].size, len(out), "frames")

a0 = np.asarray(out[0])
print("corner_alpha", [int(a0[y, x, 3]) for (x, y) in
                       ((0, 0), (a0.shape[1] - 1, 0), (0, a0.shape[0] - 1), (a0.shape[1] - 1, a0.shape[0] - 1))])
mid = (a0[:, :, 3] > 20) & (a0[:, :, 3] < 235)
print("alpha: opaque %.1f%%  soft-edge %.2f%%  transparent %.1f%%" %
      (100 * (a0[:, :, 3] > 235).mean(), 100 * mid.mean(), 100 * (a0[:, :, 3] <= 20).mean()))

if QA:
    tiles = []
    for col in ((255, 0, 255), (26, 32, 48), (245, 245, 245)):
        c = Image.new("RGB", out[0].size, col)
        c.paste(out[len(out) // 4], (0, 0), out[len(out) // 4])
        tiles.append(c)
    sheet = Image.new("RGB", (out[0].width * 3 + 24, out[0].height), (0, 0, 0))
    xx = 0
    for c in tiles:
        sheet.paste(c, (xx, 0)); xx += c.width + 12
    sheet.save(QA)
    print("qa", QA, sheet.size)
