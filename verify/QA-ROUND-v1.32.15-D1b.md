# QA 定点复测 · v1.32.15 D1 第二轮（task-7 · commit `5016373`）

- 被测提交：**`5016373`**（4 文件 +225/−55，只动 `android-app/**` + `openspec/**`，版本仍 1.32.15/81）
- 判定人：tester（写域仅 `verify/**`）；环境：笔电常驻模拟器 `emulator-5554`（AVD dsh-p16，物理 1440x3168@640，CSS360/dpr4）
- 本轮只跑 `sample`（+ 补测用的 `docpanel` / `menu` / `closepanel` / `a14`），未重跑全轮

## 0. 定点结论：**全绿**

| 判据 | 笔电 DSH | vm1 DSH（复现面） |
|---|---|---|
| **主判据：卡片 `_block_7gxqk_4 md-code-block` = 原生 `rgb(249,250,251)`、inline 非 transparent、8×700ms 0 翻转** | **PASS** | **PASS** |
| 聊天根 / frame / centerCol / scrollBody / panelBody / surface / overlayLayer transparent | PASS（0 翻转） | PASS（0 翻转） |
| `role=listbox` 菜单 0.96（选项保持原生） | PASS | — |
| 小代码块 / 输入卡 0.45 | PASS | PASS |
| `#dsh-theme-veil` 未被注入改写 | PASS | PASS |
| 文档 Review 面板 `_tabHost_6nhg2_162 _pane_6nhg2_209` = `rgb(255,255,255)`（抽查） | PASS | — |
| A14 命中区（先 closepanel 再测，抽查） | PASS | — |
| **v1.32.6 红线复核（C 保留了兜底打标记）** | PASS | PASS |

**D1 关闭。** 两宿主卡片都拿到自己的原生色相 `rgb(249,250,251)`，8 次采样逐字不变、0 翻转；笔电侧连续 4 次独立运行（sample / docpanel / menu / a14）复现同一个正确值，没有任何一次回落到 transparent。

## 1. 构建与安装（全绿）

| 项 | 结果 |
|---|---|
| GPU 闸门 | **VERDICT: PASS**，`GATE_EXIT=0`；guest `GLES:` = NVIDIA GeForce RTX 4060 Laptop GPU；qemu `-gpu host`；`boot_completed=1`；`wm size/density` 1440x3168/640 |
| 源码硬哈希闸（不匹配 exit 3） | vm1 侧 `WebActivity.kt` = `3338ba82…c54fc8573`、`PushService.kt` = `0ee98aab…cc49` ⇒ **HASH_GATE_OK** |
| vm1 构建 | `BUILD SUCCESSFUL in 9s`，apk **10993764 B**，sha256 **`b73ba70a1bc5c41e34a7814e35f2627a3e2caa437ff6cd40c1eaac9e5d074999`** |
| DEX 字面量 | `__dshGlass`=1 `__qaCb`=1 `__qaN`=1 `__qaSeq`=1 `__qaRec`=1 `isCode`=1 `isCB`=1 `innerBig`=1 `1.32.15`=2 |
| 安装 | `adb root`（WHOAMI=root）→ `adb install -r` **Success 未清数据**；设备 `versionCode=81 versionName=1.32.15`；设备 `base.apk` sha256 = 同一 `b73ba70a…` ⇒ 提交↔vm1↔设备三方对齐 |
| 探针双闸 | 5 次运行前后 `shaBefore/shaAfter` 均为 `b73ba70a…`，`pid` 前后一致（无崩溃/无重启） |

脚本：`verify/qa-d1b-build.sh`（远端构建 + 硬哈希闸 + DEX 字面量）、`verify/qa-d1b-chain.ps1`（scp src → vm1 assembleDebug → 取 apk，全程 `Start-Process` 重定向 + 硬超时）。产物 `qa-d1b-app-debug.apk`，**未覆盖** `qa-d1-app-debug.apk`（4a039ab 基线）与 `qa-v132-15-app-debug.apk`（db385d5 基线）。

## 2. 主判据原始读数（8×700ms 逐次，两宿主）

### 2.1 笔电 DSH（`qa-d1b-laptop.json`，会话「笔记本弹出 cmd 窗口原因」，vw360/vh671）

卡片 `_block_7gxqk_4 md-code-block _card_7gxqk_107`，**233x410**，`position:relative`：

| 采样 | computed bg | inline | prio | `__qaN` | `__qaCb` 长度 | `nodeSeq` | `__dshGlass` | 注入记录 `{innerBig,cbOk,isCode,isCB}` | 探针复算 `boxCode` / 裸 DOM `myIsCode` |
|---|---|---|---|---|---|---|---|---|---|
| S0 | `rgb(249, 250, 251)` | `rgb(249, 250, 251)` | important | 48 | 22 | 15 | **0** | `{1, false, true, true}` | **true / false** |
| S1–S7 | 逐字不变 | 逐字不变 | important | 48 | 22 | 15 | 0 | `{1, false, true, true}` | true / false |

- 原生底色（S0 剥内联实测）= `rgb(249, 250, 251)`，还原校验通过 ⇒ **写进去的就是它自己的原生色相**。
- `flips=0`、`injOpaqueFlips=0`、`nodeSwapFlips=0`；卡片内 PRE `_plain_7gxqk_103` 233x368 仍 `rgb(249,250,251)`（PRE 不在注入选择器列表内）。
- 卡片现在**每轮都在** `__qaCb` 里（修前只在候选那一轮出现一次）⇒ 与 developer 描述一致。

### 2.2 vm1 DSH（`qa-d1b-vm1.json`，会话「我本地 Ubuntu 每次启动都是自动」，已先点 `Collapse sidebar`（`hHd-Xa_toggle`，found=true））

| 采样 | computed bg | inline | prio | `__qaN` | `__qaCb` 长度 | `nodeSeq` | `__dshGlass` | 注入记录 `{innerBig,cbOk,isCode,isCB}` | 探针复算 `boxCode` / `myIsCode` |
|---|---|---|---|---|---|---|---|---|---|
| S0 | `rgb(249, 250, 251)` | `rgb(249, 250, 251)` | important | 41 | 29 | 23 | **0** | `{0, false, true, true}` | **true / false** |
| S1–S7 | 逐字不变 | 逐字不变 | important | 41 | 29 | 23 | 0 | `{0, false, true, true}` | true / false |

- 卡片 233x353（overHalf=true），原生同为 `rgb(249,250,251)`，8 次 0 翻转。
- 未收侧栏时（上一轮 `qa-d1-vm1b.json`）代码块被压成 9px 宽 ⇒ 本轮按 lead 要求先收起，读数才算数。

### 2.3 归因确认（lead 要的「A 才是解」）

探针自带两套 isCode 复算，同一元素上同时给出：
- **裸 DOM 直接子节点判据（修前那版）`myIsCode=false`** —— 卡片直接子节点仍是 `DIV|_bannerWrap_7gxqk_|233x42` + `DIV|_content_7gxqk_74|0x0`；
- **盒树判据（本轮新实现）`boxCode=true`** —— 下钻 `display:contents` 的 `_content_` 后第一层就撞到 PRE。

⇒ **两宿主的修复都由 A（isCode 按渲染盒树）兑现**，与 developer 四变体对照（只修 V1 就修好、只修 V4 仍 transparent）完全一致；C 单独不构成解。探针也遵守了「不用 0x0 矩形反推」：`boxCode` 只读 `getComputedStyle(child).display==='contents'`。

## 3. `__qaCb` + `__dshGlass` 读数（原样）

**卡片指纹（两宿主 8 次全同）**：`{cls:'_block_7gxqk_4 md-code-block _card_7gxqk_107', innerBig:1(笔电)/0(vm1), cbOk:false, nodeSeq:15(笔电)/23(vm1), isCode:true, isCB:true}` ⇒ 正是 developer 预告的 **`isCode:true / isCB:true / cbOk:false`**（isCode 免两轮迟滞，所以 `cbOk` 永远是 false，不是异常）。

**`__dshGlass` 实测**：

| 元素 | 笔电 | vm1 | 说明 |
|---|---|---|---|
| 卡片（内容块，写不透明） | **0** | **0** | 按代码 isCB / isPanel / 浮层 / 0.45 分支**置 0** ⇒ 卡片 0 是**设计值**，不是没被注入拥有过（lead 让确认的「===1」在这条分支上应为 0；见下） |
| `scrollBody` | 1（inline `transparent !important`） | 1（同） | 写 transparent 的分支置 1 ✓ |
| `panelBody` | 1 | 1 | 同上 |
| `surface` | 1 | 1 | 同上 |
| `overlayLayer` | 1 | 1 | 同上 |
| 文档 Review 面板 `_tabHost_6nhg2_162 _pane_6nhg2_209` | **0**（inline `rgb(255,255,255) !important`） | — | isPanel 写不透明 ⇒ 置 0 ⇒ 面板不会被 isLayout 永久锁住，符合 C 的意图 |
| `frame` / `chatRoot` / `centerCol` | **null**（inline 空） | **null**（inline 空） | 见 §5：它们原生就是 transparent，幂等闸门 `a0<1` 直接 continue ⇒ 注入**从没写过它们** ⇒ 无标记。可见结果与红线一致。 |

⇒ 标记语义与代码注释一致：**「上一次写的是不是 transparent」**。isLayout 的进入条件已不再读页面可见的 inline（纪律 10 复位）。

## 4. 六项回归

| # | 项 | 读数 | 判定 |
|---|---|---|---|
| 1 | 聊天根 / frame / centerCol / scrollBody / panelBody / surface / overlayLayer | 两宿主全部 `rgba(0,0,0,0)`，8× 全 0 翻转；截图肉眼确认壁纸立绘完整（笔电与 vm1 都透过聊天区看到立绘/天空） | PASS |
| 2 | `role=listbox` 菜单 | `Z9Jnlq_viewport` 257x392 = `rgba(255,255,255,0.96) !important`，27 项；`Z9Jnlq_item` 选项 inline 全空、active 项 `rgba(38,49,72,0.06)`、其余 transparent ⇒ 未被压平；`menu.flips=0` | PASS |
| 3 | 小代码块 / 输入卡 0.45 | 小代码块 233x182 = `rgba(249,250,251,0.45) !important` 0 翻转；vm1 另有 4 个 0.45；两宿主截图里输入卡均为半透明白卡（立绘透出） | PASS |
| 4 | `#dsh-theme-veil` | `rgba(255,255,255,0.45)`，inline 未被注入改写，两宿主 0 翻转 | PASS |
| 5 | 文档 Review 面板（抽查） | 点产物行 `kuvljq_row`（HANDOVER.md +2-1）→ `_tabHost_6nhg2_162 _pane_6nhg2_209` 360x671 = `rgb(255,255,255)` / inline `!important`，8× 0 翻转；外层 `_surface_` 仍 transparent | PASS |
| 6 | A14 命中区（先 closepanel 再测） | 收起态轨道 `Open sidebar` 40x40、`New session` 36x36、`Plugins` 36x36 **全部盒子中心自命中**；展开态 `Collapse sidebar` 28x28、`New Session` 252x38、`Plugins` 252x36、brand 216x24 全自命中。非自命中（排除滚出视口的 `OFFSCREEN`）只剩：按钮中心落在自身 `svg` / 徽标 `SPAN` 子节点（探针按元素本身比对，属探针精度）、展开遮罩下的头部控件（设计如此） | PASS |

## 5. v1.32.6 红线复核（C1 变体会破的那条）

两宿主各确认：**`frame` / `centerCol` / 聊天根 / `tabHost`（真 tab 未开时为 hidden 的 `_emptyTabHost_` 除外）全部 `rgba(0,0,0,0)`、8× 0 翻转**，截图肉眼确认壁纸未被不透明白盖住。⇒ 兜底分支保留打标记是对的，红线没被放回。

**新观察（不是缺陷，登记事实）**：本轮 `frame` / `chatRoot` / `centerCol` 的 `__dshGlass=null` 且 **inline 为空**——它们原生就是 transparent，幂等闸门 `!isOv&&!(big&&isPanel)&&!isCB&&!isLayout&&a0<1` 里 `a0<1` 成立 ⇒ 直接 `continue`，注入**根本没写过它们**（上一版里它们偶尔被写成 `transparent !important`，取决于注入首跑与页面 CSS 生效的先后）。可见结果一致、且「没写过」比「写过 transparent」更安全（标记不会被误当成布局链证据）。登记备查，无需改。

## 6. 缺陷与观察清单

| 编号 | 严重度 | 内容 | 状态 |
|---|---|---|---|
| **D1** | P1 | 聊天大代码块容器停在 transparent | **已关闭**（本轮两宿主 PASS，4 次独立运行复现正确值） |
| **D2** | P2 | vm1 命名（`hHd-Xa_/wSkVaW_/pI_x6G_/EvIC1a_`）下 v1.32.5 窄屏补丁整体空转：展开侧栏挤压正文（代码块 9px 宽）、侧栏 0.45（笔电 0.92）。本轮再次实测（`qa-d1b-vm1.json` 收起后 233px；上一轮 `qa-d1-vm1b.json` 展开时 9px） | 仍在，v1.32.16 议题 |
| **D3** | P3 | 无 tab 时 hidden 的 `_emptyTabHost_6nhg2_143` 被写 `rgb(255,255,255) !important`（本轮两宿主仍在普查里，`visibility:hidden` ⇒ 无视觉影响）；开真 tab 后由真 `_tabHost_`（本就该不透白、`__dshGlass=0`）接管 | 仍在，P3 |
| **D6** | P3 | 探针 `menu` 模式在已开会话视图里读不到 composer（`NO_TA`），只在空态能量到；且残留的 `/` 草稿会持久化在会话 composer 里（本轮笔电截图可见 `//`）。属探针副作用，非 App 缺陷 | 我的，下轮换 composer 选择器 |
| **D8** | P3（新，探针） | `a14` 模式仍不自动关面板，靠我先跑 `closepanel`（已按 lead 口径执行）。建议下轮把 closepanel 并进 a14 前置 | 我的 |

## 7. 证据文件（`verify/`）

- 构建链：`qa-d1b-build.sh`、`qa-d1b-chain.ps1`、`qa-d1b-app-debug.apk`（10993764 B / `b73ba70a…`）
- 主判据：`qa-d1b-laptop.json` + `qa-qa-d1b-laptop-sample.png`（838331 B，alive=true）；`qa-d1b-vm1.json` + `qa-qa-d1b-vm1-sample.png`（947794 B，alive=true）
- 回归：`qa-d1b-laptop-menu.json` + `-menu-menu.png`；`qa-d1b-laptop-doc.json` + `-doc-docpanel.png`；`qa-d1b-laptop-closepanel.json` + `-closed.png`；`qa-d1b-laptop-a14.json` + `-a14-collapsed.png` / `-a14-expanded.png`
- 探针改动：`CBSTATE` 现在额外读 `e.__dshGlass`、自带**盒树 isCode 复算**（`boxCode`，只认 `display:contents`、不用 0x0 反推），并新增 `chan` 快照（frame/chatRoot/centerCol/scrollBody/panelBody/surface/tabHost/overlayLayer 的 bg + inline + `glass` + `boxCode`）

复现：`node verify/qa-v132-15-probe.mjs sample "<url with token>" <out.json> b73ba70a1bc5c41e34a7814e35f2627a3e2caa437ff6cd40c1eaac9e5d074999 <tag> session <rowIndex>`（vm1 会自动点 `Collapse sidebar`；token 每次 DSH 重启必换）

## 8. 纪律自查

写域只有 `verify/**`（`android-app/**` 一行未动）；本轮纯渲染验证，**未发推送**（如需发一律 `qa-` 前缀 + epoch 唯一串）；**未跑 `-Deploy`**；装机前查了 GPU 闸门（PASS / exit 0）与 `adb root`；`.ps1`/`.sh` 纯 ASCII、LF；文本走 read/write/edit；未 spawn 队友。
