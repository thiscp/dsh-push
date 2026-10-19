# gen-pose-celebrate.py -- FLF2V loop (green screen) with a CELEBRATION action prompt
# 与旧 gen-pose-green.py 的差别只在提示词：旧版是 "gently breathes and sways"（几乎静止），
# 这里改成明确的庆祝动作（连蹦两下 + 挥手 + 星光），其余流水线（416x768 / 49 帧 / 4 步 lightning
# / 首尾同图保证无缝）完全不动，方便和旧结果直接对比。
#
# usage: python gen-pose-celebrate.py <theme> [seed] [light|full]
# 输出: %TEMP%\poseai\cele_<theme>_s<seed>_green_raw.webp   （交给 key-green2 同款抠像步骤）
import json, os, sys, time, tempfile, urllib.request, urllib.error

THEME = sys.argv[1] if len(sys.argv) > 1 else 'day'
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 7
MODE = sys.argv[3] if len(sys.argv) > 3 else 'light'
BASE = "http://127.0.0.1:8000"
W, H, LEN = 416, 768, 49
TMP = os.path.join(tempfile.gettempdir(), 'poseai')
os.makedirs(TMP, exist_ok=True)
RAW = os.path.join(TMP, f'cele_{THEME}_s{SEED}_green_raw.webp')

POS = ("the cute chibi whale girl with blue hair and white maid headband, wearing a navy blue "
       "dress with white apron and ribbon, round white whale body with dark blue whale tail fin, "
       "she happily hops in place twice with a cheerful bounce, raises one hand and waves hello "
       "with a big smile, her hair and tail fin bounce and sway with the movement, "
       "short sparkles twinkle around her, static camera, uniform flat pure green background, "
       "high quality anime style, same character and same outfit as the reference image")
NEG = ("sad, crying, angry, changing clothes, missing clothes, changing hairstyle, changing face, "
       "different character, identity change, extra limbs, missing limbs, deformed hands, "
       "extra fingers, camera movement, zoom, pan, scene change, background change, "
       "green on character, green outline, morphing, flickering, distorted anatomy, "
       "text, watermark, blurry, low quality, oversaturated, cropped")

HI = "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
LO = "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
LORA_HI = "wan2.2_i2v_4steps_high_noise.safetensors"
LORA_LO = "wan2.2_i2v_4steps_low_noise.safetensors"
SHIFT, STEPS, CFG, MID = (5.0, 4, 1.0, 2) if MODE == 'light' else (8.0, 20, 4.0, 10)

g = {
  "1": {"class_type": "UNETLoader", "inputs": {"unet_name": HI, "weight_dtype": "default"}},
  "2": {"class_type": "UNETLoader", "inputs": {"unet_name": LO, "weight_dtype": "default"}},
  "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan", "device": "cpu"}},
  "4": {"class_type": "VAELoader", "inputs": {"vae_name": "wan_2.1_vae.safetensors"}},
  "5": {"class_type": "CLIPTextEncode", "inputs": {"text": POS, "clip": ["3", 0]}},
  "6": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["3", 0]}},
  "7": {"class_type": "LoadImage", "inputs": {"image": f"gref_{THEME}.png"}},
  "8": {"class_type": "LoadImage", "inputs": {"image": f"gref_{THEME}.png"}},
  "9": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["1", 0], "shift": SHIFT}},
  "11": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["2", 0], "shift": SHIFT}},
  "10": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["9", 0], "lora_name": LORA_HI, "strength_model": 1.0}},
  "12": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["11", 0], "lora_name": LORA_LO, "strength_model": 1.0}},
  "13": {"class_type": "WanFirstLastFrameToVideo", "inputs": {
      "positive": ["5", 0], "negative": ["6", 0], "vae": ["4", 0],
      "width": W, "height": H, "length": LEN, "batch_size": 1,
      "start_image": ["7", 0], "end_image": ["8", 0]}},
  "14": {"class_type": "KSamplerAdvanced", "inputs": {
      "model": ["10", 0] if MODE == 'light' else ["9", 0], "add_noise": "enable", "noise_seed": SEED,
      "steps": STEPS, "cfg": CFG, "sampler_name": "euler", "scheduler": "simple",
      "positive": ["13", 0], "negative": ["13", 1], "latent_image": ["13", 2],
      "start_at_step": 0, "end_at_step": MID, "return_with_leftover_noise": "enable"}},
  "15": {"class_type": "KSamplerAdvanced", "inputs": {
      "model": ["12", 0] if MODE == 'light' else ["11", 0], "add_noise": "disable", "noise_seed": SEED,
      "steps": STEPS, "cfg": CFG, "sampler_name": "euler", "scheduler": "simple",
      "positive": ["13", 0], "negative": ["13", 1], "latent_image": ["14", 0],
      "start_at_step": MID, "end_at_step": 10000, "return_with_leftover_noise": "disable"}},
  "16": {"class_type": "VAEDecode", "inputs": {"samples": ["15", 0], "vae": ["4", 0]}},
  "17": {"class_type": "SaveAnimatedWEBP", "inputs": {
      "images": ["16", 0], "filename_prefix": f"cele_{THEME}_s{SEED}", "fps": 24,
      "lossless": False, "quality": 92, "method": "default"}},
}

def post(path, obj):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:1500], flush=True); raise SystemExit(1)

r = post("/prompt", {"prompt": g, "client_id": f"dsh-cele-{THEME}-{SEED}"})
pid = r.get("prompt_id")
print(f"[{THEME}/s{SEED}] submitted {pid} mode={MODE}", flush=True)
t0 = time.time()
while time.time() - t0 < 3600:
    time.sleep(10)
    try:
        h = json.loads(urllib.request.urlopen(BASE + "/history/" + pid, timeout=60).read())
    except Exception:
        continue
    if pid in h:
        e = h[pid]
        st = e.get('status', {})
        print(f"[{THEME}/s{SEED}] {st.get('status_str')} in {int(time.time()-t0)}s", flush=True)
        for nid, o in e.get("outputs", {}).items():
            for key in ("images", "gifs"):
                for img in o.get(key, []):
                    url = (BASE + "/view?filename=" + img["filename"] +
                           "&subfolder=" + img.get("subfolder", "") + "&type=" + img.get("type", "output"))
                    with open(RAW, "wb") as f:
                        f.write(urllib.request.urlopen(url, timeout=180).read())
                    print("RAW", RAW, os.path.getsize(RAW) // 1024, "KB", flush=True)
        if st.get('status_str') == 'error':
            print(json.dumps(st)[:1200], flush=True)
        break
