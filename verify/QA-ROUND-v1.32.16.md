# QA 轮 · v1.32.16（task-9 · commit `efde4c2`）

- 被测提交：**`efde4c2`**（2 文件 +304/−32：`GLASS-OVERLAY.md` + `WebActivity.kt`；版本仍 **1.32.15 / versionCode 81**）
- 判定人：**tester**（写域仅 `verify/**`，`android-app/**` 一行未动）
- 环境：笔电常驻模拟器 `emulator-5554`（AVD `dsh-p16`，物理 1440x3168@640，CSS360/dpr4，`-gpu host`）；两个 DSH Web 宿主 —— **笔电** `<tailnet-laptop>:3080`（类名锚点命中面）与 **vm1** `<tailnet-vm1>:3080`（类名轮换、几何兜底路径命中面）
- 本轮范围：D2 专项（含真机同 bundle A/B）+ D3 专项 + 观察器开销 A/B + 六项回归。读数一律标「真机」（模拟器实测），只有 lead 的合成套件标「合成」，两者不混。
- 探针：`verify/qa-v132-15-probe.mjs`（本轮新增 `d2` / `d2e` / `perf` 模式与 `D2STATE` / `sbProbe` / `railProbe` / `dismissSheets` / `scrollBurst`）；每次运行前后 `shaBefore/shaAfter` 同值、`pid` 前后一致（无崩溃、无重启）。

## 0. 定点结论

| 判据 | 结果 |
|---|---|
| **D2 挤压解除**（真机同 bundle A/B：44px → 289px，frame 内联 `grid-template-columns` 从有到无） | **PASS**（见 §2） |
| D2 收起态：正文不被钉死、无 `width:280px !important`、轨道底色回 0.45 | **PASS** |
| D3 零 tab：`_emptyTabHost_` 的 `inline` 与 `prio` 都是空串 | **PASS** |
| D3 开真 tab：`_tabHost_…_pane_…` 仍 `rgb(255,255,255)`、8× 0 翻转 | **PASS** |
| 观察器开销 A/B（gfxinfo + 页内 rAF + 写入计数） | **差异在噪声内**（新版方向还更好） |
| 回归①卡片底色 + 8×700ms 0 翻转（两宿主） | **PASS** |
| 回归②文档 Review 面板白底 | **PASS** |
| 回归③A14 命中区（先 `closepanel`） | **PASS** |
| 回归④v1.32.6 壁纸红线（两宿主） | **PASS** |
| 回归⑤入口未读 | **PASS** |
| 回归⑥推送落库 + 截图链路（`qa-` 前缀 + epoch） | **PASS** |
| **D10 残留**：vm1 展开态侧栏底色停在 0.45，拿不到笔电的 0.92 | **登记**（真机实测、非本轮引入，发版后修） |
| **D9 探针坑**：`clickAt(330,300)` 在 vm1 展开态会点开 Settings | **登记**（已加 `dismissSheets` / `railProbe`） |
| 环境事故：guest `system_server` 崩过一次并整机重启 | **登记**（见 §7，非 tester 操作） |

**本轮判定：`efde4c2` 可发版。** D2 的挤压解除拿到真机同 bundle A/B 硬证；D3 两项按专项口径正式复跑通过；新观察器无可测开销；六项回归全绿。唯一残留是 D10（侧栏底色档位），与补丁无关、不阻塞发版。

## 1. 构建与安装

| 项 | 结果 |
|---|---|
| 源码硬哈希闸 | vm1 侧 `WebActivity.kt` = **`df35d772…51c1cd`**、`PushService.kt` = **`0ee98aab…cc49`**（不匹配 `exit 3`）⇒ `HASH_GATE_OK` |
| 构建方式 | 先 `scp` 同步 `app/src` + 三个 gradle 文件到 vm1（vm1 仓库是旧的），再 `gradle clean assembleDebug`（只 `assembleDebug`，无 `-Deploy`、未改版本号） |
| 产物 | `verify/qa-v132-16-app-debug.apk` **10995364 B**，sha256 **`f8b063f0335b612f7494b71d59739dd0890d55d140db2fbf0647e6914f937cec`**；DEX 字面量含 `grid-template-columns` / `MutationObserver` / `__bw` / `visibility` / `contents` |
| 装机 | GPU 闸门 **VERDICT: PASS**（`GATE_EXIT=0`，guest `GLES:` = NVIDIA GeForce RTX 4060 Laptop GPU，qemu `-gpu host`，`wm size/density` 1440x3168/640）→ `adb root`（`whoami=root`）→ `adb install -r` **Success 未清数据**；`versionCode=81 / versionName=1.32.15`；设备 `base.apk` sha256 = 同一个 `f8b063f0…` ⇒ 提交↔vm1↔笔电↔设备四方一致 |
| 基线臂 apk | `verify/qa-v132-15-app-debug.apk` **10993508 B**，sha256 **`597ff2672ebe9fe88c2930dfa48eecf9fc46ecc628e35cc4624bc462e8e57827`**（`db385d5`，无几何段、无观察器） |
| 脚本 | `verify/qa-v132-16-build.sh`（远端构建 + 硬哈希闸 + DEX 字面量）、`verify/qa-v132-16-chain.ps1`（sync / build / fetch 三步，`Start-Process` 重定向 + 硬超时，纯 ASCII） |

## 2. D2：窄屏展开侧栏把正文挤成细条

### 2.1 真机同 bundle A/B（本轮最硬的一条，独立复现两次）

同一台 vm1 DSH Web（**同一个前端 bundle**）、同一会话行（row 3「我本地Ubuntu每次启动都是自动」）、同一探针流程（`d2e`：进会话 → 重新展开侧栏 → 8×700ms 采样），只换 apk：

| 读数 | 基线臂 `597ff267`（v1.32.15） | 新臂 `f8b063f0`（`efde4c2`） |
|---|---|---|
| `pI_x6G_frame` **内联** | `grid-template-columns: 280px minmax(0px, 1fr) minmax(0px, 0px); background-color: transparent !important;` | **只剩** `background-color: transparent !important;` |
| frame computed 列宽 | `280px 80px 0px` | 单列 `360px` |
| `pI_x6G_centerCol` | **80x671 @x=280** | **360**（x=0） |
| 代码块（按面积前三） | **44x4933 / 44x2900 / 44x2482** | **289x296 / 289x254 / 289x220** |
| 侧栏 | 280x671 `static`，hit-test(20,60) 自命中 `hHd-Xa_logoRow` | 280x671 `static`，同样自命中 |
| `__bwGeomObs` | false（基线没这东西） | **true** |
| 8 次采样 / 翻转 | 逐字不变，**0 翻转** | 逐字不变，**0 翻转** |

> **两个宽度数字都在同一份基线臂文件里，后人别再绕一遍**：`qa-v132-16-d2-ab-baseline.json` 的 **`codeblocks` 段**（L376 起）是 7 个代码块卡片 `_block_7gxqk_4 md-code-block _card_7gxqk_107`，**全部 9px 宽**（9x4975 / 9x2942 / 9x2524 / 9x2410 / 9x2220 / 9x2144 / 9x1783；`inline rgba(249,250,251,0.45)` + `important`，剥内联后原生 `rgb(249,250,251)`）；上表「代码块（按面积前三）」那行的 **44px** 来自**同一文件的 `d2.blocks` 段**（L526 起）——那里排在前面的 8 条是卡片**内层 PRE** `_plain_7gxqk_103`（PRE 保持固有宽度、溢出 9px 的卡片，`inline ""`、`bg rgb(249,250,251)`），其后还跟着 4 条 9px 的卡片。⇒ 基线上挤压**最窄到过 9px（卡片级）**，44px 是它内层 PRE 的读数；新臂两段**全部 289px**（`codeblocks` 7×289、`d2.blocks` 12×289，全文再无 `4975` / `4933`）。

证据：`verify/qa-v132-16-d2-ab-baseline.json` + `verify/qa-v132-16-d2-ab-new.json`（本轮专项复跑），以及 `verify/qa-v132-16-perf-baseline.json` / `verify/qa-v132-16-perf-new.json`（开销 A/B 顺带的同 bundle 对照，读数完全一致）；截图 `qa-qa-v132-16-perfbase-perf.png`（基线臂正文一屏一个词，肉眼可见的挤压）与 `qa-qa-v132-16-d2ab-new-d2e.png`（新臂正文满宽、侧栏覆盖层）。

⇒ **挤压解除是补丁的功劳**：44px → 289px（目标 ~233px 以上达成），且侧栏仍可见可点。

### 2.2 机制（为什么末态 `__bwW=null` 不等于「没动手」）

挤压的来源是**页面自己**写在 frame 上的内联 `grid-template-columns: 280px minmax(0,1fr) 0`。补丁的几何路径先按判据写入自己的列宽，随后 `bwUndo()` 执行 `w.f.style.removeProperty('grid-template-columns')` —— **内联样式是同一个命名空间**，所以这条 `removeProperty` 摘掉的是**页面写的那条**（不是只回收我们写的），摘掉后落回页面样式表的默认「单列 360px + 侧栏覆盖层」。因此末态看到 `__bwW=null / __bwSbEl=null / __bwRailW=null` 且 frame 内联里没有 `grid-template-columns`，是**撤销之后**的状态，不是「这段没跑」的证据。

**风险边界**：这段只在「窄屏（vw≤1023）+ 展开 + 存在饥饿兄弟列」判据成立时才动手；笔电宿主走类名命中路径，**根本不进这段**（实测 `__bwGeomObs=false`，见 §4）。

### 2.3 写入细节仍标「合成」

补丁**正向写入的具体值** —— `grid-template-columns: 56px minmax(0,1fr) 0px`、`overflow:visible`、`backdrop-filter:none`、侧栏 `position:fixed / width:280px / z-index:60 / 底色 0.92` —— 只有 **lead 的合成探针**（`C:\Users\<user>\Desktop\test\glass-suite-result4.txt` 16 场景 + `glass-d2-probe.txt`）证明，**标「合成」**。真机上这条路径当前以「摘掉页面内联」的形态生效，正向写入值在真机 bundle 上观察不到。

### 2.4 跨 bundle 的 9px 老基线只作历史参考

`verify/qa-d1-vm1b.json`（4a039ab 那轮）里代码块 **9x4975**、frame 只有 **73px**、类名 `EvIC1a_frame` / `bhn1Oq_root`。**vm1 前端 bundle 两轮之间换过**（`EvIC1a_/bhn1Oq_` → `pI_x6G_/hHd-Xa_`），新 bundle 窄屏侧栏本就是覆盖层，当时据此判断「9px 是旧 bundle 的形态、当前 bundle 复现不出来」——**这句现在收紧**：§2.1 专项 A/B 的基线臂（**当前 bundle + 基线 apk**）里，`codeblocks` 段 7 个代码块卡片**全部 9px**（9x4975 / 9x2942 / 9x2524 / 9x2410 / 9x2220 / 9x2144 / 9x1783），与旧 bundle 那个数字一模一样 ⇒ **9px 在当前 bundle 上照样复现，不是旧 bundle 的专利**；上表 44px 那组是同一批卡片内层 PRE 的读数（见 §2.1 表下注）。旧 bundle 特有的只有「frame 本身只剩 73px」这一条形态（当前 bundle 的 frame 是 360px，挤压发生在列宽上而不是 frame 宽度上）。D2 的完整证据链因此是：**同一 bundle、同一会话、只差 apk，9px → 289px**；跨 bundle 的 `qa-d1-vm1b.json` 只作历史参考。

### 2.5 收起态（vm1，真机）

`verify/qa-v132-16-d2vm1-collapse.json` + `qa-qa-v132-16-d2collapse-d2.png`（888512 B，alive）：

- 可见轨道 `pI_x6G_sidebarCol` **56x671**、`position:static`、底色 **`rgba(249,250,251,0.45) !important`** ⇒ 底色回 0.45 ✓，**没有** `width:280px !important` 钉死（`__bwW / __bwSbEl` 皆 null、frame 无 grid 内联）。
- 正文 `centerCol` **304x671**、卡片 **233x353 = `rgb(249,250,251)`**（overHalf=true）、轨道 hit-test(18,60) 自命中 `hHd-Xa_root hHd-Xa_collapsed` ⇒ 可见可点。
- 8×700ms 全部 0 翻转。
- 第一次跑被污染（Settings 面板被点开，见 §6 D9），已存 `-contaminated` 两份；加 `dismissSheets`（Escape×2 + 统计 `[role=dialog]/sheet/mask`，本次 before/after 均 0）与 `railProbe` 后重跑干净。

## 3. D3：零 tab 的空壳不该被我们打白标

| 状态 | 元素 | computed | inline | prio | 判定 |
|---|---|---|---|---|---|
| **零 tab**（`verify/qa-v132-16-d3-zerotab.json`） | `_emptyTabHost_6nhg2_143` 360x671 | `rgb(255,255,255)` | **`""`** | **`""`** | **PASS**（白来自原生 CSS，不是我们的 `!important`） |
| 同上对照 | `_surface_6nhg2_125` | `rgba(0,0,0,0)` | `transparent` | `important` | 我们的写入照旧正确 |
| 同上对照 | `#dsh-theme-veil` | `rgba(255,255,255,0.45)` | 原值 | 无 | 未被改写 |
| **开一个真 tab**（`verify/qa-v132-16-d3-tabopen.json`，点文件卡 `E:/work/work_dsh/dsh-push/verify/HANDOVER.md+2`） | `_tabHost_6nhg2_162 _pane_6nhg2_209` 360x671 | **`rgb(255,255,255)`** | `rgb(255,255,255)` | `important` | **PASS**，8×700ms **flips=0**、distinct 只有 `rgb(255, 255, 255)` |

截图：`qa-qa-v132-16-d3zero-closed.png`（522470 B）、`qa-qa-v132-16-d3open-docpanel.png`（224034 B），均 alive。

## 4. 观察器开销 A/B（vm1 真机）

做法：装基线 → `dumpsys gfxinfo <pkg> reset` → 展开会话页滚 10 秒（8 组 × 5 次 wheel）→ 采 gfxinfo + cpuinfo + 页内 rAF + `setProperty` 计数；再装回新版同样跑一遍。全文：`verify/qa-v132-16-perf-baseline.txt` / `verify/qa-v132-16-perf-new.txt`（含 gfxinfo / cpuinfo 原文与末尾对照块），原始 JSON 同名 `.json`。

| 指标 | 基线 `597ff267` | 新 `f8b063f0` |
|---|---|---|
| gfxinfo Total / Janky | 319 / **148 (46.39%)** | 314 / **141 (44.90%)** |
| gfxinfo p50 / p90 / p95 / p99 | 46 / 77 / 200 / 450 ms | 48 / **69** / **150** / 500 ms |
| 页内 rAF（~11.5s 滚动） | 688 帧，med 17 / p90 17 / p95 17，max **83**ms，>20ms **10 帧 (1.45%)** | 690 帧，med 17 / p90 17 / p95 17，max **17**ms，>20ms **0 帧 (0.00%)** |
| `setProperty` / `setProperty(…,important)` / `setAttribute('style')` | **0 / 0 / 0** | **0 / 0 / 0**（`byProp` 空 ⇒ 稳态无重复写入、**无自激**） |

### `__bw*` 三态对照（本轮实测）

| 面 | `__bwGeomObs` | `__bwPanelBgObs` | `__bwPanelClose` | `__bwW / __bwRailW / __bwSbEl` |
|---|---|---|---|---|
| **vm1 + 新** `f8b063f0` | **true**（4 次独立采样一致：2×d2 + 2×perf） | false | true | null / null / null（跑过并撤销） |
| **笔电 + 新** `f8b063f0` | **false**（类名命中路径，连观察器都没挂） | **true**（0.92 那条路照旧） | true | null / null / null |
| **vm1 + 基线** `597ff267` | false（无此物） | false | **true** | 名字不存在 |

⇒ **结论：新观察器带来的差异在噪声内**，方向还偏有利于新版（长帧 0 vs 10、p90 69 vs 77、p95 150 vs 200）。稳态写入为 0，所以「自己的写入再触发自己」这条自激路径在本 bundle 上**未被触发**（观察器只反复跑发现扫描）。两臂 pid 前后不变（4355 / 4681）。诚实标注：两臂滚动时页面内容密度不同（基线被挤成 44px 宽、每屏字数少），工作量非严格等量，但帧统计同量级且新版不差。

**顺带纠正一处 diff 读法**：`__bwPanelClose` 在**基线 apk 上就已经是 true** ⇒ 该名字不是 `efde4c2` 新加的。

## 5. 六项回归（照 `verify/QA-ROUND-v1.32.15-D1b.md` 那张表）

| # | 判据 | 读数 | 判定 |
|---|---|---|---|
| ① | 卡片底色 + 8×700ms 0 翻转 | **vm1**（`qa-v132-16-reg-vm1.json`，已先 `Collapse sidebar`）：`_block_7gxqk_4 md-code-block _card_7gxqk_107` **233x353** = `rgb(249,250,251)`，inline `rgb(249,250,251)` prio `important`，剥内联后原生同为 `rgb(249,250,251)`，`__dshGlass=0`，`nodeSeq=39` 恒定，注入记录 `{innerBig:0, cbOk:false, isCode:true, isCB:true}`，8 次逐字不变、**全通道 0 翻转**。**笔电**（`qa-v132-16-laptop.json`）：**233x410** = `rgb(249,250,251)`，`__dshGlass=0`，`nodeSeq=20` 恒定，注入记录 `{innerBig:1, cbOk:false, isCode:true, isCB:true}`，盒树复算 `boxCode=true`，**0 翻转** | **PASS** |
| ② | 文档 Review 面板 | `_tabHost_6nhg2_162 _pane_6nhg2_209` = `rgb(255,255,255)`（inline + `important`），8× **flips=0**（见 `qa-v132-16-d3-tabopen.json`、`qa-v132-16-reg-laptop-redline.json`） | **PASS** |
| ③ | A14 命中区（**先 `closepanel`**） | `closepanel`（`qa-v132-16-reg-closepanel.json`）：面板计数 2 → 2 → **1**（只剩 surface）；`a14`（`qa-v132-16-reg-a14.json`）收起态 **14/14 行 `selfHitVis=true`**（`Open sidebar` 40x40、`New session` 36x36、`Plugins` 36x36、`Agent Team`、`Open in File Explorer`、`More ways to open`、`More actions` 全自命中）；展开态入口行 `New session`(216x24)、`Collapse sidebar`(28x28)、`New session`(252x38)、`Plugins`(252x36) 均 `true`，其余 287 行是被浮层/输入条覆盖的行（与 D1b 同形态，非本轮引入）。截图 864814 B / 623947 B alive | **PASS** |
| ④ | v1.32.6 壁纸红线 | **vm1**（`qa-v132-16-reg-vm1-redline.json`）与**笔电**（`qa-v132-16-reg-laptop-redline.json`）：html / body / frame / centerCol / rootBig / sidebar / bodyBig / scrollBody / panelBody / surfaceBig / overlayLayer 全 `rgba(0,0,0,0)`；`#dsh-theme-veil` = `rgba(255,255,255,0.45)` **inline 原值、无 prio**（未被我们改写）；小代码块 `rgba(249,250,251,0.45)`；笔电 `bigPre` `rgb(249,250,251)` inline 空（原生） | **PASS** |
| ⑤ | 入口未读 | 推送后 prefs 里我这张卡 `read":false`（未读）、无 `answered` 字段；入口页截图 `qa-v132-16-push-entry-unread.png`（1109678 B）可见 **「19 条未读」+ 红点**、顶部卡片 `● DSH waiting for choice [qa-v132-16-b1792089964]` 带蓝点与 `已读` 按钮 | **PASS** |
| ⑥ | 推送落库 + 截图链路 | 两条推送都 **HTTP 200**（ntfy id `RxkVEWuIlh4z` / `ziDi2ttLCT4s`，topic `dsh`，标题带 `qa-v132-16-<epoch>`）；9 秒内卡片落库：`callId":"qav13216b1792089964"`、`qid":"q0"`、`nid` / `mid` 由 `PushService.linkRegex` 解析；系统侧 `NotificationRecord pkg=xyz.cpyh.dshpush id=400967440 importance=4` 已贴出；`#ans` 回声后同卡 **`read":true` + `answered":"QA answered by tester"`**（普通作答自动已读路径正常），截图 `qa-v132-16-push-entry-read.png`（1253834 B） | **PASS** |

推送纪律：一律 `qa-` 前缀 + epoch 唯一串（`cid=qav13216b1792089964`，记在 `verify/qa-v132-16-push-cid.txt`），发完用 `#ans` 回声把未读清掉，不给用户真机留悬挂问题。

## 6. 残留与探针坑

- **D10（真机实测、非本轮引入，发版后再做）**：vm1 **展开态**侧栏底色停在 `rgba(249,250,251,0.45) !important`，拿不到笔电那侧的 0.92。根因：`bwPanelBg` 只认 `__bwSbEl`（几何段末态已撤销 ⇒ null）+ 类名锚点 `_2H3hWW_root`（vm1 类名轮换 ⇒ 不命中），两个目标都落空就退回通用 0.45。**两臂都是 0.45**（基线臂也是），与补丁无关。修法方向（lead 已记）：把「找侧栏元素」和「修挤压」解耦。不阻塞 v1.32.16。
- **D9（探针坑，已修）**：`openFirstSession` 里的 `clickAt(330,300)`（点空白收 IME）在 vm1 展开态会**点开 Settings 面板**，第一次收起态测量被污染（证据留作 `qa-v132-16-d2vm1-collapse-contaminated.json` / `.png`）。已加 `dismissSheets()`（Escape×2 + 统计 `[role=dialog]/sheet/mask`）与 `railProbe`（按 `aria-label` 图标定位可见轨道），重跑后干净。
- **prefs 里 JSON 是 HTML 实体**（tester 本轮踩的）：`shared_prefs/dshpush.xml` 把引号存成 `&quot;`，直接按 `"callId":"cid"` 匹配会**假阴性**（我第一次未读检查就报 `CARD_FOUND=False`，其实卡片在）。要么先 `-replace '&quot;','"'`（`verify/qa-readstate.ps1` 就是这么做的），要么按 `callId&quot;:&quot;` 匹配。夜间监督脚本若少了这步，落库判定会误报。
- **扁平记录结构的 JSON 不能用「对象嵌套链」判归属**（lead 本轮踩的）：探针把 frame 与代码块存成**兄弟记录**，按父链往上找 frame 祖先会得到全 `(无 frame 祖先)`，进而误判「这组读数不在这个文件里」。判归属要看**记录所在的段/字段**（`codeblocks` / `d2.blocks` / `samples[k]`），或直接查特征值（如 `4975`、`4933`）落在哪个文件哪一段 —— 本轮 §2.1 的 9px 与 44px 就在同一份文件的两个不同段里。
- 设计使然的现象（登记备查）：同一代码块在展开态 289x296（h < vh×0.5 ⇒ `overHalf=false` ⇒ 0.45）与收起态 233x353（`over=true` ⇒ 原生 `rgb`）档位不同 —— `big` 阈值随布局宽高变化，不是本轮引入。

## 7. 环境事故（非 tester 操作）

本轮开工后 guest 的 **`system_server` 崩过一次**：`pm` 全线报 `cmd: Can't find service: package`、guest `load average 53.57`（`composer3-service.ranchu` / `allocator-service.ranchu` 各占 ~92% CPU）、随后 `adb` 报 `device offline`。恢复后确认 **qemu 进程整机重启**：旧 pid 28264（起于 10/15 17:18:39）→ 新 pid **33284**（起于 **10/16 02:02:27**）。tester 未跑任何重启、未跑 `dsh-app-verify.ps1`。

恢复动作与结果：重跑 GPU 闸门 **VERDICT: PASS**（`-gpu host`、`G:\Android\emu-ladder.gpu = host`、guest `GLES:` = NVIDIA GeForce RTX 4060、`wm size/density` 1440x3168/640）、重新 `adb root`（重启后掉回 `shell`）、apk 与数据都在（`/data/app/...` 原路径、sha 未变）。第一次 D3 尝试因此作废并重跑。

**可疑原因（写进报告，对以后所有 QA 轮都值钱）**：模拟器是 **`-gpu host`**，与本地 **Strata 125B 引擎抢同一块 GPU**；引擎满载时 guest 的图形链路（composer / allocator HAL 已在 92% CPU 空转）被拖慢，可能触发 watchdog 把 `system_server` 拖崩并整机重启。以后 QA 轮要么**先停引擎**，要么把这条当**已知抖动**：装机前先跑 GPU 闸门 + `pm path` 探活，发现 `Can't find service: package` / `device offline` 就等整机回来再重跑，别误判成被测提交的问题。

## 8. 纪律与产物

- 只写 `verify/**`；`android-app/**` 一行未动（缺陷只登记不修）。
- 构建只 `assembleDebug`；**未跑 `dsh-app-verify.ps1`**、**未 `-Deploy`**、**未改版本号**；推送一律 `qa-` 前缀 + epoch。
- `.ps1` / `.sh` 纯 ASCII、LF；ssh / scp 一律 `Start-Process` 重定向 + `WaitForExit(ms)` 硬超时，不经 PowerShell 管道；token 每次现取（笔电 `Fkc7pw…KG8s`、vm1 `NHSt0z…s6w`，均从各自 `web.log` 末条）。
- 本轮产物：`qa-v132-16-build.sh`、`qa-v132-16-chain.ps1`、`qa-v132-16-app-debug.apk`、`qa-v132-16-d2-ab-{baseline,new}.json`、`qa-v132-16-d2vm1.json`、`qa-v132-16-d2vm1-collapse.json`、`qa-v132-16-laptop.json`、`qa-v132-16-d3-{zerotab,tabopen}.json`、`qa-v132-16-perf-{baseline,new}.{txt,json}`、`qa-v132-16-reg-{vm1,vm1-redline,laptop-redline,closepanel,a14}.json`、`qa-v132-16-push-entry-{unread,read}.png`、`qa-v132-16-push-cid.txt`、`qa-v132-16-prefs-dump.xml`，以及同名 `qa-qa-v132-16-*.png` 截图（全部 >100 KB、`alive=true`）。
