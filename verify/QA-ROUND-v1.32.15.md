# QA 轮报告 · dsh-push v1.32.15（task-2 改动验证轮）

- 被测提交：`674363c`（isAnchor→isLayout 结构判据 + 单向写 + isCB 两轮迟滞）、`db385d5`（isCode 内容叶子 + isCB/pm 死锁修正 + apply() O(N²) 自激修正）
- HEAD `db385d5`，工作树干净；`WebActivity.kt` sha256 `6de9f9ac…e87905`（git hash-object `6352f06a`）
- 判定人：tester（写域仅 `verify/**`）；判定环境：笔电常驻模拟器 `emulator-5554`（AVD dsh-p16，物理 1440x3168@640，CSS360/dpr4）
- 判据口径：**真机 + CDP computed style 实测**；合成 DOM 一律不计入判定

## 0. 三个必答

| 问题 | 答复 |
|---|---|
| **VM 侧是否 0 翻转** | **是。** vm1 DSH（`<tailnet-vm1>:3080`，复现面）两轮独立采样：`vm1-core`（收起态侧栏，15 目标）与 `vm1-session`（展开态侧栏，14 目标），各 8 次 × 700ms，**全部 0 翻转**；`nodeSwapFlips` / `injOpaqueFlips` 同为 0。截图 `qa-v132-15-vm1-core-sample.png` 肉眼确认壁纸立绘完整（无 v1.32.6「壁纸整层消失」）。 |
| **红线是否全绿** | **否。** 6 绿 / 1 红 / 1 未覆盖，另有 1 项仅在 vm1 侧失效（锚点腐烂，非本轮引入）。红项见 §4 第 3 条与 §6 D1。 |
| **apply() 是否已批处理** | **是。** vm1 真机挂钩计数（`Page.addScriptToEvaluateOnNewDocument` 劫持 `setProperty`）：reload 后 10s 内 apply() 共 **5 轮**（t=2807/2884/3614/4321/6822ms），`background-color` 写操作共 **75 次**（≈15 次/轮），候选元素 **7 个**、大元素 15 个；t=6s→10s 计数**零增长**（已静置）。若仍是 O(N²)，7 候选就该 ≥49 轮。 |

## 1. 构建与安装链路（全绿）

| 项 | 结果 |
|---|---|
| GPU 权威闸门 `verify/emu-gpu-verdict.ps1` | **VERDICT: PASS**，exit 0；guest `dumpsys SurfaceFlinger` 的 `GLES:` 行 = NVIDIA GeForce RTX 4060 Laptop GPU；qemu `-gpu host`；`boot_completed=1` + `adb shell echo ok` |
| 源码三方对齐 | 笔电 HEAD 与 vm1 scp 后 sha256 逐字节一致（`qa-v132-15-build.sh` 前置闸门） |
| vm1 构建 | `BUILD SUCCESSFUL in 48s`（Gradle 8.7 / JDK 17.0.20.1），apk **10993508 B**，sha256 **`597ff2672ebe9fe88c2930dfa48eecf9fc46ecc628e35cc4624bc462e8e57827`** |
| DEX 字面量 | `ancBigPos`=1 `__cbOk`=1 `isLayout`=1 `isCode`=1 `isPanel`=1 `innerBig`=1 `Dc7zOa_root`=1 `BynINW_`=2 `1.32.15`=2 |
| 安装 | `adb root`（WHOAMI=root）→ `adb install -r` = Success，**未清数据**；设备侧 `versionCode=81 versionName=1.32.15`（原 80/1.32.14 DEBUGGABLE）；设备 `base.apk` sha256 = 同一 `597ff267…` ⇒ 提交↔vm1↔设备三方对齐 |
| CDP 套接字 | `webview_devtools_remote_<pid>` 存在（debug 包），10 次运行全部连上；每次运行前后 `pidof` 一致（无崩溃/无重启） |

## 2. 核心判据：时间维度稳定性（8×700ms，0 翻转）

每轮 8 次采样，逐目标记录 computed backgroundColor + inline + priority + 节点身份（`__qaId`）。**共 10 轮 × 8 次 = 80 次采样，0 翻转。**

| 轮次 | 宿主 | 状态 | 目标数 | 翻转 | 证据 |
|---|---|---|---|---|---|
| discover | 笔电 | 欢迎页（收起） | 锚点普查 | — | `qa-v132-15-laptop-discover.json/.png` |
| discover | vm1 | 欢迎页（收起） | 锚点普查 | — | `qa-v132-15-vm1-discover.json/.png` |
| sample | 笔电 | 会话（旧命名） | 12 | **0** | `qa-v132-15-laptop-session.json` |
| sample | 笔电 | 新建会话/空 tab | 15 | **0** | `qa-v132-15-laptop-session2.json/.png` |
| sample | **vm1** | 展开态侧栏 | 14 | **0** | `qa-v132-15-vm1-session.json/.png` |
| sample | **vm1** | 收起态（核心） | 15 | **0** | `qa-v132-15-vm1-core.json/.png` |
| sample | 笔电 | 真实聊天（含代码块） | 19 | **0** | `qa-v132-15-laptop-chat2.json` |
| sample | 笔电 | 真实聊天（收起侧栏） | 18 | **0** | `qa-v132-15-laptop-chat3.json/.png` |
| sample | 笔电 | 聊天 + 斜杠菜单 | 19 | **0** | `qa-v132-15-laptop-menu.json/.png` |
| sample | 笔电 | A14 展开态 | 18 | **0** | `qa-v132-15-laptop-a14.json` |
| sample | 笔电 | 聊天（innerBig 取证） | 18 | **0** | `qa-v132-15-laptop-chat4.json/.png` |

原始 8× 序列在每个 JSON 的 `samples[]` / `analysis[].series` 里，未做任何裁剪。

## 3. 壁纸通道与 veil（v1.32.6 / v1.32.10 红线）

两宿主实测（vw=360 vh=671 dpr=4）：

| 元素 | 笔电（旧命名） | vm1（新命名） | 判定 |
|---|---|---|---|
| html / body | `rgba(0,0,0,0)` inline `transparent !important` | 同 | PASS |
| 应用框 `*_frame` | `BynINW_frame` relative → transparent !important | `pI_x6G_frame` → transparent !important | PASS |
| 浮层容器 `*_overlayLayer` | absolute → transparent !important | 同 | PASS |
| 聊天根 `*_root` | `Dc7zOa_root` → transparent !important | `wSkVaW_root` → transparent !important | PASS |
| 聊天 body / scrollBody | transparent !important | transparent !important | PASS |
| 中列 `*_centerCol` | `rgba(0,0,0,0)` inline 空（原生即无底） | 同 | PASS |
| 面板 `*_panelBody` / `*_surface_` | transparent !important（原生无底） | 同 | PASS |
| `#dsh-theme-veil` | `rgba(255,255,255,0.45)`，inline 未被注入触碰，8 次 0 翻转 | 同 | PASS |

## 4. 红线逐项

| # | 红线 | 结果 | 实测值 |
|---|---|---|---|
| 1 | 文档预览面板不透明（v1.32.12） | **未覆盖** | 本轮可达视图里没有出现真实文档面板：可点到的只有 `_surface_6nhg2_125`（"Empty pane"，`transparent !important`）。唯一被写不透明的面板类元素是 `_emptyTabHost_6nhg2_143`（360x671，`rgb(255,255,255) !important`），但它 `visibility:hidden`（祖先链 `vis=hidden`、`elementFromPoint` 返回 null）⇒ 不参与渲染，不能替代真面板。见 §7。 |
| 2 | 壁纸通道 transparent（v1.32.6） | **PASS** | §3，两宿主 0 翻转，截图肉眼确认立绘完整 |
| 3 | 聊天正文大 PRE 原生不透明（裁定①新口径） | **FAIL（红）** | PRE 自身 `_plain_7gxqk_103` 233x368 = `rgb(249,250,251)`（PRE 不在注入选择器列表内，从未被触碰）✅；但**承载卡片底与头部条的容器** `_block_7gxqk_4 md-code-block` 233x410（overHalf=true，原生 `rgb(249,250,251)`）被写成 **`transparent !important`**，alpha=0，8 次采样稳定不变，4 次独立运行复现（chat2/chat3/chat4/session）。取证见 §6-D1。 |
| 4 | 小代码块 / 输入卡 0.45 | **PASS** | 小代码块 233x182 = `rgba(249,250,251,0.45) !important`，8 次 0 翻转；输入卡在两宿主截图里均为 0.45 半透明白卡 |
| 5 | `role=listbox` 菜单 0.96 | **PASS** | `Z9Jnlq_viewport`（role=listbox，257x392）= `rgba(255,255,255,0.96) !important`，8 次 0 翻转；`Z9Jnlq_item` 选项保持原生（active 项 `rgba(38,49,72,0.06)`，其余 transparent）⇒ 未被压平 |
| 6 | `#dsh-theme-veil` 不被触碰 | **PASS** | inline 与 computed 均为 `rgba(255,255,255,0.45)`，cssText 除定位/层级外无变化 |
| 7 | A14 窄屏命中区（6f4fad4） | **PASS** | 收起态 56px 轨道：`Open sidebar` 40x40、`New session`/`Plugins` 36x36，**视觉中心与盒子中心 elementFromPoint 均命中自身**（`selfHitVis/selfHitBox=true`）；展开态：`Collapse sidebar` 28x28、`New Session` 252x38、`Plugins` 252x36 均自命中。非自命中项只有两类：① 展开态遮罩下的头部控件（`Agent Team` 等，被 280px 遮罩盖住，属设计）；② `1 background job` 徽标视觉中心被相邻 `WgQWqa_main` 按钮占用（盒子中心仍自命中）——既有布局问题，与本轮玻璃注入无关。 |
| 8 | 展开态侧栏 0.92（v1.32.5） | 笔电 **PASS** / **vm1 FAIL（空转）** | 笔电 `_2H3hWW_root` pos=**fixed** 280x671 = `rgba(249,250,251,0.92) !important`；vm1 `hHd-Xa_root` pos=**static** 280x671 = `rgba(249,250,251,0.45)`。原因：`bwPanelBg()` 与窄屏 CSS 补丁全部锚在 `_2H3hWW_root`，vm1 上 0 命中。见 §5-a / §6-D2。 |

## 5. 额外实测（只测不修）

**a. 窄屏侧栏根：computed position + 最终底色**
- 笔电：`_2H3hWW_root` → `position:fixed`（窄屏补丁生效），280x671，最终 `rgba(249,250,251,0.92)`。
- vm1：`hHd-Xa_root` → `position:static`（补丁未命中），280x671，最终 `rgba(249,250,251,0.45)`；**展开时中列 `pI_x6G_centerCol` 被压到 80x671**（收起时 304x671），即侧栏没有变成覆盖层而是挤占了正文宽度。
- 登记事实：`_2H3hWW_root` 在 vm1 上 0 命中 ⇒ `bwPanelBg` 的 0.92 与 `skipBg` 均为空转（`_2H3hWW_collapsed` 同样 0 命中）。

**b. 首屏候选数与 apply() 次数**：见 §0 第 3 行 —— 5 轮 / 75 写 / 7 候选 / 15 大元素，6s→10s 零增长 ⇒ **O(N²) 自激已消除**。补充：`__cbOk===1` 计数 0、`__cbOk===0` 计数 116（欢迎页无内容块，迟滞未被触发）。

**c. S8 边界（把 PRE 挂成聊天根直接子节点）**
`qa-v132-15-laptop-s8c.json`：在真实会话里向最大的 `*_root`（`xz4KEq_root` 297x5644）挂入 PRE，`preIsDirectChildOfRoot=true`；挂载后 2×2.5s 聊天根始终 `rgba(0,0,0,0)`、inline 空 ⇒ **没有被判成内容叶子、没有吃到不透明白**；卸载后回到原状。
⚠ 保留意见：`childTags` 显示新增节点是 `DIV.`（空类名包裹层），所以「PRE 严格作为直接子节点」这一条件只被部分触发；合成 DOM 里开发者已覆盖该判据的边界，真机侧建议复测。

## 6. 本轮发现、未修的缺陷（tester 写域外，未动一行代码）

**D1 · P1 · 聊天大代码块容器仍被写 transparent（v1.32.13 修复未落地到真机）**
- 现象：`_block_7gxqk_4 md-code-block`（233x410，vw360/vh671 ⇒ overHalf=true）最终 `transparent !important`，而其**原生**底色是 `rgb(249,250,251)`（探针「剥内联→读原生→还原」实测，`restoreOk=true`）。卡片头部条（`_bannerWrap_7gxqk_` 233x42）与内边距区域因此透出壁纸/底层文字。
- 取证：`innerBig=1`（唯一 >50%×50% 的后代是 `PRE|_plain_7gxqk_103|233x368`），直接子节点 = `DIV|_bannerWrap_7gxqk_|233x42` + `DIV|_content_7gxqk_74|0x0`；`isCode=true`（直接子树含 PRE 的兄弟结构，PRE 在 `_content_` 下）⇒ `isLayout=false`、`isPanel=false`（ancBigPos=false）、`isOv=false`。按 `WebActivity.kt:542-550` 的判据，innerBig=1 ≤2 ⇒ 应进候选、两轮后 `__cbOk=1` ⇒ 走 `561-570` 剥内联取原生 ⇒ 写 `rgb(249,250,251)`。**实测没有发生。**
- 与合成 DOM 的分歧：开发者 harness 里该块 innerBig=2 且已恢复不透明；真机 innerBig=1 更宽松却不落地 ⇒ 分歧不在阈值，在**时序**。
- 最可能机制（**推断，需真机插桩确认**）：`__cbOk` 挂在 DOM 节点上，聊天列表虚拟化/重渲染会换节点 ⇒ 标记丢失；同一轮兜底分支立刻写 transparent（`579` 闸门在 a0<1 且 isCB=false 时 continue，但换节点后 a0=1 的那一轮会被大容器分支直接写 transparent），而不透明写要晚一轮（2×rAF + 重跑 apply）⇒ 元素长期停在 transparent。
- 需要的确认手段（不是修法）：在候选复核处导出 `window.__qaCb=[{cls,innerBig,cbOk,nodeSeq}]`，并让 QA 探针比对节点身份，即可判定是「候选从未进」还是「进了又被清」。

**D2 · P2 · CSS-module 锚点腐烂使 v1.32.5 窄屏补丁在 vm1 上整体空转**
- vm1 DSH 现发 `hHd-Xa_*` / `wSkVaW_*` / `pI_x6G_*` / `P3OORG_*` / `_6nhg2_` 命名；`BynINW_`、`_2H3hWW_root`、`_2H3hWW_collapsed`、`Dc7zOa_root` 全部 **0 命中**（普查见两个 discover.json 的 `census`）。
- 后果（实测）：侧栏展开不是覆盖层而是挤压布局，中列 304→**80px**；展开态侧栏 0.92→0.45；`skipBg` 空转。
- 归属：本轮两个提交之前既有（窄屏 CSS 与 `bwPanelBg` 的类名闸门），**非本轮引入**；但它是「`_2H3hWW_root` 已 0 命中」这条登记事实的完整代价，建议一并进 v1.32.16 议题。
- 对照：笔电 DSH 仍发旧命名（`BynINW_`=6、`_2H3hWW_root`=1、`Dc7zOa_root`=1）⇒ 「锚点已死」是**按宿主成立**的，两侧必须都测。

**D3 · P3 · `_emptyTabHost_6nhg2_143` 在 `visibility:hidden` 时被写不透明白**
两宿主一致：360x671、static、有定位大祖先（`P3OORG_panel` absolute）⇒ isPanel=true ⇒ 写 `rgb(255,255,255) !important`。当前该 pane 隐藏 ⇒ 无视觉影响；一旦上游把它显示出来，就会以不透明白盖住壁纸。与 v1.32.12 语义一致（非本轮回归），登记。

**D4 · P3 · QA 探针自身的锚点也腐烂过（已在本轮修好，属工具问题）**
`sidebarState()` 用 `[class*=_root_]`（带尾下划线）在 `_2H3hWW_root` 上 0 命中；`S8_INFO` 用 `/_root_/` 同样漏。已改为 `(^|_)root(_|$)` 结构匹配，两宿主均恢复可测。

**D5 · P3 · 斜杠菜单探针收尾未清 composer**
`menu` 模式里 `document.querySelector('textarea')` 返回 null（该 DSH 版本的输入区不是裸 textarea），菜单仍能打开并完成 0.96 测量，但 `clear` 步骤报 `NO_TA` ⇒ 可能残留一个 `/` 在输入框（未发送任何 prompt，无副作用）。

## 7. 未覆盖 / 受阻项（显式列出）

1. **真实文档预览面板不透明**：本轮无法在模拟器里稳定打开一个文档 tab（可达视图里没有可点的文件卡；`docpanel` 模式只找到隐藏的 `_emptyTabHost_`）。需要开发者/leader 指一条「进入文档预览」的稳定 UI 路径（例如某条含文件编辑的会话里点 diff 卡的具体位置），下轮补测。
2. **S8 的「PRE 严格为直接子节点」条件**：见 §5-c 保留意见。
3. **`_split_` / `_tabHost_`（非 empty）本体**：两宿主普查均为 0 命中（只有 `_emptyTabHost_` / `_tabLayout_` / `_surface_` / `_pane_` 家族），已按实际存在的元素名测量。
4. **推送链路**：本轮为纯渲染验证，未推送（`qa-` 前缀 + epoch 唯一串规则未触发）；`dsh-app-verify.ps1 -Deploy` 全程未跑（leader 专属）。

## 8. 证据文件索引（均在 `verify/`，`qa-v132-15-` 前缀）

- 构建：`qa-v132-15-build.sh`、`qa-v132-15-app-debug.apk`（10993508 B / `597ff267…`）
- 探针：`qa-v132-15-probe.mjs`（mode: discover / sample / redline / applycount / s8 / a14 / menu / docpanel）
- 普查：`qa-v132-15-{laptop,vm1}-discover.json` + `.png`
- 采样：`qa-v132-15-laptop-{session,session2,chat,chat2,chat3,chat4,menu,a14}.json`、`qa-v132-15-vm1-{session,core,applycount}.json` + 同名 `.png`
- 专项：`qa-v132-15-laptop-s8{,b,c}.json` + `.png`

复现：`node verify/qa-v132-15-probe.mjs <mode> "<url with token>" <outjson> 597ff2672ebe9fe88c2930dfa48eecf9fc46ecc628e35cc4624bc462e8e57827 <tag> [session] [rowIndex]`
（token 每次 DSH 重启必换，取 `~/.dsh/web.log` 最后一条 `dsh web:`；探针会先 `adb root` 再冷启 App，并在写盘前后各校验一次设备 apk sha。）
