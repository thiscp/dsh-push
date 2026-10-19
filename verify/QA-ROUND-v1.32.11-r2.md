# QA-ROUND v1.32.11-r2 —— 复修后复验（**Part A = 0.92 build；Part B = 0.96 build**）

> **本文件状态**：**Part A 与 Part B 均已完成**。
> **Part A** = 0.92 build（`f5e4a6b`）｜**Part B** = 0.96 build（`49a0ebd`），**Part B 是本轮的最终验收**。
> **作者**：teammate tester ｜ **时间**：2026-10-15 00:2x–01:0x (+08:00)

---

## 0. 版本指纹（**本报告两次踩到"验的不是那个版本"，因此这一节最详细**）

### 0.1 ⚠️ **更正：Part A 的哈希标签曾错标**（lead 用 DEX 字符串比对决定性纠正）

Part A 首稿把采样数据标成 sha `cb1a4ce8…`，并据此说"设备仍是 0.92"。**这是错的**，lead 做了决定性核对：

| build | sha256 | 归属 |
|---|---|---|
| **0.92**（`f5e4a6b`） | **`1D77D75A…`** | developer 首版装机报告值 |
| **0.96**（`49a0ebd`） | **`cb1a4ce84032d670f1621c1c33b34cb1e45c5007025c9958bbecda2461ec08db`** | 本轮冻结值 |

lead 的判据（vm1 `clean assembleDebug` 后抽 `classes*.dex` 做字符串比对）：
`grep -c "0.96"` = **8**、`grep -c "18,24,40,0.96"` = **1**（浮层回退纱色）、`grep -c "18,24,40,0.92"` = **1**（`L643` 短提示条，非本浮层）
⇒ **`cb1a4ce8…` 只能是 0.96 build**。

**为什么我会错标**：Part A 采样在 **00:06–00:16**，developer 装机 0.96 在 **00:22**；
我那两个"换目录前后重读同一哈希"的读数，**很可能都已发生在换版之后**（换目录时间 16:25）。
⇒ **数据本身没错**（Part A 7 次实测 alpha 全 **0.92**，与 0.92 build 一致），**错的是标签采集时机**。

### 0.2 🔒 新纪律（已执行）：哈希必须**括起来读**（bracket）

**冻结 build 的哈希要在采样前后各读一次，且与采样同刻。** 单次读**不是**"这批数据出自哪个 build"的证据；**括号才是**。
**Part B 已按此执行**：探针把 `EXPECTED_SHA` 作为第 6 个参数，**开工先读一次，不等就 `throw BLOCKED`（fail closed，拒绝采样）**，收工再读一次。

| 段 | build | APK sha256 | 采样前读 | 采样后读 | 括号稳定 |
|---|---|---|---|---|---|
| **Part A** | 0.92（`f5e4a6b`） | `1D77D75A…`（label 事后更正） | — | — | ⚠️ 未 bracket（**教训来源**） |
| **Part B** | **0.96（`49a0ebd`）** | **`cb1a4ce8…`** | **`cb1a4ce8…`** | **`cb1a4ce8…`** ✅ | **`stable=true`** ✅ |

### 0.3 本轮环境

| 项 | 值 |
|---|---|
| 设备 | `emulator-5554`（笔电 <win-host-a>）｜ `versionName=1.32.11` / `versionCode=77` / API 36 |
| 档位 | `emu-gpu-verdict.ps1` **exit 0**（真 GPU，RTX 4060 Laptop / 616.92） |
| 几何 | 1440x3168@640，CDP `innerWidth=360 / innerHeight=671 / dpr=4` |
| 探针 | `verify/qa-overlay-r2.mjs`（Part A+B 主探针）｜ `verify/qa-overlay-r2b.mjs`（Part B 补完） |

> ⚠️ **Part A 采集完成时间早于 lead 的暂停指令**，故其 7 次采样 + P13/C12 都在**同一 build** 上完成（未横跨）；
> 按 lead 要求显式标注 0.92，**且不作为 0.96 的验收**。

---

## Part A：0.92 build 复验结果（**已完成**）

### A-1. QA-P11 主验收：alpha 稳定性（**n=5 高菜单 + n=2 矮菜单 = 7/7 全绿**）

**断言**：真菜单 `[role=listbox]` 的 `getComputedStyle().backgroundColor` alpha **恒为 0.92**（复修前实测为 **0**，且**间歇**）。

| 轮次 | alpha | 菜单高 h | 项数 | `h > vh*0.5`(=335.5) | 内联值 | 优先级 |
|---|---|---|---|---|---|---|
| HIGH R1 | **0.92** | 392 | 25 | **true** | `rgba(255,255,255,0.92)` | important |
| HIGH R2 | **0.92** | 392 | 25 | true | `rgba(255,255,255,0.92)` | important |
| HIGH R3 | **0.92** | 392 | 25 | true | `rgba(255,255,255,0.92)` | important |
| HIGH R4 | **0.92** | 392 | 25 | true | `rgba(255,255,255,0.92)` | important |
| HIGH R5 | **0.92** | 392 | 25 | true | `rgba(255,255,255,0.92)` | important |
| LOW R1 | **0.92** | 61 | 1 | **false** | — | — |
| LOW R2 | **0.92** | 61 | 1 | false | — | — |

**⇒ 7/7 恒为 0.92。** 两个要点：
1. **阈值两侧都测了**（高 392 > 335.5 **与** 矮 61 < 335.5）——上一轮 developer 只测矮菜单才误判"已修好"；本轮**高菜单才是原始 FAIL 的确切几何**，现在也过。
2. **`alpha=0` 的间歇性已消失**：5 次独立"force-stop → 冷起页 → 输 `/` → 量"全部 0.92。
   机制上说得通：复修把 `role` 命中的浮层**彻底豁免几何判定** ⇒ 无论最后一次 `apply()` 读到的高度是多少，`listbox` 都走 0.92 分支，竞态不再影响它。

### A-2. 主判据：**整页截图肉眼判**（比 alpha 数值重要）

- `qa-P11-r2-high-r1.png`（708,084 B）—— **我 `read_image` 亲看**：
  菜单是**不透明白色面板**，25 个条目（`dsh-push-app…`/`dsh-push-nigh…`/`dsh-self-restart`/…/`win-login-sess…`）**文字清晰、无叠印**；
  与**改前失败态对照**（`qa-P11-slash-menu.png`，那时底层正文 `The contents of this turn's changes…`、`六、一句话` **清晰压在菜单项上**）——**用户投诉的"发花"已消除**。
  ⚠️ **但仍能隐约看到底层正文的淡影**（约 8% 透光）：`两仓均已推云端、落后 0、工作树干` 与立绘轮廓在面板区域**可辨但不干扰阅读**。
  ⇒ 这是 **P2 观感残余**，**也正是 lead 决定提到 0.96 的理由**（与 developer 的判断一致）。
- `qa-P11-r2-low-r1.png`（906,843 B）—— 单个 `Plan` 项，面板不透明白色、文字清晰，无异样。
- **我没有遇到 developer 报的"DOM 说在、截图里没有"**：7 次采样每次 `screencap` 都拍到了真菜单，文件均 >700KB。
  ⇒ 你的取证链照旧可用（本次未记 BLOCKED）。

### A-3. 祖先链逐层（**21 层，`[role=listbox]` → `body`**）

| d | 元素 | alpha | bg | background-image | pos/z | 尺寸 |
|---|---|---|---|---|---|---|
| **0** | `Z9Jnlq_viewport` **[role=listbox]** | **0.92 ✅** | `rgba(255,255,255,0.92)` | none | static | **257x392** |
| **1** | `_surface_ri079_1 Z9Jnlq_menu` | **0 ⚠️** | `rgba(0,0,0,0)` | none | **absolute z=100** | **265x400** |
| 4 | `RlGAzG_card`（输入卡） | **0.45 ✅ 预期** | `rgba(255,255,255,0.45)` | none | relative | 265x98 |
| 10 | `Dc7zOa_composerSeat` | 0（**有渐变**） | `rgba(0,0,0,0)` | **linear-gradient** | sticky z=9 | 297x128 |
| 13 | `Dc7zOa_root` | 0 | transparent | none | relative | 304x671 |
| 16 | `BynINW_centerCol` | **0 ✅ 红线** | `rgba(0,0,0,0)` | none | static | 304x671 |
| 17 | `BynINW_frame` | **0 ✅ 红线** | `rgba(0,0,0,0)` | none | relative | 360x671 |
| 20 | `BODY` | **0 ✅ 红线** | `rgba(0,0,0,0)` | none | static | 360x671 |

**结论：没有"夹在菜单项与面板之间的透明层"**。菜单子树只有 **1 个上色元素**（d=0），
d=1 表层**从来就不是上色层**（复修前它的 computed bg 也是 `rgba(0,0,0,0)`，见 task-7 §3 表）⇒ **不需要"补层"**。

### A-4. **你要的 `_surface_*` 残留实测**（`265x400`，无 role）

| 项 | 实测 |
|---|---|
| computed bg | **`rgba(0, 0, 0, 0)`（仍透明）** |
| 内联值 | **`transparent` + `important`** ⇒ **确认仍被大容器分支设成 transparent** |
| 尺寸 | 265x400 vs 内层 257x392 |
| **逐边外扩（rim）** | **左 −4 / 上 −4 / 右 +4 / 下 +4 px**（即表层比 listbox **每边大 4px**） |

**判定**：
1. developer 预判"约 2px"——**实测是每边 4px**（略大于预判，但同量级）；
2. **观感无影响** ✅：我在整页图上**看不到 4px 的透明边**。原因明确：
   **d=1 表层在复修前就不是上色层**（它自带 `box-shadow` 提供层次，底色为全透明），
   **它的透明不是本轮引入的回归**，只是它依旧不参与提亮。真正上色的是 d=0（已 0.92/0.96）。
3. ⇒ **建议：不必为此单开一轮**；若要彻底干净，可把 `role` 的豁免**沿 DOM 继承给"紧邻的 absolute 包裹层"**，
   但**优先级低**（P3），且**动它反而有碰坏 veil 门槛的风险**。

### A-5. 红线复跑（QA-P12 + QA-A29）—— **数值全绿；P12 的"整页图"这一半 BLOCKED**

**数值（两跑一致，`r2-report.json` 的 `redlines_noOverlay` / `redlines_withOverlay`）**：

| 断言 | 无浮层时 | 浮层在场时 | 结果 |
|---|---|---|---|
| `BynINW_frame` | `rgba(0,0,0,0)` | `rgba(0,0,0,0)` | ✅ |
| `BynINW_centerCol` | `rgba(0,0,0,0)` | `rgba(0,0,0,0)` | ✅ |
| `html` / `body` | `rgba(0,0,0,0)` | `rgba(0,0,0,0)` | ✅ |
| **`#dsh-theme-veil`** | **0.45** | **0.45** | ✅ **未被提亮** |
| `RlGAzG_card`（非浮层） | **0.45** | **0.45** | ✅ **零误伤** |

⇒ **`QA-A29`（veil 0.45 + 输入卡 0.45）完全 PASS**；`QA-P12` 的**计算值**部分 PASS。

**⚠️ `QA-P12` 的"整页肉眼判壁纸透出"这一半 = BLOCKED（如实记录，不当 PASS）**：
我补拍 `qa-P12-r2-wallpaper.png`（2,038,279 B，尺寸达标）时，**拍到的却是 launcher 桌面**
（`Wed, Oct 14`、Gmail/Photos/YouTube、Dock）——**不是 App 页**。
**根因（有硬证据）**：该图状态栏时间是 **4:25**，而 `dumpsys package` 的 `lastUpdateTime=` **2026-10-14 16:25:16**，
且 `/data/app/` 出现新目录 `~~6Z_EB9X…`（16:25）—— **有人在我抓图的同时 `adb install -r` 了这个包，
安装会杀掉 App 进程** ⇒ 我 `am start` 起的页面被安装动作掐掉，截图落在桌面。
**⇒ 这是"跑了没量到"，按纪律记 BLOCKED，不当 PASS。**
（可用的旁证：task-7 的 `qa-P12-wallpaper.png`（947,510 B）**我亲眼看过**整页壁纸+立绘正常透出，
但那是**复修前**的 build ⇒ 只能当参考，**不能替代复修后的 P12 目视验收**。Part B 会补这一张。）

⇒ **v1.32.6「壁纸整层消失」与 veil 两条红线：数值上均未被复修破坏；P12 的目视那一半待 Part B 补齐。**

### A-5b. ⚠️ 采样期间发生了**并发装机** —— 已核对，**我的数据集没有横跨版本**

| 时刻 | 事件 | 证据 |
|---|---|---|
| Part A 采样 | 7 次菜单 + P13/C12 | 全部落在同一次运行（`r2-report.json`，同一 pid 段） |
| **16:25:16** | **`adb install -r`（他人/developer）** | `lastUpdateTime=2026-10-14 16:25:16`；`/data/app/` 新目录 `~~6Z_EB9X…`；旧目录 `~~OWu6ng36…` 消失 |
| 16:25 之后 | 我补拍 P12 → 拍到 launcher | 安装杀进程所致（见 A-5） |

**关键完整性核对（这决定 Part A 是否作废）**：
- 采样前已装 APK sha256 = **`cb1a4ce84032d670f1621c1c33b34cb1e45c5007025c9958bbecda2461ec08db`**
- 换目录后重读 sha256 = **`cb1a4ce84032d670f1621c1c33b34cb1e45c5007025c9958bbecda2461ec08db`** —— **完全相同**
⇒ **只是同一份 APK 被重装（换目录），不是换版本** ⇒ **Part A 的 7 次采样确实都在同一个 build 上，未横跨版本。**
（这也说明：**现在设备上仍是 0.92 build**，0.96 的源码改动尚未构建装机。）

### A-6. 补上一轮的 U-1 / U-2

- **U-1（QA-P13 展开态侧栏）→ PASS** ✅
  `Open sidebar`（JS `dispatchEvent`，因为 CDP 合成点击会被 `SECTION._tabHost_*` 抢走目标）：
  收起态 `alpha=0.45 / w=55.5 / collapsed=true` → 展开态 **`alpha=0.92 / w=280 / position=fixed / z=60`** → 点浮层外 → **回到 `0.45 / 55.5`**（C12 一并 PASS）。
  整页图 `qa-P13-r2-sidebar-expanded.png`（806,250 B）我亲看：面板 280px 完整、条目清晰。
- **U-2（QA-C11 滚动到底）→ PASS** ✅（本轮**把滚动排在点击之前**）
  浮层内真实滚动容器：`scrollTop 0 → 548`，`scrollHeight=940`，`moved=true`，
  **`lastItemFullyVisible=true`**（末项 `win-login-session-ops判断与处置` 完整可见）、`itemCount=25`。
  随后真点 `Goal`（中心 202,224）→ **`menuClosedAfterClick=true`**（未误触邻居、未无反应）。

### A-7. 设备复位

`pidof` = **空** ✅ ｜ `forward --list` = **空** ✅ ｜ `whoami=root` ✅ ｜ `font_scale=1.0` ✅ ｜ `wm 1440x3168/640`（无 override）✅
未推 ntfy ✅ ｜ 未切 GPU ✅ ｜ 未冷启 ✅

---

## Part A 判定：**PASS-with-findings**（针对 **0.92 build**）

- **P0/P1：无。** 用户投诉的"菜单太透、文字发花"**已消除**（7/7 alpha=0.92 + 整页肉眼判）；
  间歇性 `alpha=0` **已消失**（5 次独立采样全绿）。
- **P2-1（唯一 finding）**：0.92 下仍可见**底层正文淡影（约 8% 透光）** ⇒ **正是 lead/developer 提到 0.96 的理由**，Part B 复验期望值改为 **0.96**。
- **P3-1**：外层 `_surface_*` 仍 `transparent`（每边 4px rim），**观感无影响**，可选修、**建议不动**。
- 其余：veil 0.45 ✅、输入卡 0.45 ✅、P13 展开态 0.92 ✅、C12 收起 ✅、C11 滚动+点项 ✅；
  **P12 计算值 ✅ / P12 目视 ⛔ BLOCKED**（补拍时被并发装机杀掉进程，拍到 launcher —— 见 A-5）。

**⇒ 若 0.96 build 在 Part B 复现同等稳定性、淡影消失、且补上 P12 目视图，则可判 `PASS`。**

---

## Part B：0.96 build 复验结果（**已完成 —— 本轮最终验收**）

**被验 build**：`49a0ebd` / sha **`cb1a4ce8…`**（开工读一次 ✅ 匹配、收工再读一次 ✅ 相等 ⇒ `stable=true`）
**探针**：`qa-overlay-r2.mjs`（主）+ `qa-overlay-r2b.mjs`（补完：LOW/P13/C12/A29）
**原始数据**：`F:\work\work_dsh\tmp\r2b-report.json` + 主探针 stdout

### B-1. QA-P11 主验收：alpha 稳定性 —— **7/7 恒为 0.96** ✅

| 轮次 | alpha | 菜单高 h | 项数 | `h > vh*0.5`(335.5) | 内联值 |
|---|---|---|---|---|---|
| HIGH R1 | **0.96** | 392 | 25 | **true** | `rgba(255,255,255,0.96)` |
| HIGH R2 | **0.96** | 392 | 25 | true | — |
| HIGH R3 | **0.96** | 392 | 25 | true | — |
| HIGH R4 | **0.96** | 392 | 25 | true | — |
| HIGH R5 | **0.96** | 392 | 25 | true | — |
| LOW R1 | **0.96** | 61 | 1 | **false** | `rgba(255,255,255,0.96)` |
| LOW R2 | **0.96** | 61 | 1 | false | — |

**⇒ 7/7 = 0.96，阈值两侧（高 392 > 335.5 / 矮 61 < 335.5）都覆盖**，
且**5 次独立"force-stop → 冷起页 → 输 `/`"全部 0.96** ⇒ **间歇性不再出现**（0.92 轮也是 5/5 稳，机制一致：`role` 命中彻底豁免几何判定）。

> **采样期间的一次中断（已排除）**：第一遍跑到 HIGH R3 时设备 `offline` ——
> 自愈日志给出原因：`00:32:10 renderer: (COULD NOT READ)` → **`WARNING: renderer line unreadable -> failing CLOSED`** →
> **`VIOLATION: guest is healthy but NOT rendering on the host GPU`** → `killing emulator tree, pids 23252,28612` → rung 1 `-gpu host` 重启。
> ⇒ **这是加固版自愈的既定行为（fail-closed + 主动纠正），不是故障**；且**它只重启模拟器、没换 build**：
> 重启后重读 sha256 仍 = `cb1a4ce8…`。被我丢弃的那 2 个样本（也是 0.96）不计入本表，本表全部来自**一次连续、未被中断的运行**。

### B-2. **主判据：整页截图肉眼判 —— 淡影已基本消除** ✅

- `qa-P11-r2-high-r1.png`（645,851 B）—— **我 `read_image` 亲看**：
  菜单是**不透明白色面板**，25 个条目文字**清晰、锐利、无叠印**；
  对比 0.92 轮的同一位置（`qa-P11-r2-high-r1.png` 旧版，708,084 B）里**能辨出 `两仓均已推云端…` 与立绘轮廓的淡影**，
  **0.96 这版底层正文的淡影已不可辨**（仅在面板边缘外侧还能看到背景本身，这是正常且期望的）。
  ⇒ **0.96 的唯一目的（消除 0.92 那层淡影）达成**。
- `qa-P11-r2-low-r1.png`（900,669 B）：单 `Plan` 项，面板不透明、文字清晰。

### B-3. 祖先链 / `_surface_*` 残留（红线与残留复核）

- 祖先链结论与 Part A 一致（**菜单子树只有 1 个上色元素 = `[role=listbox]` 本体，现为 0.96**），
  **不存在夹在菜单项与面板之间的中间透明层** ⇒ **不补层**（与你我此前结论一致）。
- **`_surface_ri079_1 Z9Jnlq_menu`（265x400，无 role）**：仍 `transparent`（内联 `transparent !important`）。
  内层 `[role=listbox]` 257x392 → **rim 每边 4px**（与 Part A 实测一致）。
  **观感判定：整页图上仍看不到这 4px 透明边** ⇒ **无影响**。
  按 lead 决定：**不单开一轮**（它复修前就不是上色层，非本轮回归）。

### B-4. 红线复跑 —— **P12 / A29 全部保住** ✅

**QA-A29（非浮层零误伤）**，实测（`r2b-report.json`）：

| 元素 | alpha | 判定 |
|---|---|---|
| **`#dsh-theme-veil`** | **0.45** | ✅ **未被提亮**（红线保住） |
| `RlGAzG_card`（输入卡） | **0.45** | ✅ 零误伤 |
| `BynINW_frame` | **0 / transparent** | ✅ 壁纸通道 |
| `[role=listbox]`（目标浮层） | **0.96** | ✅ 正确提亮 |

**A29 多浮层共存（补上一轮未覆盖）**：`dialog / alertdialog / tooltip / menu` 在当前页面**均 `present:false`**
（界面场景里唤不出）⇒ **如实记「未覆盖」**，但**已把它做成探针的常驻断言**（下轮任何浮层出现即自动纳入）。

**QA-P12（壁纸通道 · 含上轮 BLOCKED 的"整页目视"）→ 本轮补齐** ✅
- 数值：`frame / centerCol / html / body` 全 `rgba(0,0,0,0)`（`frame` 内联 `transparent important`）。
- **整页目视（本轮新拍 `qa-P12-r2-wallpaper.png`，105,727 B）**：**我 `read_image` 亲看** ——
  画面是**起始页**（`Into the Unknown` 区、`The contents of this turn's changes are no longer available`、顶部标签栏），
  **背面原生壁纸的淡蓝/云朵纹理透出**，**没有被白纱整体盖住** ⇒ **壁纸通道正常**。
- 同时用 `P12_ALIVE before=true/3555 after=true/3555`（同一 pid、shell 仍在）**证明截图时 App 进程活着**
  —— 这正是上轮 BLOCKED 的成因（并发装机杀进程），本轮已排除。

### B-5. P13 / C11 / C12 不回退 —— 全部 ✅

| 项 | 实测 | 判定 |
|---|---|---|
| **P13 收起态** | `alpha=0.45 / w=55.5 / collapsed=true` | ✅ 与 Part A 一致 |
| **P13 展开态** | **`alpha=0.92 / w=280 / position=fixed / z=60`** | ✅ **未回退**（`bwPanelBg()` 仍是 0.92，**未被 0.96 波及**，符合预期） |
| **C12 点浮层外收起** | 展开 → 点 (340,430) → **`collapsed=true / w=55.5 / alpha=0.45`** | ✅ |
| **C11 滚动到底（排在点击前）** | Part A 已 PASS（`scrollTop 0→548`、末项完整可见、25 项）；Part B 采样流程沿用同序 | ✅ 未回退 |
| **C11 点菜单项** | Part B `qa-C11-r2-menu-clicked.png`（1,006,467 B）已拍，`menuClosedAfterClick` 在 Part A 为 true | ✅ |

### B-6. 设备复位

`pidof` **空** ✅ ｜ `forward --list` **空** ✅ ｜ `whoami=root` ✅ ｜ `font_scale=1.0` ✅ ｜ `wm 1440x3168/640`（无 override）✅
**未推 ntfy** ✅ ｜ **未切 GPU** ✅ ｜ **未冷启**（那次重启是**自愈自己做的**，不是我）✅

---

## Part B 判定：**PASS** ✅

**最终结论（针对冻结版 0.96 / `cb1a4ce8…`）：`PASS`。**

| 判据 | 结果 |
|---|---|
| **QA-P11 主验收** alpha | **7/7 = 0.96**（含阈值两侧、5 次独立采样）✅ |
| **主判据**：整页肉眼判"不再发花 / 淡影消除" | ✅ **0.96 的目的达成**，用户投诉的观感问题解决 |
| 祖先链无中间透明层 | ✅（不需要补层） |
| **P12 壁纸通道**（数值 + 整页目视） | ✅ **含上轮 BLOCKED 的目视部分，本轮补齐** |
| **A29 veil 仍 0.45** / 输入卡 0.45 / frame transparent | ✅ 红线全保 |
| P13 展开态 0.92 / C12 / C11 | ✅ 未回退 |
| `_surface_*` 4px rim | ✅ 观感无影响（P3，按 lead 决定不动） |
| 哈希 bracket | ✅ 采样前后同哈希（`stable=true`） |

**无 P0/P1，无 P2**（0.92 的 P2 淡影已被 0.96 消除）。**⇒ 具备放行条件。**
**唯一残留 P3**：`_surface_*` 4px 透明 rim（观感无影响，建议不动）。
**未覆盖（如实列出，不影响放行）**：A29 多浮层共存（页面上唤不出 dialog/tooltip/toast）；整轮全量（按规定留体验轮）；命中区几何（本轮未动尺寸 ⇒「未涉及」）。

---

## 未覆盖 / BLOCKED（最终态）

| ID | 状态 | 内容 |
|---|---|---|
| **A29 多浮层共存** | **未覆盖** | `dialog/alertdialog/tooltip/menu` 在当前页面 `present:false`，唤不出；**已做成探针常驻断言**，下轮任何浮层出现即自动纳入 |
| **U-3 命中区几何** | 未覆盖 | 本轮只改 `background-color`、**未动浮层尺寸/内边距** ⇒ 记「**未涉及**」（`TESTER.md` §3.6） |
| **U-5 整轮全量** | 未覆盖 | 按规定留给"体验轮" |
| **P12 目视图** | ✅ **已补齐**（上轮 BLOCKED → 本轮 PASS，见 B-4） |
| **Part A 哈希标签** | ✅ **已更正 + 新纪律已执行**（见 §0.1 / §0.2） |

**"跑了没量到"声明**：无计入 PASS 的空测量。
Part B 第一遍被自愈中断的 2 个样本（亦为 0.96）**已丢弃、未计入**；最终 7/7 来自一次连续未中断的运行。
所有关键截图**均由我 `read_image` 逐张看过**（Part A 7 张 + Part B 4 张）。

---

## 交付物

| 产物 | 路径 |
|---|---|
| 本报告 | `verify/QA-ROUND-v1.32.11-r2.md` |
| 主探针（含哈希 bracket + P12 存活断言） | `verify/qa-overlay-r2.mjs`（21,901 B，纯 ASCII，`node --check` rc=0） |
| 补完探针（LOW/P13/C12/A29 + bracket close） | `verify/qa-overlay-r2b.mjs`（9,953 B，纯 ASCII，`node --check` rc=0） |
| Part A 原始数据 | `F:\work\work_dsh\tmp\r2-report.json`（24,006 B） |
| **Part B 原始数据** | `F:\work\work_dsh\tmp\r2b-report.json` |
| 截图（r2 标记） | `F:\work\work_dsh\tmp\shots\qa\`（Part A 11 张）+ `F:\work\work_dsh\tmp\shots\qa\r2b\`（Part B：`qa-P11-r2-high-r1.png` 645,851 B、`qa-P11-r2-low-r1.png` 900,669 B、`qa-P12-r2-wallpaper.png` 105,727 B 等） |
| 改前失败对照 | `F:\work\work_dsh\tmp\shots\qa\qa-P11-slash-menu.png`（task-7 的 alpha=0 现场） |

```powershell
# 复现（编排机 → 笔电）；token 从 ~/.dsh/web.log 最后一条 'dsh web:' 现取（DSH 重启必换）
powershell -File verify\emu-gpu-verdict.ps1                      # 期望 exit 0
# 第 6 个参数 = 冻结哈希；不匹配则 fail-closed 拒绝采样（新纪律）
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-overlay-r2.mjs `"<URL>`" G:\Android\qa-r2d 5 2 cb1a4ce84032d670f1621c1c33b34cb1e45c5007025c9958bbecda2461ec08db"
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-overlay-r2b.mjs `"<URL>`" G:\Android\qa-r2d cb1a4ce84032d670f1621c1c33b34cb1e45c5007025c9958bbecda2461ec08db 2"
```

---

## 附：本轮给仓库的新增纪律（建议进 `README.md` / `TESTER.md`）

1. **哈希 bracket**：冻结 build 的 sha256 **必须在采样前后各读一次**，且**与采样同刻**；
   单次读不能证明"这批数据出自哪个 build"。**本报告 §0.1 的错标就是这条纪律的来源。**
   探针已实现：把期望哈希作为参数，**不匹配即 `throw BLOCKED` 拒绝采样**（fail-closed）。
2. **`qa-overlay-r2.mjs` 的 `connect()` 需重试**：模拟器冷启后 devtools socket 约 25s 才出现，
   单次 `fetch` 会 `fetch failed` ⇒ 已改为 **20 次有界重试**（本就是 `README` 记过的坑）。
3. **自愈会 fail-closed 杀模拟器**：`renderer line unreadable` 也会判 `VIOLATION`（宁可错杀）；
   采样中途设备 `offline` 先看 `G:\Android\emu-ladder.log` 的 `VIOLATION` 行再定性 —— **本轮的 00:32 中断即此**。
4. **P12 整页目视要断言"App 进程活着"**：并发 `install -r` 会杀进程，拍到 launcher 就成 BLOCKED
   （上轮教训）⇒ 截图前后各读一次 `pidof`/shell 存在性，本轮已内建。
