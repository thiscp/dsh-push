# run-animate-full.py -- Wan2.2-Animate-2 (GGUF TURBO) with arbitrary ref / driving video / size
# usage: python run-animate-full.py <ref.png> <driving.mp4> <W> <H> <LEN> <outname>
import json, os, sys, time, urllib.request, urllib.error

BASE = "http://127.0.0.1:8000"
REF = sys.argv[1]
VID = sys.argv[2]
W = int(sys.argv[3])
H = int(sys.argv[4])
LEN = int(sys.argv[5])
OUTNAME = sys.argv[6] if len(sys.argv) > 6 else "animate_full"
OUT = rf"C:\Users\<user>\AppData\Local\Temp\{OUTNAME}.webp"
REF_STR = float(sys.argv[7]) if len(sys.argv) > 7 else float(os.environ.get('REF_STR', '1.0'))
STEPS = int(sys.argv[8]) if len(sys.argv) > 8 else int(os.environ.get('STEPS', '10'))
SAMPLER = sys.argv[9] if len(sys.argv) > 9 else os.environ.get('SAMPLER', 'lcm')
SHIFT = float(sys.argv[10]) if len(sys.argv) > 10 else float(os.environ.get('SHIFT', '5.0'))
MODEL_KIND = sys.argv[11] if len(sys.argv) > 11 else os.environ.get('MODEL_KIND', 'gguf')
CFG = float(sys.argv[12]) if len(sys.argv) > 12 else float(os.environ.get('CFG', '1.0'))
UNET_NAME = os.environ.get('UNET_NAME', 'wan2.2_animate_14B_int8_convrot.safetensors')
POSE_STR = float(sys.argv[13]) if len(sys.argv) > 13 else float(os.environ.get('POSE_STR', '1.0'))
POSE_END = float(sys.argv[14]) if len(sys.argv) > 14 else float(os.environ.get('POSE_END', '1.0'))
SEED = int(os.environ.get('SEED', '7'))

POS = ("Character Description: the whale girl with long wavy blue hair, a white frilled maid headband, "
       "navy blue maid dress with a large white apron, and **a big dark navy whale tail fin with two flukes "
       "sticking out behind her right hip**\n"
       "Background description: plain solid green background, static camera")
NEG = ("missing tail, no tail, tail removed, tail disappears, changing clothes, changing hairstyle, "
       "changing face, different character, identity change, extra limbs, missing limbs, deformed hands, "
       "extra fingers, blurry, motion blur, ghosting, double image, low quality, watermark, text, "
       "camera movement, zoom, flickering, morphing")
POSE_TEXT = "a video of a person dancing happily"

GGUF = "Wan-Animate-2-14B-TURBO-Q5_K_M.gguf"

graph = {
  "1": ({"class_type": "UNETLoader",
         "inputs": {"unet_name": UNET_NAME, "weight_dtype": "default"}}
        if MODEL_KIND == "unet" else
        {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": GGUF}}),
  "2": {"class_type": "ContextWindowsManual", "inputs": {
      "model": ["1", 0], "context_length": 21, "context_overlap": 8,
      "context_schedule": "standard_static", "context_stride": 1, "closed_loop": False,
      "fuse_method": "pyramid", "dim": 2, "freenoise": True, "cond_retain_index_list": "0",
      "split_conds_to_windows": False, "latent_retain_index_list": "", "causal_window_fix": True}},
  "3": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["2", 0], "shift": SHIFT}},
  "4": {"class_type": "BasicScheduler", "inputs": {"model": ["3", 0], "scheduler": "simple", "steps": STEPS, "denoise": 1.0}},
  "5": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": SAMPLER}},
  "6": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan", "device": "cpu"}},
  "7": {"class_type": "CLIPTextEncode", "inputs": {"text": POS, "clip": ["6", 0]}},
  "8": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["6", 0]}},
  "9": {"class_type": "CLIPTextEncode", "inputs": {"text": POSE_TEXT, "clip": ["6", 0]}},
  "10": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": "clip_vision_h.safetensors"}},
  "11": {"class_type": "VAELoader", "inputs": {"vae_name": "Wan2_1_VAE_bf16.safetensors"}},
  "12": {"class_type": "LoadImage", "inputs": {"image": REF}},
  "13": {"class_type": "LoadVideo", "inputs": {"file": VID}},
  "14": {"class_type": "GetVideoComponents", "inputs": {"video": ["13", 0]}},
  "15": {"class_type": "CLIPVisionEncode", "inputs": {"clip_vision": ["10", 0], "image": ["12", 0], "crop": "none"}},
  "16": {"class_type": "ImageFromBatch", "inputs": {"image": ["14", 0], "batch_index": 0, "length": 1}},
  "17": {"class_type": "CLIPVisionEncode", "inputs": {"clip_vision": ["10", 0], "image": ["16", 0], "crop": "none"}},
  "18": {"class_type": "WanAnimate2ToVideo", "inputs": {
      "positive": ["7", 0], "negative": ["8", 0], "vae": ["11", 0],
      "width": W, "height": H, "length": LEN, "batch_size": 1, "video_frame_offset": 0,
      "pose_strength": POSE_STR, "pose_start_percent": 0.0, "pose_end_percent": POSE_END,
      "reference_image_strength": REF_STR,
      "reference_image": ["12", 0], "pose_video": ["14", 0],
      "clip_vision_output": ["15", 0], "positive_pose": ["9", 0], "clip_vision_output_pose": ["17", 0]}},
  "19": {"class_type": "SamplerCustom", "inputs": {
      "model": ["3", 0], "add_noise": True, "noise_seed": SEED, "cfg": CFG,
      "positive": ["18", 0], "negative": ["18", 1], "sampler": ["5", 0], "sigmas": ["4", 0],
      "latent_image": ["18", 2]}},
  "20": {"class_type": "TrimVideoLatent", "inputs": {"samples": ["19", 0], "trim_amount": ["18", 3]}},
  "21": {"class_type": "VAEDecode", "inputs": {"samples": ["20", 0], "vae": ["11", 0]}},
  "22": {"class_type": "SaveAnimatedWEBP", "inputs": {
      "images": ["21", 0], "filename_prefix": OUTNAME, "fps": 8,
      "lossless": False, "quality": 92, "method": "default"}},
}


def post(path, obj):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=120).read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:2500], flush=True)
        raise SystemExit(1)


r = post("/prompt", {"prompt": graph, "client_id": "dsh-anim-full"})
pid = r.get("prompt_id")
print(f"prompt_id {pid} | ref={REF} vid={VID} {W}x{H} len={LEN}", flush=True)
t0 = time.time()
while time.time() - t0 < 5400:
    time.sleep(15)
    el = int(time.time() - t0)
    try:
        h = json.loads(urllib.request.urlopen(BASE + "/history/" + pid, timeout=60).read())
    except Exception:
        print(f"t={el}s polling...", flush=True)
        continue
    if pid in h:
        e = h[pid]
        st = e.get("status", {})
        print("FINISHED", st.get("status_str"), "in", el, "s", flush=True)
        if st.get("status_str") == "error":
            print(json.dumps(st)[:2000], flush=True)
        # ★ 只取保存节点的输出：LoadVideo 节点也会吐出"图像"（驱动视频本身），
        #   早先遍历全部节点导致驱动视频覆盖生成结果，误判成"身份丢失"。
        outs = e.get("outputs", {})
        target = outs.get("22") or {}
        imgs = target.get("images", [])
        if not imgs:
            for nid, o in outs.items():
                if o.get("images") and nid != "13":
                    imgs = o["images"]
                    print("fallback to node", nid, flush=True)
                    break
        for img in imgs:
            url = (BASE + "/view?filename=" + img["filename"] +
                   "&subfolder=" + img.get("subfolder", "") + "&type=" + img.get("type", "output"))
            with open(OUT, "wb") as f:
                f.write(urllib.request.urlopen(url, timeout=300).read())
            print("SAVED", OUT, flush=True)
        break
else:
    print("TIMEOUT", flush=True)
