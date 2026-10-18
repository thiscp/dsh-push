"""重建生成用绿底参考图：给角色留出动作余量（默认占画布高 70%），纯绿背景。

背景：旧 gref_*.png 里角色占高 96.7%、上下仅 12px 余量，一抬手/一跳就出框被裁。
这里把角色缩到 70% 高、居中、四周留绿边，动作就能留在画布内；出图后再按
"全体帧并集包围盒"统一裁剪放回 422×760（见 key_alpha --fit）。

用法: python prep_green_pad.py <outdir> [W] [H] [occupancy]
"""
import os
import sys

from PIL import Image

SRC = r'F:\work\work_dsh\dsh-push\android-app\app\src\main\res\drawable-nodpi'
THEMES = [
    ('day', 'pose_maid.webp'),
    ('night', 'pose_serious.webp'),
    ('sakura', 'pose_shy.webp'),
    ('matcha', 'pose_confused.webp'),
    ('starry', 'pose_starry.webp'),
    ('caramel', 'pose_cheerful.webp'),
]
GREEN = (0, 255, 0)

out_dir = sys.argv[1] if len(sys.argv) > 1 else r'F:\AI\DocumentsComfyUI\input'
W = int(sys.argv[2]) if len(sys.argv) > 2 else 480
H = int(sys.argv[3]) if len(sys.argv) > 3 else 864
occ = float(sys.argv[4]) if len(sys.argv) > 4 else 0.70

for key, fname in THEMES:
    im = Image.open(os.path.join(SRC, fname)).convert('RGBA')
    # 先按 alpha 裁到真实内容，避免原图自带留白干扰占比计算
    bbox = im.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    target_h = max(1, int(H * occ))
    s = min(target_h / im.height, (W * 0.92) / im.width)
    nw, nh = max(1, round(im.width * s)), max(1, round(im.height * s))
    r = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), GREEN + (255,))
    canvas.alpha_composite(r, ((W - nw) // 2, (H - nh) // 2))
    dst = os.path.join(out_dir, 'grefp_%s.png' % key)
    canvas.convert('RGB').save(dst)
    print('%-8s %s -> %dx%d  char %dx%d (占高 %.0f%%)  margin top/bottom %d/%d'
          % (key, fname, W, H, nw, nh, 100.0 * nh / H, (H - nh) // 2, H - nh - (H - nh) // 2))
