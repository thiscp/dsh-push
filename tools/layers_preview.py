"""把 See-through 产出的图层合成预览：①按深度叠出完整图 ②单层接触表（棋盘底看 alpha）。

用法: python layers_preview.py <output_dir> <prefix> <out_composite.png> <out_grid.png>
"""
import glob
import os
import re
import sys

import numpy as np
from PIL import Image

outdir, prefix, out_comp, out_grid = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

files = sorted(glob.glob(os.path.join(outdir, prefix + '*.png')))
layers = {}
depths = {}
for f in files:
    base = os.path.basename(f)[:-4]
    name = base[len(prefix):]
    if name.endswith('_depth'):
        depths[name[:-6]] = f
    else:
        layers[name] = f

print("layers:", len(layers))
for n in sorted(layers):
    im = Image.open(layers[n])
    print("  %-16s %s  alpha>8: %.1f%%" % (n, im.size, 100.0 * (np.asarray(im.convert('RGBA'))[:, :, 3] > 8).mean()))

# 深度中值从日志里已有，这里直接用「文件名顺序 + 已知经验」做粗略叠序：
# 远 -> 近：back hair, footwear/legwear, bottomwear, topwear, 身体, 脸部件
order_pref = ['back hair', 'hair', 'tail', 'footwear', 'legwear', 'bottomwear', 'topwear',
              'body', 'neck', 'head', 'ear', 'eyewhite-l', 'eyewhite-r', 'eyelash-l', 'eyelash-r',
              'eyebrow-l', 'eyebrow-r', 'mouth', 'nose', 'face']
names = sorted(layers, key=lambda n: (order_pref.index(n) if n in order_pref else 50))

first = Image.open(layers[names[0]]).convert('RGBA')
W, H = first.size
comp = Image.new('RGBA', (W, H), (255, 255, 255, 255))
for n in names:
    im = Image.open(layers[n]).convert('RGBA')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    comp.alpha_composite(im)
comp.convert('RGB').save(out_comp)
print("composite", out_comp, comp.size)

# 单层接触表：每层放到中灰棋盘上，缩放成小格
cols = 6
th = 300
tiles = []
for n in names:
    im = Image.open(layers[n]).convert('RGBA')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    bg = Image.new('RGB', (W, H), (200, 200, 200))
    chk = np.zeros((H, W), dtype=np.uint8)
    chk[::16, :] = 40
    chk[:, ::16] = 40
    ck = Image.fromarray(np.dstack([chk] * 3))
    bg = Image.composite(Image.new('RGB', (W, H), (150, 150, 150)), ck, ck.convert('L').point(lambda v: 255 if v > 0 else 0))
    bg.paste(im, (0, 0), im)
    sc = th / H
    tiles.append((n, bg.resize((int(W * sc), th), Image.LANCZOS)))

rows = (len(tiles) + cols - 1) // cols
tw = tiles[0][1].width
sheet = Image.new('RGB', (tw * cols, (th + 18) * rows), (30, 30, 30))
from PIL import ImageDraw
dr = ImageDraw.Draw(sheet)
for i, (n, t) in enumerate(tiles):
    x = (i % cols) * tw
    y = (i // cols) * (th + 18)
    sheet.paste(t, (x, y))
    dr.text((x + 4, y + th + 3), n[:26], fill=(255, 255, 255))
sheet.save(out_grid)
print("grid", out_grid, sheet.size)
