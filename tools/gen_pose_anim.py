#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_pose_anim.py — 从静态立绘合成"活立绘"动画 WebP（v1.31.0）。

做法（单图伪 2D 动画，无需重新绘图）：
  1. 横向波动：越靠下（发梢/裙摆/尾尖）摆幅越大，且相位自上而下滞后，
     形成"跟随摆动"；头部几乎不动。
  2. 呼吸起伏：胸口高度一条高斯带的纵向缩放，±0.6% 幅度。
  3. 10 帧 110ms 无缝循环，双线性重采样，输出动画 WebP（全透明通道）。

用法：python tools/gen_pose_anim.py            # 生成 6 套到 res/raw/
      python tools/gen_pose_anim.py --preview  # 另存帧拼图到 %TEMP% 供检查
"""
import os
import sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "android-app", "app", "src", "main", "res")
SRC = os.path.join(RES, "drawable-nodpi")
DST = os.path.join(RES, "raw")

POSES = ["maid", "serious", "shy", "confused", "starry", "cheerful"]
N_FRAMES = 10
DURATION_MS = 110
OUT_H = 760          # 成功页显示高 230dp（xxhdpi 约 690px），760 足够
QUALITY = 72


def frames_for(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    ow = round(OUT_H * w / h)
    im = im.resize((ow, OUT_H), Image.LANCZOS)
    arr = np.asarray(im, dtype=np.float32)
    H, W = OUT_H, ow

    ys = np.arange(H, dtype=np.float32)
    xs = np.arange(W, dtype=np.float32)

    # 横向：底部摆幅大 + 相位滞后（跟随感）
    s = (ys / H) ** 1.6
    A = 0.007 * W
    phase = 1.3 * (ys / H)
    # 呼吸：胸口高斯带纵向缩放
    y0, sig = 0.30 * H, 0.10 * H
    bump = np.exp(-((ys - y0) ** 2) / (2 * sig ** 2))
    B = 0.006 * H

    out = []
    for k in range(N_FRAMES):
        t = k / N_FRAMES
        dx = (A * s * np.sin(2 * np.pi * t + phase))[:, None]        # (H,1)
        dy = (B * bump * np.sin(2 * np.pi * t + 1.6))[:, None]       # (H,1)
        Y = np.broadcast_to(ys[:, None] - dy, (H, W))
        X = np.broadcast_to(xs[None, :] - dx, (H, W))

        y0i = np.clip(np.floor(Y).astype(np.int32), 0, H - 1)
        y1i = np.minimum(y0i + 1, H - 1)
        wy = (Y - y0i)[..., None]
        x0i = np.clip(np.floor(X).astype(np.int32), 0, W - 1)
        x1i = np.minimum(x0i + 1, W - 1)
        wx = (X - x0i)[..., None]

        f = (arr[y0i, x0i] * (1 - wy) * (1 - wx) +
             arr[y0i, x1i] * (1 - wy) * wx +
             arr[y1i, x0i] * wy * (1 - wx) +
             arr[y1i, x1i] * wy * wx)
        out.append(Image.fromarray(np.uint8(np.clip(f, 0, 255)), "RGBA"))
    return out


def main():
    preview = "--preview" in sys.argv
    global DST
    if "--out" in sys.argv:
        DST = sys.argv[sys.argv.index("--out") + 1]
    os.makedirs(DST, exist_ok=True)
    sheets = []
    for name in POSES:
        src = os.path.join(SRC, f"pose_{name}.webp")
        fr = frames_for(src)
        dst = os.path.join(DST, f"pose_anim_{name}.webp")
        fr[0].save(dst, save_all=True, append_images=fr[1:],
                   duration=DURATION_MS, loop=0,
                   quality=QUALITY, method=6)
        kb = os.path.getsize(dst) // 1024
        print(f"pose_anim_{name}.webp  {kb}KB  {fr[0].size[0]}x{fr[0].size[1]}")
        if preview:
            th = [f.resize((f.width * 240 // f.height, 240)) for f in fr]
            sheet = Image.new("RGBA", (240 * 5, 240 * 2), (40, 40, 60, 255))
            for i, t2 in enumerate(th):
                sheet.paste(t2, ((i % 5) * 240, (i // 5) * 240), t2)
            sheets.append((name, sheet))
    if preview:
        import tempfile
        tmp = os.path.join(tempfile.gettempdir(), "pose-anim-preview.png")
        big = Image.new("RGBA", (240 * 5, 240 * 2 * len(sheets)), (40, 40, 60, 255))
        for i, (_, s) in enumerate(sheets):
            big.paste(s, (0, i * 480))
        big.save(tmp)
        print("preview:", tmp)


if __name__ == "__main__":
    main()
