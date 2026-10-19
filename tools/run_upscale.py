"""超分精修：把 i2v 原始帧用 4x-UltraSharp 放大后再降到目标分辨率，用超采样换锐度。

用法: python run_upscale.py <input.mp4> <outname> [W] [H]
输出: C:\\AI\\<outname>.webp（绿色底、未抠像）
"""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8000"
VID = sys.argv[1]
OUTNAME = sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 900
H = int(sys.argv[4]) if len(sys.argv) > 4 else 1620

graph = {
    "1": {"class_type": "LoadVideo", "inputs": {"file": VID}},
    "2": {"class_type": "GetVideoComponents", "inputs": {"video": ["1", 0]}},
    "3": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "4x-UltraSharp.pth"}},
    "4": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["3", 0], "image": ["2", 0]}},
    "5": {"class_type": "ImageScale", "inputs": {
        "image": ["4", 0], "upscale_method": "lanczos", "width": W, "height": H, "crop": "disabled"}},
    "6": {"class_type": "SaveAnimatedWEBP", "inputs": {
        "images": ["5", 0], "filename_prefix": OUTNAME, "fps": 8,
        "lossless": False, "quality": 95, "method": "default"}},
}


def post(path, obj):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read())


r = post("/prompt", {"prompt": graph, "client_id": "dsh-upscale"})
pid = r.get("prompt_id")
print("prompt_id", pid, flush=True)
if not pid:
    print("SUBMIT FAILED", json.dumps(r)[:1500])
    raise SystemExit(1)
t0 = time.time()
while time.time() - t0 < 3600:
    time.sleep(8)
    try:
        h = json.loads(urllib.request.urlopen(BASE + "/history/" + pid, timeout=60).read())
    except Exception:
        continue
    if pid in h:
        e = h[pid]
        print("FINISHED", e.get("status", {}).get("status_str"), "in", int(time.time() - t0), "s", flush=True)
        print(json.dumps(e.get("outputs", {}))[:600], flush=True)
        break
else:
    print("TIMEOUT")
