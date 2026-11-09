"""手部定向强化：只在肤色手部区域做加强 USM + 二次去绿，其余像素不动。
零位移风险（不搬像素），只提升该区域锐度并压掉残留绿边。

用法: python hand_sharpen.py <in.webp> <out.webp> [amount] [radius]
"""
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageSequence

SRC, DST = sys.argv[1], sys.argv[2]
AMOUNT = int(sys.argv[3]) if len(sys.argv) > 3 else 130
RADIUS = float(sys.argv[4]) if len(sys.argv) > 4 else 1.2
DUR_IN = None

im = Image.open(SRC)
DUR_IN = im.info.get("duration", 84) or 84
frames = [f.convert("RGBA") for f in ImageSequence.Iterator(im)]
out = []
tot_hand = 0
for f in frames:
    arr = np.asarray(f).astype(np.float32)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    # 肤色判定（原画手部是偏暖的浅肤色）
    skin = (a > 200) & (r > 185) & (g > 150) & (b > 130) & (r > g) & (g >= b - 6) & ((r - b) > 10)
    # 收缩到实心区域再膨胀，避免把边缘也一起强化
    m = Image.fromarray((skin * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(5))
    mask = np.asarray(m, dtype=np.float32) / 255.0
    if mask.sum() < 30:
        out.append(f)
        continue
    tot_hand += 1
    # 加强 USM（只在手部区域合成回去）
    rgb = Image.fromarray(np.asarray(f)[:, :, :3], "RGB").filter(
        ImageFilter.UnsharpMask(radius=RADIUS, percent=AMOUNT, threshold=2))
    sharp = np.asarray(rgb).astype(np.float32)
    w = mask[:, :, None]
    comp = arr[:, :, :3] * (1 - w) + sharp * w
    # 手部区域二次去绿（绿不得超过红蓝较大者）
    cap = np.maximum(comp[:, :, 0], comp[:, :, 2])
    comp[:, :, 1] = np.where(mask > 0.2, np.minimum(comp[:, :, 1], cap), comp[:, :, 1])
    res = np.dstack([comp, a])
    out.append(Image.fromarray(np.clip(res, 0, 255).astype(np.uint8), "RGBA"))

out[0].save(DST, format="WEBP", save_all=True, append_images=out[1:],
            duration=DUR_IN, loop=0, quality=92, method=6)
print("frames", len(out), "hand-enhanced", tot_hand, "->", DST)
