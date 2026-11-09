import json, os, threading, time, urllib.request, urllib.error, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

NONCES = "/var/lib/answer-relay/nonces.json"
QUESTIONS = "/var/lib/answer-relay/questions.json"
TOKEN = open("/etc/answer-relay/regtoken").read().strip()
BRIDGE_TOKEN = open("/etc/answer-relay/bridgetoken").read().strip()
BRIDGE_URL = "http://<tailnet-ip>:2588/answer"  # 最近接入主机的应答桥（tailscale 内网地址，部署时改）
LOCK = threading.Lock()
NTFY_URL = "http://127.0.0.1:2586"
NTFY_TOKEN = open("/etc/answer-relay/ntfytok").read().strip()

PAGE = """<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 作答</title><style>
body{font-family:system-ui,sans-serif;background:#101418;color:#e6e6e6;margin:0;padding:16px}
.q{margin:18px 0}.q h3{font-size:17px;margin:0 0 10px}
button{display:block;width:100%;margin:8px 0;padding:14px;font-size:16px;border-radius:10px;
border:1px solid #345;background:#18222c;color:#e6e6e6;text-align:left}
button.sel{border-color:#4af;background:#123}
#go{background:#2a7f4f;border-color:#2a7f4f;color:#fff;text-align:center;font-weight:bold}
#msg{margin-top:14px;color:#9bd;min-height:24px}
input{width:100%;padding:12px;font-size:15px;border-radius:8px;border:1px solid #345;
background:#18222c;color:#e6e6e6;box-sizing:border-box;margin-top:6px}
</style></head><body>
<h2>DSH 等你选择</h2><div id="qs"></div>
<button id="go" style="display:none">提交作答</button><div id="msg"></div>
<script>
const Q = __QUESTIONS__;
const sel = {};
const box = document.getElementById('qs');
Q.forEach((q, qi) => {
  const d = document.createElement('div'); d.className = 'q';
  const t = document.createElement('h3'); t.textContent = q.question; d.appendChild(t);
  sel[q.id] = null;
  (q.options || []).forEach(o => {
    const b = document.createElement('button'); b.textContent = o;
    b.onclick = () => { sel[q.id] = {id: q.id, selected: [o]};
      d.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); document.getElementById('go').style.display = 'block'; };
    d.appendChild(b);
  });
  const inp = document.createElement('input'); inp.placeholder = '或自己输入答案';
  inp.oninput = () => { if (inp.value.trim()) { sel[q.id] = {id: q.id, selected: [], custom: inp.value.trim()};
    d.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
    document.getElementById('go').style.display = 'block'; } };
  d.appendChild(inp); box.appendChild(d);
});
document.getElementById('go').onclick = async () => {
  const answers = Q.map(q => sel[q.id] || {id: q.id, selected: []});
  const msg = document.getElementById('msg'); msg.textContent = '提交中…';
  try {
    const r = await fetch('/answer/submit', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({callId: __CALLID__, answers})});
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) { msg.textContent = '已送达，任务继续 ✔'; document.getElementById('go').disabled = true; }
    else { msg.textContent = '失败: ' + (j.error || r.status); }
  } catch (e) { msg.textContent = '网络错误: ' + e; }
};
</script></body></html>"""


def echo(call_id, answers):
    # 作答回声：向 ntfy 发静默 #ans 消息，App 收到即撤通知+入已答态（v1.13.0）
    try:
        parts = []
        for a in answers:
            if not isinstance(a, dict):
                continue
            sel = a.get("selected") or []
            parts.append(str(sel[0]) if sel else str(a.get("custom") or ""))
        summary = " / ".join([p for p in parts if p])
        msg = {"topic": "dsh", "title": "DSH 已答",
               "message": "#ans %s %s" % (call_id, summary), "priority": 1}
        req = urllib.request.Request(
            NTFY_URL, data=json.dumps(msg).encode("utf-8"),
            headers={"Authorization": "Bearer " + NTFY_TOKEN,
                     "Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=4)
    except Exception:
        pass


def esc(s):
    return json.dumps(s if s is not None else "")


def load(path):
    try:
        with open(path) as f: return json.load(f)
    except Exception: return {}


def save(path, d):
    tmp = path + ".tmp"
    with open(tmp, "w") as f: json.dump(d, f)
    os.replace(tmp, path)


class H(BaseHTTPRequestHandler):
    def _send(self, code, body="ok", ctype="text/plain"):
        b = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if self.path == "/health":
            return self._send(200)
        if self.path.endswith("/json") and self.path.startswith("/answer/"):
            call_id = urllib.parse.unquote(self.path[len("/answer/"):-len("/json")])
            with LOCK:
                e = load(QUESTIONS).get(call_id)
            if not e or e["expires"] < time.time():
                return self._send(404, json.dumps({"ok": False, "error": "gone"}), "application/json")
            return self._send(200, json.dumps({"ok": True, "callId": call_id,
                    "agentId": e["agentId"], "questions": e["questions"]}, ensure_ascii=False), "application/json")
        if self.path.startswith("/answer/"):
            call_id = urllib.parse.unquote(self.path[len("/answer/"):])
            if not call_id or "/" in call_id:
                return self._send(404)
            with LOCK:
                e = load(QUESTIONS).get(call_id)
            if not e or e["expires"] < time.time():
                return self._send(404, "问题不存在或已过期（请在网页/桌面端作答）")
            html = (PAGE
                    .replace("__QUESTIONS__", json.dumps(e["questions"], ensure_ascii=False))
                    .replace("__CALLID__", json.dumps(call_id)))
            return self._send(200, html, "text/html")
        return self._send(404)

    def do_POST(self):
        try:
            if self.path == "/answer/register":
                if self.headers.get("X-Reg-Token") != TOKEN:
                    return self._send(401, "bad reg token")
                b = self._body()
                ttl = min(int(b.get("ttl") or 86400), 604800)
                # v2: {callId, agentId, questions:[{id,question,options}]}
                if b.get("callId"):
                    call_id = str(b["callId"])
                    questions = b.get("questions") or []
                    if not questions:
                        return self._send(400, "need questions")
                    with LOCK:
                        d = load(QUESTIONS)
                        d[call_id] = {
                            "agentId": str(b.get("agentId") or ""),
                            "questions": questions,
                            "expires": time.time() + ttl,
                        }
                        d = {k: v for k, v in d.items() if v["expires"] > time.time() - 86400}
                        save(QUESTIONS, d)
                    return self._send(200)
                # v1 legacy: {nonce, url}
                nonce, url = str(b.get("nonce") or ""), str(b.get("url") or "")
                if len(nonce) < 8 or not url.startswith("http"):
                    return self._send(400, "need nonce(>=8) and http url, or callId+questions")
                with LOCK:
                    d = load(NONCES)
                    d[nonce] = {"url": url, "expires": time.time() + ttl, "consumed": False}
                    d = {k: v for k, v in d.items() if v["expires"] > time.time() - 86400}
                    save(NONCES, d)
                return self._send(200)

            if self.path == "/answer/submit":
                b = self._body()
                call_id = str(b.get("callId") or "")
                answers = b.get("answers")
                if not call_id or not isinstance(answers, list):
                    return self._send(400, json.dumps({"ok": False, "error": "need callId+answers"}), "application/json")
                with LOCK:
                    d = load(QUESTIONS)
                    e = d.get(call_id)
                    if not e or e["expires"] < time.time():
                        return self._send(404, json.dumps({"ok": False, "error": "问题不存在或已过期"}), "application/json")
                fwd = {"callId": call_id, "agentId": e["agentId"],
                       "qids": [q["id"] for q in e["questions"]], "answers": answers}
                req = urllib.request.Request(
                    BRIDGE_URL, data=json.dumps(fwd).encode("utf-8"),
                    headers={"Content-Type": "application/json", "X-Bridge-Token": BRIDGE_TOKEN},
                    method="POST")
                try:
                    with urllib.request.urlopen(req, timeout=8) as r:
                        code, body = r.getcode(), r.read().decode("utf-8", "replace")
                except urllib.error.HTTPError as ex:
                    code, body = ex.code, ex.read().decode("utf-8", "replace")
                except Exception as ex:
                    return self._send(502, json.dumps({"ok": False, "error": "转发失败: %s" % ex}), "application/json")
                if 200 <= code < 300:
                    with LOCK:
                        d = load(QUESTIONS)
                        if call_id in d:
                            d[call_id]["expires"] = time.time()
                            save(QUESTIONS, d)
                    echo(call_id, answers)
                return self._send(200 if 200 <= code < 300 else 409, body, "application/json")

            if self.path == "/answer":
                b = self._body()
                nonce = str(b.get("nonce") or "")
                with LOCK:
                    d = load(NONCES)
                    e = d.get(nonce)
                    if not e or e["expires"] < time.time():
                        return self._send(404, "unknown or expired nonce")
                    if e["consumed"]:
                        return self._send(409, "nonce already consumed")
                    e["consumed"] = True
                    save(NONCES, d)
                req = urllib.request.Request(
                    e["url"], data=json.dumps(b.get("payload") or {}).encode(),
                    headers={"Content-Type": "application/json"}, method="POST")
                try:
                    with urllib.request.urlopen(req, timeout=5) as r:
                        code = r.getcode()
                except Exception as ex:
                    return self._send(502, "forward failed: %s" % ex)
                if 200 <= code < 300:
                    return self._send(200)
                return self._send(502, "target returned %s" % code)

            self._send(404)
        except Exception as ex:
            self._send(400, "bad request: %s" % ex)

    def log_message(self, fmt, *args):
        print(time.strftime("%H:%M:%S"), self.address_string(), fmt % args, flush=True)


class S(ThreadingMixIn, HTTPServer):
    daemon_threads = True


S(("127.0.0.1", 2587), H).serve_forever()
