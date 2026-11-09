# run-pose-ai.py -- one theme's success-page pose -> AI loop -> transparent animated WebP
# usage: python run-pose-ai.py <theme> [seed] [mode: light|full]
import json, os, sys, time, tempfile, urllib.request, urllib.error
from PIL import Image, ImageSequence, ImageFilter

THEME = sys.argv[1] if len(sys.argv) > 1 else 'day'
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 7
MODE = sys.argv[3] if len(sys.argv) > 3 else 'light'
BASE = "http://127.0.0.1:8000"
W, H, LEN = 416, 768, 49
TMP = os.path.join(tempfile.gettempdir(), 'poseai')
OUT_WEBP = os.path.join(TMP, f'ai_{THEME}.webp')
RAW = os.path.join(TMP, f'ai_{THEME}_raw.webp')

POS = ("the cute chibi whale girl with blue hair and white maid headband, wearing a navy blue "
       "dress with white apron and ribbon, round white whale body with dark blue whale tail fin, "
       "she gently breathes and sways in place, hair and tail fin sway softly, "
       "static camera, plain flat solid background, high quality anime style, "
       "same character and same outfit as the reference image")
NEG = ("changing clothes, missing clothes, changing hairstyle, changing face, different character, "
       "identity change, extra limbs, missing limbs, deformed hands, extra fingers, camera movement, "
       "zoom, pan, scene change, background change, morphing, flickering, text, watermark, blurry, "
       "low quality, oversaturated, cropped")

HI = "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
LO = "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
LORA_HI = "wan2.2_i2v_4steps_high_noise.safetensors"
LORA_LO = "wan2.2_i2v_4steps_low_noise.safetensors"

if MODE == 'light':
    SHIFT, STEPS, CFG, MID = 5.0, 4, 1.0, 2
else:
    SHIFT, STEPS, CFG, MID = 8.0, 20, 4.0, 10

g = {
  "1": {"class_type": "UNETLoader", "inputs": {"unet_name": HI, "weight_dtype": "default"}},
  "2": {"class_type": "UNETLoader", "inputs": {"unet_name": LO, "weight_dtype": "default"}},
  "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan", "device": "cpu"}},
  "4": {"class_type": "VAELoader", "inputs": {"vae_name": "wan_2.1_vae.safetensors"}},
  "5": {"class_type": "CLIPTextEncode", "inputs": {"text": POS, "clip": ["3", 0]}},
  "6": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["3", 0]}},
  "7": {"class_type": "LoadImage", "inputs": {"image": f"ref_{THEME}.png"}},
  "8": {"class_type": "LoadImage", "inputs": {"image": f"ref_{THEME}.png"}},
  "9": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["1", 0], "shift": SHIFT}},
  "11": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["2", 0], "shift": SHIFT}},
  "13": {"class_type": "WanFirstLastFrameToVideo", "inputs": {
      "positive": ["5", 0], "negative": ["6", 0], "vae": ["4", 0],
      "width": W, "height": H, "length": LEN, "batch_size": 1,
      "start_image": ["7", 0], "end_image": ["8", 0]}},
  "14": {"class_type": "KSamplerAdvanced", "inputs": {
      "model": ["9", 0], "add_noise": "enable", "noise_seed": SEED, "steps": STEPS, "cfg": CFG,
      "sampler_name": "euler", "scheduler": "simple",
      "positive": ["13", 0], "negative": ["13", 1], "latent_image": ["13", 2],
      "start_at_step": 0, "end_at_step": MID, "return_with_leftover_noise": "enable"}},
  "15": {"class_type": "KSamplerAdvanced", "inputs": {
      "model": ["11", 0], "add_noise": "disable", "noise_seed": SEED, "steps": STEPS, "cfg": CFG,
      "sampler_name": "euler", "scheduler": "simple",
      "positive": ["13", 0], "negative": ["13", 1], "latent_image": ["14", 0],
      "start_at_step": MID, "end_at_step": 10000, "return_with_leftover_noise": "disable"}},
  "16": {"class_type": "VAEDecode", "inputs": {"samples": ["15", 0], "vae": ["4", 0]}},
  "17": {"class_type": "SaveAnimatedWEBP", "inputs": {
      "images": ["16", 0], "filename_prefix": f"aipose_{THEME}", "fps": 24,
      "lossless": False, "quality": 92, "method": "default"}},
}
if MODE == 'light':
    g["10"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["9", 0], "lora_name": LORA_HI, "strength_model": 1.0}}
    g["12"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["11", 0], "lora_name": LORA_LO, "strength_model": 1.0}}
    g["14"]["inputs"]["model"] = ["10", 0]
    g["15"]["inputs"]["model"] = ["12", 0]

def post(path, obj):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode(), headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:2000], flush=True); raise SystemExit(1)

def get(path):
    return json.loads(urllib.request.urlopen(BASE + path, timeout=60).read())

r = post("/prompt", {"prompt": g, "client_id": f"dsh-pose-{THEME}"})
pid = r.get("prompt_id")
if not pid:
    print("SUBMIT FAILED:", json.dumps(r)[:1500]); sys.exit(1)
print(f"[{THEME}] prompt_id {pid} mode={MODE} {W}x{H} len={LEN} seed={SEED}", flush=True)

t0 = time.time()
while time.time() - t0 < 7200:
    time.sleep(15)
    try:
        h = get("/history/" + pid)
    except Exception as e:
        print("poll err", str(e)[:70], flush=True); continue
    if pid in h:
        e = h[pid]
        print(f"[{THEME}] FINISHED {e.get('status',{}).get('status_str')} in {int(time.time()-t0)}s", flush=True)
        for nid, o in e.get("outputs", {}).items():
            for key in ("images", "gifs"):
                for img in o.get(key, []):
                    url = BASE + "/view?filename=" + img["filename"] + "&subfolder=" + img.get("subfolder", "") + "&type=" + img.get("type", "output")
                    with open(RAW, "wb") as f:
                        f.write(urllib.request.urlopen(url, timeout=180).read())
        break
else:
    print("TIMEOUT"); sys.exit(2)

# --- composite with the original artwork's alpha mask -> transparent animated webp (422x760) ---
# encoding choice (measured offline, tune2-post.py): 25 frames (12fps) @422x760 q70 ~= 1.0 MB/theme
mask = Image.open(os.path.join(TMP, f'mask_{THEME}.png')).convert('L').filter(ImageFilter.MaxFilter(5))
anim = Image.open(RAW)
frames_out = []
for i, fr in enumerate(ImageSequence.Iterator(anim)):
    if i % 2:            # keep every 2nd frame -> 25 of 49, play at 84 ms
        continue
    rgba = fr.convert('RGB').convert('RGBA')
    rgba.putalpha(mask)
    frames_out.append(rgba.resize((422, 760), Image.LANCZOS))
frames_out[0].save(OUT_WEBP, format='WEBP', save_all=True, append_images=frames_out[1:],
                   duration=84, loop=0, quality=70, method=6)
kb = os.path.getsize(OUT_WEBP) / 1024
print(f"[{THEME}] frames={len(frames_out)} -> {OUT_WEBP} ({kb:.0f} KB)", flush=True)
