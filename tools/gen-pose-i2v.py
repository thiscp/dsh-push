# gen-pose-i2v.py -- free i2v (NO end-frame pin) => the model is allowed to actually act.
# 旧 FLF2V 路线把首尾钉成同一张图，实测动作幅度只有 6~12px（<1%），等于微动；
# 这里换 WanImageToVideo（只给 start_image），让 Wan 敢做"蹦 + 挥手"，循环交给
# key/pingpong 步骤用正反拼接保证无缝（前进 N 帧 + 倒放 N-2 帧）。
#
# usage: python gen-pose-i2v.py <theme> [seed] [light|full] [length]
# 输出: %TEMP%\poseai\i2v_<theme>_s<seed>_L<len>_green_raw.webp
import json, os, sys, time, tempfile, urllib.request, urllib.error

THEME = sys.argv[1] if len(sys.argv) > 1 else 'day'
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 7
MODE = sys.argv[3] if len(sys.argv) > 3 else 'light'
LEN = int(sys.argv[4]) if len(sys.argv) > 4 else 25
BASE = "http://127.0.0.1:8000"
W, H = 416, 768
TMP = os.path.join(tempfile.gettempdir(), 'poseai')
os.makedirs(TMP, exist_ok=True)
RAW = os.path.join(TMP, f'i2v_{THEME}_s{SEED}_L{LEN}_green_raw.webp')

POS = ("the cute whale girl with long blue hair and white maid headband, wearing a navy blue dress "
       "with white apron, she jumps up joyfully with both arms raised in celebration, "
       "a big happy bounce, then lands and bounces again, her hair and skirt swing with the jump, "
       "sparkles twinkle around her, energetic cheerful motion, static camera, fixed framing, "
       "uniform flat pure green background, high quality anime style, "
       "same character and same outfit as the reference image")
NEG = ("sad, crying, angry, walking away, leaving frame, camera movement, zoom in, zoom out, pan, "
       "dolly, scene change, background change, changing clothes, changing hairstyle, changing face, "
       "different character, identity change, extra limbs, missing limbs, deformed hands, "
       "extra fingers, green on character, green outline, morphing, flickering, distorted anatomy, "
       "text, watermark, blurry, low quality, oversaturated, cropped, tiny character, "
       "character getting smaller, character getting larger")

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
  "9": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["1", 0], "shift": SHIFT}},
  "11": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["2", 0], "shift": SHIFT}},
  "10": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["9", 0], "lora_name": LORA_HI, "strength_model": 1.0}},
  "12": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["11", 0], "lora_name": LORA_LO, "strength_model": 1.0}},
  "13": {"class_type": "WanImageToVideo", "inputs": {
      "positive": ["5", 0], "negative": ["6", 0], "vae": ["4", 0],
      "width": W, "height": H, "length": LEN, "batch_size": 1,
      "start_image": ["7", 0]}},
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
      "images": ["16", 0], "filename_prefix": f"i2v_{THEME}_s{SEED}_L{LEN}", "fps": 24,
      "lossless": False, "quality": 92, "method": "default"}},
}

def post(path, obj):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:1500], flush=True); raise SystemExit(1)

r = post("/prompt", {"prompt": g, "client_id": f"dsh-i2v-{THEME}-{SEED}"})
pid = r.get("prompt_id")
print(f"[{THEME}/s{SEED}/L{LEN}] submitted {pid} mode={MODE}", flush=True)
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
