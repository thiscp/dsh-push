# STATUS — task-16：App 网络感知（v1.32.8 代码，版本号仍 1.32.7）

**结论**：代码完成 + 自测通过（3 条需求里的 ①②全绿，③的问答链路 UI 全绿、**"折回"因环境不可验**）。
提交：见本文件末尾（android-app 单文件改动，versionCode/versionName 未动，留给 task-18）。

## 改了什么（只碰 `WebActivity.kt` 一个文件）

1. **断网横幅（需求①）**
   - `watchNetwork()` 的 `NetworkCallback` 增加 `onLost`：置 `offline=true` 并调 `showNetBanner()`；
     `onAvailable` 撤横幅。注册那一刻就断网的情况也主动问一次 `cm.activeNetwork == null`。
   - 横幅是**注入网页 DOM** 的 `div#bw-net-banner`（不是原生层）：`position:fixed;top:0;left/right:0`、
     `z-index:2147483000`、`rgba(18,24,40,0.92)` 深色半透明、白字居中、`pointer-events:none`。
   - `onPageFinished` 里若 `offline` 为真则重新挂上（页面重载后 DOM 是新的）。
   - **命中区纪律（TESTER.md 规则 6）**：横幅虽然盖在页面头部按钮上，但 `pointer-events:none`
     让点击/命中测试穿透到下面的按钮 —— 实测 8 个头部按钮的**视觉中心全部命中自己**
     （`elementFromPoint`），并对 "Open sidebar" 做了**真实输入**复核（命中它自己）。
2. **恢复即自动重载 + 首连退避（需求②）**
   - `onAvailable` 时若处于断开态（`errorLayer` 可见 / `loadErrored`）→ 取消排期、清零计数、`hideError()`
     并 `loadUrl(currentUrl())`，URL+token 不变。**不需要用户手点**。
   - 新增 `scheduleRetry()`：**1s → 2s → 4s → 8s → 16s → 30s（封顶）** 退避，`onReceivedError`（主文档）
     与 `onReceivedHttpError`（主文档 ≥500）触发；`onPageFinished` 里靠 `loadErrored` 区分"真成功"与
     "错误页也会回调 onPageFinished"，成功才清零/取消。
   - 手点「重试」降级为兜底：取消已排期的重试、清零计数，避免与自动重试双重加载。
   - `onDestroy` 取消排期；`onNewIntent`（同窗口换链接）清零计数。
   - 新增字段：`offline / retryAttempt / retryPending / loadErrored / ui(Handler) / lastUrl`；
     新增 `bannerJs() / showNetBanner() / hideNetBanner() / scheduleRetry() / cancelRetry() / currentUrl()`。

## 自测（模拟器 adb，全程未手点；截图 `F:\work\work_dsh\tmp\shots\task16\`）

被测 APK：本地 `assembleDebug`（`dsh-push-v1328-qa.apk`，11,071,407B，装后 `versionName=1.32.7` —— 版本号按纪律留给 task-18）。
驱动：`tmp\qa\task16-run.ps1`（一次 ssh 内跑完）+ `tmp\qa\task16-net.mjs`。

| 用例 | 实测 | 图 |
|---|---|---|
| T1 飞行模式开 → 横幅出现 | **556ms** 出现（要求 ≤2s）✓ 文案「网络已断开，正在等待恢复…」、`position:fixed`、`pointer-events:none` | `task16-t1-banner.png` |
| T2 飞行模式关 → 横幅消失 + 页面可用 | 横幅 **1659ms** 消失，页面 `#bw-narrow-fix`/shell 仍在、无手点 ✓ | `task16-t2-recovered.png` |
| T3 横幅不抢命中区 | 8 个头部按钮视觉中心 `elementFromPoint` 全 = 自己；真实输入点 "Open sidebar" → 命中 "Open sidebar" ✓ | `task16-t3-banner-hits.png` |
| T4 冷启动时离线 → 恢复后自动重载 | 离线时页面 `chrome-error://chromewebdata/`（"Webpage not available"）；恢复网络后**无手点**、**5410ms** 页面自己回来 ✓（退避重试生效） | `task16-t4-offline-start.png` / `task16-t4-after-backoff.png` |
| 卡片链路 UI | 推 1 条 `qa-task16*` 问题 → 通知落库（prefs 有 callId/opts）→ 打开 QuickAnswer → 卡片正确渲染我的问题与 `qa-opt-A/B` → 点选项后卡片关闭 ✓ | `task16-card-before.png` / `task16-card2-before.png` |

- 全程**未手点**任何东西（飞行模式开关走 `adb shell cmd connectivity`，卡片选项走 `input tap` 模拟用户点击）。
- 推送只用了 **2 条**（都带 `qa-` 前缀，`dsh-ntfy-push.py` 走生产 topic `dsh`）。
- 设备收尾：airplane 已关、`font_scale/uimode/wm size` 未动过、应用 force-stop。

## 遗留风险 / 未验到

1. **卡片"折回"未验成（环境问题，非本改动）**：我的合成问题（用 `dsh-ntfy-push.py` 直接推的）在
   `POST https://ntfy.cpyh.xyz/answer/submit` 上得到
   **`502 {"ok": false, "error": "转发失败(重试4次): <urlopen error [Errno 111] Connection refused>"}`**
   → 应用侧 `r.isSuccessful && ok` 不成立，走失败分支（卡片带提示关闭，无成功姿态，prefs 里也没有
   `answered` 字段）。**该路径我一行没碰**（本任务只改 WebActivity 的网络/重载段），且 README 说明
   `POST /answer/submit` 对"有 hostId 的已注册问题"才回 `{ok, queued:true}` —— 我的合成问题不是
   `/answer/register` 注册的，所以它会尝试转发到一个连不上的 host。**建议**：折回验证留给有真实 pending
   问题的场景（task-17 的 QA 轮或 Lead 自己发一次 `ask_user_question`），不要用合成问题判定。
2. **真机（OriginOS）未测**：`onLost/onAvailable` 在真机的耗时、以及横幅在真机 WebView 上的层级表现需抽样。
3. **多网络切换**：`onLost` 在网络切换（WiFi⇄蜂窝）时也会触发，横幅可能短暂闪一下（未实测真机行为）。
4. **极端场景未覆盖**：长时间离线后恢复（退避已到 30s 档）时页面恢复耗时、以及"离线期间用户正在打字"是否被
   重载打断（当前实现：恢复即重载，**不会**保留未提交的输入 —— 如果这不可接受，需要改成"仅在错误态才重载"）。
5. 桌面 ≥1024px 零改动：本次只加了网络回调与横幅，未动任何窄屏注入 CSS；**未跑卡片/侧栏的完整回归**
   （A14/A15/C05 依赖 task-17 那轮）。

## 提交

`android-app/app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt`（+1 文件），版本号三处未动。
