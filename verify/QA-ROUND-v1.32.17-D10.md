# QA 轮 v1.32.17-D10/D11（task-11）— 真机验收：D10 未达成 → D11 补丁达成

被测仓库 `E:\work\work_dsh\dsh-push`，测试人 tester，设备 `emulator-5554`（AVD `dsh-p16`，物理 1440x3168@640，CDP `innerWidth=360`、`dpr=4`、`vh=671`）。本轮**只跑 assembleDebug、不 -Deploy、不改版本号、不跑 dsh-app-verify.ps1**；只写 `verify/**`。

## §0 定点结论

| 段 | 判定 | 一句话 |
|---|---|---|
| A D10/D11 三条指纹（新臂） | **达成** | 展开稳态 `__bwSbEl` 非 null、侧栏内联 `rgba(249,250,251,0.92) !important`、收起回 0.45 且只翻 1 次 |
| B D2 不回退（新臂） | **达成** | 代码块仍 289px、frame 内联仍无 `grid-template-columns`、20 目标 0 翻转 |
| C 稳态写入与开销（新臂） | **达成** | 展开稳态 8 次采样 `setProperty`/`setAttribute('style')` **全 0**；滚动 8 个 burst 期间计数冻结 |
| D 六项回归（新臂，两宿主） | **全过** | 卡片底色 0 翻转、Review 面板 `rgb(255,255,255)`、A14 命中、两宿主壁纸红线原值、入口未读、推送落库+撤通知+已答态 |
| 旧臂（`3385166`+`9924d59`） | **未达成** | A 段 3/4 不过：`__bwSbEl` 恒 null、底色停在 0.45 |

**结论：`23a3169`（D11）在真机上达成了 `3385166` 声称的目标；本轮判定「可发版」，但发版前请先处理 §6.4 那条显示缺陷（状态卡片仍写 v1.32.15）。**
A 段三条没有一条是靠「基本」「大致」过的：每条都给 8/8 采样的逐次读数。

## §1 三臂与被测物（每个数字都要对号入座）

| 臂 | apk | sha256 | 版本 | 源码 |
|---|---|---|---|---|
| **A0 对照臂** | `verify/qa-v132-16-app-debug.apk` | `f8b063f0…7cec` | 81 / 1.32.15 | `efde4c2`（D10 之前） |
| **A1 旧臂** | `verify/qa-d10-489765b0-app-debug.apk` | `489765b0…92e4` | 82 / 1.32.16 | `3385166` + `9924d59`（L498 转义修复） |
| **A2 新臂** | `verify/qa-d10-app-debug.apk` | `3104fcaa…5303` | 82 / 1.32.16 | `23a3169`（D11） |

- 构建闸（`verify/qa-d10-build.sh`，vm1 上跑）本轮**重钉**到 D11：`WEB de9a9bd812c833376c96bb96321e9464c1b6dfb3721746ba4d7c5b9d09ec882f` + `PUSH 0ee98aabcfb9f21d998b3d108c5a0e416e0342a6179bd51ef2f5ac15cb59cc49` → `HASH_GATE_OK`、`BUILD SUCCESSFUL`。旧钉 `bac07314…ca9d` 已作废（写进脚本注释）。
- DEX 字面量（A2）：`__bwSbEl=2 __bwBgEl=1 __bwW=1 __bwRailW=1 bwFind=1 bwGeomFix=1 bwAlpha=1 bwPanelBg=1 bwHandle=1 bwFpSb=1 bwFpPlace=1 bwFpExp=1 grid-template-columns=1 MutationObserver=2 __dshGlass=1 isCode=1 isCB=1 innerBig=1 visibility=3 contents=2 0.92=9`。
- 装机：A2 用普通 `adb install -r`（82→82）成功；设备 `sha256sum` 与本地一致；`dumpsys package` = `versionCode=82 versionName=1.32.16`。
- GPU 闸（`verify/emu-gpu-verdict.ps1`）本轮 PASS：guest `GLES:` = NVIDIA GeForce RTX 4060，qemu `-gpu host`；`pm path` 探活通过。

## §2 A 段：D10/D11 专项（vm1 真机）

### A2 新臂（`3104fcaa`）— 证据 `verify/qa-d11-d10.json` + `qa-qa-d11-d10-d10-{expanded,collapsed}.png`（360607 / 477730 B，alive，pid 13997）

| 判据 | 读数（8 次采样逐次一致） | 判定 |
|---|---|---|
| ① 展开稳态 `window.__bwSbEl` 非 null | 8/8 = `hHd-Xa_root` 360x671 | **PASS** |
| ② 展开侧栏内联底色 = 宿主原生色相 + 0.92 | 8/8 内联 `rgba(249, 250, 251, 0.92)`，priority `important`；色相 249/250/251（这台宿主原生，不是笔电的 255，也不是 `transparent`） | **PASS** |
| ③ 收起回 0.45、只翻 1 次、之后稳定 | 收起 8/8 内联 `rgba(249, 250, 251, 0.45)` important；写入计数展开每次 0/0/0，收起 C0 起 92/85/0 **冻结 8 次** ⇒ 只在收起那一轮写 1 次 | **PASS** |
| ④ 认不出侧栏时用 `__bwBgEl` 拉回 0.45 | 本轮不再需要兜底：`__bwSbEl` 在两态都非 null，收起态仍指同一节点（缩成 56x671 的 `hHd-Xa_collapsed hHd-Xa_railIn` 轨道） | 路径未被触发（见下条口径） |

**口径修正（要写进下一轮任务书）**：D10 时代写的「收起后 `__bwSbEl` 应变回 null」已被 D11 取代 —— D11 的指纹臂在两态都认得住元素，所以收起后它**也非 null**（同一节点、56 宽）。功能要求（收起把 alpha 拉回 0.45）达成，而且不再依赖 `__bwBgEl` 兜底。判「达成」应以「两态 alpha 正确 + 只翻 1 次」为准，不以 null 与否为准。

**视觉**：`qa-qa-d11-d10-d10-expanded.png` 侧栏已是近不透明浅底，壁纸立绘只在底部边缘淡淡透出（0.92 该有的样子）；A1 旧臂同图（`qa-qa-d10-d10-d10-expanded.png`，588726 B）立绘从条目缝里透出来（0.45）。

### A1 旧臂（`489765b0`）— 证据 `verify/qa-d10-d10.json`（本轮前半，已归档）

- ① 8/8 `__bwSbEl = null`；我从 CDP 手动调 `window.__bwPanelBg()` 两次仍 null（`qa-d10-diag.json`）。
- ② 被写元素（`__bwBgEl` = `hHd-Xa_root`）内联 8/8 `rgba(249,250,251,0.45) !important`，**从未 0.92**。
- ③ 形状对（只在收起那一轮多写 1 次后冻结），但值本来就没离开过 0.45 ⇒ 只是「空过」。
- 根因（实测，非推断）：`bwFind()` 判据①要求 `96px ≤ 宽 ≤ vw*0.9`（=324）。这台宿主展开态侧栏是**满屏宽**（`hHd-Xa_root` 360x671、`pI_x6G_sidebarCol` 360x671、外壳计算轨道只有**一条** `360px`）。`qa-d10-diag.json` 把全页 `left≤2 且 h≥60%vh` 的 10 个元素全列了一遍：**全部 over90（353~360）**，**[96,324] 带里一个元素都没有**。

### 结构说明（A2 新臂）

D11 的三条臂优先级：类名锚点 → **结构臂**（`bwFind` ①②③④，唯一能动轨道、修挤压靠它）→ **指纹臂**（`bwFpSb` + `bwFpPlace` 否决 + `bwFpExp` 用页面自己那根把手的边界）。
本轮实测：`window.__bwW` 与 `__bwRailW` 在 A2 上仍是 `null`/`null`（`qa-d11-ab-new.json`、`qa-d11-d10.json` perfFinal 一致），即**结构臂在这个形态上仍然钉不住**；0.92 是**指纹臂**给的。从页面外无法区分 `bwFind()` 是返回 null 还是返回了 `sb` 但没有 `col`（两种都留 `__bwW=null`）。可报的事实是：`__bwSbEl` 每轮都发布、指对了元素、两态 alpha 都对、且修挤压那条没被扰动（B 段）。

## §3 B 段：D2 不回退（同 bundle A/B，只差 apk）

| 读数 | A0 对照臂 `f8b063f0` | A2 新臂 `3104fcaa` |
|---|---|---|
| frame `pI_x6G_frame` 内联 | 只有 `background-color: transparent !important;` | 同左，**`gridInline` 空**，计算轨道 `360px`（单轨） |
| 代码块宽度 | 7 张 **289x296**、PRE 289x254 | **289x258 / 289x201**、PRE 289（第三条 360x0 是零高卡片） |
| 8×700ms 翻转 | 20 目标 **0 翻转** | 20 目标 **0 翻转** |
| `#dsh-theme-veil` | `rgba(255,255,255,0.45)` 内联**无 prio** | 同左 |
| `__bwW / __bwRailW` | null / null | null / null（修挤压路径同为 no-op） |
| 观察器 | `{geom:true, panelBg:false, panelClose:true}` | 同左 |
| 侧栏底色 | `rgba(249,250,251,0.45)` | `rgba(249,250,251,0.92)`（`analysis.sidebarRoot` 独立读到） |

证据：`verify/qa-d10-ab-base.json`（A0）、`verify/qa-d11-ab-new.json`（A2，截图 `qa-qa-d11-abnew-d2e.png` 471506 B alive）。
注：两次跑可见代码块数量不同（A0 7 张 / A2 3 张）是会话滚动位置不同，验收看的是**宽度 289**，不是数量。

## §4 C 段：稳态写入与开销

### C1 稳态写入计数（判据：展开稳态计数必须为 0）

| 口径 | A0 对照臂 | A1 旧臂 | A2 新臂 |
|---|---|---|---|
| `d10` 模式展开稳态 8 次采样 | 0/0/0 每次 | 0/0/0 每次 | **0/0/0 每次** |
| `d10` 模式收起稳态 8 次采样 | 冻结 41/34/0 | 冻结 46/39/0 | **冻结 92/85/0** |
| `perf` 模式 8 个滚动 burst | 0→0（全程 0） | 0→0（全程 0） | **18→18（burst0 起就冻结，滚动期间 0 增长）** |
| `setAttribute('style')` | 0 | 0 | **0** |

- A2 的 18 次全部是 `background-color`，且**在第一个 burst 读数之前就已写完**（burst0 t=2960 已是 18，之后 7 次读数一动不动）⇒ 落在「展开侧栏 + 玻璃化 apply + 300/1200ms 定时器」这个过渡窗口里，滚动期间零写入。
- **观察（不是缺陷，但要给 developer）**：过渡窗口写入总量在涨：A0 41/34 → A1 46/39 → A2 **92/85**（`background-color` 39→85）。原因是侧栏现在真被认出来了：多一次 0.92 写、指纹臂每轮观察器都跑、`__bwSbEl` 非 null 后玻璃化 `isSb`/`skipBg` 两条臂作用到更多元素。稳态仍是 0，所以不构成自激。
- 另一个观察：A2 的 rAF 记录里有一个 **1117ms 的长帧**（落在 burst0 窗口内，即展开+apply 那一刻）；A1 同窗口 max 67ms、A0 117ms。单次采样无法把「新代码首扫」和「新代码引起的整屏重绘（侧栏变近不透明 + 满屏 blur）」分开，记为待观察项，不作判定依据。

### C2 10s 滚动 gfxinfo（`perf` 模式，同设备同模式）

| 臂 | Total / Janky | p50 / p90 / p95 / p99 | gpu p95 / p99 | 现场 GPU |
|---|---|---|---|---|
| A0 今天同时段对照（`qa-d10-perf-ctl.txt`） | 233 / 169 = **72.53%** | 65 / 200 / 350 / 600 | 4950 / 4950 | 无 LLM 引擎 |
| A1 旧臂 sample1（`qa-d10-perf.txt`） | 308 / 216 = **70.13%** | 57 / 109 / 250 / 550 | 25 / 4950 | 无 LLM 引擎 |
| A1 旧臂 sample2（`qa-d10-perf2.txt`） | 279 / 197 = **70.61%** | 61 / 150 / 300 / 700 | 4950 / 4950 | 无 LLM 引擎 |
| **A2 新臂（`qa-d11-perf.txt`）** | 285 / 217 = **76.14%** | 65 / 150 / 400 / 1050 | 4950 / 4950 | **NO_LLM_ENGINE_ON_GPU** |
| 上轮 v1.32.16 双臂（`qa-v132-16-perf-*.txt`） | 319/148=46.39%、314/141=**44.90%** | 48 / 69 / 150 / 500 | — | 当时环境不同 |

**结论：差异在噪声内（环境侧），不可归因于本轮代码。** 依据：① 今天同一台机器、同一小时段内三臂（A0 72.53% / A1 70.13~70.61% / A2 76.14%）挤在同一个 70~76% 带里，而**上轮的 44.90% 与今天的 70%+ 差 25 个点**——这是机器/环境状态变了，不是代码变了；② 三条 gpu p95/p99 反复出现同一个 **4950ms** 离群值（连 A0 对照臂也是），是模拟器 GPU 计时通道的固定 stall，不是我们的 JS；③ 页内 rAF 记录三臂完全同级：A0 687 帧 med/p90/p95=17ms、A1 686 帧 17ms、A2 691 帧 17ms（`jankPct` 字段是「jank 帧数×10」，A0 30、A1 30、A2 70，都发生在过渡窗口）。
**只有同臂同时段的对照才算数**（这也是为什么我今天补跑了 A0 对照臂）；上轮的 44.90% 只能作为「另一时段的参考」，不能与本轮 A2 直接比。

## §5 D 段：六项回归（全部在 A2 新臂上重跑；旧臂同项读数并列给）

| # | 项 | A2 新臂读数 | 判定 |
|---|---|---|---|
| ① | 卡片底色 + 8×700ms 0 翻转（**两宿主**） | vm1（`qa-d11-reg-vm1-sample.json`）：18 目标 **0 翻转**；代码卡 233x296 / 233x239 内联 `rgba(249,250,251,0.45)` important、原生 `rgb(249,250,251)`；另有一张 360x595 的 `_numbered_` 卡走 `transparent !important`（壁纸通道，0 翻转稳定）。笔电（`qa-d11-reg-lap1-sample.json`）：16 目标 **0 翻转**，卡 233x353 走原生 `rgb(249,250,251)`（over-half 规则）、PRE 原生 | **PASS** |
| ② | 文档 Review 面板 | `_tabHost_6nhg2_162 _pane_6nhg2_209` SECTION 360x671 = **`rgb(255,255,255)`** 内联 `rgb(255,255,255)` + important；外层 `_surface_6nhg2_125` 仍 `transparent !important`（`qa-d11-reg-vm1-docpanel.json`，截图 470618 B alive） | **PASS** |
| ③ | A14 命中区（先 closepanel 再 a14） | 收起：on-screen 10/10 `selfHitVis=true`；展开：on-screen 6 个里 4 个 true，2 个 false 是 `Wrap lines`/`Copy` 被 `DIV.hHd-Xa_root`（展开侧栏覆盖层）盖住——设计如此。与 A1 旧臂逐项同形（`qa-d11-reg-vm1-a14.json`，两图 993334 / 473066 B alive） | **PASS** |
| ④ | v1.32.6 壁纸红线（**两宿主**） | vm1（`qa-d11-reg-vm1-redline.json`）与笔电（`qa-d11-reg-lap1-redline.json`）：`#dsh-theme-veil` 仍是 **`rgba(255,255,255,0.45)`** 内联、**无 priority**、`pos fixed`、`z=-1`、360x671；零 tab 的 `_emptyTabHost_6nhg2_143` 仍 `rgb(255,255,255)` 内联无 prio | **PASS** |
| ⑤ | 入口未读 | `qa-d11-push-entry-unread.png`（1072702 B）：卡片 `qa-d11-1792107879` 带蓝点未读 + 「肥鱼快答 / 已读」按钮；状态卡 `● 23 条未读` | **PASS** |
| ⑥ | 推送落库 + 截图链 | ntfy id `OoS93cOvVDsk`，title `qa-d11-1792107879`（qa- 前缀 + epoch）；prefs 行 `read:false`、`callId` 干净、`nid`/`qid` 齐；**未读期间 `dumpsys notification --noredact` 有该记录（True）**；`#ans` 回声（纯文本、prio 1、topic `dsh`，id `3dTXHWGeWimE`）后 prefs 翻成 **`read:true` + `answered:"answered by qa round"`**，通知记录消失（False），`qa-d11-push-entry-read.png`（1197927 B）卡片无蓝点 | **PASS** |

## §6 残留与判据腐烂（下一轮必须带着走）

1. **自锁机制（本轮最重要的一条）**：A0 对照臂上那个 280px 宽的侧栏，是**旧几何段自己钉 `width:280px` 的残留**（对照臂内联里那条 `width: 280px` 就是它）；新包不再钉（因为不再发现），侧栏就是页面自己的**满屏宽覆盖层**（360 = 100%vw）。⇒ **「按宽度认侧栏」在任何形态上都会随我们自己的写入而腐烂**：写入改变宽度 → 宽度判据失效 → 发现失效 → 写入消失 → 宽度又变回去。D11 用高度天花板（`h ≤ vh*1.25`）+ 把手锚点（`bwHandle`：宽 ≤24、高 ≥0.5vh、`left ∈ [40, 0.92vw]`）绕开了这一轮，但**任何仍以宽度为主的判据都要按同一条腐烂风险复查**。
2. **结构臂仍未拿下这个形态**：`__bwW`/`__bwRailW` 在 A2 上仍是 null，0.92 由指纹臂供。也就是说「修挤压」与「调底色」在这个形态上是两条**互不相干**的路径：底色对了，不代表结构臂哪天能接管。若哪天要在这个形态上再动轨道，得先补结构臂的 ③（这台宿主外壳 `pI_x6G_frame` 的子列只有 `sidebarCol` 360x671 是高的，`centerCol`/`rightbarCol` 高 0，`overlayLayer` 同宽不算「更宽」，`handle` 8px 已被新的 `width>=40` 下限挡掉 ⇒ `ok=false`）。
3. **正文子树是 4.35×vh 的陷阱**：`wSkVaW_viewArea` / `EvIC1a_frame` / `EvIC1a_root` / `EvIC1a_scroll` 全是 **353 宽 × 2922 高**、`left≤2`。只放宽宽度上限不加上限高度，「取最窄」会先撞上 353 的正文 ⇒ 0.92 写到聊天根 = **v1.32.6 壁纸红线**。本轮两宿主红线都仍是原值，说明护栏有效。
4. **显示缺陷（发版前要处理）**：状态卡片写 `状态：已连接（v1.32.15）`，而设备上装的是 `versionCode=82 versionName=1.32.16`。根因：`PushService.kt:41 const val APP_VER = "1.32.15"` 是**硬编码常量**，发版只改了 `build.gradle` 的 versionName，没同步这个常量（`MainActivity.kt:908` 直接用它渲染）。与本轮代码无关，但会被用户看见。
5. **探针坑（登记）**：旧 helper `sidebarState()` 的选择器是 `[class*=_root_]`（带尾下划线），当前 bundle 类名是 `hHd-Xa_root`（无尾下划线）⇒ **恒 null**，别拿它判展开态。可靠判据是内容法探针（文本同时含 `New Session`/`新会话` 与 `Settings`/`插件`）+ `elementFromPoint` 命中测试，即 `D10STATE` / `D10DIAG` / `D10MAP` 三段。另外 `NAV {"session":{"found":false,"why":"no collapse button"}}` 只表示点会话行时侧栏已经是展开态，不是失败。
6. **装机坑（登记）**：发版后设备是 82，要装 81 的对照臂必须 `adb install -r -d`（否则 `INSTALL_FAILED_VERSION_DOWNGRADE: Update version code 81 is older than current 82`）；数据不丢、不用 uninstall。82→82 用普通 `-r`。
7. **`#ans` 回声口径（登记，非 App 缺陷）**：App 只在**自己订阅的 topic `dsh`** 上收消息，且要求 `body.startsWith("#ans ")`（`PushService.kt:371`）。所以：① 发到 `/answer/<cid>` 它**看不见**（那是另一个 topic）；② 用 ntfy JSON API 发会让消息文本变成整串 JSON，不以 `#ans ` 开头 ⇒ App 会**新渲染一张卡**而不是当回声；③ 正确形态 = 纯文本 body `#ans <cid> <label>` POST 到 `https://ntfy.cpyh.xyz/dsh`（prio 1）。另外 `linkRegex` 的 `(S+)` 会把链接后面紧跟的 JSON 标点一起吃进 `callId`（`PushService.kt:46`），所以推送正文里那个 answer 链接**必须是纯文本**、后面别跟引号/逗号。
8. **编译闸教训（已在 `ad2de48` 归档）**：`3385166` 作为提交**编不过**（`WebActivity.kt:498` 内层双引号未转义 → Kotlin 字符串提前结束），是 QA 构建闸第一次拦下来的；`9924d59` 一行修好。纪律：**任何 Kotlin 里拼 JS 的改动，提交前必须至少跑一次 `assembleDebug`**，不能只靠合成 DOM 套件。
9. 本轮 A1 旧臂的 apk 我留了副本 `verify/qa-d10-489765b0-app-debug.apk`；已发布的 82 号包 sha 是 `8adc6b87…0dd2`，与 QA 构建的包（`489765b0` / `3104fcaa`）不同——**同源码不同构建**，比对时别把两者混为一谈。

## §7 真机 vs 合成边界

- 本轮**所有判定都来自真机**（`emulator-5554`，CDP `Runtime.evaluate returnByValue` + `Input.dispatch*` + `adb screencap`），每条都有 8 次采样与截图。
- 合成（jsdom 玻璃套件）只作旁证，**且必须标「合成」**：lead 的 `C:/Users/<user>/Desktop/test/glass-d11-suite.txt`（`ad2de48` vs `23a3169`：玻璃段仍 5858 B 逐字节相同，20 场景只有 S16/S16b 变化，S16 `sbRoot` `transparent` → `rgba(249,250,251,0.92)` f0、S16b 收起 → 0.45 f1，S1/S2/S4/S6/S8 聊天根陷阱与 S12 红线不变）；上一轮的 `glass-d10-suite.txt` 同理。
- **教训写死**：D10 那一轮合成 18 场景全绿、真机 A 段 3/4 FAIL。⇒ 合成只能证明「没改坏别的」，**不能**证明「真机上生效」。本轮 D11 的达成结论**只由真机支撑**。

## §8 证据清单（全部在 `verify/`）

A 段：`qa-d11-d10.json`、`qa-qa-d11-d10-d10-expanded.png`、`qa-qa-d11-d10-d10-collapsed.png`；旧臂 `qa-d10-d10.json`、`qa-d10-diag.json`、`qa-d10-map.json`、`qa-d10-a-b-findings.txt`、`qa-d11-a-b-findings.txt`。
B 段：`qa-d11-ab-new.json` + `qa-qa-d11-abnew-d2e.png`；对照 `qa-d10-ab-base.json` + `qa-qa-d10-abbase-d2e.png`。
C 段：`qa-d11-perf.json` / `qa-d11-perf.txt`；`qa-d10-perf.json` / `qa-d10-perf.txt` / `qa-d10-perf2.json` / `qa-d10-perf2.txt` / `qa-d10-perf-ctl.json` / `qa-d10-perf-ctl.txt`；上轮 `qa-v132-16-perf-{baseline,new}.txt`。
D 段：`qa-d11-reg-vm1-{sample,redline,docpanel,closepanel,a14}.json`、`qa-d11-reg-lap1-{sample,redline}.json` 及同名截图；推送 `qa-d11-prefs-afterpush.txt` / `qa-d11-prefs-afterecho.txt` / `qa-d11-dumpsys-ntf-unread.txt` / `qa-d11-push-entry-{unread,read}.png`。
工具：`verify/qa-v132-15-probe.mjs`（本轮新增 `d10diag` / `d10map` 两模式，`node --check` RC=0）、`verify/qa-d10-build.sh`（闸已重钉 D11）、`verify/qa-d10-chain.ps1`、`verify/emu-gpu-verdict.ps1`。
