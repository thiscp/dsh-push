"""手部原画级回贴 v3：**每只手独立处理**，逐帧模板匹配；匹配分数不够就跳过（不贴错位残片）。

相比 v2 的改进
  * v2 把左右手当成一整块 patch 贴，主题间 --fit 缩放差异会让整块偏位 → 出现残片
  * v3 对每个 handwear 层单独建 patch、单独匹配、单独阈值把关

用法: python hand_paste2.py <asset.webp> <pose.webp> <layers.json> <layer_dir> <out.webp> [search] [thresh]
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageSequence

ASSET, POSE, JF, LDIR, OUT = sys.argv[1:6]
SEARCH = int(sys.argv[6]) if len(sys.argv) > 6 else 14
THRESH = float(sys.argv[7]) if len(sys.argv) > 7 else 0.55


def align(mask_img, dst_bool, s_lo, s_hi, steps=41, off=12, off_step=2):
    dw, dh = dst_bool.shape[1], dst_bool.shape[0]
    best = None
    ty, tx = np.where(dst_bool)
    for i in range(steps):
        s = s_lo + (s_hi - s_lo) * i / (steps - 1)
        w = max(1, int(round(mask_img.width * s)))
        h = max(1, int(round(mask_img.height * s)))
        m = np.asarray(mask_img.resize((w, h), Image.BILINEAR)) > 128
        my, mx = np.where(m)
        if len(my) == 0:
            continue
        cdy, cdx = ty.mean() - my.mean(), tx.mean() - mx.mean()
        for dy in range(-off, off + 1, off_step):
            for dx in range(-off, off + 1, off_step):
                oy, ox = int(round(cdy)) + dy, int(round(cdx)) + dx
                canvas = np.zeros_like(dst_bool)
                y0, x0 = max(0, oy), max(0, ox)
                y1, x1 = min(dh, oy + h), min(dw, ox + w)
                if y1 <= y0 or x1 <= x0:
                    continue
                canvas[y0:y1, x0:x1] = m[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
                inter = float((canvas & dst_bool).sum())
                union = float((canvas | dst_bool).sum())
                if union <= 0:
                    continue
                iou = inter / union
                if best is None or iou > best[0]:
                    best = (iou, s, ox, oy)
    return best


asset = Image.open(ASSET)
frames = [f.convert("RGBA") for f in ImageSequence.Iterator(asset)]
W, H = frames[0].size
orig = Image.open(POSE).convert("RGBA")
OW, OH = orig.size
meta = json.load(open(JF, encoding="utf-8"))
CW, CH = int(meta["width"]), int(meta["height"])
DUR = asset.info.get("duration", 84) or 84

# 对齐 1：See-through 画布 -> 原图
sil = Image.new("L", (CW, CH), 0)
for L in meta["layers"]:
    p = os.path.join(LDIR, L["filename"])
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGBA")
    sil.paste(255, (int(L["left"]), int(L["top"]),
                    int(L["left"]) + im.width, int(L["top"]) + im.height), im.split()[3])
orig_bool = np.asarray(orig)[:, :, 3] > 60
a0 = np.asarray(frames[0])[:, :, 3] > 60
sb = np.asarray(sil) > 60
s_y, s_x = np.where(sb)
o_y, o_x = np.where(orig_bool)
s0 = ((o_x.max() - o_x.min()) / max(1, (s_x.max() - s_x.min())) +
      (o_y.max() - o_y.min()) / max(1, (s_y.max() - s_y.min()))) / 2
st = align(sil, orig_bool, s0 * 0.88, s0 * 1.12)
# 对齐 2：原图 -> 成品帧
orig_sil = Image.fromarray((orig_bool * 255).astype(np.uint8))
at = align(orig_sil, a0, (W / OW) * 0.85, (W / OW) * 1.15)
print("align1 IoU=%.4f s=%.4f off=(%d,%d)" % st)
print("align2 IoU=%.4f s=%.4f off=(%d,%d)" % at)
_, s_st, ox_st, oy_st = st
_, s_as, ox_as, oy_as = at

# 每只手单独建 sprite
sprites = []
for L in meta["layers"]:
    if not L["name"].startswith("handwear"):
        continue
    p = os.path.join(LDIR, L["filename"])
    if not os.path.exists(p):
        continue
    a = Image.open(p).convert("RGBA").split()[3]
    # 层掩膜 -> 原图坐标
    w1, h1 = max(1, int(round(a.width * s_st))), max(1, int(round(a.height * s_st)))
    a1 = a.resize((w1, h1), Image.LANCZOS)
    m_orig = Image.new("L", (OW, OH), 0)
    m_orig.paste(255, (int(round(L["left"] * s_st)) + ox_st, int(round(L["top"] * s_st)) + oy_st), a1)
    # 原图坐标 -> 成品帧坐标
    w2, h2 = max(1, int(round(OW * s_as))), max(1, int(round(OH * s_as)))
    m_asset = m_orig.resize((w2, h2), Image.LANCZOS)
    orig_s = orig.resize((w2, h2), Image.LANCZOS)
    arr = np.asarray(orig_s).copy()
    arr[:, :, 3] = (np.asarray(m_asset, dtype=np.float32) / 255.0 * arr[:, :, 3]).astype(np.uint8)
    full = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    full.paste(Image.fromarray(arr, "RGBA"), (ox_as, oy_as))
    al = np.asarray(full)[:, :, 3]
    ys, xs = np.where(al > 40)
    if len(ys) < 80:
        continue
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    sprites.append(dict(name=L["name"], full=full, box=(x0, y0, x1, y1),
                        feather=Image.fromarray(al).filter(ImageFilter.GaussianBlur(1.0))))
    print("  %-12s box=(%d,%d,%d,%d) px=%d" % (L["name"], x0, y0, x1, y1, int((al > 40).sum())))

if not sprites:
    print("no hand sprites"); raise SystemExit(1)

out_frames = []
stats = {s["name"]: [0, 0.0] for s in sprites}
for f in frames:
    fa = np.asarray(f, dtype=np.float32)
    gray = np.asarray(f.convert("L"), dtype=np.float32)
    comp = fa[:, :, :3].copy()
    alpha = fa[:, :, 3].copy()
    for sp in sprites:
        x0, y0, x1, y1 = sp["box"]
        pw, ph = x1 - x0, y1 - y0
        sp_arr = np.asarray(sp["full"], dtype=np.float32)
        patch_gray = np.asarray(sp["full"].convert("L"), dtype=np.float32)[y0:y1, x0:x1]
        mask = patch_gray > 0
        best = (-1.0, x0, y0)
        for dy in range(-SEARCH, SEARCH + 1, 2):
            for dx in range(-SEARCH, SEARCH + 1, 2):
                ax, ay = x0 + dx, y0 + dy
                if ax < 0 or ay < 0 or ax + pw > W or ay + ph > H:
                    continue
                win = gray[ay:ay + ph, ax:ax + pw]
                a_ = win[mask] - win[mask].mean()
                b_ = patch_gray[mask] - patch_gray[mask].mean()
                den = np.sqrt((a_ ** 2).sum()) * np.sqrt((b_ ** 2).sum())
                if den < 1e-6:
                    continue
                sc = float((a_ * b_).sum() / den)
                if sc > best[0]:
                    best = (sc, ax, ay)
        score, ax, ay = best
        stats[sp["name"]][1] += score
        if score < THRESH:          # 分数不够 → 不贴（宁可保留生成版，也不贴错位）
            continue
        stats[sp["name"]][0] += 1
        fe = np.zeros((H, W), dtype=np.float32)
        fe[ay:ay + ph, ax:ax + pw] = (np.asarray(sp["feather"], dtype=np.float32) / 255.0)[y0:y1, x0:x1]
        rgb = np.zeros((H, W, 3), dtype=np.float32)
        rgb[ay:ay + ph, ax:ax + pw] = sp_arr[y0:y1, x0:x1, :3]
        w3 = fe[:, :, None]
        comp = comp * (1 - w3) + rgb * w3
        alpha = np.maximum(alpha, fe * 255.0)
    res = np.dstack([comp, alpha])
    out_frames.append(Image.fromarray(np.clip(res, 0, 255).astype(np.uint8), "RGBA"))

for n, (cnt, sc) in stats.items():
    print("  %-12s pasted %2d/%d  mean_score=%.3f" % (n, cnt, len(frames), sc / len(frames)))
out_frames[0].save(OUT, format="WEBP", save_all=True, append_images=out_frames[1:],
                   duration=DUR, loop=0, quality=92, method=6)
print("saved", OUT, os.path.getsize(OUT) // 1024, "KB")
