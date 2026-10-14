# QA-ROUND v1.32.14 —— FINDING-1 瞬时露白复验（task-15）

> **对象**：`xyz.cpyh.dshpush` **v1.32.14 / versionCode 80**（`dumpsys` 实测）
> **主题**：复验 `task-13` 登记的 **FINDING-1[P2]**（`Dc7zOa_root` ≈2s 瞬时"原生白"窗口 ⇒ 壁纸被盖）是否已修
> **执行者**：teammate tester ｜ **时间**：2026-10-15 03:0x–03:2x (+08:00)
> **设备**：`emulator-5554`（笔电 DESKTOP-CPYH，**03:11:11 由 lead 用受认可真 GPU 冷启脚本恢复**）
> **档位**：真 GPU（`emu-gpu-verdict.ps1` **exit 0**，RTX 4060 Laptop / 616.92）｜ **几何**：`1440x3168@640`，CDP `360x671 / dpr=4`

## 结论：**PASS** ✅ —— 白色窗口**已消失**（3/3 轮零命中）

| 项 | v1.32.13（改前） | **v1.32.14（本轮）** |
|---|---|---|
| `qa-dcroot-transient.mjs` 命中 | **2 次/轮**（两轮独立运行均命中） | **0 次/轮 × 3 轮 = 0** ✅ |
| `nativeWhiteSamples` | 2, 2 | **0, 0, 0** ✅ |
| settle 终态 | `rgba(0,0,0,0)` | **`rgba(0,0,0,0)`（5/5 连续读数）** ✅ |
| 五红线 | 全绿 | **全绿** ✅ |
| `wouldChange`（面板分支实际点亮的大容器数） | 1（仅 `_tabHost`） | **2** = `_tabHost` **+ 大代码块**（**均为既有正当修复**，见 §3 说明） |

**⇒ FINDING-1 已修复，无回归，无新增误伤。具备放行条件。**

---

## 0. 版本指纹（哈希夹逼 —— 每次都重新 `pm path`）

| 项 | 值 |
|---|---|
| **冻结 sha256（lead 三方对齐 + DEX 校验）** | `2850a0d3d345c7619db9394993232147380e092356cf979c11159c5ff96f5b9d` |
| **设备读数（8 次独立夹逼：开工/收工 × 4 个探针）** | **全部同值** ✅ |
| `versionName` / `versionCode` | **`1.32.14` / `80`** / API 36 / 10,993,088 B |
| `hashStable` | **true**（每个探针都前后各读一次） |
| 探针行为 | 期望哈希做 argv ⇒ **不匹配即 `throw BLOCKED` 拒绝采样**；父目录每次重取（本轮实测路径 `~~BolV5LAYd5koZsbMekVHVA==/…`） |

> **恢复过程如实记录**：SETTLE 探针首跑时设备在 `03:06:50` 后**进程消失**（`adb devices` 空、`qemu` 进程 0），
> `emu-ladder.log` **无 `VIOLATION` 行**（自愈每 5 分钟仍报 `already healthy`，与消失时刻不吻合）。
> 我在 `03:1x` 观察到 `emulator`+`qemu` 于 **03:11:11 重新拉起**、`boot_completed=1`、**sha 仍是冻结值**、版本仍 `1.32.14`
> ⇒ **未重装、版本未变**，随后**整体重跑**了全部探针（本文所有数据都来自恢复之后的运行）。

---

## 1. ★ 主验收：白色窗口是否消失 —— **已消失**（3/3 轮零命中）

**方法**（沿用 `QA-A32` 的抓法，**只在过渡期可测**）：`qa-dcroot-transient.mjs`
= **220 次高频轮询（120ms）+ 周期性滚动扰动逼出 React 重渲染**，判定"未注入/被抹掉"状态（**内联为空 `''` 且 computed `alpha==1`**），**命中即立刻 `screencap`**。

**结果**（三轮独立运行，各自哈希夹逼通过）：

| 轮次 | `caught` | `nativeWhiteSamples` | settle 终态 | `hashStable` |
|---|---|---|---|---|
| **R1** | **0** | **0** | `alpha=0 / inline='transparent'` | true |
| **R2** | **0** | **0** | `alpha=0 / inline='transparent'` | true |
| **R3** | **0** | **0** | `alpha=0 / inline='transparent'` | true |
| **合计** | **0** | **0** | 全部正确 | 3/3 true |

**对照 v1.32.13**（`task-13` §7.4b）：同一探针、同一扰动方式，**两轮独立运行各命中 2 次**（`caught=2 / nativeWhiteSamples=2`）。
⇒ **同一判据下，改前 2 次/轮 → 改后 0 次/轮** ⇒ **白色窗口确实消失** ✅

**每轮收尾均自愈且正确**：`SETTLED alpha=0 inline='transparent' wiped=0 alive=true`（进程存活断言）。
**⇒ 不是"变少了"，是"零命中"** ⇒ 不触发 FAIL（lead 要求的"若仍能抓到就报 FAIL"未发生）。

### 1.1 settle 时间线（`qa-dcroot-settle.mjs`）—— 终态仍 `rgba(0,0,0,0)`

```
t=3147ms  dcRoot alpha=1  inline=''            frame=rgb(255,255,255)  veil=n/a  touched=0   transp=0
t=3721ms  dcRoot alpha=0  inline='transparent' frame=rgba(0,0,0,0)     veil=0.45 touched=8   transp=2   ← 首次注入
t=4250ms  dcRoot alpha=0  inline='transparent' frame=rgba(0,0,0,0)     veil=0.45 touched=8   transp=2
t=5029ms  dcRoot alpha=0  inline='transparent' frame=rgba(0,0,0,0)     veil=0.45 touched=32  transp=8
t=5539ms  dcRoot alpha=0  inline='transparent' frame=rgba(0,0,0,0)     veil=0.45 touched=32  transp=8
t=6055ms  dcRoot alpha=0  inline='transparent' frame=rgba(0,0,0,0)     veil=0.45 touched=32  transp=8
t=6560ms  dcRoot alpha=0  inline='transparent' frame=rgba(0,0,0,0)     veil=0.45 touched=32  transp=8
SETTLED_AT 3721ms        ← 比 v1.32.13 的 4191ms 更早
SETTLED dcRoot=rgba(0,0,0,0)/a0 inline='transparent'  frame/centerCol/body 全 rgba(0,0,0,0)  veil=0.45
SETTLED_REPEATS [0,0,0,0,0] 全部 rgba(0,0,0,0)/transparent      ← 连续 5 次读数
```

**关于 `t=3147ms` 那一行（避免误读为"又露白了"）**：
该时刻 `touched=0`（**注入一次都还没跑**）、`frame` 也是 `rgb(255,255,255)`、`veil=n/a`（纱罩尚未创建）
⇒ 那是**整页注入前的原生态**，**不是 FINDING-1 的缺陷窗口**（缺陷窗口的特征是"**注入已跑过、只有该层被抹**"）。
**关键差异**：**v1.32.13 曾在 `t=2987/3498ms` 内联被写成 `rgb(255,255,255)`（带值）**，
本轮**没有出现"注入写的白"**（`inline` 从空 → 直接 `transparent`）⇒ 与 `Dc7zOa_root` 被加入 `isAnchor` 一致 ✅

---

## 2. 复验项逐条

### 2.1 `wouldChange` 复跑 —— **= 2**（`_tabHost` + 大代码块），**排除未削弱修复**

**什么叫 `wouldChange`**：**面板/内容块分支实际把哪些大容器点成了不透明（`alpha==1`）**。
`ANALYSIS-v1.32.12` §2.5 在 **v1.32.12 状态下**量得 **1**（恰好只有 `_tabHost`）。

**本轮实测**（`qa-wouldchange.mjs`，面板打开 + settle 后）：

| 状态 | `bigTotal` | **`wouldChange`** | 明细 |
|---|---|---|---|
| 面板**关闭** | 45 | **1** | （仅 `_tabHost` 存在时） |
| **面板打开** | 63 | **2** | `_tabHost_6nhg2_162`（alpha=1, `rgb(255,255,255)`）**＋** `_block_7gxqk_4 md-code-block`（alpha=1, `rgb(249,250,251)`） |

**⚠️ 对 lead「期望仍 = 1」的如实更正**：实测是 **2**，**多出来的那 1 个是大代码块**，
它是 **v1.32.13 的正当修复**（`QA-C14`：`331x524` 从 `0.45` 提到 `1.0`），**不是新增误伤**。
⇒ **"面板那一条"仍然是 1**；`wouldChange=2` 是"面板 + 上一轮已批准的代码块修复"之和。

**锚点（应保持透明）实测全部正确** ✅：
```
BynINW_frame          alpha=0  rgba(0,0,0,0)   nativeAlpha=1  inline='transparent'   ← 原生白却被正确保住
BynINW_centerCol      alpha=0  rgba(0,0,0,0)   nativeAlpha=0  inline=''
Dc7zOa_root           alpha=0  rgba(0,0,0,0)   nativeAlpha=1  inline='transparent'   ← ★ FINDING-1 修复点
BynINW_overlayLayer   alpha=0  rgba(0,0,0,0)   nativeAlpha=0  inline=''
```
**⇒ 排除 `Dc7zOa_root` 没有削弱任何东西**：`_tabHost` 仍被点亮（1.0）、大代码块仍被点亮（1.0）、
四个锚点**全部保持 `rgba(0,0,0,0)`**（其中 `BynINW_frame`/`Dc7zOa_root` **原生同为 `rgb(255,255,255)`**，
是最能暴露"颜色判据会误伤"的两个样本，本轮**双双安全**）。

### 2.2 大代码块 `1.0` + 9 个矮块 `0.45` —— **PASS（5/5 恒定）**

| 轮次 | 大块数 | **大块 alpha** | 矮块数 | **矮块 alpha** | frame | veil | card | tabHost |
|---|---|---|---|---|---|---|---|---|
| R1–R5 | 1 | **1** | 9 | **0.45** | `rgba(0,0,0,0)` | **0.45** | 0.45 | 1 |

`A31` 集合级：`bigAlphas=[1]`、`smallAlphas=[0.45]`；`smallHeights=[182,163,125,144,182,87,296,87,144]`（全 `<335.5`）；`bigSizes=["331x524"]`
⇒ **阈值两侧分流仍精确**，`Dc7zOa_root` 被排除**没有波及**代码块判定 ✅

### 2.3 五红线 —— **全部保住** ✅

| # | 断言 | 实测（面板开 / 关两态） | 判定 |
|---|---|---|---|
| ① | `BynINW_frame`/`centerCol`/**`Dc7zOa_root`**/`html`/`body` 仍 `rgba(0,0,0,0)` | **全 `rgba(0,0,0,0)`**（R1–R5 逐轮 + 关闭态 + 收尾） | ✅ |
| ①b | **整页图**壁纸仍透出 | `qa-v13214-panel-closed-wallpaper.png`(964,864 B)、`qa-v13214-settled-chat.png`(959,222 B) **我亲看**：**立绘+壁纸完整透出** | ✅ |
| ② | `_tabHost` 仍 **1.0** | **1**（`rgb(255,255,255)`）；关闭后 `null`（卸载，正常） | ✅ |
| ③ | 真菜单 **0.96**；**veil 0.45** | 菜单 **0.96**（`rgba(255,255,255,0.96)`、257x172、**25 项**）；**veil 实测 `rgba(255,255,255,0.45)`** | ✅ |
| ④ | 侧栏 **0.92 / 0.45** | 收起 **0.45/55.5** → 展开 **0.92/280** → 点外回 **0.45/55.5** | ✅ |
| ⑤ | `RlGAzG_card` 仍 **0.45** | **0.45**（R1–R5 一致） | ✅ |

### 2.4 交互与其它内容块

| 项 | 实测 | 判定 |
|---|---|---|
| 聊天滚动 | `moved=true`、`scrollTop 0 → 9413.5`、`scrollHeight=10009`、`clientHeight=595` | ✅ |
| 代码块横滚 | 被测块 `hScrollable=false`（文本未超宽 ⇒ 无需横滚） | ✅（如实记） |
| `table` / `blockquote` | 仍 `alpha=0`（**本轮范围外**） | 📌 登记 |
| 进程存活 | `alive=true`、`pidof` 非空（目视前断言） | ✅ |

### 2.5 整页肉眼判（主判据之一）

- `qa-v13214-codeblock-chat.png`（499,313 B）**我 `read_image` 亲看**：
  doc 面板实白、markdown 标题与正文清晰、行内 code 块（`/health`、`pi-ai stream TIMEOUT idle…`）**浅灰实底、文字锐利**，
  **底层聊天正文不可见** ✅
- `qa-v13214-settled-chat.png`（959,222 B）**我亲看**：**立绘（蓝发女仆装）+ 壁纸完整透出**，`Chat/Trajectory` 正常 ✅
- `qa-v13214-panel-closed-wallpaper.png`（964,864 B）：关闭态壁纸同样透出 ✅
- `qa-v13214-wouldchange-panelopen.png`（515,048 B）：`wouldChange` 面板打开态的整页留档 ✅

---

## 3. 未覆盖 / BLOCKED（**下轮不得当已验**）

| ID | 状态 | 内容 | 说明 |
|---|---|---|---|
| **U-1** | **未覆盖** | **静止纯聊天 + 大块同屏**的逐帧锁定 | 沿用 `task-13` U-1：主探针的轮次处于"面板打开"态（应用自动恢复 doc 标签）。大块 `1.0` 已在**面板打开**与**滚动经过**两处成立 |
| **U-2** | **未覆盖** | `table` / `blockquote` 仍 `transparent` | **范围外**（未被任何一轮要求） |
| **U-3** | **未覆盖** | 代码块**横向滚动** | 只测到"无需横滚"的情形 |
| **U-4** | **未覆盖** | 命中区几何三步 | 本轮只改判据/背景色，**未动尺寸** ⇒ 「**未涉及**」 |
| **U-5** | **未覆盖** | 整轮全量回归 | 按规定留给"体验轮" |
| **U-6** | **观察项（非未覆盖）** | **设备在 03:06:50 后消失**（无 `VIOLATION` 行） | 已由 lead 冷启恢复；**未查明根因**，但**不影响本轮结论**（恢复后 sha/版本未变，全部探针重跑）。建议 lead 留意是否复现 |

**"跑了没量到"声明**：**无**。3 轮抓取**每轮都有明确计数值**（`caught=0`），
**不是"没跑到"** —— 判据是"**探针完整跑完 220 次轮询后命中 0 次**"，
且**同一探针在 v1.32.13 上能命中 2 次**（阳性对照）⇒ **零命中是可判读的结论，不是空测量**。

---

## 4. 设备复位

| 项 | 实测 | 判定 |
|---|---|---|
| `am force-stop` | `pidof` = **空** | ✅ |
| `adb forward --list` | **空** | ✅ |
| `whoami` | **root** | ✅ |
| `font_scale` | **1.0** | ✅ |
| `wm size/density` | `1440x3168 / 640`（无 override） | ✅ |

**未推 ntfy** ✅ ｜ **未切 GPU** ✅ ｜ **未冷启笔电**（03:11 那次是 lead 做的）✅

---

## 5. 交付物与复现

| 产物 | 路径 |
|---|---|
| 本报告 | `verify/QA-ROUND-v1.32.14.md` |
| **新增探针（`wouldChange`）** | `verify/qa-wouldchange.mjs`（纯 ASCII，`node --check` OK） |
| 复用的既有探针 | `verify/qa-dcroot-transient.mjs`（主验收）｜`qa-dcroot-settle.mjs`｜`qa-codeblock.mjs` |
| 原始数据 | `F:\work\work_dsh\tmp\t15-r{1,2,3}.json`（三轮抓捕）｜`t15-settle.json`｜`t15-wc.json`｜`t15-cb.json` |
| 截图（`v13214` 标记） | `F:\work\work_dsh\tmp\shots\qa\`：`qa-v13214-codeblock-chat.png`(499,313) / `qa-v13214-settled-chat.png`(959,222) / `qa-v13214-panel-closed-wallpaper.png`(964,864) / `qa-v13214-wouldchange-panelopen.png`(515,048) |

```powershell
# 复现（编排机 → 笔电）；token 从 ~/.dsh/web.log 最后一条 'dsh web:' 现取（DSH 重启必换）
powershell -File verify\emu-gpu-verdict.ps1            # 期望 exit 0
$sha = "2850a0d3d345c7619db9394993232147380e092356cf979c11159c5ff96f5b9d"
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-dcroot-transient.mjs `"<URL>`" G:\Android\qa-r1 $sha"   # ×3 轮
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-dcroot-settle.mjs   `"<URL>`" G:\Android\qa-settle $sha"
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-wouldchange.mjs      `"<URL>`" G:\Android\qa-wc $sha"
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-codeblock.mjs        `"<URL>`" G:\Android\qa-cb3 $sha 5"
```

---

## 6. 判据汇总

| 用例 | 断言 | 实测 | 结论 |
|---|---|---|---|
| **QA-A32 复验**（FINDING-1） | 白色窗口消失（命中 0） | **0 / 0 / 0（三轮）**，改前为 2/轮 | ✅ **PASS** |
| **QA-C16** `wouldChange` | 面板分支仍点亮面板（未被削弱） | **2** = `_tabHost` + 大代码块（**均正当**）；四锚点全 `rgba(0,0,0,0)` | ✅ **PASS** |
| QA-C14 大代码块 | 1.0 | **1（5/5）**、`rgb(249,250,251)` | ✅ **PASS** |
| QA-C15 矮块 9 个 | 0.45 | **0.45（9/9）** | ✅ **PASS** |
| QA-P12 壁纸通道 | 四通道 0 + 壁纸透出 | 全 `rgba(0,0,0,0)`（开/关两态）+ 整页图透出 | ✅ **PASS** |
| QA-C13 `_tabHost` | 1.0 | **1** | ✅ **PASS** |
| QA-P11 浮层 / QA-A29 veil·card | 0.96 / 0.45 / 0.45 | **0.96**（25 项）/**veil 0.45**/**card 0.45** | ✅ **PASS** |
| QA-P13 侧栏 | 0.92 / 0.45 | **0.92 / 0.45** | ✅ **PASS** |
| 版本指纹 | 哈希夹逼 + ≥5 采样 | **8 次读数全同值**，`hashStable=true`，5 轮采样 | ✅ **PASS** |

**最终判定：`PASS`** —— **FINDING-1 已修复且已用阳性对照证明"零命中"可信**；
**无 P0/P1/P2**（上一轮的 P2 已消除）；五红线全绿；无新增误伤。
**⇒ 具备放行条件。** 唯一遗留为既有未覆盖项（U-1~U-5）与一条**环境观察**（U-6 设备曾消失，已恢复、不影响结论）。

---

## 7. 本轮结论对 `task-13` FINDING-1 的闭合

| | `task-13`（v1.32.13） | `task-15`（v1.32.14） |
|---|---|---|
| 现象 | `Dc7zOa_root` 出现 **≈2s 原生白窗口**（截图实锤） | **不再出现**（3 轮 × 220 次轮询 = 0 命中） |
| 根因 | `isCB`（运行时 `innerBig`）在过渡期临时 ≤2 ⇒ 命中布局容器 | 同上（lead 追查闭合；**我 §7.3 的"注入写的白"判读成立**） |
| 修法 | — | `083de4f`：`isAnchor` 追加 `Dc7zOa_root`（同时封住"取原生色相回写"与 `isCB`） |
| 判定 | **P2**（可见/自愈/非持久） | **已修** → 本轮 **PASS** |
| 证据 | `qa-C14-dcroot-nativewhite-1/2.png` | 三轮 `caught=0`；`t=3147ms` 后**无"注入写的白"** |
