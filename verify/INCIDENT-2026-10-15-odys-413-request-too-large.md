# 事故：`odys` 网关 413（请求体超 ~8 MiB）导致"成员状态不对 / 本轮运行失败"（2026-10-15 08:2x）

> 触发：用户看成员面板觉得"**状态不太对**"，给出真机截图（08:28）：本轮运行失败、
> 报 **`413 INVALID_REQUEST`**，错误页正文是 **`<center>nginx/1.18.0 (Ubuntu)</center>`**。
> 本次**不是**本地推理引擎问题 —— 那是同目录 [`INCIDENT-2026-10-14-local-engine-prefill-oom.md`](INCIDENT-2026-10-14-local-engine-prefill-oom.md)
> 的**另一起**事故（引擎 prefill OOM / 300s 超时）。

## 0. 与上一起事故的关系（**同一条 `odys` 路由，角色正好互换**）

| | 上一起（10-14） | **本起（10-15）** |
|---|---|---|
| 症状 | `pi-ai stream TIMEOUT idle timeout after 300000ms` | **`413 INVALID_REQUEST` + `nginx/1.18.0 (Ubuntu)`** |
| 受害者 | **成员**（钉在本地 `strata-local`，而引擎 OOM 服务不了） | **成员**（钉在云端 `odys`，而网关拒超大 body） |
| Lead 在哪 | 云端 `odys/Deepseek-V4.1-Flash`（**不受影响**） | 本地 `strata-local/qwen3.8-flash-next-abl-iq3_s`（**不受影响**） |
| 根因 | 本地引擎"活着但服务不了" | **上游 nginx `client_max_body_size`（≈8 MiB）** |

**⇒ 共性教训（两次事故共用）**：**"谁被钉在哪个路由上"决定了他会不会中招**，
而**成员模型是 spawn 时定死的** ⇒ **路由的容量/健康差异会直接变成成员的反复失败**。
**⇒ 判据顺序**：成员报"failed before it finished"时，
**先看该成员钉在哪个 provider**（`list_agents` 的 `model` 字段 + 会话转写里的 `provider` 计数），
**再判是"引擎挂了"还是"上游网关拒了"** —— 两者症状文本完全不同（超时 vs 413），
**别一律归因到引擎**。

---

## 1. 一句话结论

**成员没坏；是上游模型网关拒了超大请求体。**

1. **根因（已钉成铁证）**：请求被路由到 **`odys`（`https://api.odys.work`）**，
   **该网关的 nginx 有约 8 MiB 请求体上限** ⇒ 超限直接 **413**（**不是模型报错、不是 DSH 报错**）。
   **铁证**：会话转写里 413 错误页正文含 **`/odys-cockpit/user-display.js?v=20261014a`**
   —— 那是 **odys 自己的前端资源路径**，等于上游自己报了名（见 §3.1）。
2. **成员"状态不对" = 宿主重启后成员被重建 + 当前无在飞回合** ⇒ 面板显示 `inactive`、模型回落成本地模型。
   **这是设计行为**（成员模型 spawn 时定死、之后无工具可改），**不是故障**（见 §4）。

## 2. 现场事实（实测）

### 2.1 服务与端口

| 项 | 值 | 来源 |
|---|---|---|
| DSH Web 内层 | `127.0.0.1:3081`（pid `14312`） | `Get-NetTCPConnection` |
| 对外代理 | `0.0.0.0:3080`（pid `24984`）= `dsh-net-proxy.mjs --target 127.0.0.1:3081` | 进程命令行 |
| 本地引擎 | `127.0.0.1:8080` = `F:\AI\strata\...\server.py --engine strata --config strata-iq3_s_abl.json` | 进程命令行 |
| 当前 Lead 模型 | **`strata-local` / `qwen3.8-flash-next-abl-iq3_s`** | `profiles/web/cordis.patch.yml` L9-11 |

**本地引擎 `/health`（08:34）**：`{"status":"ok","max_context":262144,"model":"qwen3.8-flash-next-abl-iq3_s","images":true,"api_key":true,"loaded":true,"service":"strata"}`

⚠️ **`/health` 会骗人**（本仓已有事故记录）⇒ 另发真实请求：`/v1/models` → **`http=401`（有响应，只是缺 key）**
⇒ **引擎真在服务**（不是"活着但服务不了"）。

### 2.2 各上游指纹（定位 413 来源）

| provider | 端 | `Server` 头 |
|---|---|---|
| **`odys`** | `https://api.odys.work/v1` | **`nginx/1.18.0 (Ubuntu)`** |
| `aiaaa` | `https://aiaaa.cc/v1` | `nginx/1.22.1` |
| `goopencode` | `https://opencode.ai/zen/go/v1` | `cloudflare` |
| `dpclub` | `https://token.3dpclub.com/v1` | `cloudflare` |
| `strata-local` | `http://127.0.0.1:8080/v1` | `BaseHTTP/0.6 Python/3.12.10` |

**⇒ 截图里的 `nginx/1.18.0 (Ubuntu)` 在本机全部路由里唯一命中 `odys`。**

### 2.3 `odys` 请求体上限（主动扫描，非推断）

对 `https://api.odys.work/v1/chat/completions` 发 `openai-completions` 形状请求，只变 body：

| body | 结果 |
|---|---|
| 8 KB … 1 MB … 3 MB … 4 MB … **6 MB / 7 MB** | **`401`**（**已穿过 nginx**，只是缺 key） |
| **8 MB** | **`413`** ← 被 nginx 拦下 |

**⇒ 上限在 `7–8 MiB` 之间（≈ 8 MiB，nginx `client_max_body_size` 默认值）。**
**⇒ 只要发往 `odys` 的 body 超过约 8 MiB，必然 413，与模型无关。**

## 3. 铁证链（会话转写解压取证）

> ⚠️ **方法坑**：DSH 会话转写是 **concatenated-frame zstd**（`session.v4.jsonl.zstd`）。
> `Select-String` / `zstdDecompressSync(整块)` **只能解出第一帧（273 字节）** ⇒
> **会得出"没有 413"的假阴性**。正确做法：**按 zstd magic（`28 B5 2F FD`）切帧、逐帧解压再拼接**
> （脚本：`F:\work\work_dsh\tmp\zdump2-413.mjs` / `zdump3-413.mjs`，均 100% 解出：`frames=1637/1637` 等）。

### 3.1 413 错误页正文（上游自报名）

从 `a086a3d5…`（developer 子会话）与 `c16678b7…`（tester 子会话）解出的失败记录：

```json
{"kind":"error","failure":{"message":"413 <html>\r\n<head><title>413 Request Entity Too Large</title>
 <script>…<script src=\"/odys-cockpit/user-display.js?v=20261014a\"></script></head>\r\n<body>\r\n
 <center><h1>413 Request Entity Too Large</h1></center>\r\n<hr><center>nginx/1.18.0 (Ubuntu)</center>
 \r\n</body>\r\n</html>\r\n","code":"INVALID_REQUEST"}}
```

**两条决定性指纹**：
1. **`/odys-cockpit/user-display.js`** ⇒ **上游就是 `odys`**（这是它自己的前端资源路径）；
2. **`nginx/1.18.0 (Ubuntu)`** ⇒ 与 §2.2 指纹表**唯一吻合 odys**。

**计数**（`Entity Too Large` 出现次数）：`a086a3d5` = **12 次**、`c16678b7` = **4 次**
⇒ **反复发生**，与"成员连续多次 failed before it finished"的现象一致。

### 3.2 失败时刻的路由与规模

| 会话 | `max inputTokens` | 纯文本估算 | 覆盖的 turn |
|---|---|---|---|
| `a086a3d5`（developer） | **562,382** | **≈2.15 MiB** | turn 7 / 8 / 9 / 10（**渐进恶化**） |
| `c16678b7`（tester） | **529,215** | **≈2.02 MiB** | turn 10 起 |

**路由实测**：该会话的 `provider` 集合 = `[spawn, goopencode, strata-local, odys]`
⇒ **`odys` 确实在可选集里**（`allowedModels` 含它，见 §5 P2）。

### 3.3 ✅ 决定性连接：失败子会话**就是被钉在 `odys` 上**

对 `a086a3d5…`（developer，413 出现 **12 次**）的完整转写做**provider 计数**：

| 字符串 | 出现次数 |
|---|---|
| **`"provider":"odys"`** | **1123** |
| `"provider":"strata-local"` | **1** |
| `"provider":"goopencode"` | **1** |
| `"Deepseek-V4.1-Flash"`（odys 路由的模型名） | **1149** |
| `deepseek-v4.1-flash` | 745 |
| `qwen3.8-flash-next-abl-iq3_s` | 10 |

**⇒ 该会话的请求几乎全部走 `odys`**（对照 `strata-local` 仅 1 次）
⇒ **413 = 发往 `odys` 的请求被它的 nginx 拒绝**，与 §3.1 的上游自报名（`/odys-cockpit/…`）
和 §2.3 的 8 MiB 阈值**三方吻合**。
**⇒ 成员"连续 failed before it finished"的机制闭合：会话越长 ⇒ body 越大 ⇒ 撞 `odys` 的 8 MiB 上限 ⇒ 413 ⇒ 回合失败。**

### 3.4 ✅ 跨会话统计：**413 只出现在"重度使用 odys"的会话里**（全库扫描）

对 `.dsh\sessions` 下 **mtime 最新的 25 个会话转写**全部切帧解压后统计（脚本 `zallsess.mjs`）：

| mtime | 大小 | `provider:odys` | `goopencode` | `strata-local` | **`413 Request Entity Too Large`** | 会话 |
|---|---|---|---|---|---|---|
| 10-15 00:43 | **6.7 MB** | **3002** | 1 | 1 | **184** ⚠️ | `session-11ed9272…` |
| 10-14 19:15 | 2.5 MB | **1209** | 1 | 1 | **4** | `c16678b7`（tester） |
| 10-14 19:00 | 2.5 MB | **1123** | 1 | 1 | **12** | `a086a3d5`（developer） |
| 10-14 16:44 | 0.8 MB | **426** | 1 | 44 | 0 | `session-8c199175…` |
| 10-14 16:04 | 4.7 MB | **1463** | 0 | 660 | 0 | `session-a0d88e51…` |
| …其余 20 个 | ≤1.3 MB | **0 或 1** | 0–1 | 100–1500+ | **0** | — |

**⇒ 两条硬结论**：
1. **`413 Request Entity Too Large` 在全库里只出现在 3 个会话**，而这 3 个**都是重度 `odys` 会话**
   （`odys` 计数 1123–3002；其余会话 `odys` 计数只有 0 或 1）；
2. **`odys` 计数高 ≠ 必然 413**（`a0d88e51` odys=1463 但 413=0）⇒ **触发条件是"body 越过 8 MiB"，
   不是"用了 odys"** —— 与 §2.3 的阈值结论**互相印证**（用得久 ⇒ 回放变大 ⇒ 才越线）。

**⇒ 对"成员反复失败"的解释完整了**：成员会话被钉在 `odys` 上 ⇒ 随轮次增长 body 越过 8 MiB ⇒
**每一次请求都 413** ⇒ 表现为"连续 failed before it finished"（`a086a3d5` 12 次、`11ed9272` **184 次**）。

### 3.5 ⚠️ 诚实标注：一处**尚未闭合的算术缺口**

**纯文本估算 ≈2.15 MiB < 8 MiB 阈值** ⇒ **仅凭文本解释不了 413**。
差额的**推断**来源（**未直接测量**）：
- **JSON 转义**（转写里满是 `\r\n`、`\"`、`\\` ⇒ 可膨胀近一倍）；
- **工具定义 schema**（每次请求都带全量工具清单）；
- **base64 图片附件**（本会话大量 `read_image`/截图；引擎 `images:true`）——
  base64 相对原图 **+33%**，且**不可压缩地进 JSON 字面量**。

**⇒ 这条缺口不影响处置**（413 已由上游指纹钉死是 `odys` 发的），
但**要把"多大才炸"钉准**，需在**下一次 413 时**抓 **DSH 出站请求的 `Content-Length`**（见 §6.5）。

## 4. 为什么"成员状态不对"（设计行为，非故障）

`list_agents`（08:3x）：

| target | status | model |
|---|---|---|
| lead | running | `qwen3.8-flash-next-abl-iq3_s` |
| developer | **inactive** | `qwen3.8-flash-next-abl-iq3_s` |
| tester | **inactive** | `qwen3.8-flash-next-abl-iq3_s` |

- **`inactive` 的含义**：**当前没有回合在执行** —— **不代表任务失败、完成或"坏了"**。
- **三个都是本地模型**：会话前半段 developer 显示的是 `Deepseek-V4.1-Flash`（spawn 时继承的旧 Lead 模型），
  现在统一变成本地模型 ⇒ **宿主重启后成员被重建过**（本轮 `dsh-push` 记录过**宿主重启多次**）。
  **成员模型 spawn 时定死、之后无工具可改**（`skill dsh-team-model-control` §1）⇒ 重建即换模型。
- **任务板不受影响**：`dsh-push` 本轮 task-12…15 **仍全部 `completed`**。

## 5. 处置建议（按优先级）

| # | 动作 | 理由 |
|---|---|---|
| **P0** | **长上下文会话/子智能体避开 `odys`**（改用 `strata-local` 或 `goopencode`） | `odys` 的 8 MiB 上限**在上游、我们改不了**，长会话必然 413 |
| **P1** | 若要留 `odys` ⇒ **只用于短请求**（单轮问答），**别给长会话/压缩/子智能体** | 压缩回放动辄数 MB（本仓实测本地摘要一次 **308,470 token**） |
| **P1** | **给 `odys` 加出站预检**：发送前估算 body 字节，超 ~7.5 MiB **直接拒绝并提示换路由** | 现在 413 只表现为"本轮失败"，**用户看不出真因**（本次就是这样被误当"成员坏了"） |
| **P2** | 复核 `allowedModels` 是否保留 `odys`（`profiles/web/cordis.patch.yml` L544-545） | 免得子智能体再被指到会 413 的路由 |
| **P2** | 成员状态文案可区分 `idle`（空闲可用）与 `inactive` | 减少"状态不对"的困惑 |

## 6. 复现命令（可直接照抄）

```powershell
# 6.1 本地引擎是否真在服务（别只看 /health）
Invoke-WebRequest http://127.0.0.1:8080/v1/models -TimeoutSec 8 -UseBasicParsing   # 期望 401（有响应）

# 6.2 各上游指纹（找 nginx/1.18.0 (Ubuntu) = odys）
foreach($u in @('https://api.odys.work/v1/models','https://aiaaa.cc/v1/models',
                'https://opencode.ai/zen/go/v1/models','https://token.3dpclub.com/v1/models')){
  try { $r=Invoke-WebRequest $u -TimeoutSec 12 -UseBasicParsing; "$u -> $($r.Headers['Server'])" }
  catch { "$u -> $($_.Exception.Response.Headers['Server'])" }
}

# 6.3 阈值扫描（确认 odys ≈8 MiB 上限）
foreach($mb in @(6,7,8)){
  $pad='x'*($mb*1024*1024)
  $body='{"model":"Deepseek-V4.1-Flash","messages":[{"role":"user","content":"'+$pad+'"}],"max_tokens":4}'
  try { Invoke-WebRequest https://api.odys.work/v1/chat/completions -Method POST -Body $body `
          -ContentType 'application/json' -TimeoutSec 90 -UseBasicParsing | Out-Null; "odys ${mb}MB -> 200" }
  catch { "odys ${mb}MB -> $($_.Exception.Response.StatusCode.value__)" }   # 6,7MB=401  8MB=413
}

# 6.4 解压会话转写取证（必须切帧！整块只解第一帧）
& "D:\programs\dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" `
   F:\work\work_dsh\tmp\zdump2-413.mjs a086a3d5 c16678b7

# 6.5 下一次 413 时钉准"多大才炸"（建议加的观测）
#     → 抓 DSH 出站请求的 Content-Length（或给 odys 路由加一条出站日志记字节数 + 状态码）

# 6.6 成员状态（inactive = 无在飞回合，不是故障）
#     list_agents
```

## 7. 我对自己先前判断的更正（如实记录）

排查中途我用 **`-match '413'`** 筛日志，得到几条"命中"，**绝大多数是假阳性**：
- `restart-resume.stderr.log` 的"命中"是 V8 栈地址 `00007FF60A413BAD` 里的 `413`；
- `session_projcache/*.json` 的"命中"是 token 计数 `4137`、`seq: 413` 之类的**子串**；
- `web-requests.log` 里搜到的"413"全是**时间戳毫秒**（`…:32.413Z`）。

**⇒ 教训**：**裸数字串搜日志会大量假阳性**（`413` 是极常见子串）。
判据必须是**带上下文的模式**（`413 Request Entity Too Large` / `INVALID_REQUEST`），
**且压缩转写必须切帧解压**（否则假阴性）。
本文件的结论**不依赖那些假阳性**：来自**上游指纹比对 + 主动阈值扫描 + 切帧解压取证**。

## 8. 边界与未验证项（**不得当已验**）

- **未测量** 413 那次请求的**真实 `Content-Length`**（§3.5 的算术缺口）⇒
  "8 MiB 上限"是**扫描出来的**，但"该次会话的 body 具体多大"**仍未知**。
- **未验证** 8 MiB 是 `odys` 的**精确**值（只测到 7 MiB 过、8 MiB 不过）。
- **未验证** `aiaaa` 的 `503 nginx/1.22.1`（探测时不可用）是否影响其路由。
- **未验证** 每轮失败是否**全部**来自 `odys`（只取证了 developer / tester 两个会话）。
- **未做任何修改**：本文档**只诊断** —— **未改配置、未重启服务、未动成员**。
