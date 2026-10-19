"""手部原图回贴：把**原立绘的手指像素**贴回 i2v 生成的每一帧，解决"手指糊成肉色块"。

原理
  1. 用 See-through 的 handwear-l/r 掩膜取出手部区域（原图坐标系）
  2. 用轮廓 IoU 网格搜索求出 原图 -> 目标资产 的缩放/平移
  3. 把原图手部像素（带羽化）贴到每一帧对应位置
  4. 只在"该位置确实有角色"时才贴（避免手已移开时贴出孤块）

用法: python hand_restore.py <asset.webp> <pose_orig.webp> <layers.json> <layer_dir> <out.webp>
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageSequence

ASSET, POSE, JF, LDIR, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]

asset = Image.open(ASSET)
frames = [f.convert("RGBA") for f in ImageSequence.Iterator(asset)]
W, H = frames[0].size
print("frames", len(frames), "size", (W, H))

orig = Image.open(POSE).convert("RGBA")
opa = np.asarray(orig)[:, :, 3]
ys, xs = np.where(opa > 8)
B = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

# 目标帧的角色包围盒（用第一帧）
a0 = np.asarray(frames[0])[:, :, 3]
ys2, xs2 = np.where(a0 > 8)
A = (int(xs2.min()), int(ys2.min()), int(xs2.max()) + 1, int(ys2.max()) + 1)
print("orig bbox", B, "asset bbox", A)

# IoU 网格搜索 原图 -> 资产
sil_o = Image.fromarray(((opa > 40) * 255).astype(np.uint8))
tgt = (a0 > 40)
best = None
for si in range(41):
    s = 0.18 + si * 0.005
    w = max(1, int(orig.width * s))
    h = max(1, int(orig.height * s))
    m = np.asarray(sil_o.resize((w, h), Image.BILINEAR)) > 128
    my, mx = np.where(m)
    if len(my) == 0:
        continue
    ty, tx = np.where(tgt)
    cdy, cdx = ty.mean() - my.mean(), tx.mean() - mx.mean()
    for dy in range(-10, 11, 2):
        for dx in range(-10, 11, 2):
            oy, ox = int(round(cdy)) + dy, int(round(cdx)) + dx
            canvas = np.zeros_like(tgt)
            y0, x0 = max(0, oy), max(0, ox)
            y1, x1 = min(H, oy + h), min(W, ox + w)
            if y1 <= y0 or x1 <= x0:
                continue
            canvas[y0:y1, x0:x1] = m[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
            inter = float((canvas & tgt).sum())
            union = float((canvas | tgt).sum())
            if union <= 0:
                continue
            iou = inter / union
            if best is None or iou > best[0]:
                best = (iou, s, ox, oy)
if best is None:
    print("align failed")
    raise SystemExit(1)
iou, s, ox, oy = best
print("align IoU=%.4f scale=%.4f off=(%d,%d)" % (iou, s, ox, oy))

# 手部掩膜（原图坐标 -> 资产坐标）
meta = json.load(open(JF, encoding="utf-8"))
hand = Image.new("L", (orig.width, orig.height), 0)
found = []
for L in meta["layers"]:
    if not L["name"].startswith("handwear"):
        continue
    p = os.path.join(LDIR, L["filename"])
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGBA").split()[3]
    # 层坐标在 See-through 画布上，先按画布->原图 的近似映射放大（用包围盒比）
    cw, ch = meta["width"], meta["height"]
    sx = (B[2] - B[0]) / cw          # 画布 -> 原图 的粗略比例
    sy = (B[3] - B[1]) / ch
    big = im.resize((max(1, int(im.width * sx * 2.2)), max(1, int(im.height * sy * 2.2))), Image.LANCZOS)
    hand.paste(255, (int(L["left"] * sx * 2.2) + B[0] // 2, int(L["top"] * sy * 2.2)), big)
    found.append(L["name"])
print("hand layers:", found)

# 手部掩膜 -> 资产坐标
hmask = hand.resize((max(1, int(orig.width * s)), max(1, int(orig.height * s))), Image.LANCZOS)
mask_full = Image.new("L", (W, H), 0)
mask_full.paste(hmask, (ox, oy))
mask_full = mask_full.filter(ImageFilter.GaussianBlur(1.2))
mask_np = np.asarray(mask_full, dtype=np.float32) / 255.0
print("hand mask pixels in asset: %.1f%%" % (100.0 * (mask_np > 0.3).mean()))

# 原图手部像素（缩放对齐）
hand_rgba = orig.resize((max(1, int(orig.width * s)), max(1, int(orig.height * s))), Image.LANCZOS)
canvas_src = Image.new("RGBA", (W, H), (0, 0, 0, 0))
canvas_src.paste(hand_rgba, (ox, oy))
src_np = np.asarray(canvas_src, dtype=np.float32)

out_frames = []
restored = 0
for f in frames:
    fa = np.asarray(f, dtype=np.float32).copy()
    # 仅在该位置有角色(alpha>60)时回贴，避免手移开后贴出孤立块
    gate = (fa[:, :, 3] > 60).astype(np.float32)
    w = mask_np * gate * (src_np[:, :, 3] / 255.0)
    w3 = w[:, :, None]
    comp = fa[:, :, :3] * (1 - w3) + src_np[:, :, :3] * w3
    fa[:, :, :3] = comp
    fa[:, :, 3] = np.maximum(fa[:, :, 3], (mask_np * gate * 255 * 0.9))
    if w.max() > 0.05:
        restored += 1
    out_frames.append(Image.fromarray(np.clip(fa, 0, 255).astype(np.uint8), "RGBA"))

print("frames with hand restored: %d/%d" % (restored, len(out_frames)))
out_frames[0].save(OUT, format="WEBP", save_all=True, append_images=out_frames[1:],
                   duration=asset.info.get("duration", 84) or 84, loop=0, quality=92, method=6)
print("saved", OUT, os.path.getsize(OUT) // 1024, "KB")
