"""色相/饱和度锁定 + 锐化：把动画的观感拉回原立绘（确定性校正，不依赖统计量猜测）。

为什么不用 Lab 均值/方差对齐：角色在画面里的构成比例逐帧不同（深色裙/白围裙占比变化），
强行对齐三通道统计量会**过冲**——实测把色相从 231.6° 推到 214.9°（离原图 237.3° 更远）。
这里改用「测原图主色相/饱和 → 把每帧角色像素的 H 平移、S 缩放到位」，目标值由构造保证。

用法: python hue_lock.py <anim.webp> <pose_ref.webp> <out.webp> [--sharpen 70] [--sat 1.0]
"""
import colorsys
import os
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageSequence


def stats(img):
    """角色像素（alpha>8 或整图）里高饱和部分的 主色相(中位,度) / 中位饱和度。"""
    a = np.asarray(img.convert("RGBA")).astype(np.float32)
    al = a[:, :, 3]
    m = al > 8
    if m.sum() < 100:
        return None
    px = a[:, :, :3][m] / 255.0
    mx = px.max(axis=1); mn = px.min(axis=1)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6,
                 np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    col = s > 0.15
    if not col.any():
        return None
    return np.median(h[col]), np.median(s[col])


args = sys.argv[1:]
src, ref, dst = args[0], args[1], args[2]
SHARPEN = int(args[args.index("--sharpen") + 1]) if "--sharpen" in args else 70
SATK = float(args[args.index("--sat") + 1]) if "--sat" in args else 1.0

rs = stats(Image.open(ref))
if rs is None:
    print("ref has no character pixels"); raise SystemExit(1)
ref_hue, ref_sat = rs
print("ref  hue=%.1f° sat=%.3f" % (ref_hue, ref_sat), flush=True)

anim = Image.open(src)
frames = [f.convert("RGBA") for f in ImageSequence.Iterator(anim)]
print("frames", len(frames), flush=True)

out = []
for i, f in enumerate(frames):
    a = np.asarray(f).astype(np.float32)
    al = a[:, :, 3]
    m = al > 8
    st = stats(f)
    if st is not None and m.sum() > 100:
        cur_hue, cur_sat = st
        dh = (ref_hue - cur_hue) * SATK
        ks = (ref_sat / max(cur_sat, 1e-6)) ** SATK
        rgb = a[:, :, :3] / 255.0
        mx = rgb.max(axis=2); mn = rgb.min(axis=2)
        # RGB -> HSV（向量化）
        d = mx - mn
        h = np.zeros_like(mx)
        nz = d > 1e-6
        r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
        idx = nz & (mx == r); h[idx] = (((g - b)[idx] / d[idx]) % 6)
        idx = nz & (mx == g); h[idx] = ((b - r)[idx] / d[idx] + 2)
        idx = nz & (mx == b); h[idx] = ((r - g)[idx] / d[idx] + 4)
        h = (h * 60.0 + dh) % 360.0
        s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0) * ks
        s = np.clip(s, 0, 1)
        v = mx
        # HSV -> RGB
        c = v * s
        x = c * (1 - np.abs((h / 60.0) % 2 - 1))
        m2 = v - c
        z = np.zeros_like(c)
        cond = [(h < 60), (h < 120), (h < 180), (h < 240), (h < 300), (h >= 300)]
        rr = np.select(cond, [c, x, z, z, x, c])
        gg = np.select(cond, [x, c, c, x, z, z])
        bb = np.select(cond, [z, z, x, c, c, x])
        rgb2 = np.stack([rr + m2, gg + m2, bb + m2], axis=2)
        new = np.where(m[:, :, None], rgb2 * 255.0, a[:, :, :3])
        a = np.dstack([new, al])
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    if SHARPEN > 0:
        sh = im.convert("RGB").filter(ImageFilter.UnsharpMask(1.2, SHARPEN, 2))
        im = Image.merge("RGBA", (*sh.split(), im.split()[3]))
    out.append(im)

dur = Image.open(src).info.get("duration", 84) or 84
out[0].save(dst, format="WEBP", save_all=True, append_images=out[1:],
            duration=dur, loop=0, quality=90, method=6)
print("saved", dst, os.path.getsize(dst) // 1024, "KB", out[0].size, len(out), "frames", flush=True)
st2 = stats(out[len(out) // 4])
print("after hue=%.1f° sat=%.3f" % st2, flush=True)
