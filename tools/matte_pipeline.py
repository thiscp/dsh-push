"""成品抠像流水线（成熟方案）：rembg isnet-anime 出 alpha → 去绿边 → 并集裁剪 → 正反拼接。

为什么换掉自研色键：
  * 纯色键 + 腐蚀会把发丝/蕾丝/羽毛一并啃掉，边缘发硬；
  * **isnet-anime** 是动漫角色抠像的工业标准模型（rembg 内置），半透明发丝能保留下来；
  * 抠完仍可能残留"源图里半透明发丝混入的绿"，补一道 despill（G 不得超过 max(R,B)）即可。

用法（在装了 rembg 的环境里跑，如 F:\\AI\\matte-venv）：
  python matte_pipeline.py <raw.webp> <out.webp> [--start N] [--frames N] [--pingpong]
      [--fit] [--size 422x760] [--duration 84] [--model isnet-anime] [--qa out.png] [--despill 1]
      [--color-ref pose.webp] [--sharpen 60]

  --color-ref：给出原立绘路径 ⇒ 每帧角色区域在 **Lab 空间做均值/方差对齐**到原立绘，
      消除生成模型的整体色偏（实测主色相偏约 6°，肉眼就是"头发颜色不一样"）。
  --sharpen：USM 强度百分比（0=关闭）；生成源分辨率有限，轻微锐化能明显改善"糊"感。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageSequence
from rembg import new_session, remove

args = sys.argv[1:]
src, dst = args[0], args[1]


def opt(name, default):
    return args[args.index(name) + 1] if name in args else default


start = int(opt("--start", 0))
nframes = int(opt("--frames", 0))
DUR = int(opt("--duration", 84))
MODEL = opt("--model", "isnet-anime")
QA = opt("--qa", None)
SPILL = int(opt("--despill", 1))
COLOR_REF = opt("--color-ref", None)
STRENGTH = float(opt("--color-strength", 0.6))
SHARPEN = int(opt("--sharpen", 60))
do_fit = "--fit" in args
do_pp = "--pingpong" in args
w, h = opt("--size", "422x760").lower().split("x")
SIZE = (int(w), int(h))

raw = Image.open(src)
frames = [f.convert("RGB") for f in ImageSequence.Iterator(raw)]
print("in_frames", len(frames), "size", raw.size, "model", MODEL, flush=True)
if start or nframes:
    end = start + nframes if nframes else len(frames)
    frames = frames[start:end]
if do_pp:
    frames = frames + frames[-2::-1]
print("frames to matte", len(frames), "pingpong", do_pp, flush=True)

sess = new_session(MODEL)

# 色彩对齐的参考统计量（Lab 空间，只看原立绘的角色像素）
ref_stats = None
if COLOR_REF and os.path.exists(COLOR_REF):
    r_im = Image.open(COLOR_REF).convert("RGBA")
    r_lab = np.asarray(r_im.convert("LAB")).astype(np.float32)
    r_mask = np.asarray(r_im)[:, :, 3] > 8
    if r_mask.sum() > 100:
        ref_stats = [(float(r_lab[..., c][r_mask].mean()), float(r_lab[..., c][r_mask].std()))
                     for c in range(3)]
        print("color-ref", COLOR_REF, "masked px", int(r_mask.sum()),
              "lab mean", [round(x[0], 1) for x in ref_stats], flush=True)
    else:
        print("color-ref ignored (no opaque pixels)", flush=True)

out = []
for i, fr in enumerate(frames):
    res = remove(fr, session=sess)                      # RGBA
    a = np.asarray(res).astype(np.float32)
    if SPILL:
        # 去绿边：绿通道不得超过红蓝较大者（只压绿、不动 alpha 与其它通道）
        cap = np.maximum(a[:, :, 0], a[:, :, 2])
        a[:, :, 1] = np.minimum(a[:, :, 1], cap)
        # ★ 边缘加强去绿：薄边缘（手指缝、发丝）上残留的绿靠上面一刀压不干净，
        #   这里只对 alpha<250 的边缘像素按 excess*K 额外扣绿（K>1 表示多扣）。
        #   限制在边缘是为了不伤到实心区域（皮肤 R>G>B，若全域多扣会发紫）。
        K = float(opt("--despill-edge", 1.0))
        if K > 1.0:
            al = a[:, :, 3]
            edge = (al > 0) & (al < 250)
            excess = np.maximum(0.0, a[:, :, 1] - cap)
            a[:, :, 1] = np.where(edge, a[:, :, 1] - excess * (K - 1.0), a[:, :, 1])
    rgba = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")

    # 色度对齐到原立绘：**只动 Lab 的 a/b（色度），不动 L（亮度），也不做方差缩放**。
    # 早先做过"三通道 mean+std 全对齐"，结果色相从 231.6° 被推到 214.9°（离原图 237.3° 更远）——
    # 因为角色在画面里的构成比例（深色裙/白围裙占比）与逐帧不同，强行对齐统计量会过冲。
    # 现在只平移色度均值并乘 STRENGTH，属于保守校正。
    if ref_stats is not None and STRENGTH > 0:
        al = np.asarray(rgba)[:, :, 3]
        m = al > 8
        if m.sum() > 100:
            lab = np.asarray(rgba.convert("LAB")).astype(np.float32)
            for c in (1, 2):
                mf = float(lab[..., c][m].mean())
                mr = ref_stats[c][0]
                lab[..., c] = np.where(m, lab[..., c] + (mr - mf) * STRENGTH, lab[..., c])
            lab = np.clip(lab, 0, 255).astype(np.uint8)
            rgb2 = Image.fromarray(lab, "LAB").convert("RGB")
            rgba = Image.merge("RGBA", (*rgb2.split(), rgba.split()[3]))

    # 轻微 USM：生成源分辨率有限，锐化后再降采样可明显改善"糊"感
    if SHARPEN > 0:
        sharp = rgba.convert("RGB").filter(ImageFilter.UnsharpMask(1.2, SHARPEN, 2))
        rgba = Image.merge("RGBA", (*sharp.split(), rgba.split()[3]))

    out.append(rgba)
    if (i + 1) % 8 == 0:
        print("  matted", i + 1, flush=True)

if do_fit:
    boxes = []
    for im2 in out:
        bb = im2.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()
        if bb:
            boxes.append(bb)
    if boxes:
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        mw = max(4, int((x1 - x0) * 0.04)); mh = max(4, int((y1 - y0) * 0.04))
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
        print("fit union bbox (%d,%d)-(%d,%d) -> %dx%d in %s" % (x0, y0, x1, y1, nw, nh, SIZE), flush=True)
else:
    out = [im2.resize(SIZE, Image.LANCZOS) for im2 in out]

out[0].save(dst, format="WEBP", save_all=True, append_images=out[1:],
            duration=DUR, loop=0, quality=85, method=6)
print("saved", dst, os.path.getsize(dst) // 1024, "KB", out[0].size, len(out), "frames", flush=True)

a0 = np.asarray(out[0])
print("corner_alpha", [int(a0[y, x, 3]) for (x, y) in
                       ((0, 0), (a0.shape[1] - 1, 0), (0, a0.shape[0] - 1), (a0.shape[1] - 1, a0.shape[0] - 1))])
soft = ((a0[:, :, 3] > 20) & (a0[:, :, 3] < 235))
print("alpha: opaque %.1f%% soft %.2f%% transparent %.1f%%" %
      (100 * (a0[:, :, 3] > 235).mean(), 100 * soft.mean(), 100 * (a0[:, :, 3] <= 20).mean()))

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
    print("qa", QA, flush=True)
