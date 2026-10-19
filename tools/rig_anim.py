"""原画网格形变动画（像素保真路线）：不重绘任何像素，只对原图做骨架式网格变形。

为什么这条路能做到"近乎原图"：输出帧的每个像素都来自原立绘的重采样，没有模型重绘，
所以线条、发丝、笔触、色相天然与原图一致；代价是只做平面内的形变（呼吸/摇摆/发丝/裙摆/
点头/小幅度抬手），大幅位移的遮挡关系变化做不了。

实现要点
  * 变形场建在**粗网格**上（COLS×ROWS 控制点），再用双三次插值升采样到全分辨率
    ⇒ 变形是平滑的"弯曲"而不是逐像素拉扯（早先全局位移场正是败在这里）；
  * 采样在**预乘 alpha** 空间做，避免彩边/黑边；
  * 每个控制点的位移由若干"器官级"运动叠加而成：整体摇摆(随高度)、呼吸(胸部高斯带)、
    点头(头部带)、发丝拖尾(离中线越远相位越滞后)、裙摆开合(下部按左右分侧)、尾鳍摆动；
  * 首末帧同相 ⇒ 天然无缝循环。

用法: python rig_anim.py <pose.webp> <out.webp> [--h 760] [--frames 33] [--duration 84]
        [--preview png] [--mp4 out.mp4]
"""
import os
import sys

import numpy as np
from PIL import Image

args = sys.argv[1:]
src, dst = args[0], args[1]


def opt(name, default):
    return args[args.index(name) + 1] if name in args else default


OUT_H = int(opt("--h", 760))
N = int(opt("--frames", 33))
DUR = int(opt("--duration", 84))
PREVIEW = opt("--preview", None)
MP4 = opt("--mp4", None)

# ---- 运动幅度（占画布比例）----
A_SWAY = 0.010      # 整体左右摇摆（越靠上越大）
A_BREATH = 0.007    # 胸口呼吸
A_BOB = 0.006       # 整体上下浮
A_HEAD = 0.004      # 点头
A_HAIR = 0.014      # 发丝拖尾
A_SKIRT = 0.010     # 裙摆开合
A_TAIL = 0.012      # 尾鳍摆动
TILT = 0.006        # 头部侧倾（以颈为轴）
GAIN = float(opt("--gain", 1.0))   # 整体幅度倍率：想更"活"就调大（1.6~2.0 观感更明显）
A_SWAY *= GAIN; A_BREATH *= GAIN; A_BOB *= GAIN; A_HEAD *= GAIN
A_HAIR *= GAIN; A_SKIRT *= GAIN; A_TAIL *= GAIN; TILT *= GAIN

COLS, ROWS = 9, 15

im = Image.open(src).convert("RGBA")
w0, h0 = im.size
ow = round(OUT_H * w0 / h0)
im = im.resize((ow, OUT_H), Image.LANCZOS)
arr = np.asarray(im, dtype=np.float32)
H, W = arr.shape[:2]
a = arr[..., 3:4] / 255.0
pm = np.concatenate([arr[..., :3] * a, arr[..., 3:4]], axis=2)   # 预乘

# 角色包围盒（用于把运动带定位到角色身上，而不是整幅画布）
al = arr[..., 3]
ys, xs = np.where(al > 8)
y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
bh = max(1, y1 - y0)
cx = (x0 + x1) / 2.0

yy = np.linspace(0, H - 1, ROWS)
xx = np.linspace(0, W - 1, COLS)
GX, GY = np.meshgrid(xx, yy)                     # 控制点坐标

# 归一化高度（0=脚底, 1=头顶）
yn = np.clip((GY - y0) / bh, 0.0, 1.0)
# 离中线距离（归一化）
dxn = np.clip(np.abs(GX - cx) / (0.5 * max(1, x1 - x0)), 0.0, 1.0)
# 各运动带
chest = np.exp(-((yn - 0.62) ** 2) / (2 * 0.10 ** 2))
headb = np.clip((yn - 0.80) / 0.20, 0, 1) ** 1.2
skirt = np.clip((0.45 - yn) / 0.45, 0, 1) ** 1.3
hairb = np.clip((yn - 0.35) / 0.65, 0, 1) * np.clip((0.98 - yn) / 0.2, 0, 1)
# 尾鳍：右下区域
tail = np.exp(-(((GX - (x0 + 0.86 * (x1 - x0))) ** 2) / (2 * (0.10 * (x1 - x0)) ** 2)
                + ((GY - (y0 + 0.42 * bh)) ** 2) / (2 * (0.12 * bh) ** 2)))

# ★ 脚部约束（root/IK）：人的脚是钉在地上不动的，只有髋以上在动。
#   早先整幅一起位移，脚会跟着上下浮沉，看着像"飘"——用户实测一眼就指出。
#   footlock 在脚踝以下 = 1（完全锁死），向上快速衰减到 0（自由运动）。
ankle_yn = 0.14                                   # 脚踝高度（占角色高比例）
footlock = np.clip(1.0 - (yn - 0.02) / (ankle_yn - 0.02), 0.0, 1.0) ** 1.6
free = 1.0 - footlock                             # 0=锁死, 1=自由

frames = []
for k in range(N):
    t = k / N
    th = 2 * np.pi * t
    # 位移场（控制点）
    dx = (A_SWAY * W * (yn ** 1.4) * np.sin(th)
          + A_HAIR * W * hairb * dxn ** 1.5 * np.sin(th - 0.9)
          + A_SKIRT * W * skirt * dxn * np.sign(GX - cx) * np.sin(th + 0.6)
          + A_TAIL * W * tail * np.sin(th + 1.8))
    dy = (-A_BREATH * H * chest * np.sin(th + 0.4)
          - A_BOB * H * (1 - yn) ** 0.7 * np.sin(th)
          - A_HEAD * H * headb * np.sin(th + 1.2)
          - A_HAIR * H * 0.35 * hairb * dxn * np.sin(th - 0.4))
    # 头部侧倾：以颈部为轴，越靠上位移越大
    dx = dx + TILT * W * headb * np.sin(th + 0.8)
    # 脚部锁死：脚踝以下完全不动（位移场乘 0），向上渐变放开
    dx = dx * free
    dy = dy * free

    # 粗网格 -> 全分辨率（双三次）
    dxf = np.asarray(Image.fromarray(dx.astype(np.float32), mode="F").resize((W, H), Image.BICUBIC))
    dyf = np.asarray(Image.fromarray(dy.astype(np.float32), mode="F").resize((W, H), Image.BICUBIC))

    X, Y = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    Xr = np.clip(X - dxf, 0, W - 1)
    Yr = np.clip(Y - dyf, 0, H - 1)

    x0i = np.clip(np.floor(Xr).astype(np.int32), 0, W - 1)
    x1i = np.minimum(x0i + 1, W - 1)
    y0i = np.clip(np.floor(Yr).astype(np.int32), 0, H - 1)
    y1i = np.minimum(y0i + 1, H - 1)
    wx = (Xr - x0i)[..., None]
    wy = (Yr - y0i)[..., None]
    f = (pm[y0i, x0i] * (1 - wy) * (1 - wx) + pm[y0i, x1i] * (1 - wy) * wx +
         pm[y1i, x0i] * wy * (1 - wx) + pm[y1i, x1i] * wy * wx)
    alp = np.clip(f[..., 3:4], 0, 255)
    rgb = np.where(alp > 0, f[..., :3] * 255.0 / np.maximum(alp, 1e-6), 0)
    frames.append(Image.fromarray(np.uint8(np.concatenate([np.clip(rgb, 0, 255), alp], axis=2)), "RGBA"))

frames[0].save(dst, format="WEBP", save_all=True, append_images=frames[1:],
               duration=DUR, loop=0, quality=92, method=6)
print("saved", dst, os.path.getsize(dst) // 1024, "KB", frames[0].size, len(frames), "frames", flush=True)

a0 = np.asarray(frames[0])
print("corner_alpha", [int(a0[y, x, 3]) for (x, y) in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1))])

if PREVIEW:
    cols = 7
    th = [f.resize((f.width * 170 // f.height, 170)) for f in frames]
    rows = (len(th) + cols - 1) // cols
    tw = th[0].width
    sheet = Image.new("RGB", (tw * cols, 170 * rows), (26, 32, 48))
    for i, t2 in enumerate(th):
        sheet.paste(t2, ((i % cols) * tw, (i // cols) * 170), t2)
    sheet.save(PREVIEW)
    print("preview", PREVIEW, sheet.size, flush=True)

if MP4:
    try:
        import av
        with av.open(MP4, "w") as c:
            s = c.add_stream("libx264", rate=1000 // DUR)
            s.width, s.height = frames[0].size
            s.pix_fmt = "yuv420p"
            bg = Image.new("RGB", frames[0].size, (26, 32, 48))
            for f in frames:
                comp = bg.copy(); comp.paste(f, (0, 0), f)
                vf = av.VideoFrame.from_image(comp)
                for pkt in s.encode(vf):
                    c.mux(pkt)
            for pkt in s.encode():
                c.mux(pkt)
        print("mp4", MP4, os.path.getsize(MP4) // 1024, "KB", flush=True)
    except Exception as e:
        print("mp4 failed:", e, flush=True)
