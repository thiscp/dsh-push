"""手部原画级回贴 v5（最终版）
改进点（针对 v2~v4 的失败）
  1) 模板匹配信号从"灰度相关性"换成 **alpha 轮廓 IoU** —— 生成帧再糊，轮廓依旧清楚
  2) 每只手独立匹配（handwear-l / handwear-r 分开），避免"整块贴导致另一只手残片"
  3) 时序一致：某只手在 >=60% 帧达标 → 该手**全部帧**都贴（缺的帧用已达标帧的中位偏移）
     否则该手整段不贴 —— 只出现"全程贴"或"全程不贴"，不会闪烁
用法: python hand_paste4.py <asset.webp> <pose.webp> <layers.json> <layer_dir> <out.webp> [search] [iou_thresh]
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageSequence

ASSET, POSE, JF, LDIR, OUT = sys.argv[1:6]
SEARCH = int(sys.argv[6]) if len(sys.argv) > 6 else 20
IOU_T = float(sys.argv[7]) if len(sys.argv) > 7 else 0.50
COVER = 0.60


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
                if best is None or inter / union > best[0]:
                    best = (inter / union, s, ox, oy)
    return best


asset = Image.open(ASSET)
frames = [f.convert("RGBA") for f in ImageSequence.Iterator(asset)]
alphas = [np.asarray(f)[:, :, 3] > 100 for f in frames]
W, H = frames[0].size
orig = Image.open(POSE).convert("RGBA")
OW, OH = orig.size
meta = json.load(open(JF, encoding="utf-8"))
CW, CH = int(meta["width"]), int(meta["height"])
DUR = asset.info.get("duration", 84) or 84

sil = Image.new("L", (CW, CH), 0)
for L in meta["layers"]:
    p = os.path.join(LDIR, L["filename"])
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGBA")
    sil.paste(255, (int(L["left"]), int(L["top"]),
                    int(L["left"]) + im.width, int(L["top"]) + im.height), im.split()[3])
orig_bool = np.asarray(orig)[:, :, 3] > 60
sb = np.asarray(sil) > 60
s_y, s_x = np.where(sb)
o_y, o_x = np.where(orig_bool)
s0 = ((o_x.max() - o_x.min()) / max(1, (s_x.max() - s_x.min())) +
      (o_y.max() - o_y.min()) / max(1, (s_y.max() - s_y.min()))) / 2
st = align(sil, orig_bool, s0 * 0.88, s0 * 1.12)
at = align(Image.fromarray((orig_bool * 255).astype(np.uint8)), alphas[0],
           (W / OW) * 0.85, (W / OW) * 1.15)
_, s_st, ox_st, oy_st = st
_, s_as, ox_as, oy_as = at
print("align1 IoU=%.4f | align2 IoU=%.4f s=%.4f off=(%d,%d)" % (st[0], at[0], at[1], at[2], at[3]))

# 每只手：形状模板 + 原图像素精灵
hands = []
for L in meta["layers"]:
    if not L["name"].startswith("handwear"):
        continue
    p = os.path.join(LDIR, L["filename"])
    if not os.path.exists(p):
        continue
    a = Image.open(p).convert("RGBA").split()[3]
    w1, h1 = max(1, int(round(a.width * s_st))), max(1, int(round(a.height * s_st)))
    a1 = a.resize((w1, h1), Image.LANCZOS)
    m_orig = np.zeros((OH, OW), dtype=np.uint8)
    px, py = int(round(L["left"] * s_st)) + ox_st, int(round(L["top"] * s_st)) + oy_st
    y0m, x0m = max(0, py), max(0, px)
    y1m, x1m = min(OH, py + h1), min(OW, px + w1)
    if y1m <= y0m or x1m <= x0m:
        continue
    m_orig[y0m:y1m, x0m:x1m] = np.asarray(a1)[y0m - py:y1m - py, x0m - px:x1m - px]
    w2, h2 = max(1, int(round(OW * s_as))), max(1, int(round(OH * s_as)))
    mask_img = Image.fromarray(m_orig).resize((w2, h2), Image.LANCZOS)
    orig_s = orig.resize((w2, h2), Image.LANCZOS)
    arr = np.asarray(orig_s).copy()
    arr[:, :, 3] = (np.asarray(mask_img, dtype=np.float32) / 255.0 * arr[:, :, 3]).astype(np.uint8)
    full = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    full.paste(Image.fromarray(arr, "RGBA"), (ox_as, oy_as))
    shape = np.asarray(full)[:, :, 3] > 100
    ys, xs = np.where(shape)
    if len(ys) < 150:
        continue
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    hands.append(dict(name=L["name"], full=full, box=(x0, y0, x1, y1),
                      shape=shape[y0:y1, x0:x1],
                      feather=np.asarray(Image.fromarray(np.asarray(full)[:, :, 3]).filter(
                          ImageFilter.GaussianBlur(0.8)), dtype=np.float32)))
    print("  %-12s box=(%d,%d,%d,%d) shape_px=%d" % (L["name"], x0, y0, x1, y1, int(shape.sum())))

if not hands:
    print("no hand sprites"); raise SystemExit(1)

# 逐帧逐手：alpha 轮廓 IoU 搜索最佳偏移
best_off = {h["name"]: [] for h in hands}
for fi, fr_alpha in enumerate(alphas):
    for h in hands:
        x0, y0, x1, y1 = h["box"]
        pw, ph = x1 - x0, y1 - y0
        tpl = h["shape"]
        area = float(tpl.sum())
        best = (-1.0, 0, 0)
        for dy in range(-SEARCH, SEARCH + 1):
            for dx in range(-SEARCH, SEARCH + 1):
                ax, ay = x0 + dx, y0 + dy
                if ax < 0 or ay < 0 or ax + pw > W or ay + ph > H:
                    continue
                win = fr_alpha[ay:ay + ph, ax:ax + pw]
                inter = float((win & tpl).sum())
                union = area + float(win.sum()) - inter
                if union <= 0:
                    continue
                iou = inter / union
                if iou > best[0]:
                    best = (iou, dx, dy)
        best_off[h["name"]].append(best)

# 时序决策
use = {}
for h in hands:
    offs = best_off[h["name"]]
    good = [o for o in offs if o[0] >= IOU_T]
    cov = len(good) / len(offs)
    if cov >= COVER:
        dxs = np.median([o[1] for o in good])
        dys = np.median([o[2] for o in good])
        use[h["name"]] = (True, int(round(dxs)), int(round(dys)))
        print("  %-12s USE  cover=%.0f%% median_off=(%d,%d) mean_iou=%.3f" %
              (h["name"], cov * 100, dxs, dys, float(np.mean([o[0] for o in good]))))
    else:
        use[h["name"]] = (False, 0, 0)
        print("  %-12s SKIP cover=%.0f%% mean_iou=%.3f" %
              (h["name"], cov * 100, float(np.mean([o[0] for o in offs]))))

out = []
for fi, f in enumerate(frames):
    fa = np.asarray(f, dtype=np.float32)
    comp = fa[:, :, :3].copy()
    alpha = fa[:, :, 3].copy()
    for h in hands:
        ok, mdx, mdy = use[h["name"]]
        if not ok:
            continue
        x0, y0, x1, y1 = h["box"]
        # 逐帧用自身最佳偏移（若该帧达标），否则用中位偏移
        iou, dx, dy = best_off[h["name"]][fi]
        if iou < IOU_T:
            dx, dy = mdx, mdy
        ax, ay = x0 + dx, y0 + dy
        if ax < 0 or ay < 0 or ax + (x1 - x0) > W or ay + (y1 - y0) > H:
            continue
        ph, pw = y1 - y0, x1 - x0
        fe = np.zeros((H, W), dtype=np.float32)
        fe[ay:ay + ph, ax:ax + pw] = h["feather"][y0:y1, x0:x1] / 255.0
        sp = np.asarray(h["full"], dtype=np.float32)
        rgb = np.zeros((H, W, 3), dtype=np.float32)
        rgb[ay:ay + ph, ax:ax + pw] = sp[y0:y1, x0:x1, :3]
        w3 = fe[:, :, None]
        comp = comp * (1 - w3) + rgb * w3
        alpha = np.maximum(alpha, fe * 255.0)
    out.append(Image.fromarray(np.clip(np.dstack([comp, alpha]), 0, 255).astype(np.uint8), "RGBA"))

out[0].save(OUT, format="WEBP", save_all=True, append_images=out[1:],
            duration=DUR, loop=0, quality=92, method=6)
print("saved", OUT, os.path.getsize(OUT) // 1024, "KB")
