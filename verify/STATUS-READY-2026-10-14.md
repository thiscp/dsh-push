# STATUS-READY-2026-10-14 —— tester 就绪自检（task-2）

> **目的**：证明 tester 的**全套取证链路现在就能跑通**，产出可复现的"随时可开工"结论。
> **不是**跑完整 QA 轮、**不是**测新功能。
> 判据来源一律是 **脚本输出 + 真机证据**；"跑了没量到" 一律记 **BLOCKED**，不当 PASS。

| 字段 | 值 |
|---|---|
| 报告落笔时间 | **2026-10-14 19:20:38 (+08:00)**（A–F 执行窗口 19:11–19:20） |
| 执行者 | teammate **tester**（模型 `Deepseek-V4.1-Flash`，spawn 时继承 Lead，本轮不可改） |
| 首稿落笔时 HEAD | `a2db444fc3964c037c3d0ca17c14d3c82ad19be4` |
| **收笔时 HEAD** | **`f7c2c27ab0ee4c4617ad776f0618e6e12f230432`** —— `docs(qa): tester 就绪自检 A-E 全绿 + GPU 判据重写 + 411 宽基线作废标注 + 就绪报告与证据`（**Lead 用它收口了 F**，见 §7） |
| ⚠️ HEAD 在本轮执行窗口（19:11–19:22）内变了 **7 次** | `f2fbd20e` → `c2156916` → `85b4a488` → `a2db444f` → `f53e4b7` → `a2db444` → **`f7c2c27`**（**Lead 全程并行提交 `verify/**`**）。任何"与 HEAD 比对"类结论都按**收笔时** `f7c2c27` 算；F 的判定与此无关（判据是工作树本身） |
| 编排机 | 台式机 `DESKTOP-CPHOME`（`F:\work\work_dsh\dsh-push`） |
| 模拟器机 | 笔电 `DESKTOP-CPYH` / `user@<tailnet-laptop>`（Tailscale 固定 IP） |
| 设备 | `emulator-5554`，AVD `dsh-p16`，**API 36**，`x86_64` |
| 模拟器档位 | **真 GPU**（`-gpu host`，RTX 4060 Laptop / 驱动 616.92） |
| 几何基线 | **CSS360**：`1440x3168 @ 640`，CDP 实测 `innerWidth=360 / dpr=4` |
| 被测包 | `xyz.cpyh.dshpush` versionName **1.32.10** / versionCode **76** |
| **最终判定** | **`READY`** —— A–E 全绿；F 首稿 `RED`、已由 Lead 在 `f7c2c27` 收口（§7）；**H-1 已修并真机回归 PASS（task-4，§8）**。残余未覆盖项见 §4（U-1/U-3/U-4/U-5/U-6/U-8；**U-2 已部分覆盖、U-7 已修**） |

---

## 0. 一句话结论

**取证链路（A–E）现在完全可用**：档位闸门 exit 0、截图 >2MB 且肉眼可看、起页真加载出 DSH Web、三个 QA 脚本语法零错、用例库 45 条已盘点。
**最初唯一的红项 F**（`git status --short` 非空：3 modified + 2 untracked）**已由 Lead 在 `f7c2c27` 一并提交收口** ——
`TESTER.md` + 两个用例文件 + 本报告 + 证据目录全部入库，**F 除"报告自身还在修订"这一自指项外 = PASS**（详见 **§7 收笔后记**）。
**⇒ tester 取证链路随时可开工；task-3 的前置已具备。**
**原唯一遗留的 P1 隐患 H-1 已在 task-4 修掉并真机回归 PASS（7/7 + 顺序铁律 CONFIRMED）** —— 详见 **§8 H-1 修复记录**；
修复前先复现证实机理，修复中**证伪了我自己第一版无效判据**（§8.4），修复后设备与 adbd root 态均已复原。

---

## 1. 逐条验证 A–F

### A. 模拟器档位闸门 —— **PASS (exit 0)**

**断言**：`verify\emu-gpu-verdict.ps1` 退出码 = **0**（真 GPU）；顺带 `wm size/density` = `1440x3168 / 640`。
**命令**：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\emu-gpu-verdict.ps1`

**实际输出（原文摘录）**：
```
laptop           : DESKTOP-CPYH  (user@<tailnet-laptop>)
qemu processes   : 1
qemu started     : 10/14/2026 18:40:14
qemu argv        : …\qemu-system-x86_64-headless.exe -avd dsh-p16 -no-window -no-audio -no-boot-anim -gpu host -cores 4 -memory 4096
selector file    : G:\Android\emu-ladder.gpu = host
boot_completed   : 1
adb devices      : emulator-5554	device
wm size/density  : Physical size: 1440x3168 / Physical density: 640
RENDERER (auth)  : GLES: Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), OpenGL ES 3.1 (4.5.0 NVIDIA 616.92)
qemu -gpu arg    : host

VERDICT: PASS - real GPU confirmed (host NVIDIA adapter renders the guest)
```
- **退出码 = 0**（实测 `EXITCODE=0`，墙钟 **1s**）。
- `wm size` = `Physical size: 1440x3168`；`wm density` = `Physical density: 640` → **= CSS360 期望值，PASS**。
- **旁证（-SelfTest，只读、无需 ssh）**：`SELFTEST: PASS (6/6 cases)`，`SELFTEST_EXIT=0` —— 含 `swiftshader renderer → code 3`、`host-looking renderer but -gpu sw (qemu arg wins) → code 3`、`no emulator → code 4`、`renderer line missing → code 4`。**证明这台闸门对软渲染/判不了两种情况确实会报红，不是恒 PASS。**

**证据路径**：
- 闸门脚本：[emu-gpu-verdict.ps1](F:\work\work_dsh\dsh-push\verify\emu-gpu-verdict.ps1)
- 自愈日志（同刻交叉印证）：笔电 `G:\Android\emu-ladder.log` 末条
  `2026-10-14 19:11:51 renderer: GLES: … (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2) …` →
  `already healthy ON THE REAL GPU (boot_completed=1) -> nothing to do`
  —— 与闸门结论**一致**（两条独立通道同结论）。

**⚠️ 旧判据已作废，本轮未使用**：`emu-ladder.log` 的 `interactive console session` **禁止再用**。
本轮日志里该字段确实出现了**自相矛盾**的两行（`SshdOnly=True` 那趟写 `True`、正常那趟写 `False`，同一分钟），
这正是它被废掉的原因；加固版已给它加了 `INFORMATIONAL ONLY - never gates GPU decisions` 标注。
**自愈是否 kill 过我**：本轮全日志 `VIOLATION` **0 行**、`NEEDS A REBOOT` **0 行** → **没有发生自愈 kill/重启**（不需要当故障解释）。

---

### B. 截图链路端到端 —— **PASS**

**断言**：`adb shell screencap -p` + `adb pull` 得到 **>100KB** 的文件，且**我自己 `read_image` 看了整页**（不是只看字节数）。
**命令（经 ssh 到笔电，adb 路径 `G:\Android\Sdk\platform-tools\adb.exe`）**：
`adb shell screencap -p /sdcard/ready3.png` → `adb pull /sdcard/ready3.png G:\Android\ready3.png` → `scp` 回台式机

**实际**：
- 文件大小 **2,036,754 B（≈1.99 MiB，>100KB 门槛 20 倍）**，`1440x3168` 全分辨率，**非 0 字节、非几 KB**。
- **肉眼判读（read_image 整页）**：Android 启动器整页可见 —— 状态栏 `11:12` 时钟/信号/电量、壁纸、`Wed, Oct 14`、
  Gmail / Photos / YouTube 图标、底部 Dock（电话/信息/Chrome/**dshpush 图标带未读红点**）、搜索胶囊、手势条。
  **整页渲染正常，无花屏、无黑屏、无裁剪**。
- **耗时（旁证，非判档位依据）**：

  | 采样方式 | 样本 | 备注 |
  |---|---|---|
  | 台式机→ssh→笔电 adb（含 ssh 往返） | **1.92 / 1.71 / 1.39 s** | n=3，含 ssh 建立开销 |
  | 笔电本地 adb（去掉 ssh 开销，更接近流水线内真实值） | **654 / 500 / 503 / 465 ms** | n=4 |

  → 与 `TESTER.md` §2 记的真 GPU 基线 **1.0–1.25s** 同量级（本机 ssh 样本偏高来自 ssh 往返；本地样本更低）。
  **声明**：这是**旁证**，单次量受预热影响；**判档位一律走 A 的闸门**，不用耗时。

**证据路径**：[B-screencap-launcher.png](F:\work\work_dsh\dsh-push\verify\evidence-ready-2026-10-14\B-screencap-launcher.png)
（sha256 `BFD702AF0CC526C54295D318A1609148A01ACD489FD8F3FAFCE4FE49EADB83B5`，2,036,754 B）

---

### C. App 起页链路 —— **PASS**（页面真加载出 DSH Web）

**断言**：从 `C:\Users\<user>\.dsh\web.log` 取**最后一条** `dsh web:` 的 token → 拼 URL → `force-stop` → `am start …WebActivity --es url` → **截图确认页面真的是 DSH Web**（不是 auth 错误页）。
**URL 里的 `&` 转义**：本轮 token 后**没有** `&`（URL 形如 `?token=<43 字符>`），所以未触发转义问题；
为免 cmd 解析吞参，我把起页逻辑写进 `.cmd` 文件（`G:\Android\ready-start-page.cmd`）用 `%~1` 接收 URL，
且**始终加引号** —— 这是"永久安全"的姿势（等价于任务描述里"直接用执行文件名调用避免 shell 解析"）。

**实际**：
- 取到 token：`dsh web: http://127.0.0.1:3081/?token=q1g59K5…`（**token 长度 43**，取自 web.log **第 321 行**，即最后一条）。
- 替换 host → `http://<tailnet-windows>:3080/?token=…`。
- `am force-stop xyz.cpyh.dshpush` → `am start -n xyz.cpyh.dshpush/.WebActivity --es url "<URL>"` → **`Starting: Intent { cmp=xyz.cpyh.dshpush/.WebActivity (has extras) }`**，无异常。
- `topResumedActivity=ActivityRecord{… xyz.cpyh.dshpush/.WebActivity t116}`、`mCurrentFocus=Window{… WebActivity}` →
  **WebActivity 真的在前台**（不是 launcher）。
- **肉眼判读（read_image 整页）**：页面标题栏 **「DSH 网页 · 台式机」** + 「关闭」按钮；左侧 56px 图标轨道；
  会话内容、`Chat / Trajectory` 分页、输入框 `Message or run a task, / commands,…`、底部 `34 turns … / 106M t… / 46%`；
  **立绘与壁纸透出** —— **这是真实的 DSH Web 会话页，绝不是 "authentication required" 错误页**。
- **CDP 链路（真跑通，非仅解析）**：`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`
  → `/json/version` 返回 `Android-Package: xyz.cpyh.dshpush`、`Browser: Chrome/133.0.6943.137`；
  `/json/list` 返回 **1 个 page target**，url = `http://<tailnet-windows>:3080/`。
  → 再用一次完整脚本（起页→轮询 pid→forward→CDP `Runtime.evaluate`）得到
  **`innerWidth=360, innerHeight=671, dpr=4`**，`title="DeepSeek Harness"`，`readyState=interactive`
  —— **CSS360 基线由 CDP 独立复证**（与 §A 的 `wm size/density` 两条通道同结论）。

**🔴 本轮新发现的硬事实（H-1，必须记入章程）**：
> **`am start …/.WebActivity` 要求 adbd 已经是 root。**
> 以**非 root**（uid 2000 = shell）执行时报：
> `java.lang.SecurityException: Permission Denial: starting Intent { … cmp=xyz.cpyh.dshpush/.WebActivity … } from null (pid=4352, uid=2000) not exported from uid 10216`
> —— 第一次尝试就是这样失败的（当轮 adbd 恰在同一次 `adb root` 的重启窗口里掉设备）。
> `adb root`（`restarting adbd as root` + `whoami` = **root** 双确认）后**立刻成功**。
> **`verify\card-layout-verify.ps1` 已内置 `adb root`（L220）；但 `verify\qa-round.ps1` 与 `verify\qa-round-driver.mjs` 都没有** ——
> 后者 L169–171 直接 `am start`，**隐式依赖 adbd 已是 root**。当前 adbd = root 所以能跑；
> 一旦模拟器重启（`README.md` L83 已记"模拟器重启后 adbd 会掉回非 root"），**整轮 QA 的起页会失败**。
> **本轮未擅自修改这两个脚本**（任务要求"先报告再修"；且 Lead 正在并行改 `verify/**`，避免撞写）。

**证据路径**：
- [C-webactivity-dshweb.png](F:\work\work_dsh\dsh-push\verify\evidence-ready-2026-10-14\C-webactivity-dshweb.png)
  （sha256 `CDB6ED2998AD0FE83EC03ECDC60A70C038A7D05D61173AEFD20E456844E3AD5C`，1,041,919 B）
- CDP 原始输出：[ready-viewport.json](F:\work\work_dsh\tmp\ready-viewport.json)（笔电 `G:\Android\ready-viewport.json`）
- 起页脚本：[ready-start-page.cmd](F:\work\work_dsh\tmp\ready-start-page.cmd)

---

### D. QA 工具链语法解析 —— **PASS（3/3 零错、纯 ASCII）**

**断言**：三个脚本存在，且能被 `[Parser]::ParseFile` 解析出 **0 个语法错误**（**只解析，不真跑整轮**）。
**命令**：`[System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errors)`

| 文件 | 存在 | 字节 | **parseErrors** | 非 ASCII 字节 | 结论 |
|---|---|---|---|---|---|
| [qa-round.ps1](F:\work\work_dsh\dsh-push\verify\qa-round.ps1) | ✓ | 4,289 | **0** | 0 | PASS |
| [gate-shot.ps1](F:\work\work_dsh\dsh-push\verify\gate-shot.ps1) | ✓ | 6,557 | **0** | 0 | PASS |
| [card-layout-verify.ps1](F:\work\work_dsh\dsh-push\verify\card-layout-verify.ps1) | ✓ | 14,866 | **0** | 0 | PASS |

**顺带实测两条"开工前必须能用"的依赖（都是真跑，不是推断）**：
1. **token 提取在"web.log 被 DSH 独占锁住"时仍然可用** ——
   `qa-round.ps1` / `gate-shot.ps1` 用的是 `Select-String -Path …`，实测在**正在写入的** web.log 上
   **OK，tokenlen=43**；而 **`[System.IO.File]::ReadAllLines()` 直接抛**
   `IOException: 文件正由另一进程使用`（我首次尝试就撞上了）。
   → **硬事实**：这两个脚本的 token 取法是对的，别"顺手改成 .NET 读"。
2. **`-Node D:\Program\nodejs\node.exe` 默认值在笔电上真实存在**：`node -v = v22.14.0`（同路径也是 PATH 里的 node）。

**证据**：以上表格即命令原始输出（`FILE=… bytes=… parseErrors=… nonAsciiBytes=…`）。

---

### E. 用例库盘点 —— **PASS（45 条），并已就地标注失效基线**

**断言**：列出 `verify\testcases\` 下的文件与用例总数；指出依赖**旧 411 宽几何基线**（CSS360 下作废）的用例。

**实际**：

| 文件 | 字节 | 用例数（按 `### QA-xx` 标题） | 区间 |
|---|---|---|---|
| [00-core-flows.md](F:\work\work_dsh\dsh-push\verify\testcases\00-core-flows.md) | 16,196 | **10** | `QA-C01`–`QA-C10` |
| [01-adversarial.md](F:\work\work_dsh\dsh-push\verify\testcases\01-adversarial.md) | 32,014 | **25** | `QA-A01`–`QA-A16`（缺 A17/A18/A19）、`QA-A20`–`QA-A28` |
| [02-ux-polish.md](F:\work\work_dsh\dsh-push\verify\testcases\02-ux-polish.md) | 5,308 | **10** | `QA-P01`–`QA-P10` |
| **合计** | | **45 条**（已写定的用例标题） | |

**⚠️ 编号缺口的解释（不是丢用例）**：`QA-A17 / QA-A18 / QA-A19` **在用例库里没有标题**，但**已在代码里实现** ——
`verify\qa-round-driver.mjs` 的 `CASES_IMPL` 共 **16 个可执行 key**：`QA-C05, QA-A01, QA-A02, QA-A06, QA-A07, QA-A08, QA-A10, QA-A11, QA-A12, QA-A14, QA-A15, QA-A17, QA-A19, QA-N1, QA-N4, QA-P04`。
`QA-A17`（滚动后 F1 clearance）、`QA-A19`（常驻"命中区几何审计"）、`QA-N1/N4`（离线条时序 / 抢点击）是 **promoted 用例**，
沉淀在 driver 里（`01-adversarial.md` L219 有说明）。⇒ **37 个有标题 + 6 个只在 runner 里的 + 2 个跨文件引用（`QA-A22/A24/QA-C09` 在两处出现）**，别把缺口当"用例丢了"。

**🔴 依赖旧 411 宽几何基线的用例（CSS360 下数字作废）**：

| 用例 | 失效的具体数字（旧 411 CSS px 视口下量的） | 处置 |
|---|---|---|
| **QA-A14** 命中区放大后的重叠 | `Open in File Explorer(40x40 @279.3)`、`More ways to open(40x40 @299.3)`、横向重叠 20px、`中心距 32px`、重叠 8px | **本轮已就地加⚠️作废标注**（`01-adversarial.md`） |
| **QA-A15** 收起态图标轨道 | 轨道宽 `55.6px`、右边界 `≤44px`、行距 `32px`、留 8px | **本轮已就地加⚠️作废标注** |
| **QA-P04** 按钮命中区 | `28×28`、`23×23`、`17×23`、会话行高 `28` | **本轮已就地加⚠️作废标注**（`02-ux-polish.md`） |
| QA-A10 极窄视口（≈300 CSS px） | "800x1200（≈305 CSS px）" 是**故意压窄后**的视口，非 411 基线 | 未标注；**下一轮复核其参照系**（未覆盖项 U-3） |
| QA-A16 成组小按钮扩容前先治上游 | 含"当前版本实测仍是 <40px 的一批"这类**版本相关的几何数字** | 未标注；重打基线时一并复核（未覆盖项 U-3） |

**改了什么（写入范围内，3 处）**：`01-adversarial.md`（QA-A14、QA-A15 各加一段⚠️作废标注）、
`02-ux-polish.md`（QA-P04 加一段⚠️作废标注）。**只加标注、未改任何步骤/断言/预期** —— 方法学仍有效，只有数字作废。
依据：`verify\TESTER.md` 附录 A.1、`verify\TEAM-START.md` §0.1、`HANDOVER.md` §4.2。

---

### F. 工作树干净 —— **首稿 🔴 FAIL → 收笔时已由 Lead 收口（见 §7）**

**断言**：`git status --short` **为空**。
**命令**：`cd F:\work\work_dsh\dsh-push; git status --short`

**实际（收笔复核，HEAD `a2db444f`）**：
```
 M verify/TESTER.md
 M verify/testcases/01-adversarial.md
 M verify/testcases/02-ux-polish.md
?? verify/STATUS-READY-2026-10-14.md
?? verify/evidence-ready-2026-10-14/
```
→ **非空 = FAIL**（5 行；含本报告自身 —— 报告未提交是**必然**的，见下方流程观察）。

**逐项归因（谁写的、为什么、要不要提交）**：

| 路径 | 谁改的 | 内容 | 处置 |
|---|---|---|---|
| `verify/TESTER.md`（M，+20/−9） | **Lead**（不是 tester） | GPU 判据重写（作废 `interactive console session`、改指 `emu-gpu-verdict.ps1`）+ CSS360/耗时基线更新 | **必须由 Lead commit**；tester 不碰（避免越权/撞写） |
| `verify/testcases/01-adversarial.md`（M，+7） | **tester（本轮）** | E 项的 2 处⚠️作废标注 | 待 Lead 一并 commit |
| `verify/testcases/02-ux-polish.md`（M，+3） | **tester（本轮）** | E 项的 1 处⚠️作废标注 | 待 Lead 一并 commit |
| `verify/evidence-ready-2026-10-14/`（??，2 个 PNG，≈3.0 MB） | **tester（本轮）** | B/C 的整页证据图（存档用） | 待 Lead 决定入库或加入 ignore |
| `verify/STATUS-READY-2026-10-14.md`（??，25 KB） | **tester（本轮）** | **本报告** | 待 Lead commit（**报告提交前 F 必然非空** —— 这是自指，不是缺陷） |

**⚠️ 一条流程观察（影响"F 该由谁收口"）**：本轮执行期间 **HEAD 前进了 4 次**
（`f2fbd20e` → `c2156916` → `85b4a488` → `a2db444f`），全部由 **Lead 在并行提交 `verify/**`**。
⇒ **只要团队在并行写 `verify/**`，`git status --short` 为空就不可能是 tester 单方面达成的验收项。**
建议 F 的判据在团队并行期改为：**"tester 自己写过的路径，除本报告与证据外，没有未归因的改动"** —— 见 §5 建议。

**最小复现命令**：`cd F:\work\work_dsh\dsh-push; git status --short`（非空即红）。

---

## 2. 判定汇总

| 项 | 断言 | 实测 | 结论 |
|---|---|---|---|
| A 档位闸门 | `emu-gpu-verdict.ps1` exit 0 + `1440x3168/640` | **exit 0**，真 GPU（RTX 4060），SelfTest 6/6 | ✅ **PASS** |
| B 截图链路 | `screencap`+`pull` >100KB 且肉眼看过 | **2,036,754 B**，整页启动器肉眼确认 | ✅ **PASS** |
| C 起页链路 | WebActivity 真加载 DSH Web | **PASS**（`DSH 网页·台式机` 整页 + CDP `innerWidth=360/dpr=4`） | ✅ **PASS**（发现 H-1，已于 task-4 修复 → §8） |
| D 工具链解析 | 3 脚本 `ParseFile` 零错 | **3/3 parseErrors=0**、纯 ASCII；node/token 依赖真跑可用 | ✅ **PASS** |
| E 用例库盘点 | 列文件+总数+标失效基线 | **3 文件 / 45 条**；A14/A15/P04 已就地标注作废 | ✅ **PASS** |
| F 工作树干净 | `git status --short` 为空 | 首稿**非空**（3 M + 2 ??）→ **Lead 在 `f7c2c27` 全部收口**；收口后仅剩本报告自身（自指） | 🟡 **首稿 FAIL → 已收口（除报告自身外 PASS）** |

**最终判定：`READY`** —— **A–E 五条取证链路全绿**；F 首稿为红、**已由 Lead 提交收口**（§7）。
**当时唯一遗留的 P1 隐患 H-1 已在 task-4 修复并真机回归 PASS（7/7）—— 见 §8；本节以下保留"修复前"的历史记录供追溯。**

---

## 3. 红项 / 隐患与最小修复

### 🟡 RED-F（首稿）→ 已被 Lead 收口
- **首稿最小复现**：`cd F:\work\work_dsh\dsh-push; git status --short` → 5 行、非空。
- **收口结果**：Lead 在 **`f7c2c27`** 一并提交（`TESTER.md` + 2 个用例文件 + 本报告 + 证据目录），
  **首稿的 4 个脏项全部清零**；提交后唯一剩余 = 本报告自身（我在提交后追加了 §7，属**自指**）。
- **⇒ 净结论：除报告自身外 F = PASS。** 把本节一并提交后 `git status --short` 即为空。
- **原始归因（供追溯）**：

| 路径 | 谁改的 | 内容 |
|---|---|---|
| `verify/TESTER.md`（M，+20/−9） | **Lead** | GPU 判据重写（作废 `interactive console session`、改指 `emu-gpu-verdict.ps1`）+ CSS360/耗时基线更新 |
| `verify/testcases/{01-adversarial,02-ux-polish}.md`（M，+7/+3） | **tester（本轮）** | E 项的 3 处⚠️ 411 基线作废标注 |
| `verify/evidence-ready-2026-10-14/`（??，2 PNG ≈3.0 MB） | **tester（本轮）** | B/C 的整页证据图 |
| `verify/STATUS-READY-2026-10-14.md`（??，25 KB） | **tester（本轮）** | **本报告** |

### 🟠 P1 H-1（**已在 task-4 修复 → 见 §8；以下是修复前的原始记录，保留供追溯**）：`am start …/.WebActivity` 隐式要求 adbd 是 root
- **最小复现**（在笔电、adbd 非 root 时）：
  ```
  G:\Android\Sdk\platform-tools\adb.exe unroot          # 或重启模拟器（README L83）
  G:\Android\Sdk\platform-tools\adb.exe shell whoami    # -> shell
  G:\Android\Sdk\platform-tools\adb.exe shell am start -n xyz.cpyh.dshpush/.WebActivity --es url http://<tailnet-windows>:3080/
  # -> java.lang.SecurityException: … not exported from uid 10216
  ```
- **影响面**：`qa-round.ps1`（默认 10 条用例全走起页）+ `qa-round-driver.mjs` 的 `startApp()`（L169–171）。
  **模拟器重启后 adbd 掉 root → 整轮 QA 起页失败**（会以 BLOCKED 形态暴露，**不会假 PASS** —— driver 的 `ensureShell`/`assertOk` 会兜住，这点是好的）。
- **建议修法（待 Lead 点头，tester 可改，因为在 `verify/**` 内）**：在 `qa-round.ps1` 的远端脚本里、
  **`adb start-server` 之后、调 driver 之前**插 `& $adb root | Out-Null; Start-Sleep 3`，
  并在 driver 的 `startApp()` 前做 `whoami` 断言。**注意顺序**：`adb root` 会重启 adb server 并清掉所有 forward，
  所以必须排在**任何 forward 之前**（`card-layout-verify.ps1` L220/L228 就是这个顺序）。
- **本轮未修的理由（task-2 当时）**：任务纪律"发现取证链路断了先报告再修"；且当前 adbd = root、链路**没断**，属于脆弱点而非故障。
  → **task-4 已按 lead 放行修掉**：`qa-round-driver.mjs` + `gate-shot.ps1` 补 `adb root` + `whoami` 断言，真机回归 **7/7 PASS**（§8）。

---

## 4. 显式列出的 BLOCKED 与未覆盖项（**下轮不得当已验**）

| ID | 状态 | 内容 | 为什么没做 / 下轮怎么补 |
|---|---|---|---|
| **U-1** | **部分覆盖**（task-4 起） | `gate-shot.ps1` / `card-layout-verify.ps1` **仍只做过语法解析，未真跑整轮** | task-2 的 D 项明确"只做语法解析，不要真跑整轮"。task-4 给 `gate-shot.ps1` 补了 root 块并**重新解析为 0 错**，但**没有真跑它**；两者都会起页+截图，属完整 QA 动作，留给改动验证轮 |
| **U-2** | **已覆盖（最小 1 条）**（task-4 起） | `qa-round.ps1`/driver 的起页链**已真跑过 1 条最小用例**（`QA-C05`） | task-2 禁止跑完整轮；task-4 按 lead 要求只跑最小 1 条做 H-1 回归，**不是**完整轮。整轮 34/45 项仍未跑 |
| **U-3** | **未覆盖** | `QA-A10`（极窄视口）与 `QA-A16`（成组按钮间距）里的**几何数字未标注失效** | 它们不是 411 基线本身，但含版本相关数字；**重打 CSS360 基线时必须一并复核**，别直接套用 |
| **U-4** | **部分覆盖** | CDP **真输入**（`Input.dispatchMouseEvent` / 真点击）本轮未验 | 本轮只验到 `/json/list` + `Runtime.evaluate`（读属性）。真点击链路留待 QA-A14/A19 那类命中区用例 |
| **U-5** | **旁证，未定基线** | 截图耗时**未按"剔除预热、n≥3 稳态"口径重打** | 本轮 n=3(含 ssh) / n=4(本地)；**判档位请一律走 A 的闸门**，不要用耗时数字下结论 |
| **U-6** | **未覆盖** | 真机 OriginOS 行为（通知栏/后台被杀/深链落点） | 模拟器天然测不了（`README.md` 末节）；与 task-2 无关 |
| **U-7** | ✅ **已修（task-4，2026-10-14）** | **H-1 已修复并真机回归 PASS**：`qa-round-driver.mjs` + `gate-shot.ps1` 补 `adb root` 前置 + `whoami` 断言，顺序置于任何 forward 之前 | 判据见 §8；回归 7/7 PASS、ORDER_PROOF CONFIRMED。**残余**：`qa-round.ps1` 自身未改（起页在 driver 里，无需改）；`gate-shot.ps1` 的 root 块只做解析未真跑（U-1） |
| **U-8** | **未覆盖** | 本轮**没有推任何 ntfy**（按纪律） | 生产 topic `dsh` 全程未碰；`dsh-verify` 也未使用（本轮不需要推）。task-4 同样 0 条推送 |

**"跑了没量到" 声明**：本轮**没有任何**一条结论建立在"命令跑了、但没拿到可判读输出"之上 ——
A/B/C/D/E/F 六项全部有退出码、字节数或原文输出。唯一"跑了没量到"的是 **U-4 的真输入**，已显式记为未覆盖。

---

## 5. 设备复位声明

测完已复位，设备留干净状态（笔电 `emulator-5554`）：

| 项 | 复位后实测值 | 是否干净 |
|---|---|---|
| `font_scale` | `1.0` | ✅ 未被我改过 |
| `ui_night_mode` | `1` | ✅ 未被我改过（本轮未切主题） |
| `airplane_mode_on` | `0` | ✅ 未被我改过（本轮未切飞行模式） |
| `wm size` | `Physical size: 1440x3168` | ✅ 无动态 override |
| `wm density` | `Physical density: 640` | ✅ 无动态 override |
| `am force-stop xyz.cpyh.dshpush` | `pidof` = **空**（已杀） | ✅ |
| `topResumedActivity` | `com.google.android.apps.nexuslauncher/.NexusLauncherActivity` | ✅ 无我方 Activity 残留 |
| `adb forward --remove-all` | `forward --list` **空** | ✅ CDP 端口已清 |
| ntfy 推送 | **本轮 0 条**（生产 `dsh` 与 `dsh-verify` 都没碰） | ✅ |

**未动过的东西（红线遵守声明）**：未切模拟器 GPU 模式、未冷启/重启笔电、未跑 `-Deploy`、
未改 `android-app/**` / `host-plugin/**` / `openspec/**`、未改 `verify\config.local.ps1` / profiles / hooks.json、
未推生产 topic `dsh`。本轮对仓库的写入**仅在 `verify/**` 内**（3 处用例标注 + 证据目录 + 本报告）。

---

## 6. 给 Lead 的三条建议（供决策，未执行）

1. **F 的收口 ✅ 已完成**：Lead 已在 **`f7c2c27`** 提交（含他自己的 `TESTER.md` + 我的用例标注 + 报告 + 证据图）——
   首稿的 4 个脏项全部清零。**本条建议已闭环，仅保留作追溯**（详见 §7）。
2. **并行期把 F 的判据改写成可达成形式**（本轮 HEAD 3 连跳就是证据）：
   建议改为 **"tester 写入范围（`verify/**`）内没有*未归因*的脏文件"**，而不是"`git status --short` 为空" ——
   后者在 Lead 有未提交改动时必然红，会一直误报。
3. **H-1 要不要本轮修** ✅ **已在 task-4 修掉**：`qa-round-driver.mjs` + `gate-shot.ps1` 补 `adb root` + `whoami` 断言，
   真机回归 **7/7 PASS**、顺序铁律 **CONFIRMED**（§8）。**本条建议已闭环。**

---

## 7. 收笔后记：F 已被 Lead 收口（**本节写于报告首次定稿之后**）

本报告首次定稿时 F = **FAIL**（工作树 5 行）。**Lead 随后在 `f7c2c27` 一并提交**了：

```
f7c2c27  2026-10-14 19:21:19 +0800
docs(qa): tester 就绪自检 A-E 全绿 + GPU 判据重写 + 411 宽基线作废标注 + 就绪报告与证据
 verify/STATUS-READY-2026-10-14.md                  | 338 +++++++++++++++++++++
 verify/TESTER.md                                   |  29 +-
 verify/evidence-ready-2026-10-14/B-screencap-launcher.png | Bin 0 -> 2036754 bytes
 verify/evidence-ready-2026-10-14/C-webactivity-dshweb.png | Bin 0 -> 1041919 bytes
 verify/testcases/01-adversarial.md                 |   7 +
 verify/testcases/02-ux-polish.md                   |   3 +
 6 files changed, 368 insertions(+), 9 deletions(-)
```

**⇒ F 的 4 个原始脏项全部清零**（`TESTER.md`、两个用例文件、报告、证据目录均已入库）。
**提交后唯一剩余的脏文件 = 本报告自身**（`M verify/STATUS-READY-2026-10-14.md`）—— 因为我在提交之后才追加本节与时间戳更正。
这属于**自指**：只要报告还在被修订，"工作树为空"就不可能由 tester 单方面达成（SS3 建议 2 说的正是这件事）。

**F 的净结论**：**除报告自身外，F = PASS**。把本节一并提交后，`git status --short` 即为空。

**HEAD 变化完整序列（本轮 19:11–19:22）**：
`f2fbd20e` → `c2156916` → `85b4a488` → `a2db444f` → `f53e4b7` → `a2db444` → **`f7c2c27`**（Lead 全程并行提交；tester 只写 `verify/**`）。

**H-1（起页要求 adbd root）的处置状态**：**当时未修**（U-7 BLOCKED）；`f7c2c27` 未触及 `qa-round.ps1` / `qa-round-driver.mjs`。
**→ 随后已由 task-4 修复**：`qa-round-driver.mjs` + `gate-shot.ps1` 补 root 前置 + `whoami` 断言，真机回归 **7/7 PASS**（**§8**）。

---

## 8. H-1 修复记录（task-4，2026-10-14 19:3x–19:5x）—— **FIXED，真机回归 PASS**

> 本节由 **task-4** 追加。结论：**`FIXED`**。修复前先复现（证实机理），修复后真机回归 **7/7 PASS**，
> 并特意证伪了我自己第一版的错误判据（见 §8.4）——**判据本身先被怀疑过**。

### 8.1 最小复现（修复前，证实 H-1 真的成立）

**命令**（笔电，见 `tmp\t4-repro-h1.ps1`）：`adb unroot` → `whoami` → `am start …/.WebActivity` → `adb root` 重试。

| 步骤 | 实际输出 | 判定 |
|---|---|---|
| baseline | `whoami(before unroot) = root` | — |
| `adb unroot` | `restarting adbd as non root`；`whoami = **shell**` | 造出 H-1 条件 |
| 非 root 起页 | **`SecurityException: Permission Denial: starting Intent { flg=0x10000000 xflg=0x4 cmp=xyz.cpyh.dshpush/.WebActivity (has extras) } from null (pid=5082, uid=2000) not exported from uid 10216`**；`topResumedActivity=…NexusLauncherActivity` | **证实：起页被拒** |
| `adb root` 后重试 | `whoami = root`；**无 `SecurityException`**；`topResumedActivity=ActivityRecord{145367250 … xyz.cpyh.dshpush/.WebActivity t118}`、`pidof = 5123` | **证实：root 后立刻成功** |
| 复原 | `RESTORED whoami = root` | ✅ |

**判据**：`nonroot_whoami=shell nonroot_SEC=True | root_whoami=root root_TOPreached=True` —— **H-1 成立，且修复方向正确**。

### 8.2 改动（2 个文件，均在 `verify/**` 内；`card-layout-verify.ps1` 已正确，未动）

**`verify\qa-round-driver.mjs`** —— 新增 `requireRoot(tag)`（含 `whoami` 断言 + fail-closed），并在**三处**调用：
1. `startApp()` 开头（`:169-171` 之前）—— 必须先于 `connect()` 建 forward；
2. `connect()` 开头（forward **之前**）—— 把不变量钉在"任何 forward 之前"这一层，防止未来新增起页点绕过；
3. `QA-A02` 开头 —— 该用例**自己**又 `am start` 一次（原代码第二处起页点，容易漏）。

**`verify\gate-shot.ps1`** —— 远端脚本在起页前补 `& $adb root`（照 `card-layout-verify.ps1:220` 写法），
紧接着 `whoami` 断言，**不满足即 `exit 1` 并打印 `BLOCKED:`**（不许静默继续）；另加一行 `topResumedActivity` 输出做自证。

**关键 diff（driver）**：
```diff
 async function connect() {
+  // H-1: root must be re-established BEFORE the forward below (adb root drops existing forwards).
+  await requireRoot("connect");
   const pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0];
@@
+function whoami() {
+  // bounded: a wedged guest must not hang the whole round
+  try { return String(adb(["shell", "whoami"], { timeout: 15000 }) || "").trim(); }
+  catch (e) { return "ERR:" + String(e && e.message).slice(0, 80); }
+}
+async function requireRoot(tag) {
+  let who = whoami();
+  if (who === "root") { console.log("ADB_ROOT " + tag + " already=root (forward untouched)"); return; }
+  console.log("ADB_ROOT " + tag + " whoami=" + who + " -> adb root");
+  try { adb(["root"], { timeout: 30000 }); } catch (e) { /* logged */ }
+  await sleep(3000);
+  for (let i = 0; i < 20; i++) {
+    who = whoami();
+    if (who === "root") { console.log("ADB_ROOT " + tag + " whoami=root after " + (i + 1) + " poll(s)"); return; }
+    await sleep(1500);
+  }
+  // fail closed: never keep going and let a case report "ran" while measuring nothing
+  throw new Error("BLOCKED: adbd is not root (whoami=" + who + ") - am start .WebActivity is denied (not exported). Remedy: adb root");
+}
 async function startApp(url) {
+  await requireRoot("startApp");   // must precede connect()'s adb forward
   try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch {}
@@ "QA-A02": async (rec) => {
+    await requireRoot("QA-A02");   // this case relaunches WebActivity directly
```

**关键 diff（gate-shot.ps1）**：
```diff
+# ORDER: this must precede any adb forward (root restarts the adb server and drops forwards).
+& `$adb root | Out-Null
+Start-Sleep 3
+`$who = ((((& `$adb shell whoami) 2>&1) -join '').Trim())
+'ADB_ROOT whoami=' + `$who
+if (`$who -ne 'root') { 'BLOCKED: adbd is not root …'; exit 1 }
 & `$adb shell am force-stop xyz.cpyh.dshpush | Out-Null
@@
+& `$adb shell dumpsys activity activities | Select-String -Pattern 'topResumedActivity' | Select-Object -First 1
```

**语法闸**：`gate-shot.ps1` → `Parser::ParseFile` **parseErrors=0**、非 ASCII **0** 字节（7,406 B）；
`qa-round-driver.mjs` → 笔电 `node --check` → **`NODECHECK_OK`**（`exit 0`）。

### 8.3 真机回归（**先 `adb unroot` 造出 H-1 条件**，再让修复后的 driver 自己救回来）

**REGRESSION_RESULT = PASS（7/7）** —— 笔电 `G:\Android\t4-regress2.ps1`，只跑**最小 1 条** `QA-C05`（未跑整轮）：

| 断言 | 实际 | 结果 |
|---|---|---|
| [A1] 非 root 被检出并尝试 root | `ADB_ROOT startApp whoami=shell -> adb root` | ✅ |
| [A2] `whoami` 变为 root（**断言满足**） | `ADB_ROOT startApp whoami=root after 1 poll(s)` | ✅ |
| [A3] `topResumedActivity` == WebActivity | timeline `webActivity=True` | ✅ |
| [A4] **`forward --list` 非空**（证明顺序对、forward 没被 root 清掉） | `emulator-5554 tcp:9225 localabstract:webview_devtools_remote_5828;` | ✅ |
| [A5] `SHELL_READY true`（页面真是 DSH shell，非 stale auth 页） | `SHELL_READY true` | ✅ |
| [A6] 用例**真 RAN**（CDP 端到端跑通） | `[RAN] QA-C05 QA-C05 (4962ms)` | ✅ |
| [A7] `ROUND_DONE` | `ROUND_DONE clean-state applied` | ✅ |

**driver stdout 原文（关键行）**：
```
CASES QA-C05
ADB_ROOT startApp whoami=shell -> adb root
ADB_ROOT startApp whoami=root after 1 poll(s)
APP_PID 5828
ADB_ROOT connect already=root (forward untouched)
SHELL_READY true
[RAN] QA-C05 QA-C05 (4962ms)
ADB_ROOT connect already=root (forward untouched)
ROUND_DONE clean-state applied
```
**timeline（独立探针，不是 driver 自报）**：
```
t=  3s whoami=root  forwardNonEmpty=False webActivity=False
t=  6s whoami=root  forwardNonEmpty=False webActivity=True
t=  9s whoami=root  forwardNonEmpty=True  webActivity=True   <- forward 建立
t= 12s whoami=root  forwardNonEmpty=True  webActivity=True
t= 15s whoami=root  forwardNonEmpty=True  webActivity=True
```
**负对照（证明断言是"承重"的，不是装饰）**：修复后再 `adb unroot` 手工起页 →
`non-root launch -> SecurityException = True` —— **非 root 路径依旧被拒**，说明 A2 断言真的拦住了一个会失败的路径。

### 8.4 顺序铁律的直接反证（**含一次我自己的判据翻车**）

**铁律**：`adb root` 会重启 adb server 并清掉既有 forward ⇒ root 必须排在**任何 forward 之前**。
**我的第一版实验无效**：它显示 `forward AFTER a later 'adb root'` **仍然非空**，看着像"顺序无所谓"。
**按 lead 提醒先怀疑判据** —— 根因是我那一步执行时 **adbd 本来就是 root**，所以 `adb root` 只是 no-op：
```
adb root  ->  "adbd is already running as root"      <- no-op，什么都没重启
```
**重做实验（先把 adbd 降为非 root，再建 forward，再真 root）**：
```
whoami = shell                                    <- 确认非 root
forward AFTER create (non-root) = 'emulator-5554 tcp:9227 localabstract:webview_devtools_remote_1;'
adb root said: restarting adbd as root            <- 这次是真的重启
whoami after = root
forward AFTER a REAL 'adb root' = ''              <- 被清掉了
ORDER_PROOF = CONFIRMED (a real adb root DOES drop forwards -> the order rule is load-bearing)
```
**⇒ 铁律成立**；同时我把这次"判据翻车"如实留在报告里（**"证伪自己的判据"优先于"让结论好看"**）。

### 8.5 设备复位与红线

| 项 | 复位后实测 | 状态 |
|---|---|---|
| `whoami`（本任务硬要求：**测完复原 root**） | **`root`** | ✅ 已复原（developer 特意留的 root 态未被破坏） |
| `am force-stop xyz.cpyh.dshpush` | `pidof` = **空** | ✅ |
| `adb forward --remove-all` | `forward --list` = **空** | ✅ |
| `font_scale` | `1.0` | ✅ |

未改 `dsh-app-verify.ps1` 发布链；`config.local.ps1` 只读未碰；未 `-Deploy`；未推生产 topic `dsh`；
未切 GPU 模式；未冷启/重启笔电。长脚本一律 `scp` + `-File`，**未使用 `ssh -EncodedCommand`**。

### 8.6 交付物

| 产物 | 路径 |
|---|---|
| H-1 修复（driver） | [qa-round-driver.mjs](F:\work\work_dsh\dsh-push\verify\qa-round-driver.mjs) |
| H-1 修复（gate-shot） | [gate-shot.ps1](F:\work\work_dsh\dsh-push\verify\gate-shot.ps1) |
| 最小复现脚本 | `F:\work\work_dsh\tmp\t4-repro-h1.ps1` |
| 回归脚本（7 断言 + 负对照） | `F:\work\work_dsh\tmp\t4-regress2.ps1` |
| 顺序铁律反证脚本 | `F:\work\work_dsh\tmp\t4-orderproof.ps1` |

**task-4 结论：`FIXED`**（H-1 已修 + 真机回归 7/7 PASS + 顺序铁律 CONFIRMED + 设备与 root 态已复原）。
**残余未覆盖**：`gate-shot.ps1` 新 root 块只做语法解析、未真跑（并入 **U-1**）；整轮 QA 未跑（`U-2`，按任务要求不做）。

---

## 附：本轮产物清单

| 产物 | 路径 | 说明 |
|---|---|---|
| 本报告 | [STATUS-READY-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\STATUS-READY-2026-10-14.md) | A–F 逐条断言/实际/证据 + BLOCKED/未覆盖 |
| 证据 B | [B-screencap-launcher.png](F:\work\work_dsh\dsh-push\verify\evidence-ready-2026-10-14\B-screencap-launcher.png) | 2,036,754 B，整页启动器（截图链路） |
| 证据 C | [C-webactivity-dshweb.png](F:\work\work_dsh\dsh-push\verify\evidence-ready-2026-10-14\C-webactivity-dshweb.png) | 1,041,919 B，WebActivity 真加载 DSH Web |
| 用例标注 | [01-adversarial.md](F:\work\work_dsh\dsh-push\verify\testcases\01-adversarial.md) / [02-ux-polish.md](F:\work\work_dsh\dsh-push\verify\testcases\02-ux-polish.md) | QA-A14 / QA-A15 / QA-P04 加⚠️411 基线作废标注 |
| 辅助脚本（临时，非交付） | `F:\work\work_dsh\tmp\ready-{start-page.cmd,viewport.mjs,shot-timing.ps1,cdp-check.ps1,reset.ps1}` | 本轮取证用的临时件，留在 `tmp\` 不落 `verify\` |
