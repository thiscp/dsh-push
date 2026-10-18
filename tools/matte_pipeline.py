"""成品抠像流水线（成熟方案）：rembg isnet-anime 出 alpha → 去绿边 → 并集裁剪 → 正反拼接。

为什么换掉自研色键：
  * 纯色键 + 腐蚀会把发丝/蕾丝/羽毛一并啃掉，边缘发硬；
  * **isnet-anime** 是动漫角色抠像的工业标准模型（rembg 内置），半透明发丝能保留下来；
  * 抠完仍可能残留"源图里半透明发丝混入的绿"，补一道 despill（G 不得超过 max(R,B)）即可。

用法（在装了 rembg 的环境里跑，如 F:\\AI\\matte-venv）：
  python matte_pipeline.py <raw.webp> <out.webp> [--start N] [--frames N] [--pingpong]
      [--fit] [--size 422x760] [--duration 84] [--model isnet-anime] [--qa out.png] [--despill 1]
"""
import os
import sys

import numpy as np
from PIL import Image, ImageSequence
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
out = []
for i, fr in enumerate(frames):
    res = remove(fr, session=sess)                      # RGBA
    a = np.asarray(res).astype(np.float32)
    if SPILL:
        # 去绿边：绿通道不得超过红蓝较大者（只压绿、不动 alpha 与其它通道）
        cap = np.maximum(a[:, :, 0], a[:, :, 2])
        a[:, :, 1] = np.minimum(a[:, :, 1], cap)
    out.append(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA"))
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
