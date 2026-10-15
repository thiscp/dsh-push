# QA 定点复测 · v1.32.15 D1（task-5）

- 被测提交：**`4a039ab`**（4 文件 +114/−11，只动 `android-app/**` + `openspec/**`，版本仍 1.32.15/81）
- 判定人：tester（写域仅 `verify/**`）；环境：笔电常驻模拟器 `emulator-5554`（AVD dsh-p16，物理 1440x3168@640，CSS360/dpr4）
- 本轮只做定点：主判据（两宿主）+ `__qaCb` 定案 D1 + 回归四项 + veil + 文档预览面板补测

## 0. 定点结论

| 判据 | 笔电 DSH | vm1 DSH（复现面） |
|---|---|---|
| **主判据：大代码块容器 computed bg = 原生 `rgb(249,250,251)`，8×700ms 0 翻转** | **FAIL** | **PASS** |
| 聊天根/frame/centerCol/scrollBody/panelBody/surface/overlayLayer 仍 transparent | PASS（0 翻转） | PASS（0 翻转） |
| `role=listbox` 菜单 0.96 | PASS | 未测（本轮按 lead 口径只抽查笔电） |
| 小代码块 / 输入卡 0.45 | PASS | PASS（小代码块 4 个全 0.45） |
| `#dsh-theme-veil` 未被注入改写 | PASS | PASS |
| A14 命中区（抽查一次） | PASS（复测干净后） | 未测 |
| **真实文档预览面板不透明（上轮未覆盖）** | **PASS（已可达并实测）** | 未测 |

**一句话**：D1 在 **vm1 上已修好**（卡片吃到 `rgb(249,250,251)`、0 翻转），在**笔电上仍是红项**（卡片停在 `transparent !important`）。同一个 bug 的两个分支，差别只在**首帧高度**——见 §3。

## 1. 构建与安装（全绿）

| 项 | 结果 |
|---|---|
| GPU 闸门 `verify/emu-gpu-verdict.ps1` | **VERDICT: PASS**，`GATE_EXIT=0`；guest `GLES:` = NVIDIA GeForce RTX 4060 Laptop GPU；qemu `-gpu host`；`boot_completed=1`；`wm size/density` 1440x3168/640 |
| 源码闸门（新增硬失败） | vm1 侧 `WebActivity.kt` sha256 = `9cd33fdf…8117b`、`PushService.kt` = `0ee98aab…cc49` ⇒ **HASH_GATE_OK**（不匹配即 exit 3） |
| vm1 构建 | `BUILD SUCCESSFUL in 13s`（Gradle 8.7 / JDK 17.0.20.1），apk **10993652 B**，sha256 **`f39d179a8892df892d457de92256a957df022f5d8a9c18d2d5d60ce12d83320f`** |
| DEX 字面量 | `__qaCb`=1 `__qaN`=1 `__qaSeq`=1 `__qaRec`=1 `isCode`=1 `isCB`=1 `ancBigPos`=1 `isLayout`=1 `isPanel`=1 `innerBig`=1 `1.32.15`=2 |
| 安装 | `adb root`（WHOAMI=root，adbd already running as root）→ `adb install -r` **Success 未清数据**；设备 `versionCode=81 versionName=1.32.15`；设备 `base.apk` sha256 = 同一 `f39d179a…` ⇒ 提交↔vm1↔设备三方对齐 |
| 探针 sha 双闸 | 每次运行前后 `shaBefore/shaAfter` 均为 `f39d179a…`，`pid` 前后一致（无崩溃/无重启） |

新脚本：`verify/qa-d1-build.sh`（远端构建 + 硬哈希闸 + DEX 字面量）、`verify/qa-d1-chain.ps1`（scp src → vm1 构建 → 取 apk，全程 `Start-Process` 重定向 + 硬超时）。产物改名带 `d1`（`qa-d1-app-debug.apk`），未覆盖上一轮基线 `qa-v132-15-app-debug.apk`。

## 2. 主判据原始读数（8×700ms，逐次）

### 2.1 笔电 DSH —— FAIL（`qa-d1-laptop.json`，会话「笔记本弹出 cmd 窗口原因」，vw360/vh671）

卡片 = `_block_7gxqk_4 md-code-block _card_7gxqk_107`，**233x410**（overHalf=true），`position:relative`：

| 采样 | computed bg | inline | prio | `__qaN` | `__qaCb` 长度 | 卡片 `nodeSeq` | 注入记录 `{innerBig,cbOk,isCode,isCB}` |
|---|---|---|---|---|---|---|---|
| S0 | `rgba(0, 0, 0, 0)` | `transparent` | important | 48 | 22 | **20** | `{1, true, false, false}` |
| S1–S7 | 同上（逐字不变） | 同上 | 同上 | 48 | 22 | **20** | `{1, true, false, false}` |

- 原生底色（S0 剥内联实测）= **`rgb(249, 250, 251)`**，还原校验通过（非 `RESTORE_FAIL`）。
- 卡片内 PRE `_plain_7gxqk_103` 233x368 = `rgb(249,250,251)`（PRE 不在注入选择器列表内，从未被写）⇒ 只有 ~42px 头部条 + 内边距透出壁纸。
- 8 次 `flips=0`、`injOpaqueFlips=0`、`nodeSwapFlips=0` ⇒ **稳定停在错值**，不是抖动。
- 同一红项在本轮 6 次独立运行里全部复现：`qa-d1-laptop` / `qa-d1-laptop-doc` / `qa-d1-laptop-menu` / `qa-d1-laptop-menu2` / `qa-d1-laptop-a14` / `qa-d1-laptop-a14b`。

### 2.2 vm1 DSH —— PASS（`qa-d1-vm1c.json`，会话「我本地 Ubuntu 每次启动都是自动」，收起侧栏）

| 采样 | computed bg | inline | prio | `__qaN` | `__qaCb` 长度 | 卡片 `nodeSeq` | 注入记录 `{innerBig,cbOk,isCode,isCB}` |
|---|---|---|---|---|---|---|---|
| S0 | `rgb(249, 250, 251)` | `rgb(249, 250, 251)` | important | 41 | 29 | **23** | `{0, true, false, true}` |
| S1–S7 | 同上（逐字不变） | 同上 | 同上 | 41 | 29 | **23** | `{0, true, false, true}` |

- 卡片 233x353（overHalf=true），原生底色同为 `rgb(249,250,251)` ⇒ **写进去的就是它自己的原生色相**，8 次 0 翻转。
- 记录指纹正是 developer 提醒的「**`cbOk:true` 而 `isCB:true`**」形态（此处 isCB 由 `__cbOk===1` 得到，`isCode:false`）⇒ 迟滞路径走通。
- 附带发现（同一次会话，展开侧栏时）：`qa-d1-vm1b.json` 里 7 个代码块全被压成 **9px 宽**（`9x4975` 等）⇒ 走 0.45 分支、`overHalf=false`。这就是 D2（vm1 窄屏补丁空转、侧栏挤压正文）的又一实测证据；收起侧栏后才恢复 233px。

## 3. D1 定案（用 `__qaCb` / `__qaN` / `nodeSeq` 读数写死）

**结论：既不是「候选从未进」，也不是「换节点丢标记」——是 `isLayout` 的自锁条件把首轮兜底写的 `transparent` 变成了永久锁。**

证据链（全部来自本轮真机读数）：

1. **候选进了、两轮复核也过了**：笔电卡片记录 `cbOk:true`（`cbOk` 只会在 2×rAF 复核 `_cbn(t2)<=2` 通过后被回填），`innerBig=1`（≤2 合格）。⇒ 排除「候选从未进」。
2. **稳定态没有换节点**：8 次采样里 `window.__qaN` 恒为 48（vm1 恒 41）、`__qaCb` 长度恒为 22（vm1 恒 29）、卡片 `nodeSeq` 恒为 20（vm1 恒 23）。developer 造的「换节点必换号」在**已落定的会话视图**里没有触发 ⇒ 排除「换节点丢标记」（该机制只在流式/回收期可能存在，本轮无证据）。
3. **`isCB:false` 是「被推入候选那一轮」的快照，之后再没被覆盖**：说明后续每一轮它**根本没再进入 isCB 求值分支**（`if(big&&!isLayout&&!isPanel&&!isSb&&id!=='dsh-theme-veil')`）。实测该元素 `position:relative`、`inline='transparent'`、`isCode=false`、`ancBigPos=false`（若 true 就会走 isPanel 拿不透明白，实测没有）⇒ **`isLayout=true`** ⇒ 被 isLayout 吞掉，而 isLayout 分支是**单向写 transparent** ⇒ 永不脱出。
4. **锁是怎么上的**：首轮该元素 `a0=1`（原生不透明）⇒ 幂等闸门 `!isOv&&!(big&&isPanel)&&!isCB&&!isLayout&&a0<1` 的 `a0<1` 不成立 ⇒ 不 continue ⇒ 落到大容器兜底分支 `w>vw*0.5&&h>vh*0.5` ⇒ **当轮写 transparent**。此后 `inline==='transparent'` 恰好是 isLayout 的**进入条件**之一 ⇒ 条件与写入结果互为因果 = 自锁。
5. **设计留的唯一出口 `isCode` 在真机上不成立**：卡片直接子节点实测为 `DIV|_bannerWrap_7gxqk_|233x42` + `DIV|_content_7gxqk_74|**0x0**`，PRE 在 `_content_` 里（**孙节点**）。那个 0x0 矩形说明 `_content_` 是 **`display:contents`** 包裹层（Blink 对 display:contents 返回空矩形）⇒ 盒树上 PRE 像直接子节点、DOM 上不是 ⇒ `e.children` 判据必然 false。developer 提交说明里「真机 `_block_7gxqk_4` 的直接子节点就是 pre（331x524 里套 320x500）」与本轮实测（233x410 里套 233x368，中间隔一层 display:contents）不符，**应是另一套 bundle/另一处代码块**。
6. **为什么 vm1 逃过**：vm1 上这张卡片**首轮被看到时只有 ~220px 高**（未过 `vh*0.5=335.5`）⇒ 走的是 0.45 分支，内联值是 `rgba(249,250,251,0.45)` 而**不是** `transparent` ⇒ isLayout 闸门关着 ⇒ 长高后正常进入 isCB ⇒ 候选 → 复核 → `__cbOk=1` → `isCB=true` → 剥内联取原生 → 写 `rgb(249,250,251)`。**首帧高度决定命运**，这也解释了 D1 在真机上「有时好有时坏」。

**修法方向（tester 不改代码，只给方向，lead 裁）**：
- 首选：让 isCB 的求值不被 isLayout 挡掉（或给 isLayout 的进入条件加「这个 transparent 不是我们自己写的」），拆掉 §3-4 的自锁环；
- 次选：让 isCode 在判直接子节点时跳过 `display:contents` 的中间层（`getComputedStyle(child).display==='contents'` 时递归一层）——能治本例，但依赖盒模型细节，不如前者稳。

## 4. 回归四项 + veil（本轮实测）

| 项 | 读数 | 判定 |
|---|---|---|
| 聊天根 / frame / centerCol / scrollBody / panelBody / surface / overlayLayer | 两宿主全部 `rgba(0,0,0,0)`（多数 inline `transparent !important`），8× 全 0 翻转 | PASS |
| `role=listbox` 菜单 | `Z9Jnlq_viewport` 257x392 = `rgba(255,255,255,0.96) !important`，27 项，`Z9Jnlq_item` 选项保持原生 transparent，8× 0 翻转（`qa-d1-laptop-menu2.json`） | PASS |
| 小代码块 / 输入卡 0.45 | 笔电 233x182 = `rgba(249,250,251,0.45) !important` 0 翻转；vm1 4 个 233x182/220/258 全 0.45 | PASS |
| `#dsh-theme-veil` | `rgba(255,255,255,0.45)`，inline 未被注入改写，8× 0 翻转（两宿主） | PASS |
| A14 命中区（抽查） | 收起态轨道：`Open sidebar` 40x40、`New session` 36x36、`Plugins` 36x36 **全部盒子中心自命中**；展开态：`Collapse sidebar` 28x28、`New Session` 252x38、`Plugins` 252x36、brand 216x24 全部自命中。非自命中只剩两类无害：① 滚出视口的聊天行（`owner=OFFSCREEN`）② 展开遮罩下的头部控件 + 按钮中心落在自身 `svg` 子节点上（探针按「元素本身」比对，属探针精度，非命中区问题） | PASS |
| 展开态侧栏 0.92（笔电） | `sidebarRoot` = `rgba(249,250,251,0.92)`，0 翻转 | PASS（vm1 仍 0.45，见 D2） |

⚠ A14 说明：本轮第一次跑 `a14`（`qa-d1-laptop-a14.json`）时收起态轨道三个按钮读到 `selfHitBox=false`，owner 是 `_tab_6nhg2_134 _tabActive_6nhg2_346` / `_0SbxAa_status` / `_0SbxAa_root`——即**我上一环节打开的 Review 面板（360x671 不透白）盖住了整个视口**，属我自己留下的 UI 状态，不是玻璃回归。已新增 `closepanel` 模式（Escape + 点 `_tabClose_6nhg2_417`）关掉面板（`qa-d1-laptop-closepanel.json`：面板从 2 个元素降到 1 个，只剩 transparent 的 `_surface_`），复测 `qa-d1-laptop-a14b.json` 得到上表的干净结果。

## 5. 补测：真实文档预览面板（上轮未覆盖项）—— **可达，PASS**

- 稳定路径（照 lead 给的）：进会话 → 聊天流里点产物行 `kuvljq_row`（`aria="View changes to E:/work/work_dsh/dsh-push/verify/HANDOVER.md"`，`+2-1`，232x44）→ 打开 **Review · turn 2** tab。
- 面板容器实测：`_tabHost_6nhg2_162 _pane_6nhg2_209`（SECTION，**360x671**，`position:static`）= **`rgb(255, 255, 255)`**，inline `rgb(255,255,255) !important`，alpha=1，**8×700ms 0 翻转**；外层 `_surface_6nhg2_125` 保持 `transparent !important`（壁纸仍从面板外缘透出）。⇒ **v1.32.12 红线转绿**。
- 顺带修正 D3 的表述：真 tab 出现后，`_emptyTabHost_6nhg2_143` 不再出现在普查里（它只在「一个 tab 都没开」时存在）。所以 D3 的准确说法是：**无 tab 时那个隐藏的 emptyTabHost 会被写不透明白**，一旦开出真 tab 就由真 `_tabHost_`（本就该不透白）接管 ⇒ 风险等级维持 P3。
- 证据：`qa-d1-laptop-doc.json` + `qa-d1-laptop-doc-docpanel.png`（222916 B，alive=true）。

## 6. 缺陷清单（本轮，未修）

| 编号 | 严重度 | 内容 | 归属 |
|---|---|---|---|
| **D1'** | **P1（仍在）** | 笔电宿主上大代码块容器停在 `transparent !important`（原生 `rgb(249,250,251)`）。根因不是 developer 这轮假设的「换节点丢标记」，而是 **isLayout 自锁 + isCode 因 `display:contents` 中间层失效**（§3）。vm1 侧因首帧高度不同而恰好走通 ⇒ 同一 bug 两副面孔。建议按 §3 修法方向再来一轮定点，我这边 `__qaCb` + 自算 flag 可直接验收。 | `android-app/**`（developer） |
| **D2** | P2（不变，新增证据） | vm1 命名 `hHd-Xa_/wSkVaW_/pI_x6G_` 下窄屏补丁整体空转：本轮实测展开侧栏时**代码块被压到 9px 宽**（`9x4975`），收起后恢复 233px；侧栏仍 0.45（笔电 0.92）。 | 既有（v1.32.16 议题） |
| **D3** | P3（表述修正） | 见 §5 末：无 tab 时 hidden 的 emptyTabHost 被写不透白；有 tab 时由真 tabHost 接管。 | 既有 |
| **D6** | P3（新，探针） | `menu` 模式在**已开会话**的视图里读不到 composer（`focus=NO_TEXTAREA`、`ta=NO_TA`、`count=0`），菜单只在空会话/欢迎态里能量到（`menu2` 成功）。本轮已用空态补测到 0.96；下轮若要测「会话内菜单」需换 composer 选择器。 | `verify/**`（我） |
| **D7** | P3（新，探针） | `a14` 模式不关已开的 Review 面板 ⇒ 收起态命中区会被面板盖住误读 false。已加 `closepanel` 模式修掉流程，未改 a14 本体。 | `verify/**`（我） |

## 7. 证据文件（`verify/`，`qa-d1-` 前缀）

- 构建链：`qa-d1-build.sh`、`qa-d1-chain.ps1`、`qa-d1-app-debug.apk`（10993652 B / `f39d179a…`）
- 主判据：`qa-d1-laptop.json`（FAIL）+ `qa-d1-laptop-sample.png`；`qa-d1-vm1c.json`（PASS）+ `qa-d1-vm1c-sample.png`；`qa-d1-vm1.json`、`qa-d1-vm1b.json`（9px 挤压证据）
- 回归：`qa-d1-laptop-menu2.json`（0.96）、`qa-d1-laptop-menu.json`（会话内菜单读不到，D6）、`qa-d1-laptop-a14b.json`（干净 A14）+ 两张 a14 截图、`qa-d1-laptop-a14.json`（被面板遮挡的首轮）
- 文档面板：`qa-d1-laptop-doc.json` + `-docpanel.png`；`qa-d1-laptop-closepanel.json` + `-closed.png`
- 探针：`qa-v132-15-probe.mjs` 新增 `CBSTATE`（读 `__qaCb`/`__qaN`/`__qaSeq`/`__qaRec` + 自算 isCode/innerBig/原生色）与 `closepanel` 模式；`sample` 现在把卡片与卡片内 PRE 作为 `codeCard`/`codeCardPre` 纳入 8× 翻转分析

复现：`node verify/qa-v132-15-probe.mjs sample "<url with token>" <out.json> f39d179a8892df892d457de92256a957df022f5d8a9c18d2d5d60ce12d83320f <tag> session <rowIndex>`
（vm1 需先收起侧栏，探针现在会在开完会话后自动点 `Collapse sidebar`；token 每次 DSH 重启必换。）

## 8. 纪律自查

写域只有 `verify/**`（`android-app/**` 一行未动）；本轮纯渲染验证，**未发推送**（如需发一律 `qa-` 前缀 + epoch 唯一串）；**未跑 `-Deploy`**；装机前查了 GPU 闸门（PASS/exit0）与 `adb root`；`.ps1`/`.sh` 纯 ASCII、LF；文本走 read/write/edit；未 spawn 队友。
