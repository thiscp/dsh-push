"""部位刚性绑骨动画（像素=原画，掩膜=See-through）。

核心思路
  1. See-through 的 21 层只用来取 **掩膜与深度序**，像素一律从**原立绘**裁
     ⇒ 画质等于原图（脸/眼睛/笔触零重绘），同时拥有正确的部位分离。
  2. 每个部位是一个刚体精灵：只做仿射（平移/旋转/缩放），不做柔性弯曲
     ⇒ 脸不会被躯干拉变形（这是上一版网格形变的最大问题）。
  3. 骨骼层级：root(脚，钉地) → hip → chest → neck → head；头发链挂在 head 上带相位滞后；
     手臂挂在 chest 上；裙子挂 hip。
  4. 按 layers.json 的 depth_median 从远到近合成。

用法: python rig_layers.py <layers.json> <layer_dir> <pose.webp> <out.webp>
        [--h 760] [--frames 33] [--duration 84] [--gain 1.0] [--mp4 out.mp4] [--preview png]
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

args = sys.argv[1:]
JF, LDIR, POSE, DST = args[0], args[1], args[2], args[3]


def opt(name, default):
    return args[args.index(name) + 1] if name in args else default

# 背板开关：默认关闭。开着会让 See-through 层与原图像素精灵叠成"双层头发"（用户实测问题）。
USE_BACK = '--use-back' in args


OUT_H = int(opt("--h", 760))
N = int(opt("--frames", 33))
DUR = int(opt("--duration", 84))
GAIN = float(opt("--gain", 1.0))
MP4 = opt("--mp4", None)
PREVIEW = opt("--preview", None)

# ---- 骨骼与各部位归属 ----
# 部位 -> (挂载骨骼, 旋转幅度deg, 缩放幅度, 相位)
RIG = {
    'footwear':    ('root', 0.0, 0.0, 0.0),
    'legwear':     ('root', 0.0, 0.0, 0.0),
    'bottomwear':  ('hip', 0.35, 0.004, 0.0),
    'topwear':     ('chest', 0.30, 0.006, 0.3),
    'neck':        ('neck', 0.40, 0.0, 0.5),
    'face':        ('head', 0.55, 0.0, 0.6),
    'nose':        ('head', 0.55, 0.0, 0.6),
    'mouth':       ('head', 0.55, 0.0, 0.6),
    'eyewhite-l':  ('head', 0.55, 0.0, 0.6),
    'eyewhite-r':  ('head', 0.55, 0.0, 0.6),
    'irides-l':    ('head', 0.55, 0.0, 0.6),
    'irides-r':    ('head', 0.55, 0.0, 0.6),
    'eyelash-l':   ('head', 0.55, 0.0, 0.6),
    'eyelash-r':   ('head', 0.55, 0.0, 0.6),
    'eyebrow-l':   ('head', 0.55, 0.0, 0.6),
    'eyebrow-r':   ('head', 0.55, 0.0, 0.6),
    'headwear':    ('head', 0.55, 0.0, 0.6),
    'front hair':  ('head', 0.85, 0.0, 0.9),
    'back hair':   ('head', 1.10, 0.0, 1.4),
    'handwear-l':  ('chest', 0.45, 0.0, 0.8),
    'handwear-r':  ('chest', 0.45, 0.0, -0.6),
}

# ---- 载入 See-through 图层（只要掩膜/偏移/深度）----
meta = json.load(open(JF, encoding='utf-8'))
CW, CH = int(meta['width']), int(meta['height'])
parts = []
for L in meta['layers']:
    p = os.path.join(LDIR, L['filename'])
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert('RGBA')
    m = im.split()[3]
    parts.append(dict(name=L['name'], mask=m, left=int(L['left']), top=int(L['top']),
                      depth=float(L.get('depth_median', 0.5)), size=im.size))
parts.sort(key=lambda d: -d['depth'])          # 远 -> 近

# ---- 合成掩膜求 1024 画布里的角色包围盒 ----
sil = Image.new('L', (CW, CH), 0)
for d in parts:
    sil.paste(255, (d['left'], d['top'], d['left'] + d['size'][0], d['top'] + d['size'][1]), d['mask'])
A = sil.getbbox()
if A is None:
    print('no alpha in layers'); raise SystemExit(1)

# ---- 原立绘（像素来源）与它的包围盒 ----
pose = Image.open(POSE).convert('RGBA')
orig = np.asarray(pose)
pa = orig[:, :, 3]
ys, xs = np.where(pa > 8)
B = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)

# ---- 建立 1024 画布 -> 原图 的映射 ----
# 早先用"包围盒等比 + 平移"估变换，实测静止帧就有 ~1.7% 幽灵/1.7% 撕裂
# （掩膜整体偏 ~2px）——所有重影、撕裂的源头就在这个映射上。
# 现在改成**以掩膜并集与原图轮廓的 IoU 为目标做网格搜索**，把缩放/平移都解出来。
sil_np = np.asarray(sil, dtype=np.uint8) > 40
# 原图 alpha 缩到 1/4 尺寸做搜索（快 16 倍），坐标最后再放大回去
DS = 4
small = Image.fromarray((pa > 40).astype(np.uint8) * 255).resize(
    (pose.width // DS, pose.height // DS), Image.BILINEAR)
ref_small = np.asarray(small) > 128
target_area = float(ref_small.sum())

best = None
# 缩放搜索区间必须**自适应**：不同分解分辨率下正确比例不同（1024≈1.97、1536≈1.3），
# 写死区间会让搜索卡在边界（实测 1536 时 IoU 只有 0.64）。
_s0 = ((B[2] - B[0]) / max(1, A[2] - A[0]) + (B[3] - B[1]) / max(1, A[3] - A[1])) / 2.0
s_lo, s_hi = _s0 * 0.85, _s0 * 1.15
print('scale search: %.3f..%.3f (bbox estimate %.3f)' % (s_lo, s_hi, _s0))
for si in range(61):
    s_try = s_lo + (s_hi - s_lo) * si / 60.0
    w2 = max(1, int(round(CW * s_try / DS)))
    h2 = max(1, int(round(CH * s_try / DS)))
    m = np.asarray(Image.fromarray((sil_np * 255).astype(np.uint8)).resize((w2, h2), Image.BILINEAR)) > 128
    # 面积比决定粗定位，再在 ±24 像素内扫平移
    my, mx = np.where(m)
    if len(my) == 0:
        continue
    ry, rx = np.where(ref_small)
    cy, cx = my.mean(), mx.mean()
    ry_c, rx_c = ry.mean(), rx.mean()
    base_dy, base_dx = ry_c - cy, rx_c - cx
    for dy in range(-24, 25, 4):
        for dx in range(-24, 25, 4):
            oy2 = int(round(base_dy)) + dy
            ox2 = int(round(base_dx)) + dx
            canvas_m = np.zeros_like(ref_small)
            y0, x0 = max(0, oy2), max(0, ox2)
            y1, x1 = min(ref_small.shape[0], oy2 + h2), min(ref_small.shape[1], ox2 + w2)
            if y1 <= y0 or x1 <= x0:
                continue
            canvas_m[y0:y1, x0:x1] = m[y0 - oy2:y1 - oy2, x0 - ox2:x1 - ox2]
            inter = float((canvas_m & ref_small).sum())
            union = float((canvas_m | ref_small).sum())
            if union <= 0:
                continue
            iou = inter / union
            if best is None or iou > best[0]:
                best = (iou, s_try, ox2 * DS, oy2 * DS)

if best is None:
    print('alignment failed'); raise SystemExit(1)

# 二级精搜：在粗搜最优附近再细扫一遍（步长 1/5、平移 1px），把 IoU 拉回 0.985+
iou0, s0, ox0, oy0 = best
for si in range(-12, 13):
    s_try = s0 + si * 0.002
    if s_try <= 0:
        continue
    w2 = max(1, int(round(CW * s_try / DS)))
    h2 = max(1, int(round(CH * s_try / DS)))
    m = np.asarray(Image.fromarray((sil_np * 255).astype(np.uint8)).resize((w2, h2), Image.BILINEAR)) > 128
    for dy in range(-8, 9):
        for dx in range(-8, 9):
            oy2 = int(round((oy0 + dy * DS) / DS))
            ox2 = int(round((ox0 + dx * DS) / DS))
            canvas_m = np.zeros_like(ref_small)
            y0, x0 = max(0, oy2), max(0, ox2)
            y1, x1 = min(ref_small.shape[0], oy2 + h2), min(ref_small.shape[1], ox2 + w2)
            if y1 <= y0 or x1 <= x0:
                continue
            canvas_m[y0:y1, x0:x1] = m[y0 - oy2:y1 - oy2, x0 - ox2:x1 - ox2]
            inter = float((canvas_m & ref_small).sum())
            union = float((canvas_m | ref_small).sum())
            if union <= 0:
                continue
            iou = inter / union
            if iou > best[0]:
                best = (iou, s_try, ox2 * DS, oy2 * DS)

iou, s, ox, oy = best
print('alignment: IoU=%.4f scale=%.4f off=(%d,%d)  (coarse+fine)' % (iou, s, ox, oy))
print('layer canvas %dx%d | pose %dx%d' % (CW, CH, pose.width, pose.height))

# ---- 把每层掩膜搬到原图坐标系，并裁出**原图像素**作为精灵 ----
sprites = []
for d in parts:
    mx0, my0 = d['left'], d['top']
    mw, mh = d['size']
    # 该层在 1024 画布中的绝对矩形 -> 原图坐标
    X0 = ox + mx0 * s
    Y0 = oy + my0 * s
    X1 = ox + (mx0 + mw) * s
    Y1 = oy + (my0 + mh) * s
    ix0, iy0 = max(0, int(math.floor(X0))), max(0, int(math.floor(Y0)))
    ix1, iy1 = min(pose.width, int(math.ceil(X1))), min(pose.height, int(math.ceil(Y1)))
    if ix1 <= ix0 or iy1 <= iy0:
        continue
    mw2, mh2 = ix1 - ix0, iy1 - iy0
    mask = d['mask'].resize((mw2, mh2), Image.LANCZOS)
    # 掩膜在该矩形内的位置：因为整数取整，需按实际偏移重采样
    src = pose.crop((ix0, iy0, ix1, iy1))
    sprite = np.asarray(src).copy()
    sprite[:, :, 3] = (np.asarray(mask, dtype=np.float32) / 255.0 * sprite[:, :, 3]).astype(np.uint8)
    # See-through 自己的补画层（含被遮挡区内容），作为"背板"用：让开的位置有东西承接，
    # 否则刚性部件一转开就是空洞（实测静止帧都有 5% 丢失）。
    st_img = Image.open(os.path.join(LDIR, [L for L in meta['layers'] if L['name'] == d['name']][0]['filename'])).convert('RGBA')
    st_img = st_img.resize((mw2, mh2), Image.LANCZOS)
    sprites.append(dict(name=d['name'], img=Image.fromarray(sprite, 'RGBA'), back=st_img,
                        x=ix0, y=iy0, w=mw2, h=mh2, depth=d['depth']))

print('sprites:', len(sprites))
for s2 in sprites:
    print('  %-14s %dx%d at (%d,%d)' % (s2['name'], s2['w'], s2['h'], s2['x'], s2['y']))

# ---------------------------------------------------------------
# ★ 遮挡相减（关键修复）：See-through 的相邻层掩膜在边界/重叠部位（尤其"手 vs 上身"）
#   会有重叠。若不动，近处层盖住远处层看不出问题；但一旦近处层转动离开，
#   远处层里那份重复内容就露出来 —— 用户看到的"多出一只手"正是这个。
#   做法：按深度从近到远累加"已被占据"的掩膜，逐层扣掉；只保留自己独占的部分。
# ---------------------------------------------------------------
occ = None
for sp in reversed(sprites):            # 近 -> 远
    arr = np.asarray(sp['img'])[:, :, 3]
    if occ is None:
        occ = np.zeros((pose.height, pose.width), dtype=np.uint8)
    reg = occ[sp['y']:sp['y'] + sp['h'], sp['x']:sp['x'] + sp['w']]
    keep = arr.astype(np.float32) * (1.0 - reg.astype(np.float32) / 255.0)
    a = np.asarray(sp['img']).copy()
    a[:, :, 3] = np.clip(keep, 0, 255).astype(np.uint8)
    sp['img'] = Image.fromarray(a, 'RGBA')
    reg[...] = np.maximum(reg, a[:, :, 3])   # 该层占据的区域
print('occlusion subtraction applied')

# ---- 关节位置（原图坐标）----
hip_y = B[1] + 0.52 * (B[3] - B[1])
chest_y = B[1] + 0.34 * (B[3] - B[1])
neck_y = B[1] + 0.17 * (B[3] - B[1])
cx = (B[0] + B[2]) / 2.0
PIVOT = {'root': (cx, B[3]), 'hip': (cx, hip_y), 'chest': (cx, chest_y),
         'neck': (cx, neck_y), 'head': (cx, neck_y * 0.55 + chest_y * 0.45)}
print('pivots:', {k: (round(v[0], 1), round(v[1], 1)) for k, v in PIVOT.items()})

# ---- 渲染 ----
W = round(OUT_H * pose.width / pose.height)
H = OUT_H
k = OUT_H / pose.height


def rot_about(im, ang, px, py, sc=1.0):
    """以 (px,py) 为轴旋转 ang 度并缩放 sc，返回同尺寸 RGBA。"""
    if abs(ang) < 1e-6 and abs(sc - 1.0) < 1e-6:
        return im
    # 反向映射：先移轴 -> 反旋转/反缩放 -> 移回
    a = math.radians(-ang)
    ca, sa = math.cos(a), math.sin(a)
    isc = 1.0 / sc
    # PIL 的 AFFINE 参数：目标->源
    # x' = ( (x-px)*ca - (y-py)*sa )*isc + px
    m = (ca * isc, -sa * isc, px - (ca * isc * px - sa * isc * py),
         sa * isc, ca * isc, py - (sa * isc * px + ca * isc * py))
    return im.transform(im.size, Image.AFFINE, m, resample=Image.BICUBIC)


W2, H2 = pose.width, pose.height
frames = []
for fi in range(N):
    t = fi / N
    th = 2 * math.pi * t
    canvas = Image.new('RGBA', (pose.width, pose.height), (0, 0, 0, 0))
    for sp in sprites:
        bone, arot, asc, ph = RIG.get(sp['name'], ('chest', 0.5, 0.0, 0.0))
        pj = PIVOT[bone]
        # ★ 手臂要用"肩"当轴，不能绕胸口转：把骨头轴点夹到该精灵自身包围盒内最靠近的一端
        #   （否则手会整个甩离裙子/身体，接触关系直接崩掉）
        if sp['name'].startswith('handwear'):
            sx = min(max(pj[0], sp['x']), sp['x'] + sp['w'] - 1)
            sy = min(max(pj[1], sp['y']), sp['y'] + sp['h'] - 1)
            pj = (sx, sy)
        # 统一用 sin(th)：保证 t=0 时角度与缩放**都**为 0/1（否则静止帧就在动）
        ang = arot * GAIN * math.sin(th + ph)
        sc = 1.0 + asc * GAIN * math.sin(th + ph)
        # ★ 背板已废弃（默认关闭）：See-through 层与原图像素精灵形状不完全重合，
        #   两者叠加会在发丝边缘露出"第二层头发"（用户真机回执发现）。
        #   头发甩开后后面本来就该是空的（背景），不需要补画背板。
        #   需要对照时用 USE_BACK=1 打开。
        if USE_BACK:
            back = rot_about(sp['back'], ang, pj[0] - sp['x'], pj[1] - sp['y'], sc)
            canvas.alpha_composite(back, (sp['x'], sp['y']))
        local = rot_about(sp['img'], ang, pj[0] - sp['x'], pj[1] - sp['y'], sc)
        canvas.alpha_composite(local, (sp['x'], sp['y']))
    # 输出缩放
    # ★ 兜底补缝：只填"原图有料、合成却透明"的**细缝**（幅度小后只剩轮廓 1~2px）。
    #   注意：不做大面积回填，否则等于把甩开的头发又贴回去（重影）。
    comp_a = np.asarray(canvas)[:, :, 3]
    need = (pa > 200) & (comp_a < 60)
    if need.any() and need.sum() < 0.01 * (pa > 200).sum():   # 仅当缺口很小才回填
        patch = orig.copy()
        patch[:, :, 3] = np.where(need, orig[:, :, 3], 0).astype(np.uint8)
        canvas.alpha_composite(Image.fromarray(patch, 'RGBA'))
    # ★ 内部撕裂修补：掩膜之间的细微不吻合（尤其 front/back hair 交界）会在
    #   角色轮廓**内部**留下透明缝——这永远是缺陷，用原图像素填回。
    #   只填"从边界泛洪到不了的透明区"，因此不会把甩开的头发重新贴回去。
    from collections import deque
    solid = comp_a > 60
    outside = np.zeros_like(solid)
    dq = deque()
    for x in range(W2):
        for y in (0, H2 - 1):
            if not solid[y, x] and not outside[y, x]:
                outside[y, x] = True; dq.append((y, x))
    for y in range(H2):
        for x in (0, W2 - 1):
            if not solid[y, x] and not outside[y, x]:
                outside[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy2, dx2 in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy2, x + dx2
            if 0 <= ny < H2 and 0 <= nx < W2 and not solid[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True; dq.append((ny, nx))
    inner = (~solid) & (~outside) & (pa > 120)
    if inner.any():
        # 轻微膨胀 2px，把缝隙边缘的半透明也吃进去
        inner_i = Image.fromarray((inner * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
        need2 = (np.asarray(inner_i) > 128) & (comp_a < 200) & (pa > 120)
        patch = orig.copy()
        patch[:, :, 3] = np.where(need2, orig[:, :, 3], 0).astype(np.uint8)
        canvas.alpha_composite(Image.fromarray(patch, 'RGBA'))
    out = canvas.resize((W, H), Image.LANCZOS)
    frames.append(out)

frames[0].save(DST, format='WEBP', save_all=True, append_images=frames[1:],
               duration=DUR, loop=0, quality=92, method=6)
print('saved', DST, os.path.getsize(DST) // 1024, 'KB', frames[0].size, len(frames), 'frames')
a0 = np.asarray(frames[0])
print('corner_alpha', [int(a0[y, x, 3]) for (x, y) in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1))])

if PREVIEW:
    cols = 7
    thh = 170
    tls = [f.resize((f.width * thh // f.height, thh)) for f in frames]
    rows = (len(tls) + cols - 1) // cols
    tw = tls[0].width
    sheet = Image.new('RGB', (tw * cols, thh * rows), (26, 32, 48))
    for i, t2 in enumerate(tls):
        sheet.paste(t2, ((i % cols) * tw, (i // cols) * thh), t2)
    sheet.save(PREVIEW)
    print('preview', PREVIEW, sheet.size)

if MP4:
    try:
        import av
        bg = Image.new('RGB', frames[0].size, (26, 32, 48))
        with av.open(MP4, 'w') as c:
            st = c.add_stream('libx264', rate=max(1, round(1000 / DUR)))
            st.width, st.height = frames[0].size
            st.pix_fmt = 'yuv420p'
            for f in frames:
                comp = bg.copy(); comp.paste(f, (0, 0), f)
                for pkt in st.encode(av.VideoFrame.from_image(comp)):
                    c.mux(pkt)
            for pkt in st.encode():
                c.mux(pkt)
        print('mp4', MP4, os.path.getsize(MP4) // 1024, 'KB')
    except Exception as e:
        print('mp4 failed:', e)
