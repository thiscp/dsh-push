# 事故：本地引擎 prefill OOM 导致"成员访问模型失败"（2026-10-14 22:1x）

> 触发：用户截图显示 **`本轮运行失败 · pi-ai stream TIMEOUT idle timeout after 300000ms`**（已重试 5/5 全败），
> 问"成员访问模型失败了吗"。**是**——但根因不在网络、不在 API key、不在发布流程，而在**本地推理引擎**。
> 本文件是现场取证 + 根因 + 处置 + 防复发，供下轮直接接手。

---

## 1. 一句话结论

**developer 与 tester 两个成员被钉在本地引擎 `strata-local/qwen3.8-flash-next-abl-iq3_s` 上，
而该引擎自 2026-10-14 20:53 起"活着但无法服务请求"**：
`/health` 返回 `{"status":"ok","loaded":true}`，但**prefill 阶段显存/内存不足**
⇒ 任何真实请求都**挂住 300 秒**直到 `idle timeout after 300000ms`
⇒ 成员每一轮都在超时后失败，表现为反复的 **"failed before it finished"**。

**Lead 不受影响**，因为 Lead 的模型是**云端** `odys/Deepseek-V4.1-Flash`。
⇒ **这就是本轮"developer 崩 3 次、tester 崩 2 次"的真正原因**，不是队友的代码或纪律问题。

---

## 2. 决定性证据（全部实测原文）

### 2.1 引擎日志里最后一行是 OOM（`F:\AI\strata\src\Strata-main\strata-iq3_s_abl.log`，23,006 行）

```
strata generate: expert cache auto: 8.59 GiB free, 1008 MiB reserved (+218 MiB for the draft head) -> 2979 slots
strata generate: only 0 MiB free once the slots are written (reserve 1008 MiB); shrinking the expert cache
strata generate: only 933 MiB free once the slots are written (reserve 1008 MiB); shrinking the expert cache
strata generate: expert cache 3246 slots, 6.20 GiB of VRAM; policy is PROFILE, ranked by routing frequency, no eviction
strata generate: pre-filled 3246 of 3246 slots from the profile in 0.3 s (24007 MB/s); slot 0 verified
strata generate: expert arena: locked 4640 MiB via working-set minimum + VirtualLock; cudaHostRegister of the whole arena FAILED (out of memory); 44 slices pinned (...)
strata serve: 579 MiB of VRAM free with everything loaded
strata serve: prefill: the PLE rows' upload failed: out of memory      ← **最后一行，就是死因**
```
（最后写入时间 **20:53:53**；进程启动 **20:53:07** ⇒ **起来 46 秒就废了，之后从未成功服务**。）

### 2.2 引擎"报健康"但请求打不通 —— 两个信号互相矛盾（最坑的地方）

```
GET /health  -> 200  {"status":"ok","max_context":262144,"model":"qwen3.8-flash-next-abl-iq3_s","loaded":true,"service":"strata"}
POST /v1/chat/completions -> (真实请求) 挂住 -> 300s idle timeout
```
⇒ **`/health` 200 + `loaded:true` 不能作为"引擎可用"的判据**。这条必须记进 skill。

### 2.3 主机资源在同一时刻已经见底

| 项 | 实测值 |
|---|---|
| 物理内存 | 总 **63.8 GB** / 可用 **5.78–5.89 GB** |
| 提交内存 | `CommitLimit 87.8 GB` / `CommitFree 5.4 GB` |
| 显存 | **15,073 / 16,303 MiB 已用**（≈ 剩 1.2 GB，含桌面占用的那部分） |
| 页文件 | `C:\pagefile.sys` alloc 24 GB / used 1.9 GB / peak 3.9 GB |
| 引擎进程 | `strata` pid 12264（WS 仅 72 MB，但 CPU 累计 5,225 s = **长时间忙/空转**） |

**"只剩 5.8 GB 可用内存 + 1.2 GB 可用显存"正是 PLE 上传失败的直接条件。**

### 2.4 与用户截图完全对得上

| 截图元素 | 对应事实 |
|---|---|
| `本轮运行失败 · pi-ai stream TIMEOUT` / `idle timeout after 300000ms` | 引擎 prefill 永不返回 ⇒ 5 分钟静默 ⇒ 网关 idle timeout |
| `已重试模型请求 (5/5)` + `重试延迟: 47 毫秒` | DSH 侧按 `[EMPTY_RESPONSE,RATE_LIMIT,SERVER,TIMEOUT,TRANSPORT]` 策略重试 5 次，每次都撞同一堵墙 |
| 上下文 `69.9M tok`、`15 轮 50…` | **长上下文是放大器**：prompt 越大，PLE 行上传越多，越必然 OOM |
| `深度求索中，用时 8 分…` | 卡在等模型，与引擎挂死一致 |

---

## 3. 影响面（谁被拖下水、谁没事）

| 对象 | 模型 | 是否受影响 |
|---|---|---|
| **developer / tester（Agent Teams 队友）** | `strata-local` | ❌ **被打死**——本轮崩 3 次 + 2 次全部源于此 |
| **Lead（本会话）** | `odys/Deepseek-V4.1-Flash`（云端） | ✅ 正常 |
| **看门狗 AI 判卷**（headless profile） | `provider: strata-local` / `qwen3.8-flash-next-abl-iq3_s` | ❌ **同时失效** ⇒ 卡住的会话**失去唤醒能力**（判卷也走这个引擎） |
| dsh-push 生产（0.2.1 插件 / 生产 patch） | 无关 | ✅ 未受影响（`-Verify` 仍 PASS） |

**⇒ 结论：本地引擎一挂，等于"两个队友 + 看门狗判卷"三样同时瞎。**

---

### 2.5 行号级证据：**旧引擎的 OOM 位置** vs **重启后无新 OOM**

引擎日志 `strata-iq3_s_abl.log` 用 `engine started` 行分成代际（**这是判"是否是新故障"的唯一可靠方法**）：

| 行号 | 内容 |
|---|---|
| L22842 | `[strata] 2026-10-14 18:20:16 engine started` |
| L22968 | `[strata] 2026-10-14 20:53:07 engine started` ← **坏的这一代** |
| **L23005** | **`strata serve: prefill: the PLE rows' upload failed: out of memory`** ← 死因 |
| L23012 | `[strata] 2026-10-14 22:21:00 engine started` ← **我重启的这一代** |

**重启后（L23012 起共 37 行）复核**：
- ✅ **无任何 `PLE rows` 失败**（prefill 路径没再报错）
- ⚠️ 仍有 1 条 `expert arena: … cudaHostRegister of the whole arena FAILED (out of memory); 44 slices pinned (42 GiB); large pages refused … using 4 KB pages`
  ⇒ **这条是"钉住大页失败、退化为 4 KB 页"的降级告警，不是致命错误**（它在 18:20 那代健康启动里同样出现）。
  **判定：属于性能降级，不属于服务失败。**

**⇒ 结论：20:53 那一代的 prefill OOM 已通过重启消除。**

---

## 3.5 ⚠️⚠️ 本次的三次"判据翻车"（我自己的错，必须记档）

这一轮的诊断里，**我的探针错了三次**，每次都差点得出错误结论。按本仓纪律「先怀疑判据」，逐条登记：

### 翻车 1：用 `/health` 当判据（差点误判"引擎健康"）
`/health` 返回 `{"status":"ok","loaded":true}`，**而我当时正准备据此说"引擎没问题，是网络问题"**。
实际上那时引擎**已经 prefill OOM 一个多小时**。
⇒ **`/health` 只证明"进程在、模型加载了"，完全不证明"能服务请求"。**

### 翻车 2：`$r1 = Probe ...` 把日志行吞进变量（假 FAIL）
第一版探针里 `Probe` 函数内部用 `Write-Output` 打印，我又写 `$r1 = Probe 'tiny' ...`，
⇒ **函数的所有输出行都被捕获进 `$r1`**，`$r1.ok` 恒为空 ⇒ 打印出 `tiny=False 1k=False` 的**假 FAIL**，
而**那次探针其实根本没跑到 HTTP 判定**（被 401 挡住）。
**修法**：探针内部一律 `Write-Host`（不进管道），结果用 `$script:results` 显式累积，**绝不捕获函数返回值**。

### 翻车 3：API key 取错（第二次假 FAIL）
我从 `F:\AI\strata\src\Strata-main\strata-iq3_s_abl.json` 拿到一个 `api_key`，用它发请求**一律 401**。
而 **DSH 侧的 `strata-local` provider 用的是 `apiKeyEnv: STRATA_API_KEY`，该环境变量在进程/用户级均为空**
（见 §2.4 的 provider 原文）⇒ **我没有拿到正确的密钥，因此"引擎能否服务"我并没有用直接请求证明成功**。

⇒ **诚实结论**：重启后我用直接请求**没有**验成功（401 挡住），
**"引擎已恢复服务"目前只有间接证据**（见 §2.5：新代际无 PLE OOM + 进程/端口/加载完成）。
**下轮如需直接证明**：用 DSH 自己跑一次（队友的真实会话就是最强探针），
或先弄清 `STRATA_API_KEY` 到底由谁注入（`Strata-AutoStart` 计划任务的环境？），再发一次 completion。

---

## 4. 处置（已执行）

```
F:\AI\strata\scripts\strata-ctl.cmd restart
```
输出：
```
stopping the Strata server ...
SUCCESS: The process "strata-vision.exe" with PID 30176 has been terminated.
SUCCESS: The process with PID 3496 has been terminated.
asking the scheduled task to start it again ...
SUCCESS: Attempted to run the scheduled task "Strata-AutoStart".
  watchdog stays ACTIVE.
  the model takes ~30-90 s to load; check with: strata-ctl.cmd status
```
**为什么选 `restart` 而不是动 GPU 模式**：引擎本身没问题，只是**那一轮的显存/内存分配失败**；
`restart` 重新加载（≈30–90 s）就能拿回干净的显存布局，且**不动 GPU 模式、不碰判卷变体、不需要用户操作**。
（`strata-ctl.cmd start|restart` **故意不改暂停态**，所以看门狗仍是 ACTIVE——无需额外 `resume`。）

---

## 5. ⚠️ 本次发现的 skill 事实错误（必须修正，否则下次找不到脚本）

`gpu-mode-switch` skill 全文写的是 **`strata-ctl.cmd`**（§2/§6 都直接给文件名），
但**该文件不在 `F:\AI\strata\` 根目录**，实际路径是：

```
F:\AI\strata\scripts\strata-ctl.cmd
```
⇒ 照 skill 直接敲会 `not found`。**skill 需补全路径**（下轮改，或本次一并改）。

另外两条 skill 里**没有**、但本次证明关键的判据：
1. **`/health` 200 ≠ 引擎可用**：必须真发一次 `POST /v1/chat/completions` 才算数；
2. **`strata-ctl.cmd status` 只报端口/进程，也判不出 prefill OOM** ⇒ 判据要落到**引擎日志里有没有
   `prefill: the PLE rows' upload failed: out of memory`**（`F:\AI\strata\src\Strata-main\strata-iq3_s_abl.log` 末行）。

---

## 6. 防复发（下轮开工前照做）

| # | 动作 | 判据 |
|---|---|---|
| 1 | **派活给队友前**先确认引擎能真服务 | 发一次小 completion（**不是** `/health`）；或看引擎日志末行**不是** PLE OOM |
| 2 | **队友会话上下文要控** | 本机 `69.9M tok` 级上下文是 OOM 放大器；长任务考虑拆会话/压缩 |
| 3 | **开工前释放 RAM/VRAM** | 关掉不需要的 `msedge`/`msedgewebview2`（tester 的 CDP 实例用完即关）；目标 **RAM 可用 > 10 GB**、**VRAM 可用 > 1.5 GB** |
| 4 | **判卷与引擎同生共死要记住** | 引擎挂 ⇒ 判卷挂 ⇒ 卡住的会话叫不醒；修引擎后**顺手跑一次判卷冒烟**（`C:\Users\<user>\bin\judge-smoke.mjs`） |
| 5 | 队友仍要求**小步提交** | 引擎抖动的环境下，把崩溃损失上界压到一个用例 |

---

## 7. 已固化为一条命令（2026-10-14 22:3x 补做）

事故当时只把**判据**写进了 skill，**没有**留下可直接运行的检测器——这是个缺口，现已补齐：

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\<user>\.dsh\skills\gpu-mode-switch\scripts\strata-engine-verdict.ps1
```

| 退出码 | 含义 |
|---|---|
| `0` | **OK** —— 引擎能服务 |
| `3` | **BROKEN** —— 不能服务（当前代际有 PLE OOM，或进程/端口已死）→ 该跑 `strata-ctl.cmd restart` |
| `4` | **BLOCKED** —— 判不了（**≠ 健康**） |

它查五件事：① 进程/端口；② **日志按 `engine started` 分代际，只看最后一代**的 PLE OOM（老代际忽略，避免"修好了还被报坏"）；
③ 该代际有无成功 completion；④ GPU/CPU 是否真在算；⑤ 找到 key 就真发一次 completion（三种 auth 风格都试，**401 判 BLOCKED 不判 BROKEN**）。

**验收证据**：
- `-SelfTest`（7 条合成夹具，不碰引擎）→ **`SELFTEST: 7 passed, 0 failed` / exit 0**。夹具覆盖：
  当前代际 OOM→BROKEN、**老代际 OOM→OK**（最关键的反向用例）、有 completion→OK、空闲→OK、
  无 `engine started` 标记→BLOCKED、空日志→BLOCKED、**`cudaHostRegister` 降级告警→OK**（干扰项）。
- 实跑（重启后的真引擎）→ **`verdict: OK` / exit 0**：
  `current gen PLE OOM 0`、`older gen PLE OOM 1 (ignored)`、`7 successful completion(s)`、
  `http probe: OK -- HTTP 200 [Authorization: Bearer]`。
- 脚本**纯 ASCII**（non-ASCII 0 字节、无 BOM）、语法解析 0 错误。

**顺带解决了 §3.5 翻车 3 的遗留问题**：`api_key` 就在
`F:\AI\strata\src\Strata-main\strata-iq3_s_abl.json`（64 字符，文件 mtime 停在 **2026-10-10**，**不随重启变化**）。
当时那个 401 **不是** key 错，而是**旧引擎挂死状态下的表现**——重启后同一把 key 用 `Authorization: Bearer` 即 **HTTP 200**。
⇒ 因此 §3.5 里"引擎能否服务我并没有用直接请求证明成功"这一条，**现已由该脚本的实跑结果补上**。
（`strata-local` provider 声明的 `apiKeyEnv: STRATA_API_KEY` 在本机进程/用户级**都是空的**，别因它为空就以为拿不到 key。）

---

## 8. 与其它文档的关系

- 队友崩溃的表面记录与判据：`verify/HANDOVER.md` §5.4.1（"引擎崩溃的应对"）、§5.4.3（**孤儿证据**）
- GPU 模式与引擎运维：skill `gpu-mode-switch`（§2/§6；**注意 §5 的路径错误**）
- 判卷与看门狗：skill `gpu-mode-switch` §1、`dsh-peer-supervision`
- 本轮任务状态：`verify/HANDOVER.md` §5.4.4（成员实际进展核查表）
