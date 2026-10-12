# key-green2.py -- hue-based green key (G - max(R,B)) + 1px erode + full despill
# usage: python key-green2.py <theme> [ramp]
import os, sys, tempfile
from PIL import Image, ImageFilter, ImageSequence
import numpy as np

THEME = sys.argv[1] if len(sys.argv) > 1 else 'day'
RAMP = float(sys.argv[2]) if len(sys.argv) > 2 else 30.0     # greenness range mapped to 0..1 alpha
TMP = os.path.join(tempfile.gettempdir(), 'poseai')
raw = Image.open(os.path.join(TMP, f'ai_{THEME}_green_raw.webp'))
frames = [f.convert('RGB') for f in ImageSequence.Iterator(raw)][::2]

out = []
for fr in frames:
    a = np.asarray(fr, dtype=np.float32)
    greenness = a[:, :, 1] - np.maximum(a[:, :, 0], a[:, :, 2])
    alpha = np.clip(1.0 - greenness / RAMP, 0, 1)            # green -> 0, everything else -> 1
    # 1px erode to drop the outermost anti-aliased ring
    m = Image.fromarray((alpha * 255).astype(np.uint8), 'L').filter(ImageFilter.MinFilter(3))
    alpha = np.asarray(m, dtype=np.float32) / 255.0
    # full despill on partly transparent pixels: green may not exceed the max of R/B
    a = a.copy()
    cap = np.maximum(a[:, :, 0], a[:, :, 2])
    edge = (alpha < 1.0)
    a[:, :, 1] = np.where(edge, np.minimum(a[:, :, 1], cap), a[:, :, 1])
    rgba = Image.fromarray(np.dstack([a, alpha * 255]).astype(np.uint8), 'RGBA')
    out.append(rgba.resize((422, 760), Image.LANCZOS))

p = os.path.join(TMP, f'ai_{THEME}_green2.webp')
out[0].save(p, format='WEBP', save_all=True, append_images=out[1:], duration=84, loop=0, quality=70, method=6)
print(f'{THEME}: ramp={RAMP} frames={len(out)} -> {os.path.getsize(p)//1024} KB')
def oncard(im, color, size=(422, 760)):
    r = im.resize(size, Image.LANCZOS); c = Image.new('RGB', size, color); c.paste(r, (0, 0), r); return c
for name, color in (('night', (29, 43, 68)), ('magenta', (255, 0, 255))):
    oncard(out[0], color).save(os.path.join(TMP, f'g2_{THEME}_{name}.png'))
print(f'QA: g2_{THEME}_night.png / g2_{THEME}_magenta.png')
