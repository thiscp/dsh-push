"""按 layers.json 的偏移与深度正确合成 See-through 图层，并出单层接触表。

用法: python layers_preview2.py <layers.json> <out_dir> <out_comp.png> <out_grid.png>
"""
import json
import os
import sys

from PIL import Image, ImageDraw

jf, outdir, out_comp, out_grid = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
d = json.load(open(jf, encoding="utf-8"))
W, H = int(d["width"]), int(d["height"])
layers = sorted(d["layers"], key=lambda L: -float(L.get("depth_median", 0)))  # 远(大深度)先画
print("canvas %dx%d, layers %d" % (W, H, len(layers)))

for L in layers:
    print("  %-14s depth=%.3f  box=(%d,%d,%d,%d)" %
          (L["name"], float(L.get("depth_median", 0)), L["left"], L["top"], L["right"], L["bottom"]))

comp = Image.new("RGBA", (W, H), (255, 255, 255, 255))
missing = 0
for L in layers:
    p = os.path.join(outdir, L["filename"])
    if not os.path.exists(p):
        missing += 1
        continue
    im = Image.open(p).convert("RGBA")
    comp.alpha_composite(im, (int(L["left"]), int(L["top"])))
print("composite built, missing files:", missing)
comp.convert("RGB").save(out_comp)
print("composite", out_comp, comp.size)

# 单层接触表：每层剪影放在中灰底上，标题写名字+尺寸
cols = 6
cell = 260
tiles = []
for L in layers:
    p = os.path.join(outdir, L["filename"])
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    sc = min((cell - 10) / max(1, w), (cell - 30) / max(1, h))
    t = im.resize((max(1, int(w * sc)), max(1, int(h * sc))), Image.LANCZOS)
    bg = Image.new("RGB", (cell, cell), (120, 120, 130))
    bg.paste(t, ((cell - t.width) // 2, (cell - 20 - t.height) // 2), t)
    dr = ImageDraw.Draw(bg)
    dr.text((4, cell - 16), "%s %dx%d" % (L["name"][:18], w, h), fill=(255, 255, 255))
    tiles.append(bg)

rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cell * cols, cell * rows), (30, 30, 30))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * cell, (i // cols) * cell))
sheet.save(out_grid)
print("grid", out_grid, sheet.size, "tiles", len(tiles))
