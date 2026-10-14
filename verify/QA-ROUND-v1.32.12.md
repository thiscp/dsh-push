# QA-ROUND v1.32.12 —— 文档预览面板不透明度（task-11 改动验证轮）

> **对象**：`xyz.cpyh.dshpush` **v1.32.12 / versionCode 78**（`dumpsys` 实测）
> **主题**：用户反馈「**对话生成的文档，我打开后背景也是透明的**」
> **执行者**：teammate tester ｜ **时间**：2026-10-15 05:4x (+08:00)
> **设备**：`emulator-5554`（笔电 DESKTOP-CPYH）｜ **档位**：真 GPU（`emu-gpu-verdict.ps1` **exit 0**，RTX 4060 Laptop）
> **几何**：1440x3168@640，CDP `innerWidth=360 / innerHeight=671 / dpr=4`
> **判据**：`verify/qa-doc-panel.mjs`（主）+ `verify/qa-doc-diff.mjs`（差异视图补测）+ **每张图我自己 `read_image` 看整页**

## 结论：**PASS** ✅（1 处未覆盖显式登记，不影响放行）

**用户投诉的问题已彻底解决**：文档预览面板从 `alpha=0`（全透明）→ **`rgb(255,255,255)` / alpha=1.0**，
**5/5 次采样恒为 1.0**；整页图肉眼判**面板文字清晰、无任何底层正文/页签叠印**。

### 版本指纹（哈希夹逼，v1.32.11 血的纪律）

| 项 | 值 |
|---|---|
| **冻结 sha256（lead 给定）** | `0acc7f357edce617fac751f807733b9b217bc0b398815488973c085fa24fa756` |
| **开工读（采样前）** | `0acc7f357edce617fac751f807733b9b217bc0b398815488973c085fa24fa756` ✅ **匹配** |
| **收工读（采样后）** | `0acc7f357edce617fac751f807733b9b217bc0b398815488973c085fa24fa756` ✅ **相等** |
| **夹逼结论** | **`hashStable = true`** ✅ ⇒ 全部样本出自**同一个冻结 build** |
| 探针行为 | 期望哈希作为 argv，**不匹配即 `throw BLOCKED` 拒绝采样**（fail-closed）—— 两次运行都先打印 `APK_SHA_MATCH ok` 才开始量 |

> ⚠️ 现场插曲：设备上 `base.apk` 的**父目录哈希变了**（`~~6Z_EB9X…` → `~~wo0g7UFk…`），
> 我第一次用旧路径读 sha 得到 `No such file or directory`。**没有沿用旧路径**，而是重新 `pm path` 取新路径再读
> ⇒ 得到 `0acc7f35…` 与冻结值一致。**这正是"别用旧报的哈希/旧路径"那条纪律的现场。**

---

## 1. 主验收：文档预览面板不透明度 —— **PASS**

**断言**：面板（被注入的那一层 `_tabHost`）`getComputedStyle().backgroundColor` 的 **alpha = 1.0**（改前 **0**）。

**探针陷阱（已按 `ANALYSIS` §2.10 规避）**：`[class*='_tabHost']` 有 **多个匹配**（含 `0x0` 占位），
`querySelector` 会拿到 `0x0` 那个、把"面板其实开着"误报成"没打开" ⇒
**我的探针扫全部匹配、按面积取最大**，并把候选清单写进报告（下表 `candidates`）。

| 轮次 | panel alpha | bg | 尺寸 | 占视口 | 内联 | candidates（面积降序） |
|---|---|---|---|---|---|---|
| R1 | **1** | `rgb(255,255,255)` | 360x671 | **100%×100%** | `rgb(255,255,255)` | `_tabHost_6nhg2_162`(360x671) → `_tabHostBody`(360x633) → `_tabHostHeader`(360x38) |
| R2 | **1** | `rgb(255,255,255)` | 360x671 | 100%×100% | 同 | 同 |
| R3 | **1** | `rgb(255,255,255)` | 360x671 | 100%×100% | 同 | 同 |
| R4 | **1** | `rgb(255,255,255)` | 360x671 | 100%×100% | 同 | 同 |
| R5 | **1** | `rgb(255,255,255)` | 360x671 | 100%×100% | 同 | 同 |

**⇒ 5/5 恒为 `alpha=1`**（不是"跑一次绿就算过"；v1.32.11 曾同版本 n=2 跑出 0 与 0.92）。

**改前 / 改后对照**：
| | 证据 | 现象 |
|---|---|---|
| **改前**（用户真机，lead 存） | `F:\work\work_dsh\tmp\shots\qa\v1.32.12-before-user-doc-transparent.jpg`（524,038 B） | 面板**整体无实底**：底层页签栏（`第2轮改动 询问模…`）、聊天正文、以及文档自身多段文字**互相叠印**，长文严重发花；代码块/正文与立绘叠在一起 |
| **改后**（本轮实拍） | `F:\work\work_dsh\tmp\shots\qa\qa-C13-doc-panel-open.png`（554,812 B） | **纯白实底面板**，抬头 `…INCIDENT-2026-10-14-local-engine-prefill-oom.md` + `Markdown`，正文（`iq3_s_abl.json`、`Authorization: Bearer`、`§8. 与其它文档的关系`、代码样式内联块）**清晰锐利**；**看不到任何底层聊天正文或页签叠印** |

**主判据（整页肉眼判）**：`qa-C13-doc-panel-open.png` **我 `read_image` 亲看** ——
面板**通体实白**、markdown 标题与正文层次分明、行内 code 块有浅灰底且不透明，
**底层聊天（`六、一句话`、`判据 + 一条命令…`）与立绘完全不可见**（改前图中它们正是叠印元凶）。
⇒ **用户投诉的"三层层叠/发花"已消除**。

**关于 alpha 取值 1.0（vs 浮层的 0.96）**：面板原生设计就是 `rgb(255,255,255)` 不透明阅读页，
1.0 是**还原原生**；与浮层 0.96 分档是 lead §3.5 的裁定（阅读面板职责 = 长时间舒适阅读）。
**本轮实测支持该裁定**：1.0 下面板空白处**无任何可辨透字**（0.96 版 lead 曾亲眼看到淡影）。

---

## 2. 红线复跑 —— **全部保住** ✅（本轮核心风险点）

⚠️ **为什么这条是本轮最大风险**：`BynINW_frame` 与坏掉的面板**原生同为 `rgb(255,255,255)`**
⇒ 修法**全靠结构判据 `isPanel`** 区分，**颜色判据会把壁纸通道一起变不透明 → 复现 v1.32.6 壁纸整层消失**。

### 2.1 面板**关闭**时（基线）

| 元素 | 实测 | 判定 |
|---|---|---|
| `BynINW_frame` | **`rgba(0,0,0,0)`** | ✅ |
| `BynINW_centerCol` | **`rgba(0,0,0,0)`** | ✅ |
| **`Dc7zOa_root`** | **`rgba(0,0,0,0)`** | ✅ |
| `html` / `body` | **`rgba(0,0,0,0)`** | ✅ |
| `#dsh-theme-veil` | **0.45** | ✅ 未被提亮 |
| `RlGAzG_card` | **0.45** | ✅ 非目标零误伤 |
| 进程存活 | `shellAlive=true`、`pid=7103` | ✅ |

### 2.2 面板**打开**时（5 轮逐轮复测）

**每一轮**（R1–R5）四条通道全部保持 **`rgba(0,0,0,0)`**，`veil=0.45`、`card=0.45`
⇒ **面板变不透明（1.0）与壁纸通道全透（0）在同屏共存、互不干扰** ✅ ——
**这正是结构判据 `isPanel` 生效、未误伤 `BynINW_frame` 的直接证据**（本轮核心风险的实测答案）。

### 2.3 面板**再次关闭**后

`panelStillOpen=false` ✅（关闭逻辑正常）｜`frame=rgba(0,0,0,0)` ✅｜`veil=0.45` ✅｜`alive=true / pid=7103` ✅

### 2.4 **整页图确认原生壁纸仍透出**（开/关两态都测）

| 状态 | 证据 | 肉眼判 |
|---|---|---|
| 面板**关闭** | `qa-P12-panel-closed-wallpaper.png`（966,368 B） | ✅ 聊天正文 + **立绘（蓝发女仆装）完整透出**、壁纸纹理可见，**未被白纱盖住** |
| 面板**关闭**（基线态） | `qa-C13-panel-closed-wallpaper.png`（511,309 B） | ✅ 同上（另一次采样，两图一致） |
| 面板**打开** | `qa-C13-doc-panel-open.png`（554,812 B） | ✅ 面板实白是**面板自己的底**（`1.0`），不是把壁纸盖掉 —— 壁纸通道元素仍 `0` |

> **v1.32.6 红线判据**：大容器仍走**互斥的 `transparent`** 分支；面板是**另一条支路**（`big && isPanel && nativeOpaque`）。
> 本轮实测证明**两条支路互不污染**（同屏 `frame=0` 且 `panel=1`）。

---

## 3. 其余必测项

### 3.1 浮层（v1.32.11 成果不许回退）—— **PASS**
| 项 | 实测 | 判定 |
|---|---|---|
| **真菜单 `role=listbox`** | **alpha=0.96**、`rgba(255,255,255,0.96)`、257x172、**25 项** | ✅ **仍 0.96** |
| `#dsh-theme-veil` | **0.45** | ✅ |
| 输入卡 `RlGAzG_card` | **0.45** | ✅ |
| 截图 | `qa-P11-menu-still-096.png`（639,608 B） | ✅ |

### 3.2 侧栏两档（`bwPanelBg()` 未破）—— **PASS**
| 状态 | alpha | 宽 | 判定 |
|---|---|---|---|
| 收起 | **0.45** | 55.5 | ✅ |
| 展开 | **0.92** | 280 | ✅ |
| 点浮层外收起后 | **0.45** | 55.5 | ✅ |
证据：`qa-P13-sidebar-expanded-v13212.png`（668,135 B）

### 3.3 交互回归 —— **PASS**
- **面板可打开**：5 轮全部成功打开（`pctW≥85 && pctH≥85` 为判据，非"点到就算"）✅
- **面板可关闭**：连点关闭后 `panelStillOpen=false` ✅
- **面板内滚动到底**（**排在关闭面板之前**，按 task 要求）：
  `scrollable=true`、**`moved=true`**、`scrollTop 0 → 9413.5`、`scrollHeight=10009`、`clientHeight=595` ✅
- **slash 菜单不受影响**：面板关闭后真菜单仍 **0.96 / 25 项** ✅

### 3.4 已知遗留（**本轮不修**，常驻断言已打出来）
`_block_7gxqk_4`（聊天里的大代码块，**331x524**，91.8%×78.1%）：
| 状态 | alpha | inline | 原生 |
|---|---|---|---|
| 面板关闭 | **1** | （空，未被写内联） | `rgb(249,250,251)` |
| 面板打开（R1–R5） | **0.45** | `rgba(249,250,251,0.45)` | `rgb(249,250,251)` |

⇒ 它**仍被大容器分支压成 0.45**、新判据不覆盖它。**lead 已裁定本轮不修**（避免夹带扩大改动面）。
**本轮按"已知遗留"登记，不计为 FAIL**；已做成**探针常驻断言**（每轮都打印 `codeBlock_a`）。

---

## 4. 对抗探针（自加 ≥1 条本库没有的角度）—— **QA-A30 多面板/多标签**

**新角度**：新判据是"**祖先 8 层内有 `absolute|fixed` 且 ≥90%×90% 视口**"的结构判定。
⇒ 最可能坏的地方是**多开一个标签页/面板**时：新面板是否仍被命中？**更多的全屏层会不会把壁纸通道也一起命中**？
（上一轮 A29 只扫"哪些 fixed/absolute 被误伤"，**没有覆盖"多面板共存"这个动态场景**。）

**实测**（`qa-A30-multi-panel.png`，515,509 B）：

```
secondOpenAttempt = opened                      // 成功再开第二个（标签页）
after.count = 3 个 live _tabHost
  _tabHost_6nhg2_162 _pane_6nhg2_209   alpha=1  bg=rgb(255,255,255)  360x671   ← 仍被正确命中
  _tabHostBody_6nhg2_181 _paneBody…    alpha=0  bg=rgba(0,0,0,0)     360x633   ← 内层滚动体（本就透明，正确）
  _tabHostHeader_6nhg2_177             alpha=0  bg=rgba(0,0,0,0)     360x38    ← 抬头容器（本就透明，正确）
frame = rgba(0,0,0,0) alpha=0                    ← ★ 壁纸通道在多面板下仍未被误伤
```

**判定 PASS**：多开一层后，**面板仍 1.0、壁纸通道仍 0** ⇒
结构判据在多面板场景下**没有退化**，也没有把 `BynINW_frame` 误判成面板。
（可见的内层透明层 `_tabHostBody`/`_tabHostHeader` 属**正确的分层**：实底只在 `_tabHost` 这一层，
正是 `ANALYSIS` §2.2 实测的"整条祖先链只有这一层有内联背景"。）

---

## 5. ⛔ 未覆盖 / 限制（**下轮不得当已验**）

| ID | 状态 | 内容 | 为什么 / 怎么补 |
|---|---|---|---|
| **U-1** | **未覆盖** | **差异视图（抬头 `+5 -5`）未能复现** | 我写了专用探针 `qa-doc-diff.mjs`，枚举全部标签页（`Chat`/`Trajectory`/`_tabCell`/`_tab_`）**逐个真点**，4 次尝试**全部 `isDiff=false`、`diffMatch=''`**（抬头恒为 `…INCIDENT-…md Markdown`，无 `+N -M`）⇒ **本环境无法唤起差异视图**，记未覆盖。<br>**可给的推论（非判据）**：`ANALYSIS` §2.6 实测两种视图**共用同一 `_tabHost` 容器**（差异抬头在 `TdjKvG_header`、正文在 `TdjKvG_preview`，同属该层），而该层 5/5 实测 **1.0** ⇒ **不透明度断言对该层两种视图同等成立**；但**差异视图的视觉渲染未亲眼看**，故仍记未覆盖。**下轮补法**：先造出真实改动（编辑文档产生 diff）再打开 |
| **U-2** | **未覆盖** | **"面板 + slash 浮层同时在场"** 未取到 | 面板打开时输入框被全屏面板覆盖，`role=listbox` 测得 `found:false`（**这是全屏面板的正常遮挡，非缺陷**）。两态分别验证：面板开 → 面板 1.0；面板关 → 菜单 0.96 ✅ |
| **U-3** | **未覆盖** | **超长文档 / 空文档** 边界 | 本轮只测了真实文档（`INCIDENT-…md`）。滚动到底已 PASS（`scrollHeight=10009`，属长文档场景），**空文档未测** |
| **U-4** | **未覆盖** | 命中区几何三步（`TESTER.md` §3.6） | 本轮 CSS **只改 `background-color`**、**未动尺寸/内边距** ⇒ 记「**未涉及**」 |
| **U-5** | **未覆盖** | 整轮全量回归 | 按规定留给"体验轮" |
| **U-6** | **登记（非未覆盖）** | 大代码块 `_block_7gxqk_4` 仍 0.45 | **lead 已裁定本轮不修**；常驻断言已打印（§3.4） |

**"跑了没量到"声明**：**无一条结论建立在空测量上**。
U-1 的差异视图**明确记为未覆盖**（探针尝试 4 次均有原始输出、非静默跳过）；
所有计入 PASS 的项目都有 `alpha` 数值 + 截图，且截图**由我逐张 `read_image` 看过**。
**探针自身缺陷已按要求规避**：①`_tabHost` 取最大而非第一个（§1 candidates 可证）②截图路径硬编码（未走 argv）③`connect()` 有界重试（**日志里可见 `CONNECT retry 1` → `ok on attempt 2`**，正是冷启后 socket 未就绪）④哈希夹逼 ⑤整页目视前断言进程存活。

---

## 6. 设备复位

| 项 | 实测 | 判定 |
|---|---|---|
| `am force-stop xyz.cpyh.dshpush` | `pidof` = **空** | ✅ |
| `adb forward --list` | **空** | ✅ |
| `whoami` | **root**（保留，便于下轮） | ✅ |
| `font_scale` | **1.0** | ✅ |
| `wm size/density` | `1440x3168 / 640`（**无 override**） | ✅ |

**未推 ntfy** ✅ ｜ **未切 GPU** ✅ ｜ **未冷启笔电** ✅（全程无自愈中断；`emu-ladder.log` 无新增 `VIOLATION`）

---

## 7. 交付物与复现

| 产物 | 路径 |
|---|---|
| 本报告 | `verify/QA-ROUND-v1.32.12.md` |
| 主探针（面板 + 红线 + A30 + 侧栏 + 菜单） | `verify/qa-doc-panel.mjs`（23,674 B → 清理后，纯 ASCII，`node --check` OK） |
| 差异视图补测探针 | `verify/qa-doc-diff.mjs`（纯 ASCII，`node --check` OK） |
| 原始数据 | `F:\work\work_dsh\tmp\doc-report.json`（主）｜`F:\work\work_dsh\tmp\doc-diff-report.json`（差异视图） |
| 截图（笔电 `G:\Android\qa-doc\` → 本机） | `qa-C13-doc-panel-open.png`(554,812) / `qa-C13-panel-closed-wallpaper.png`(511,309) / `qa-A30-multi-panel.png`(515,509) / `qa-C13-doc-panel-diff.png`(515,508) / `qa-P12-panel-closed-wallpaper.png`(966,368) / `qa-P11-menu-still-096.png`(639,608) / `qa-P13-sidebar-expanded-v13212.png`(668,135) —— 全部在 `F:\work\work_dsh\tmp\shots\qa\` |
| 改前对照 | `F:\work\work_dsh\tmp\shots\qa\v1.32.12-before-user-doc-transparent.jpg`（524,038 B，用户真机） |

```powershell
# 复现（编排机 → 笔电）；token 从 ~/.dsh/web.log 最后一条 'dsh web:' 现取（DSH 重启必换）
powershell -File verify\emu-gpu-verdict.ps1            # 期望 exit 0
# 第 3 个参数 = 冻结哈希；不匹配则 fail-closed 拒绝采样
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-doc-panel.mjs `"<URL>`" G:\Android\qa-doc 0acc7f357edce617fac751f807733b9b217bc0b398815488973c085fa24fa756 5"
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-doc-diff.mjs `"<URL>`" G:\Android\qa-doc 0acc7f357edce617fac751f807733b9b217bc0b398815488973c085fa24fa756"
```

---

## 8. 判据汇总

| 用例 | 断言 | 实测 | 结论 |
|---|---|---|---|
| **QA-C13** 面板 alpha | **= 1.0** | **1（5/5）**，`rgb(255,255,255)`、100%×100% | ✅ **PASS** |
| **QA-C13b** 整页肉眼判"无叠印" | 无透字 | 面板实白、正文清晰、底层/立绘不可见 | ✅ **PASS**（**主判据**） |
| QA-P12 壁纸通道（关/开两态） | frame/centerCol/**dcRoot**/html/body = `rgba(0,0,0,0)` | **全 0**（关 + 开 ×5 轮） | ✅ **PASS** |
| QA-P12b 整页壁纸仍透出 | 未被白纱盖 | 立绘+壁纸完整透出（两态截图） | ✅ **PASS** |
| QA-A29 veil / 非目标 | 0.45 / 零误伤 | **veil 0.45**、card **0.45** | ✅ **PASS** |
| QA-P11 浮层不回退 | 0.96 | **0.96**（25 项） | ✅ **PASS** |
| QA-P13 侧栏两档 | 0.92 / 0.45 | **0.92 / 0.45 / 收起 0.45** | ✅ **PASS** |
| QA-C11 面板开关 + 内滚到底 | 可开可关、能滚到底 | 5/5 开、关后 `false`、`scrollTop 0→9413.5` | ✅ **PASS** |
| **QA-A30** 多面板共存（**新对抗**） | 面板仍命中、通道不误伤 | 二层共存下 **panel=1 / frame=0** | ✅ **PASS** |
| 差异视图（`+5 -5`） | 覆盖两视图 | **未能复现** | ⛔ **未覆盖**（U-1） |
| 大代码块 | 已知遗留 | 仍 0.45（原生 249,250,251） | 📌 **登记**（U-6，本轮不修） |

**最终判定：`PASS`** —— **无 P0/P1/P2**；1 条未覆盖（差异视图，U-1）+ 1 条已知遗留（大代码块，U-6）。
**⇒ 具备放行条件。**
