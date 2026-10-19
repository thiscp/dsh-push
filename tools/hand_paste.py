"""手部原画级回贴（v2 实现）：用两级 IoU 对齐 + 逐帧模板匹配，把原立绘的手指像素贴回去。

三级坐标
  1) See-through 画布 (1024/1536) -> 原立绘 (1122x2019)：IoU 网格搜索求 scale/offset
  2) 原立绘 -> 成品帧 (422x760)：同样用轮廓 IoU 求解
  3) 手部掩膜随之映射到成品帧坐标；逐帧用模板匹配微调位置（±SEARCH），
     相关度不足则回退到静止位置，最后羽化合成。

用法: python hand_paste.py <asset.webp> <pose.webp> <layers.json> <layer_dir> <out.webp> [search]
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageSequence

ASSET, POSE, JF, LDIR, OUT = sys.argv[1:6]
SEARCH = int(sys.argv[6]) if len(sys.argv) > 6 else 16


def iou_align(src_mask, dst_shape, s_lo, s_hi, steps=41, off=12, off_step=2):
    """把 src_mask(同尺寸布尔) 缩放到 s 并平移，找与 dst(用回调) 最大 IoU 的 (s, ox, oy)。"""
    return None


def align(mask_img, dst_bool, s_lo, s_hi, steps=41, off=12, off_step=2):
    """mask_img: PIL L 图（源轮廓）；dst_bool: 目标布尔图。返回 (iou, s, ox, oy)。"""
    dw, dh = len(dst_bool[0]), len(dst_bool)
    best = None
    for i in range(steps):
        s = s_lo + (s_hi - s_lo) * i / (steps - 1)
        w = max(1, int(round(mask_img.width * s)))
        h = max(1, int(round(mask_img.height * s)))
        m = np.asarray(mask_img.resize((w, h), Image.BILINEAR)) > 128
        my, mx = np.where(m)
        if len(my) == 0:
            continue
        ty, tx = np.where(dst_bool)
        cdy, cdx = ty.mean() - my.mean(), tx.mean() - mx.mean()
        for dy in range(-off, off + 1, off_step):
            for dx in range(-off, off + 1, off_step):
                oy = int(round(cdy)) + dy
                ox = int(round(cdx)) + dx
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
print("asset", (W, H), "frames", len(frames), "orig", (OW, OH))

meta = json.load(open(JF, encoding="utf-8"))
CW, CH = int(meta["width"]), int(meta["height"])

# --- 1) See-through 画布 -> 原图 ---
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
# 先粗估比例，再用 IoU 精修
sw = (np.where(orig_bool)[1].max() - np.where(orig_bool)[1].min()) / max(1, (np.where(np.asarray(sil) > 60)[1].max() - np.where(np.asarray(sil) > 60)[1].min()))
sh = (np.where(orig_bool)[0].max() - np.where(orig_bool)[0].min()) / max(1, (np.where(np.asarray(sil) > 60)[0].max() - np.where(np.asarray(sil) > 60)[0].min()))
s0 = (sw + sh) / 2
st = align(sil, orig_bool, s0 * 0.85, s0 * 1.15)
print("see-through -> orig: IoU=%.4f s=%.4f off=(%d,%d)" % st)

# --- 2) 原图 -> 成品帧 ---
orig_sil = Image.fromarray(((np.asarray(orig)[:, :, 3] > 60) * 255).astype(np.uint8))
t0 = W / OW
at = align(orig_sil, a0, t0 * 0.85, t0 * 1.15)
print("orig -> asset: IoU=%.4f s=%.4f off=(%d,%d)" % at)

_, s_st, ox_st, oy_st = st
_, s_as, ox_as, oy_as = at

# --- 3) 手部掩膜 -> 原图 -> 成品帧 ---
hand_orig = Image.new("L", (OW, OH), 0)
names = []
for L in meta["layers"]:
    if not L["name"].startswith("handwear"):
        continue
    p = os.path.join(LDIR, L["filename"])
    if not os.path.exists(p):
        continue
    a = Image.open(p).convert("RGBA").split()[3]
    w = max(1, int(round(a.width * s_st)))
    h = max(1, int(round(a.height * s_st)))
    a2 = a.resize((w, h), Image.LANCZOS)
    hand_orig.paste(255, (int(round(L["left"] * s_st)) + ox_st, int(round(L["top"] * s_st)) + oy_st), a2)
    names.append(L["name"])
print("hand layers:", names, "mask px", int((np.asarray(hand_orig) > 60).sum()))

# 手部精灵（原图像素）
hw = max(1, int(round(OW * s_as)))
hh = max(1, int(round(OH * s_as)))
hand_mask_s = hand_orig.resize((hw, hh), Image.LANCZOS)
orig_s = orig.resize((hw, hh), Image.LANCZOS)
sprite = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sprite_arr = np.asarray(orig_s).copy()
sprite_arr[:, :, 3] = (np.asarray(hand_mask_s, dtype=np.float32) / 255.0 * sprite_arr[:, :, 3]).astype(np.uint8)
sprite = Image.fromarray(sprite_arr, "RGBA")
full = Image.new("RGBA", (W, H), (0, 0, 0, 0))
full.paste(sprite, (ox_as, oy_as))
sp_arr = np.asarray(full)
sp_alpha = sp_arr[:, :, 3]
bbox = Image.fromarray((sp_alpha > 30) .astype(np.uint8) * 255)
ys, xs = np.where(sp_alpha > 30)
if len(ys) == 0:
    print("no hand mask in asset coords"); raise SystemExit(1)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
print("hand bbox in asset:", (x0, y0, x1, y1), "px", int((sp_alpha > 30).sum()))

hand_rgb = np.asarray(full.convert("RGB"), dtype=np.float32)
hand_a = sp_alpha.astype(np.float32) / 255.0
# 羽化掩膜
feather = np.asarray(Image.fromarray((hand_a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), dtype=np.float32) / 255.0
patch_gray = np.asarray(full.convert("L"), dtype=np.float32)
patch = patch_gray[y0:y1, x0:x1]
pw, ph = x1 - x0, y1 - y0
print("patch size", (pw, ph))

out_frames = []
pasted = 0
scores = []
for f in frames:
    fa = np.asarray(f, dtype=np.float32)
    gray = np.asarray(f.convert("L"), dtype=np.float32)
    # 模板匹配（在期望位置附近搜索）
    best = (-1.0, x0, y0)
    for dy in range(-SEARCH, SEARCH + 1, 2):
        for dx in range(-SEARCH, SEARCH + 1, 2):
            ax, ay = x0 + dx, y0 + dy
            if ax < 0 or ay < 0 or ax + pw > W or ay + ph > H:
                continue
            win = gray[ay:ay + ph, ax:ax + pw]
            m = patch > 0
            if m.sum() < 50:
                continue
            a_ = win[m] - win[m].mean()
            b_ = patch[m] - patch[m].mean()
            den = (np.sqrt((a_ ** 2).sum()) * np.sqrt((b_ ** 2).sum()))
            if den < 1e-6:
                continue
            score = float((a_ * b_).sum() / den)
            if score > best[0]:
                best = (score, ax, ay)
    score, ax, ay = best
    scores.append(score)
    # 合成（相关度太低则用静止位置，避免贴飞）
    if score < 0.35:
        ax, ay = x0, y0
    fe = np.zeros((H, W), dtype=np.float32)
    fe[ay:ay + ph, ax:ax + pw] = feather[y0:y1, x0:x1]
    rgb = np.zeros((H, W, 3), dtype=np.float32)
    rgb[ay:ay + ph, ax:ax + pw] = hand_rgb[y0:y1, x0:x1, :]
    w3 = fe[:, :, None]
    comp = fa[:, :, :3] * (1 - w3) + rgb * w3
    alpha = np.maximum(fa[:, :, 3], fe * 255.0)
    res = np.dstack([comp, alpha])
    out_frames.append(Image.fromarray(np.clip(res, 0, 255).astype(np.uint8), "RGBA"))
    if score >= 0.35:
        pasted += 1

print("frames pasted by match: %d/%d   score mean=%.3f min=%.3f" %
      (pasted, len(out_frames), float(np.mean(scores)), float(np.min(scores))))
out_frames[0].save(OUT, format="WEBP", save_all=True, append_images=out_frames[1:],
                   duration=asset.info.get("duration", 84) or 84, loop=0, quality=92, method=6)
print("saved", OUT, os.path.getsize(OUT) // 1024, "KB")
