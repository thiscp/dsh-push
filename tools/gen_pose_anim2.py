"""Q 版立绘「快答成功」庆祝微动生成器（v2，路线 A：纯程序化位移场，零抠像）。

与 gen_pose_anim.py 的区别
--------------------------
原版只有两条连续正弦：底部加权横摆（尾/裙摆）+ 胸口呼吸带。循环很稳但"没有动作"。
v2 在同一张静态 RGBA 立绘上叠加一次**轻跳**，并把落地读成**压缩-回弹**，再配一点侧倾，
读起来像"开心地原地蹦一下"。仍是纯位移场（不画任何新元素），所以：

  * 输出天然带真 alpha（源图透明区照样透明，不烘背景）；
  * 首末帧天然接得上（所有分量都是 t 的周期函数，t=0 与 t=1 同相）；
  * 无需 ComfyUI/视频模型/抠像节点。

动作时间线（t ∈ [0,1)，25 帧 × 110ms ≈ 2.75s 一圈）
  0.10–0.60  起跳 → 顶点 → 落地（sin 钟形，起落两端都为 0，保证无缝）
  起跳段     身体轻微纵向拉长（sy>1）、顶点附近上半身再多拉一点（"向上够"的手感）
  落地段     压缩（sy<1）后有一次小的二次回弹
  全程       侧倾 ±2.2°（绕脚底 pivot，非中线对齐的摆动更有生命感）
  全程       尾/裙摆横摆（底部加权 + 二次谐波），胸口呼吸（幅度略减，给跳让位）

两个实现要点（v2 修掉/新增）
  1. 变换一律**绕脚底中线 pivot** 做（旋转 + 缩放同一 pivot）⇒ 脚不离地、压缩是往下坐；
  2. RGBA 双线性改**预乘 alpha** ⇒ 彩色不向透明区渗黑边（原版直接在非预乘 RGBA 上插值）。
     ★ v2 初版曾在旋转步误用 (cx, cy) 当 pivot（cy=H/2 ≠ py=H），整体错位 380px 被钳位成抹痕，
       靠 tools 侧 verify_anim.py 的「逐帧不透明包围盒」抓出来的 —— 改这里务必复跑那个脚本。
"""
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "android-app", "app", "src", "main", "res")
SRC = os.path.join(RES, "drawable-nodpi")
DST = os.path.join(RES, "raw")

POSES = ["maid", "serious", "shy", "confused", "starry", "cheerful"]
N_FRAMES = 25
DURATION_MS = 110
OUT_H = 760
QUALITY = 72

# ---- 动作调参（改这里就能换性格）----
CHAR_H = 690           # 角色绘制高（画布 760 ⇒ 顶部留 70px 头部空间给跳/拉伸）
HOP_PX = 30            # 单跳基准高（px，会按每跳的 scale 缩放）
# 一圈里蹦两下：单次慢跳在 2.75s 循环里读起来像"飘"，两次短跳才像"开心地连蹦"。
# (起跳时刻, 落地时刻, 幅度系数, 落地压缩系数)
HOPS = [(0.04, 0.28, 1.00, 1.00),
        (0.32, 0.54, 0.74, 0.82),
        (0.58, 0.78, 0.46, 0.62)]
STRETCH = 0.035        # 起跳拉长 / 落地压缩幅度（绕脚底 pivot）
UPPER_STRETCH = 0.020  # 顶点时上半身额外拉长
REBOUND = 0.022        # 落地后二次回弹幅度
TILT_DEG = 2.2         # 侧倾最大角度
SWAY_A1 = 0.011        # 底摆横摆主分量（占画布宽比例）
SWAY_A2 = 0.0042       # 底摆二次谐波
BREATH = 0.0050        # 胸口呼吸（占画布高比例）
PAD = 80               # 采样透明 padding（越界取透明，杜绝钳位拉丝）


def _hop(t):
    """一圈内的若干次钟形跳之和；每个窗口起落两端都为 0 ⇒ 循环无缝。"""
    total = 0.0
    for (t0, t1, amp, _) in HOPS:
        if t0 < t < t1:
            u = (t - t0) / (t1 - t0)
            total += amp * float(np.sin(np.pi * u) ** 1.1)
    return total


def _hop_phase(t):
    """返回当前所处那一次跳的 (u, amp)，供压缩/回弹复用；不在跳窗口内返回 None。"""
    for (t0, t1, amp, sq) in HOPS:
        if t0 <= t <= t1:
            return (t - t0) / (t1 - t0), amp, sq, t1
    return None


def _squash(t):
    """纵向缩放：起跳拉长(>1)、落地压缩(<1)，再加一次落地回弹。"""
    sy = 1.0
    ph = _hop_phase(t)
    if ph is not None:
        u, amp, sq, _ = ph
        sy += STRETCH * sq * np.cos(np.pi * u)     # u=0 拉长，u=1 压缩
    for (t0, t1, amp, sq) in HOPS:                 # 每次落地后的回弹
        if t1 <= t <= t1 + 0.10:
            v = (t - t1) / 0.10
            sy += REBOUND * sq * np.sin(2 * np.pi * v) * (1.0 - v)
    return float(sy)


def frames_for(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    ow = round(OUT_H * w / h)
    im = im.resize((ow, OUT_H), Image.LANCZOS)
    arr = np.asarray(im, dtype=np.float32)
    H, W = OUT_H, ow

    # 源立绘本来就顶天立地（实测 bbox 8..2013 / 高 2019），跳与拉长会把头切出上缘。
    # ⇒ 先把角色按 CHAR_H 缩好、贴底居中放进 H×W 画布，顶部留出头部空间。
    #   代价：角色显示尺寸约为原来的 CHAR_H/OUT_H（约 91%），在 230dp 下约 209dp，肉眼不敏感。
    inset = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ch = CHAR_H
    cw = max(1, round(ch * w / h))
    if cw > W:                      # 极瘦长比例兜底：按宽收敛
        cw = W
        ch = max(1, round(cw * h / w))
    sub = im.resize((cw, ch), Image.LANCZOS)
    inset.paste(sub, ((W - cw) // 2, H - ch), sub)

    # 预乘 alpha：插值在预乘空间做，避免彩色向透明区渗黑
    a0 = np.asarray(inset, dtype=np.float32)
    a = a0[..., 3:4] / 255.0
    pm0 = np.concatenate([a0[..., :3] * a, a0[..., 3:4]], axis=2)
    # 四周补透明 padding：变换后越界采样得到透明，而不是钳在边缘像素上（否则底部鞋子被拉成丝）
    pm = np.zeros((H + 2 * PAD, W + 2 * PAD, 4), dtype=np.float32)
    pm[PAD:PAD + H, PAD:PAD + W] = pm0
    PH, PW = pm.shape[0], pm.shape[1]

    ys = np.arange(H, dtype=np.float32)
    xs = np.arange(W, dtype=np.float32)

    # 底摆横摆：底部权重 + 相位滞后；二次谐波让尾尖"甩"起来
    s = (ys / H) ** 1.6
    phase = 1.3 * (ys / H)
    # 呼吸：胸口高斯带
    y0, sig = 0.30 * H, 0.10 * H
    bump = np.exp(-((ys - y0) ** 2) / (2 * sig ** 2))

    # 唯一 pivot：脚底中线（旋转与缩放共用 ⇒ 脚不离地）
    px, py = W / 2.0, float(H)
    # 上半身额外拉长按"角色顶"归一，而不是画布顶
    char_top = float(H - ch)
    norm = np.clip((ys - char_top) / max(1.0, float(ch)), 0.0, 1.0)

    out = []
    for k in range(N_FRAMES):
        t = k / N_FRAMES
        th = 2 * np.pi * t

        hp = _hop(t)
        hop = hp * HOP_PX
        sy = _squash(t)
        sx = 1.0 / np.sqrt(max(sy, 0.5))            # 体积守恒
        rot = np.deg2rad(TILT_DEG * np.sin(th + 0.4))
        upper = UPPER_STRETCH * hp                  # 顶点时上半身额外拉长

        dx = (SWAY_A1 * W * s * np.sin(th + phase)
              + SWAY_A2 * W * s * s * np.sin(2 * th + 1.1 * phase))[:, None]
        dy = (BREATH * H * bump * np.sin(th + 1.6))[:, None]

        X, Y = np.meshgrid(xs, ys)
        # 1) 位移场（尾摆 + 呼吸）：output → source
        X = X - dx
        Y = Y - dy
        # 2) 侧倾：绕脚底 pivot 反向旋转
        ca, sa = np.cos(-rot), np.sin(-rot)
        dX0 = X - px
        dY0 = Y - py
        Xr = px + dX0 * ca - dY0 * sa
        Yr = py + dX0 * sa + dY0 * ca
        # 3) 压缩/拉伸：同一 pivot（脚底），上半身额外拉长
        sy_eff = sy * (1.0 + upper * (1.0 - norm))[:, None]
        Xr = px + (Xr - px) / sx
        Yr = py + (Yr - py) / sy_eff
        # 4) 跳：内容上移 ⇒ 采样点下移
        Yr = Yr + hop

        # 边界夹取（落在 padding 上即为透明）+ 双线性（预乘空间）
        Yr = np.clip(Yr + PAD, 0, PH - 1)
        Xr = np.clip(Xr + PAD, 0, PW - 1)
        y0i = np.clip(np.floor(Yr).astype(np.int32), 0, PH - 1)
        y1i = np.minimum(y0i + 1, PH - 1)
        wy = (Yr - y0i)[..., None]
        x0i = np.clip(np.floor(Xr).astype(np.int32), 0, PW - 1)
        x1i = np.minimum(x0i + 1, PW - 1)
        wx = (Xr - x0i)[..., None]

        f = (pm[y0i, x0i] * (1 - wy) * (1 - wx) +
             pm[y0i, x1i] * (1 - wy) * wx +
             pm[y1i, x0i] * wy * (1 - wx) +
             pm[y1i, x1i] * wy * wx)

        # 反预乘回直通 alpha
        al = np.clip(f[..., 3:4], 0, 255)
        rgb = np.where(al > 0, f[..., :3] * 255.0 / np.maximum(al, 1e-6), 0)
        frame = np.concatenate([np.clip(rgb, 0, 255), al], axis=2)
        out.append(Image.fromarray(np.uint8(frame), "RGBA"))
    return out


def _one(job):
    """单张立绘的完整产出（模块级函数，供 ProcessPoolExecutor 跨进程调用）。"""
    name, src_dir, dst_dir, method, quality = job
    src = os.path.join(src_dir, "pose_%s.webp" % name)
    if not os.path.exists(src):
        return (name, None, 0.0, None)
    fr = frames_for(src)
    dst = os.path.join(dst_dir, "pose_anim_%s.webp" % name)
    fr[0].save(dst, save_all=True, append_images=fr[1:],
               duration=DURATION_MS, loop=0,
               quality=quality, method=method)
    return (name, dst, os.path.getsize(dst) / 1024.0,
            (fr[0].size[0], fr[0].size[1], len(fr)))


def main():
    argv = sys.argv[1:]
    preview = "--preview" in argv
    fast = "--fast" in argv
    only = None
    if "--only" in argv:
        only = argv[argv.index("--only") + 1]
    global DST, SRC
    if "--out" in argv:
        DST = argv[argv.index("--out") + 1]
    if "--src" in argv:
        SRC = argv[argv.index("--src") + 1]
    jobs = 1
    if "--jobs" in argv:
        jobs = max(1, int(argv[argv.index("--jobs") + 1]))
    os.makedirs(DST, exist_ok=True)

    poses = [only] if only else POSES
    method = 4 if fast else 6
    quality = 78 if fast else QUALITY

    t0 = __import__("time").time()
    results = []
    if jobs > 1 and len(poses) > 1:
        # 动图 webp 编码是 CPU 单线程、GPU 帮不上忙 ⇒ 唯一有效加速就是多进程并行。
        with ProcessPoolExecutor(max_workers=jobs) as ex:
            for r in ex.map(_one, [(n, SRC, DST, method, quality) for n in poses]):
                results.append(r)
    else:
        for n in poses:
            results.append(_one((n, SRC, DST, method, quality)))

    sheets = []
    for name, dst, kb, meta in results:
        if dst is None:
            print("SKIP %s: no source" % name, flush=True)
            continue
        w, h, nf = meta
        print("%-24s %7.0fKB  %dx%d  %d frames" %
              (os.path.basename(dst), kb, w, h, nf), flush=True)
        if preview:
            fr = frames_for(os.path.join(SRC, "pose_%s.webp" % name))
            th = [f.resize((f.width * 200 // f.height, 200)) for f in fr]
            cols = 7
            rows = (len(th) + cols - 1) // cols
            sheet = Image.new("RGBA", (200 * cols, 200 * rows), (250, 245, 250, 255))
            for i, t2 in enumerate(th):
                sheet.paste(t2, ((i % cols) * 200, (i // cols) * 200), t2)
            sheets.append((name, sheet))
    print("elapsed %.1fs  (jobs=%d)" % (__import__("time").time() - t0, jobs), flush=True)
    if preview and sheets:
        import tempfile
        gap = 10
        big_h = sum(s2.height + gap for _, s2 in sheets)
        big = Image.new("RGBA", (sheets[0][1].width, big_h), (250, 245, 250, 255))
        yy = 0
        for _, s2 in sheets:
            big.paste(s2, (0, yy))
            yy += s2.height + gap
        tmp = os.path.join(tempfile.gettempdir(), "pose-anim2-preview.png")
        big.save(tmp)
        print("preview:", tmp, flush=True)


if __name__ == "__main__":
    main()
