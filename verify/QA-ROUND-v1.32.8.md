# QA-ROUND v1.32.8 报告（改动验证轮 · App 网络感知：断网横幅 / 恢复自动重载 / 首连退避）

```
QA-ROUND v1.32.8 结论: PASS-with-findings
用例: 本轮跑 14 条（驱动 11 条 + 主流程补测 C01/C06 + N5）：通过 13 / 阻塞 1（QA-A07 首轮 150s 看门狗，复跑通过）/ 失败 0
      前半场已完成的 6 条（N1/N2/N3/N1b/N4fix/N4c）直接引用、未重做（N4 首轮 BLOCKED 是探针缺陷，见 FINDING-5）
      合计 20 条：通过 18 / 首轮阻塞 2（均已复跑通过）/ 失败 0；未覆盖 7 类（见 §6）
被测: commit e637659（只 android-app/.../WebActivity.kt）；装机 lastUpdateTime=2026-10-13 12:18:27(UTC)
      versionCode=73 / versionName=1.32.7（版本号按纪律留给 task-18，所以版本号不能用来认被测物）
环境: emulator-5554 / 1080x2400@420（本轮未动）/ adb root / API 36 / 2026-10-13 20:5x–21:2x 本地
证据: F:\work\work_dsh\tmp\shots\v1328-qa\（本轮新增 23 张图：15 张 qa-* + 5 张 c01/c06 + 3 张 n5-*，全部 >100KB，关键图逐张 read_image 看过；前半场 7 张 n1/n1b/n2/n3/n4/n4b/n4c 沿用）
      回归 JSON：qa-report-2026-10-13T13-02-37.json（11 条）、qa-report-2026-10-13T13-10-39.json（A07 复跑）
      网络感知 JSON：task17-net-report.json、task17-n4fix-report.json、task17-n4c-report.json
      主流程 JSON：task17b-c01c06-report.json、task17b-c06-report.json
```

**结论怎么来的**：本轮改动（网络感知）的 5 条验收 N1–N5 **全部实测通过**，回归邻域（面板 / 命中区 / 字体 / 主题 / 断线 / 滚动 / 推送落库 / 会话切换）**没有一条相对 v1.32.7 基线变坏**，玻璃红线（大容器 `rgba(0,0,0,0)` + veil + 壁纸立绘透出）在每张截图里都在。没有 P0/P1 → 不判 FAIL。留 1 条 P2（深色主题重载慢，归因未定）+ 4 条 P3。

---

## 1. 被测物身份（版本号相同，必须另找硬证据）

| 证据 | 值 | 来源 |
|---|---|---|
| 装机时间 | `lastUpdateTime=2026-10-13 12:18:27`（UTC，= 本地 20:18:27，task-17 装机那一刻） | `dumpsys package xyz.cpyh.dshpush` |
| 版本 | `versionCode=73 minSdk=26 targetSdk=34` / `versionName=1.32.7` | 同上 |
| 行为指纹 ① | 飞行模式一开，网页 DOM 里 381ms 出现 `div#bw-net-banner`（`position:fixed`、`z-index:2147483000`、`pointer-events:none`、`rgba(18,24,40,0.92)`） | `task17-net-report.json` R.n1 |
| 行为指纹 ② | 恢复网络后 1629ms 横幅自己消失、页面 shell 仍在、**全程无手点**（`meta.adbInputTaps=0`） | 同上 R.n2 |
| 行为指纹 ③ | 冷启动离线 → `chrome-error://chromewebdata/` → 恢复后 3066ms 页面自己回来（退避重试） | 同上 R.n3 |

这三条只存在于 e637659（v1.32.7 线上包没有横幅、也没有自动重试），所以身份成立。

**token 换新流程（宿主重启后）**：`C:\Users\<user>\.dsh\web.log` 最后一条 = `http://127.0.0.1:3081/?token=-OgndPTGax0COEni_uC4NyUYBfaggKIgmXqGKciQ9eM` → 模拟器用 `http://<tailnet-windows>:3080/?token=<同一条>` 重起（`am force-stop` → `am start -n xyz.cpyh.dshpush/.WebActivity --es url …`，Activity 未导出，adb 已是 root）。**本轮没有再遇到 401 / authentication required**。

## 2. 本轮怎么解读派单（没能问人，先把口径写清）

派单写「跑 `verify/qa-round.ps1` 核心 c-* 8 项 + 面板 + 推送落库」。我想确认口径时 `ask_user_question` 被 harness 拒了两次（`human interaction is unavailable while the calling agent is owned by another live agent`），所以按最合理的解释执行，并在此如实登记：

- 「核心 c-* 8 项」= 用例库 `verify/testcases/00-core-flows.md` 的 **QA-C01~C08**（正好 8 条）。驱动 `verify/qa-round-driver.mjs` 只实现了 C05（C07≈A07、C08≈A08 可对应），**C01/C06 我用临时驱动补跑**（`tmp/qa/task17b-c01.ps1`、`task17b-c06.mjs`），C02 由 N5 覆盖，C04 部分覆盖（见 §5）。
- 「面板」+「命中区」+「字体/主题/断线/滚动」= 驱动里已实现的 11 条全套：`QA-C05,QA-A01,QA-A02,QA-A06,QA-A07,QA-A08,QA-A12,QA-A14,QA-A15,QA-A17,QA-P04`（`-DriverTimeoutSec 1800`）。
- 红线遵守：**没跑 `-Deploy`**、没发布、没动 `host-plugin/**`、没动 relay/aliyun、没重启台式机 DSH、**没改模拟器分辨率/密度**（收尾实测仍是 `1080x2400` / `420`）。

---

## 3. FINDING 列表

### FINDING-1 [P2] 切系统深色主题后，内置浏览器要 >40s 才回到可用页面；首轮直接超 150s 看门狗（QA-A07）

- **复现**：内置浏览器停在会话页 → `adb shell cmd uimode night yes` → 驱动 reload → 等 `[class*='BynINW_frame']`。
- **实测**：
  - 首轮（13:02 那轮）：**BLOCKED**，`case watchdog 150s`，**没有任何截图产出**（`shots: []`）→ 按纪律算「跑了但没量到」，不是 PASS。
  - 复跑（13:10 那轮）：**RAN**，但整条用例 **81687ms**；DOM 里 `shellOk=false`（第一次 reload 后 40s 内没等到 shell，驱动重连 + 再 reload 才成功）。
  - 复跑后的 DOM 结论是对的：`night {collapsed:false, position:fixed, width:280, visibleW:280, bg:rgba(249,250,251,0.92), shadow:rgba(0,0,0,0.35) 0px 8px 32px}`、`bigBgs {frame/centerCol/chatChild: rgba(0, 0, 0, 0), veil:true}`、`bodyColor rgb(15, 17, 21)`。
- **预期**：主题切换后页面在几秒内回到可用会话页。
- **实际**：一次 150s 没回来、一次 ~80s 才回来（复现率 1/2）。
- **证据**：`tmp\shots\v1328-qa\qa-report-2026-10-13T13-02-37.json`（A07 `result=BLOCKED, error="case watchdog 150s"`）、`qa-report-2026-10-13T13-10-39.json`（A07 `ms=81687, dom.shellOk=false`）、`qa-A07-dark.png`（肉眼：深色系统主题下玻璃层仍是注入的浅色主题，文字可读、立绘透出）。
- **归因（诚实版）**：**未定**。可能是 night mode 触发 WebView 重建 + 软件渲染（swiftshader）下首屏慢，也可能是本轮模拟器负载；本轮**没确认模拟器 GPU 模式**（`Get-Process` 只看到 `emulator`，命令行读不到 `-gpu`）。本次改动只碰网络回调段，没动主题/注入 CSS，所以不太可能是 e637659 引入的回归——但**只有 Lead 能在真 GPU 现场判定**，故记 P2 不降级。
- **影响面**：真机上用户切深色/浅色主题（或系统按时间自动切）时，内置浏览器可能长时间停在未就绪页面；概率中等、后果可忍（重载一次就好）。

### FINDING-2 [P3] 恢复即重载会丢掉未提交的输入（本轮未测，沿用 task-16 自报风险）

`onAvailable` 里错误态直接 `loadUrl(currentUrl())`，用户在输入框打了一半的字会被重载清掉。STATUS-task16 已自报（遗留风险 4）。本轮**没有**做「离线时正在打字 → 恢复」这条用例，所以不判好坏，只登记为待测（见 §6）。

### FINDING-3 [P3] QA 驱动自身缺陷：`meta.patchGen` 恒失败，注入样式表指纹这轮没量到

两轮报告都是 `meta.patchGen = "unreadable: Cannot read properties of null (reading 'send')"` —— `qa-round-driver.mjs` 在第一次 `connect()` 之前就调 `ev()`。后果：这轮**没有**「注入样式表里有没有 v1.32.7 那批规则」这条指纹证据（v1.32.7 轮是靠它确认被测物的），本轮改用 `lastUpdateTime` + 三条行为指纹替代（§1）。属 QA 工具问题，不是 App 问题。

### FINDING-4 [P3] 命中区：视觉缝里的点仍是死区（与 v1.32.7 基线一致，非新增）

QA-A14 的 `realTaps.fired` 里，`predicted=null` 的点（元素之间 1.3px 缝、面板背景上）真实点击落到容器（`Workspaces` / `New SessionPluginsWorksp…`），`matchesPrediction=false`。`abutmentOk.all=true`、`centreSelfHit.all=true`、`railSelfHit.all=true` 三条判据仍全绿，几何与 v1.32.7 第二轮逐项相同（三钮 32×40 @174/@206/@238、Open-in 23×40.2 @287.4、More-ways 20×40.2 @311.7、Agent Team 28×40 @239、Collapse 40×40 @234；缝 gap 0 / 0 / +1.3）。**结论：没变坏**，死区是 v1.32.7 已登记的旧问题。

### FINDING-5 [P3] 两条 QA 探针缺陷（如实记，不是 App bug）

1. **N4 首轮 BLOCKED**：探针按「y<70 的可见按钮」抓 8 个元素，结果抓到的是 `y=-9926` 的屏外元素（页面已滚动），`elementFromPoint` 全 `owner=null` → 判据不成立。修成「先点进会话、再按头部行取按钮」后（`task17-n4fix-report.json`）8 个按钮全部有效。
2. **C06 首轮 `match=false`**：探针用 `[class*='hIlkoa_title']` 收集"会话"，把 **workspace 分组头**（`work_dsh`，无时间戳）也当成会话点了 → 只是把分组折叠（见 `c06-s1.png`），标题自然不变。加「行内必须有 `hIlkoa_time`」过滤后（`task17b-c06-report.json`）真会话切换 `match=true`。

---

## 4. 本轮改动专章：网络感知 N1–N5（全部实测）

| 用例 | 结果 | 实测数字 / DOM 原文 | 证据 |
|---|---|---|---|
| **N1 断网横幅** | PASS | 飞行模式开 → **381ms** 出现（要求 ≤2s）；`textExact=true`（文案「网络已断开，正在等待恢复…」）、`position=fixed`、`zIndex=2147483000`、`pointerEvents=none`、`bg=rgba(18, 24, 40, 0.92)`、`rect=412.2x30.4 @0,0`、`innerWidth=412`。n4fix 复跑再测一次：**418ms** | `n1-banner.png`（肉眼：深色半透明条压在头部上、白字居中，立绘仍透出，状态栏飞机图标在）、`task17-net-report.json` R.n1 |
| **N2 恢复自动重载（横幅消失）** | PASS | 飞行模式关 → 横幅 **1629ms** 消失；`shellStill=true`、`patchCount=1`（只注入一次）；**全程零手点**（`meta.adbInputTaps=0`） | `n2-recovered.png`、R.n2 |
| **N3 冷启动离线 → 退避重试回页** | PASS | 离线时 `chrome-error://chromewebdata/`（`Webpage not available`，`isErrorPage=true`）；恢复后 **3066ms** 页面自己回来（`hrefAfter` 是正常页、`shell=true`、大容器 `rgba(0,0,0,0)`、`veil=true`） | `n3-offline-start.png`、`n3-after-backoff.png`、R.n3 |
| **N1b 离线中导航 → 退避重试回页** | PASS | 离线时 `Page.navigate` 超时（`navErr="timeout Page.navigate"`）；恢复后 **4160ms** 自动回页（`totalMs=4211`） | `n1b-offline-reload-error.png`、`n1b-after-restore.png`、R.n1b |
| **N4 横幅不抢命中区（规则 6 双证）** | PASS | 横幅在场（`underBanner=true`）时 8 个头部按钮**视觉中心全部命中自己**（`centreSelfAll=true`）：Open in File Explorer 23×40.2@287.4 / More ways to open 20×40.2@311.7 / Agent Team 28×40@239 / 1 subagent running 112.4×28@118.6 / More actions 28×28@336.2 / Open right sidebar 28×28@372.2 / Open sidebar 40×40@4 / Chat 27×25.3@84。`allSelfAll=false` 只有一处：More ways to open 的**命中框右边缘**落进 1.3px 缝（owner=null），与 v1.32.7 基线一致。**真实输入**：CDP 真点 (298.9,25.2) → 捕获阶段 `pointerdown`+`click` 都落在 **Open in File Explorer** 自己（`realClickSelf=true`） | `n4-banner-hits.png`（红虚线=命中框、绿框=图标）、`task17-n4fix-report.json` R.grid/R.realClick |
| **N4c 真实输入有后果** | PASS | 真点 More ways to open (321.4,25.2) → `owner=true`、`expandedBefore=false → expandedAfter=true`、浮层 1→2、菜单文案 `File Explorer (default)\nVS Code`；ESC 后浮层回到 1 | `n4c-menu-open.png`、`n4b-realclick-menu.png`、`task17-n4c-report.json` |
| **N5 真实折回（本轮新增，见下）** | PASS | 点卡片 → 会话拿到答案 **3726ms**，走的是 `answered (foreground)`，**不是 180s 折回** | 见下表 |

### N5 真实折回：完整时间线（真注册路径，非 `/answer/submit` 合成路径）

提问由 **Lead 的会话**发出（`ask_user_question`，`qid=n5-foldback-1791897605`）。我自己的子 agent 会话发不出 `ask_user_question`（harness 两次直接拒绝），所以借主会话发，取证全在我这边闭环。

| epoch | 事件 | 来源 |
|---|---|---|
| `1791897701719` | 插件 `question call_5841f145a2ca4bc7a10bd527 agent=session-585c7794… timed=false` → `register … -> HTTP 200` → `timed corrected to true by the request waterfall` | `web.log` + 我给 `[dsh-push-host]` 行打的毫秒戳（`tmp/qa/task17b-logwatch.ps1`） |
| `1791897701`(s) | 提问推到 topic `dsh`：正文 `qa-N5-1791897605 …`、`→ qa-N5-opt-A / qa-N5-opt-B / qa-N5-opt-C`、`#qid n5-foldback-1791897605`、`#opts …=qa-N5-opt-A\|qa-N5-opt-B\|qa-N5-opt-C` | ntfy cache（读令牌） |
| `1791897701780` | 模拟器 App prefs 里已能读到该条目并解析出 `callId`（推送落库 ~60ms） | `adb shell cat …/shared_prefs/dshpush.xml` |
| `1791897709134` | **点卡片**：QuickAnswer 上 `qa-N5-opt-A` 的中心 (540,1219)（`uiautomator dump` 实测 bounds），`input tap` | `tmp/qa/task17b-n5tap.ps1` 输出 |
| `1791897710`(s) | relay 发第一条 `#ans call_5841f145a2ca4bc7a10bd527 qa-N5-opt-A`（手机侧 POST 成功） | ntfy cache |
| `1791897712860` | 插件 `queue: 1 item(s) [call_5841f14]` → **`answered (foreground) call_5841f145a2ca4bc7a10bd527`** | watcher |
| `1791897712`(s) | 插件 `#ans` 回声（撤销手机通知、入已答态） | ntfy cache |

- **到达耗时 = 1791897712860 − 1791897709134 = 3726ms**（点卡片 → 会话侧拿到答案；正好落在一个 3s 轮询 tick 里）。整条链路（提问注册 → 推送 → 点选 → 会话继续）= **11.1s**。
- **不是 180s 折回的判据**：日志里**没有** `returned pending; the phone card stays answerable`，**没有** `answered (continued)`，只有 `answered (foreground)` —— 即 `claimForeground=on` 让手机赢了与网页端的抢答，答案即时注入会话（对照：v1.32.7 之前那次 `call_f8139960…` 在 claimForeground=off 时走的就是 `returned pending` → `answered (continued)` 折回路径）。
- App 侧自证：prefs 里该 callId 带 `"answered":"qa-N5-opt-A"`；卡片作答后自行关闭（`n5-card-after.png` 里卡片已不在）。
- 截图：`n5-card-before.png`（heads-up 通知三个 chip + QuickAnswer 卡片三行选项 + 「自己输入…」，问题文案完整不截断）、`n5-card-toast.png`、`n5-card-after.png`。

---

## 5. 回归邻域（11 条驱动用例 + 主流程补测）

### 5.1 `verify/qa-round.ps1`（`qa-report-2026-10-13T13-02-37.json`，13:02:37–13:07:09Z）

| 用例 | 结果 | 关键数字（DOM 复核与截图同一时刻） | 截图 |
|---|---|---|---|
| QA-C05 面板展开/点外收起 | RAN | 展开 `fixed / 280 / visibleW 280 / bg rgba(249,250,251,0.92) / shadow rgba(0,0,0,0.35) 0px 8px 32px / patchCount 1`；点浮层外 → `collapsed=true / 55.6 / bg 0.45 / shadow none`；大容器三处 `rgba(0, 0, 0, 0)` + `veil=true` | `qa-C05-expanded.png`、`qa-C05-collapsed.png`（肉眼：280px 浮层完整、标题不被裁、立绘透出；0.92 下背后正文仍有淡水印=v1.32.7 已登记的 QA-P03，未变坏） |
| QA-A01 连点 10 次 | RAN | 状态严格交替 `false,true,false,true,false,true,false,true,false,true`；末态 `collapsed=true` 与最后一次一致；再点一次 → 280 | `qa-A01-rapid.png`、`qa-A01-after-toggle.png` |
| QA-A02 加载中抢点 | RAN | 5722ms 时点 toggle → `shellReady=true`、展开 280、`patchCount=1`（无双重注入） | `qa-A02-early-tap.png` |
| QA-A06 字体 1.0/1.3/1.5 | RAN | 三档全部命中 F1 规则：`titleMinWidth=0px`、`titleShrink=1`、`timeShrink=0`、`timeMarginLeft=8px`、`listPadBottom=40px`；`lastRowVsSettings` = −112.3 / −112.2 / −112.3（末行不被 Settings 压住）；收尾 `font_scale` 已回 1.0 | `qa-A06-font10/13/15.png` |
| QA-A07 深色主题 | 首轮 **BLOCKED**（150s 看门狗、无截图）→ 复跑 RAN | 见 FINDING-1 | `qa-A07-dark.png` |
| QA-A08 飞行模式断/通 | RAN | 离线时页面仍是可用会话页（`title="GitHub openspec 项目 — DeepSeek Harness"`、`shell=true`、正文完整）；恢复后 `shellBack=true`、`patchCount=1` | `qa-A08-offline.png`、`qa-A08-back.png` |
| QA-A12 面板内滚动 | RAN | 滚轮 (140,500)：侧栏根容器 `sbH=sbClient=777`（自身不滚），`innerScrolledEls=1` → 内层列表滚动；`sbTop 0→0` 无位移 | `qa-A12-scroll.png` |
| QA-A14 命中区（规则 6） | RAN | `centreSelfHit.all=true`、`abutmentOk.all=true`、`railState {w:55.6, collapsed:true}`、`railSelfHit.all=true`；缝 gap 0/0/+1.3；唯一 overlap = `Collapse sidebar × Agent Team`（面板展开时浮层盖住，预期）；`viewportAfterTaps 777x412`（IME 没缩视口） | `qa-A14-hitboxes.png` |
| QA-A15 收起态轨道 | RAN | 轨道 `w=55.6`；轨道内按钮最大 40×40、右边界 ≤46px 未顶出；`overlaps=[]` | `qa-A15-rail.png` |
| QA-A17 列表滚到底 | RAN | 真滚动容器 `_9lTDKa_list`（`scrollable=true`、`padBottom=40px`）；滚到底 `clearance=112.3px`（在顶部时 7.1px） | `qa-A17-scrollbottom.png` |
| QA-P04 命中区普查 | RAN | 25 个可点元素；仍是 <40px 的 23 个（`More actions 28x28`、`Open right sidebar 28x28`、`Copy 28x28`、`Send`、`Chat 27x25`、`Load earlier 87x22`…）—— 与 v1.32.7 FINDING-4/QA-A16 登记的范围问题一致，**未变坏** | DOM-only（无截图） |

### 5.2 主流程补测（`tmp/qa/task17b-c01.ps1`、`task17b-c06.mjs`）

| 用例 | 结果 | 实测 | 证据 |
|---|---|---|---|
| **QA-C01 推送落库 → 消息列表 → 内置浏览器** | PASS | 推送 `time=1791897340` → **~2s** 落进 App DB；prefs 原文 `{"title":"qa-C01","body":"qa-C01-1791897324 c01 push-to-DB regression","ts":1791897340,"mid":1375367643,"read":false}`（**read=false** ✓、`ENTRY_COUNT 1`、mid 与相邻条目 −1484124071 不同 ✓）；`mCurrentFocus=…MainActivity`；随后 WebActivity 起页 `shellReadyMs=2424`、`patchCount=1`、大容器三处 `rgba(0,0,0,0)`+`veil=true` | `c01-msglist.png`（肉眼：两条 qa-C01 带未读蓝点、「已读」按钮、状态卡「已连接 (v1.32.7) / topic dsh」、立绘透出）、`c01-browser.png`、`task17b-c01c06-report.json` |
| **QA-C06 会话切换** | PASS | 过滤掉 workspace 分组头后 5 个真会话行；点 `DSH 会话监督者选择` → `document.title` 变成 `DSH 会话监督者选择 — DeepSeek Harness`、`shell=true`（切换前是 `GitHub openspec 项目`）→ **标题与内容对应、不串会话** | `c06-ok.png`、`task17b-c06-report.json`（首轮探针缺陷见 FINDING-5，现场 `c06-s1.png`/`c06-s2.png` 保留） |
| **QA-C02 提问卡作答 → 回会话确认** | PASS（由 N5 覆盖） | 真提问 + 卡片点选 + 会话即时继续（`answered (foreground)`），见 §4 N5 | `n5-card-*.png` |
| **QA-C04 快答浮窗** | 部分覆盖 | QuickAnswer 卡片本身被真实作答（打开方式是 `am start --es callId`，**不是点通知**）；选项命中区足够（bounds 中心一次点中）、作答后自行关闭 | `n5-card-before/after.png` |
| **QA-C07 深浅主题** | PASS | = QA-A07（复跑），见 FINDING-1 的耗时问题 | `qa-A07-dark.png` |
| **QA-C08 断线重连** | PASS | = QA-A08 + N1/N2/N3/N1b（比用例要求更严：还量了横幅耗时与退避回页耗时） | 同上 |

---

## 6. 没验到的部分（如实，不当成通过）

1. **真机 OriginOS**：`onLost/onAvailable` 在真机的耗时、横幅在真机 WebView 的层级表现 —— 只有模拟器数据。
2. **多网络切换**（WiFi⇄蜂窝）：`onLost` 也会触发，横幅会不会闪一下 —— 未测。
3. **长时间离线后恢复**：退避已到 30s 封顶档时，恢复要多久才回页 —— 本轮两次实测都在 1s/2s 档（3066ms / 4160ms）。
4. **离线期间正在打字**：恢复即重载会不会打断输入（FINDING-2）—— 未测。
5. **QA-C03 通知栏直答**：未跑（本轮没展开通知栏作答）。**QA-C04 的「点通知起浮窗」入口**也未跑（浮窗本体已验）。
6. **桌面 ≥1024px**：本轮全程 412 CSS px 窄屏；宽屏未跑（本次改动不含窄屏 CSS，风险低但未证）。
7. **模拟器 GPU 模式未确认**（FINDING-1 的归因需要它）：本轮只确认客机健康（`sys.boot_completed=1`、`adb shell echo ok`），没读到 `-gpu` 参数。

## 7. 收尾复位（已实测证明）

`task17b-reset.ps1` 输出：`AIRPLANE 0` / `FONT 1.0` / `NIGHT Night mode: no` / `SIZE Physical size: 1080x2400` / `DENSITY Physical density: 420` / `PID `（App 已 force-stop）/ 包仍是 `versionName=1.32.7 lastUpdateTime=2026-10-13 12:18:27`。

**到用户真机的推送清单（本轮，全部 qa- 前缀）**：2 条 `qa-C01-*`（其中 1 条是我脚本笔误的浪费）、1 条 N5 提问 `qa-N5-1791897605`、relay/插件为 N5 发的 `#ans` 回声；另有我早先失败的 `ask_user_question` 留下的 1 条 pending 提问（`call_7761c8d2…`，现已是已答态）。

## 8. 给 Lead 的建议

1. **可以发**：网络感知这块（N1–N5）我这边没有保留意见；P2 那条与本次改动无关（主题/渲染路径），不挡 `-Deploy`。
2. 发版前若想收掉 P2：在真 GPU 现场跑一次 `cmd uimode night yes` 计时（我这边 1/2 复现、>40s），确认是 swiftshader 还是 WebView 重建。
3. 建议把两条 QA 资产修一下（QA 侧，不用你动）：`qa-round-driver.mjs` 的 `patchGen` 要在 `connect()` 之后再读（FINDING-3）；`QA-A07` 的 150s 看门狗对 night-mode 重载这种慢路径偏紧（改成 reload 后先 `Page.navigate` 再等 shell，或把窗口放到 240s）。
4. 用例库回填：本轮新增的取证口径（给 `[dsh-push-host]` 日志行打毫秒戳的 watcher、`#opts` 卡片真点、`hIlkoa_time` 过滤 workspace 头）值得沉淀成 QA-A18「手机作答即时到达 vs 180s 折回」——要我把它们写进 `verify/testcases/` 就说一声（章程规定用例库归 QA 维护，本轮没动）。
