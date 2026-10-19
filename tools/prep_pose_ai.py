# prep-poses-ai.py -- build flattened 416x768 references + dilated alpha masks for the 6 theme poses
# output goes to %TEMP%\poseai\ (external exes can only write Temp on this box)
import os, tempfile
from PIL import Image, ImageFilter

SRC = r'F:\work\work_dsh\dsh-push\android-app\app\src\main\res\drawable-nodpi'
OUT = os.path.join(tempfile.gettempdir(), 'poseai')
os.makedirs(OUT, exist_ok=True)

# theme -> (pose asset, flat bg colour for generation)
THEMES = [
    ('day',     'pose_maid.webp',     (234, 243, 250)),
    ('night',   'pose_serious.webp',  (29, 43, 68)),
    ('sakura',  'pose_shy.webp',      (253, 242, 244)),
    ('matcha',  'pose_confused.webp', (242, 247, 236)),
    ('starry',  'pose_starry.webp',   (31, 26, 58)),
    ('caramel', 'pose_cheerful.webp', (255, 246, 234)),
]
W, H = 416, 768          # divisible by 16 for the video model
DILATE = 6               # px of mask dilation so slight model drift is not clipped

for key, fname, bg in THEMES:
    p = os.path.join(SRC, fname)
    im = Image.open(p).convert('RGBA')
    # fit inside WxH preserving aspect, then centre-pad
    s = min(W / im.width, H / im.height)
    nw, nh = max(1, round(im.width * s)), max(1, round(im.height * s))
    r = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.paste(r, ((W - nw) // 2, (H - nh) // 2))
    alpha = canvas.split()[3]
    flat = Image.new('RGBA', (W, H), bg + (255,))
    flat.alpha_composite(canvas)
    flat.convert('RGB').save(os.path.join(OUT, f'ref_{key}.png'))
    mask = alpha.point(lambda v: 255 if v > 24 else 0).filter(ImageFilter.MaxFilter(DILATE * 2 + 1))
    mask.save(os.path.join(OUT, f'mask_{key}.png'))
    print(f'{key}: {fname} {im.size} -> ref/mask {W}x{H}  alpha_px={sum(1 for v in alpha.getdata() if v > 24)}')
print('OUT =', OUT)
