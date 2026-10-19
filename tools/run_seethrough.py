"""See-through 分层分解：跑一次完整管线并保存 PSD，全程打印进度（便于任何时刻查状态）。

管线：LoadLayerDiffModel + LoadDepthModel → GenerateLayers → GenerateDepth → PostProcess → SavePSD

用法: python run_seethrough.py <input_image_name> [resolution] [steps] [quant]
输出: ComfyUI output 目录下的 seethrough_*.psd（路径会打印）
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
IMG = sys.argv[1] if len(sys.argv) > 1 else "seethrough_maid.png"
RES = int(sys.argv[2]) if len(sys.argv) > 2 else 2048
STEPS = int(sys.argv[3]) if len(sys.argv) > 3 else 30
QUANT = sys.argv[4] if len(sys.argv) > 4 else "nf4"
PREFIX = os.path.splitext(os.path.basename(IMG))[0]
# 两个 loader 的 model 是必填枚举（默认值只是提示，不传会 400）；nf4 预量化版更省显存
LAYER_MODEL = os.environ.get("ST_LAYER_MODEL", "24yearsold/seethroughv0.0.2_layerdiff3d_nf4")
DEPTH_MODEL = os.environ.get("ST_DEPTH_MODEL", "24yearsold/seethroughv0.0.1_marigold_nf4")

graph = {
    "1": {"class_type": "LoadImage", "inputs": {"image": IMG}},
    "2": {"class_type": "SeeThrough_LoadLayerDiffModel", "inputs": {"model": LAYER_MODEL, "quant_mode": QUANT, "auto_download": True}},
    "3": {"class_type": "SeeThrough_LoadDepthModel", "inputs": {"model": DEPTH_MODEL, "quant_mode": QUANT, "auto_download": True}},
    "4": {"class_type": "SeeThrough_GenerateLayers", "inputs": {
        "image": ["1", 0], "layerdiff_model": ["2", 0], "seed": 42,
        "resolution": RES, "num_inference_steps": STEPS}},
    "5": {"class_type": "SeeThrough_GenerateDepth", "inputs": {
        "layers": ["4", 0], "depth_model": ["3", 0], "seed": 42,
        # 必须显式给：默认 -1 会跟着主分辨率走，2048 时深度阶段慢到 28 分钟还没完
        "resolution_depth": int(os.environ.get("ST_DEPTH_RES", "1024"))}},
    "6": {"class_type": "SeeThrough_PostProcess", "inputs": {
        "layers_depth": ["5", 0], "tblr_split": True, "use_lama": True}},
    "7": {"class_type": "SeeThrough_SavePSD", "inputs": {
        "parts": ["6", 0], "filename_prefix": PREFIX + "_psd"}},
}


def post(path, obj):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=120).read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:3000], flush=True)
        raise SystemExit(1)


r = post("/prompt", {"prompt": graph, "client_id": "dsh-seethrough"})
pid = r.get("prompt_id")
if not pid:
    print("SUBMIT FAILED:", json.dumps(r)[:2000], flush=True)
    raise SystemExit(1)
print("prompt_id", pid, "| res", RES, "steps", STEPS, "quant", QUANT, flush=True)

t0 = time.time()
last = ""
while time.time() - t0 < 7200:
    time.sleep(10)
    el = int(time.time() - t0)
    try:
        q = json.loads(urllib.request.urlopen(BASE + "/queue", timeout=30).read())
        running = len(q.get("queue_running", []))
        pending = len(q.get("queue_pending", []))
        msg = "t=%ds running=%d pending=%d" % (el, running, pending)
        if msg != last:
            print(msg, flush=True)
            last = msg
    except Exception:
        pass
    try:
        h = json.loads(urllib.request.urlopen(BASE + "/history/" + pid, timeout=60).read())
    except Exception:
        continue
    if pid in h:
        e = h[pid]
        st = e.get("status", {})
        print("FINISHED", st.get("status_str"), "in", el, "s", flush=True)
        outs = e.get("outputs", {})
        print(json.dumps(outs)[:1500], flush=True)
        if st.get("status_str") == "error":
            print(json.dumps(st)[:2500], flush=True)
        break
else:
    print("TIMEOUT", flush=True)
