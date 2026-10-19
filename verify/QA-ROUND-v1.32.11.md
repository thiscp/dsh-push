# QA-ROUND v1.32.11 结论: FAIL

> **对象**：`xyz.cpyh.dshpush` v1.32.11 / versionCode **77**（`dumpsys` 实测）
> **主题**：slash 指令菜单浮层不透明度（用户原话「选择传文件的控件背景透明度是否太低了点」）
> **执行者**：teammate tester ｜ **时间**：2026-10-15 00:06–00:12 (+08:00)
> **设备**：`emulator-5554`（笔电 <win-host-a>）｜ **档位**：真 GPU（`emu-gpu-verdict.ps1` **exit 0**，RTX 4060 Laptop）
> **几何**：1440x3168@640，CDP `innerWidth=360 / innerHeight=671 / dpr=4`
> **被测 HEAD**：`b8c432428439`（含 task-6 实现 `59c9c2d`）
> **判据**：两次独立探针跑（`qa-overlay-probe.mjs` + `qa-overlay-layers.mjs`）+ **每张图我自己 `read_image` 看整页**

---

## 0. 一句话结论（**推翻了 lead 的假设，也推翻了我自己上一版判断**）

**FAIL（P1）** —— 但根因不是「0.92 不够」，而是 **同一个版本、同一台设备，浮层表层的不透明度是"掷硬币"的**：

| 跑次 | 时间 | `[role=listbox]` 表层实测 | 整页肉眼 |
|---|---|---|---|
| **Run A**（`qa-overlay-probe.mjs`） | 16:06:07Z | **`rgba(0,0,0,0)`，alpha = 0**，内联被写成 `transparent !important` | **底层聊天正文与立绘照旧透上来、文字发花（＝用户投诉原状）** |
| **Run B**（`qa-overlay-layers.mjs`） | 16:09:52Z | **`rgba(255,255,255,0.92)`，alpha = 0.92** | 底色到位，背后文字**仅隐隐可见**（8% 透射） |

**⇒ 用户的问题在 Run A 那种状态下根本没被修；而 Run A 不是罕见路径 —— 它是"菜单项渲染到超过视口一半高度"时的必然结果。**

### 对 lead 假设的直接回答（你要的那组实测）

你问「是不是有一个**中间层还是透明的**、所以调 alpha 没用」。**实测答案：不是分层问题。**

- **从 `[role=listbox]` 到 `body` 共 21 层**，我逐层量了 `bg / alpha / background-image / position / z-index / 尺寸 / ::before / ::after`（见 §3 全表）；
- **菜单子树里"真正在画底色"的元素只有 1–2 个**（`menuPainters`）：表层 `Z9Jnlq_viewport` + 唯一高亮项；
- 表层与其祖先之间**没有第三个"夹在中间的上色层"**；
- 所以 **0.92 在 Run B 里确实生效了**（同一次跑里 outer surface 透明、inner 0.92，视觉正常）。
  ⇒ **不是"面板亮了、中间层还透明"，而是"表层自己有时被写成 transparent"**。

**但你的另一半直觉是对的**：即使 0.92 生效，**8% 透射 + 无 `backdrop-filter`**，背后是高对比密集中文正文时**仍能看出字形**（Run B 截图可见 `六、一句话`、`判据 + 一条命令 + 自测夹具` 的淡影）。这属 **P2 观感残余**，不是 P1。

**⇒ 修法**：**不要动 0.92 这个数值**（你判断正确——调参只会掩盖问题）。
要修的是**判定顺序**：`isOv` 必须**先于**大容器分支生效（见 §2 的精确行号与算术）。

---

## 1. 判据汇总

| 用例 | 断言 | 实测 | 结论 |
|---|---|---|---|
| **QA-P11** 浮层 alpha ≥0.92 | ≥0.92 | **Run A = 0（transparent）｜Run B = 0.92** ⇒ **不稳定** | **FAIL (P1)** |
| QA-P11b 肉眼「不再发花」 | 文字清晰、不透背 | Run A **发花严重**；Run B **仅淡影** | **FAIL (P1)**（Run A）/ P2（Run B 残余） |
| **QA-P12** 大容器 transparent + 壁纸透出 | 仍 transparent | frame/centerCol/html/body **全 `rgba(0,0,0,0)`**；整页图壁纸+立绘完整透出 | **PASS** |
| **QA-P12b** `#dsh-theme-veil` 仍 0.45 | 0.45 | **0.45**（两跑一致，`z-index:-1`） | **PASS**（你的读码推演被实测证实） |
| **QA-P13** 展开态侧栏 ≈0.92 | ≈0.92 | **0.92**（w=280, `fixed`, z=60）；收起态 **0.45 / 55.5** | **PASS** |
| **QA-C11** `/` 弹菜单 / 点项 | 可用 | 弹出 ✅（**25 项**）；真点 `Goal` → **菜单关闭** ✅；**滚动未测到** | **PASS-with-gap** |
| **QA-C12** 点浮层外收起侧栏 | 收起 | **点击后 `collapsed=true`、w=55.5** ✅ | **PASS** |
| **QA-A29** fixed/absolute 不误伤 | 非目标不变 | veil 0.45 ✅ / `RlGAzG_card` 0.45 ✅ / frame transparent ✅；**并成功抓到 P11 的不稳定（反向漏亮）** | **PASS**（作为"探雷器"有效） |
| 设备复位 | — | force-stop ✅ / forward 空 ✅ / `whoami=root` ✅ | **PASS** |

---

## 2. FINDING-1 [P1] 浮层表层**时好时坏**：大容器 `transparent` 分支与 `isOv` 分支**顺序颠倒 + 尺寸阈值正好卡在菜单真实高度上**

### 2.1 机制（对 `WebActivity.kt:374-398` 逐行 + 实测算术）

当前决策树顺序（改后）：

```js
var isOv=false;
... role/几何判定 isOv ...                 // :374-384   ← role=listbox ⇒ isOv=true
if(!m)continue;                            // :385
if(!isOv && alpha<1) continue;             // :388-389   ← 浮层豁免（正确）
var skipBg=...;
if(w>vw*0.5 && h>vh*0.5){                  // :392  ← ★ 大容器分支：无条件，且在 isOv 之前
  background-color: transparent !important;
} else if(isOv){ ... 0.92 ... }            // :394  ← 只有上面不成立才轮到
else if(!skipBg){ ... 0.45 ... }
```

**关键算术**（`vw=360, vh=671` ⇒ 阈值 `vw*0.5=180`、`vh*0.5=335.5`；真实菜单 `257x392`、**25 项**）：

- `257 > 180` → **true**
- `392 > 335.5` → **true**（**只超 56.5px —— 菜单一长就必然越界**）

⇒ 两条同时成立 ⇒ **菜单落进大容器分支，被强制设成 `transparent`**，`else if(isOv)` 的 0.92 **永远轮不到**。

### 2.2 为什么是"不稳定"而不是"稳定坏"（本次最重要的新事实）

`apply()` 会跑**多次**（首次 + `setTimeout 1500` + `setTimeout 4000` + MutationObserver 防抖 400ms），
而菜单是**渐进渲染**的（25 项陆续挂载 ⇒ 高度从矮长到 392）。**最后一次 `apply()` 读到的 `h` 决定终态**：

| 最后一次 apply 时菜单高度 | 落进哪个分支 | 终态 |
|---|---|---|
| `h ≤ 335.5` | `else if(isOv)` | **0.92 ✅**（Run B） |
| `h > 335.5` | 大容器分支 | **`transparent` ❌**（Run A） |

⇒ **同一版本、同设备、同一操作，两种结果**。这正是实测到的 Run A / Run B 差异。
**用户只要让菜单长到 25 项（默认就是这样），就有很大概率撞上 `transparent`。**

### 2.3 证据

| 证据 | 路径 | 关键值 |
|---|---|---|
| Run A（坏） | `F:\work\work_dsh\tmp\shots\qa\qa-P11-slash-menu.png`（985,987 B） | 表层 `bg=rgba(0,0,0,0)`、`inlineBg="transparent"`、`priority=important` |
| Run A JSON | `F:\work\work_dsh\tmp\qa-overlay-run2.json` → `cases.QA-P11` | `overlay.alpha=0`、`surfaceAbs.alpha=0` |
| Run B（好） | `F:\work\work_dsh\tmp\shots\qa\qa-P11-slash-menu-layers.png`（642,746 B） | 表层 `bg=rgba(255,255,255,0.92)`、`inlineBg="rgba(255,255,255,0.92)"` |
| Run B JSON | `F:\work\work_dsh\tmp\layers-report2.json` → `ancestorChain[0]` | `alpha=0.92`、`inlinePrio=important` |
| 改前对照（用户真机） | `F:\work\work_dsh\tmp\shots\qa\v1.32.11-before-user-report.jpg`（322,712 B） | 立绘+正文重叠、发花 |

**⚠️ 对 lead 的一条重要澄清**：你判定用的那张 `qa-P11-slash-menu.png` **是 Run A 的产物**，即拍摄当时表层 alpha = **0（`transparent`）**，**不是 0.92**。
所以你看到的"底层正文清晰可读"是**完全没底色**导致的，而不是"0.92 的 8% 透射"。
⇒ 结论方向一致（**FAIL**），但**归因要改**：**主因是"有时彻底透明"，不是"0.92 不够"**。

---

## 3. 你要的「祖先链每层 alpha」全表（Run B，`[role=listbox]` → `body`，21 层）

> 量到 `background-image` 是**必须的**：`background-color:transparent !important` **不会**移除渐变背景，
> 只量 `background-color` 会把"靠 gradient 上色的层"整个漏掉。

| d | tag | class / role | **bg (alpha)** | background-image | position | z | 尺寸 | 内联 |
|---|---|---|---|---|---|---|---|---|
| **0** | DIV | `Z9Jnlq_viewport` **[role=listbox]** | **rgba(255,255,255,0.92) = 0.92** ✅ | none | static | auto | **257x392** | `rgba(255,255,255,0.92)` **important** |
| **1** | DIV | `_surface_ri079_1 Z9Jnlq_menu` | **rgba(0,0,0,0) = 0** ⚠️ | none | **absolute** | **100** | **265x400** | `transparent` **important** |
| 2 | DIV | （匿名包裹） | 0 | none | static | auto | 0x0 | — |
| 3 | DIV | `RlGAzG_overlayAnchor` | 0 | none | absolute | auto | 265x**0** | — |
| 4 | DIV | `RlGAzG_card`（输入卡） | **0.45** | none | relative | auto | — | `rgba(255,255,255,0.45)` important |
| 5 | DIV | `RlGAzG_root` | 0 | none | static | auto | — | — |
| 6–9 | DIV | （匿名） | 0 | none | static | auto | — | — |
| 10 | DIV | `Dc7zOa_composerSeat` | 0 | **linear-gradient(…transparent → rgb(255,255,255)…)** ⚠️ | sticky | 9 | — | — |
| 11 | DIV | `Dc7zOa_scrollBody` | 0 | none | static | auto | 595 高 | — |
| 12 | DIV | `Dc7zOa_body` | 0 | none | relative | auto | — | — |
| 13 | DIV | `Dc7zOa_root` | 0 | none | relative | auto | — | `transparent` important |
| 14–15 | DIV | （匿名） | 0 | none | static | auto | — | — |
| 16 | DIV | `BynINW_centerCol` | **0** (transparent) ✅ | none | static | auto | 304x671 | — |
| 17 | DIV | `BynINW_frame` | **0** (transparent) ✅ | none | relative | auto | 360x671 | `transparent` important |
| 18–19 | DIV | （匿名） | 0 | none | static | auto | — | — |
| 20 | BODY | — | **0** (transparent) ✅ | none | static | auto | 360x671 | `transparent` important |

### 3.1 哪几层仍透明 / 低 alpha？（**夹在菜单项与面板之间的**）

| 层 | alpha | 判定 | 影响 |
|---|---|---|---|
| d=1 `_surface_ri079_1 Z9Jnlq_menu`（**表层容器，265x400**） | **0** | **透明** | **本轮修的就是它** —— 它被大容器分支设成 `transparent`（Run A 里 d=0 也是 0）。Run B 里 d=0 补上了 0.92，视觉靠 d=0 撑住；**但 d=0 一旦也被判成大容器，两层全透明 ⇒ Run A 的惨状** |
| d=4 `RlGAzG_card` | 0.45 | 预期值 | **非浮层，保持 0.45 是正确行为**（无误伤） |
| d=10 `Dc7zOa_composerSeat` | 0（但**有渐变 background-image**） | 预期 | 输入框上方的渐隐遮罩，**不属菜单**；**它证明"只量 background-color 会漏层"** |
| d=2/3/5–9/14–15/18–19 | 0 | 无害 | 多为 `0x0` 或纯布局包裹层，不在菜单与面板之间上色 |
| d=16/17/20 | 0（transparent） | **红线，必须保持** | 壁纸通道 ✅ 本轮未被破坏 |

**⇒ 「夹在菜单项与面板之间的透明层」= d=1（表层容器）。**
但它**不是"第三层"**：`menuPainters` 全量扫描显示，**菜单子树里真正上色的只有 2 个元素**
（d=0 表层 0.92 + 唯一高亮项 `Z9Jnlq_item Z9Jnlq_active` `rgba(38,49,72,0.06)`），
**没有隐藏的第三个上色层**。所以**调 0.92 数值确实无意义，但也不需要"补一层"——要修的是判定顺序**。

### 3.2 QA-A29 的「反向漏亮＝假达标」结果

**命中了，而且是本轮最有价值的一次命中。**

- 全量扫 `fixed|absolute`（浮层在场时）：`#dsh-theme-veil` **0.45** ✅、`RlGAzG_card` **0.45** ✅、`BynINW_frame` **0** ✅；
- **但菜单祖先链上 d=0 在 Run A 是 0、在 Run B 是 0.92** —— 同一条链、同一版本，两次结果不同。
  ⇒ **"该亮的没亮"确实发生了**（Run A 全链 0），**并且它暴露的是"不稳定"而非"少一层"**。
- 结论：这条对抗用例**值得保留为常驻** —— 它能抓到"alpha 达标/不达标随机"这种**单次测量抓不到**的缺陷
  （若只跑一次 Run B，我会误判 PASS）。

---

## 4. 逐条用例（其余项）

### QA-P12 壁纸通道回归 —— **PASS**
- 断言：`BynINW_frame` / `BynINW_centerCol` / `html` / `body` 仍 `rgba(0,0,0,0)`；**整页**图壁纸+立绘透出。
- 实际：四者**全部 `rgba(0,0,0,0)`**（frame/body/html 内联 `transparent important`）；
  整页图 `qa-P12-wallpaper.png`（947,510 B）—— 壁纸、云朵、**立绘完整透出**，未被白纱/深纱盖住 ✅。
- `#dsh-theme-veil` = `rgba(255,255,255,0.45)`、**alpha 0.45**、`z-index:-1`、360x671 ⇒ **lead 档案 §3 的读码推演由实测证实**。
- 证据：`F:\work\work_dsh\tmp\shots\qa\qa-P12-wallpaper.png`

### QA-P13 展开态侧栏 —— **PASS**（上一版报告记为 BLOCKED，**现已补测通过**）
- 断言：展开态 alpha ≈0.92、width ≈280、`position:fixed`；收起态不受影响。
- 实际：展开态 **alpha=0.92、w=280、`position=fixed`、`z-index=60`、内联 `rgba(249,250,251,0.92) important`**；
  收起态 **alpha=0.45、w=55.5、`collapsed=true`** ⇒ `bwPanelBg()` **未被破坏**。
- 定位方法：`Open sidebar` 按钮（`_2H3hWW_iconButton _2H3hWW_toggle` @24,36）用 **JS `dispatchEvent(new MouseEvent('click'))`** 成功展开
  （CDP 合成点击会被 `_tab_*` 抢走目标 —— 与 §5 输入坑同源）。
- 证据：`F:\work\work_dsh\tmp\shots\qa\qa-P13-sidebar-expanded.png`（792,304 B，整页：面板 280px、条目清晰、背后正文仅淡淡透出）

### QA-C11 菜单交互 —— **PASS-with-gap**
- `/` 弹出菜单 ✅（**25 个可见项**）；**真点 `Goal`（`role=option` @202,224）→ 菜单关闭** ✅（未误触邻居、未无反应）。
- **滚动未测到**（探针把滚动排在点击之后，菜单已关闭 ⇒ 量到 `scrollHeight=0` 是"元素已卸载"）⇒ **未覆盖**，不得当通过。
- 证据：`F:\work\work_dsh\tmp\qa-overlay-run2.json` → `cases.QA-C11`；截图 `qa-C11-menu-clicked.png`（1,008,410 B）

### QA-C12 点浮层外收起侧栏 —— **PASS**
- 展开态（280px）→ 在浮层外 (340,420) 真点 → **`collapsed=true`、w=55.5** ✅，无被裁碎片。
- 证据：`F:\work\work_dsh\tmp\shots\qa\qa-C12-after-outside-tap.png`（1,011,365 B，整页）

### 设备复位 —— **PASS**
`am force-stop` 后 `pidof` 空 ✅｜`adb forward --list` 空 ✅｜`whoami=root` ✅（task-4 要求保留 root）｜未推 ntfy ✅｜未切 GPU ✅｜未冷启 ✅

---

## 5. 工具坑（**推翻 developer 的结论**，建议进 `verify/README.md`）

> developer 报「`Input.insertText` 对该输入框插 0 字符，必须用 `adb shell input text`」——**实测恰好相反**。

| 策略（逐一单独试） | 结果 |
|---|---|
| **`el.focus()`（不点击）+ `Input.insertText("/")`** | ✅ **成功**：文本变 `/`、`[role=listbox]` 出现（**25 项**） |
| CDP 合成点击 + `adb shell input text "/"` | ❌ 插 0 字符 |
| CDP 合成点击 + `adb shell input keyevent 76` | ❌ 插 0 字符 |
| CDP 合成点击 + CDP KeyEvent 三元组（`Slash`） | ❌ 插 0 字符 |

**根因**：**CDP 合成的鼠标点击会抢走键盘焦点** —— 点击后 `document.activeElement` 变成
`SECTION._tabHost_6nhg2_162._pane_6nhg2_209`，之后所有 key/IME 事件都发给没有焦点的元素。
`el.focus()` 拿到真焦点 ⇒ 工作。
**同一坑也咬到了侧栏展开**（`Open sidebar` 的合成点击被 `_tab_*` 吃掉，改用 JS `dispatchEvent` 才展开，见 QA-P13）。

**建议写入 README（WebView 远程调试节）**：
> CDP 合成鼠标点击会抢走输入焦点（`activeElement` 落到 tab 容器）；
> 给富文本编辑器输入用 **`el.focus()`（不点击）+ `Input.insertText`**；
> 点按钮若"点了没反应"，先查 `document.elementFromPoint` 的 owner，改用 `dispatchEvent` 兜底。

---

## 6. 未覆盖 / BLOCKED（**下轮不得当已验**）

| ID | 状态 | 内容 | 怎么补 |
|---|---|---|---|
| **U-1** | **未覆盖** | **QA-C11 滚动到底**（探针排在点击之后，菜单已卸载） | 把滚动步骤**排到点击之前**重跑 |
| **U-2** | **未覆盖** | **QA-A29 多浮层共存**（toast / 通知条 / dialog）未唤出 | 需推送或特定交互；本轮不推 ntfy ⇒ 留下轮 |
| **U-3** | **未覆盖** | **命中区几何三步**（`TESTER.md` §3.6） | 本轮 CSS 只改 `background-color`、**未动浮层尺寸/内边距** ⇒ 记「**未涉及**」 |
| **U-4** | **未覆盖** | 「改前 alpha」的旧版实测 | 旧 APK 现场已不存在（lead 档案 §6 已声明）；本轮实测到 **0 与 0.92 两个值** |
| **U-5** | **未覆盖** | 整轮 34/45 项全量回归 | 按 task-7 规定「全量留给体验轮」 |
| **U-6** | **需复测** | **不稳定性本身需要多次采样钉死**（本轮 n=2：1 次 0、1 次 0.92） | 修完后连跑 **≥5 次**，每次记录 `h@lastApply` 与终态 alpha，确认恒为 0.92 |

**「跑了没量到」声明**：QA-C11 的滚动、QA-A29 的多浮层**都没有**被算作 PASS（分别记未覆盖）。
**并且我明确推翻了自己上一版报告的结论**（上一版写"根因＝大容器分支恒赢、alpha 恒为 0"）——
Run B 证明它**不是恒为 0，而是随机**；已按实测更正。

---

## 7. 建议修法（**给 developer / lead，不含数值调节**）

**核心：让 `isOv` 优先于大容器分支。** 取其一即可（最小改动优先）：

1. **调整顺序**（推荐）：
   ```js
   if(isOv && !(w>vw*0.5 && h>vh*0.5)) { ...0.92... }   // 浮层先判
   else if(w>vw*0.5 && h>vh*0.5){ ...transparent... }   // 大容器红线保留
   else if(!skipBg){ ...0.45... }
   ```
2. **或给大容器分支加浮层豁免**：`if(!isOv && w>vw*0.5 && h>vh*0.5){ transparent }`
3. **或让 `role` 命中的浮层绕过所有几何判定**（语义最清晰、最抗上游改动）：
   `role ∈ {menu,listbox,dialog,alertdialog,tooltip}` ⇒ 直接 0.92，**不再看面积**。

**三条红线（改完必须复跑，本轮已建立正确基线）**：
- **QA-P12**：`BynINW_frame` / `centerCol` / `html` / `body` 必须仍 `transparent`（v1.32.6 壁纸整层消失的教训）；
- **QA-A29**：`#dsh-theme-veil` 必须仍 **0.45**（`z-index:-1` + `inset:0` 两道门槛现在正护着它 —— **不要把门槛放宽**）；
- `_2H3hWW_root` 展开态 **0.92** / 收起态 **0.45** 不得改变。

**关于"要不要顺便提到 0.96"**：**不建议作为主修**。0.92 生效时观感已基本达标（Run B 仅淡影）；
残余淡影属 **P2**，可在修完顺序后**另开一轮**按体感决定，**不要用它掩盖顺序 bug**。

### 7.1 developer 的**在飞修复**（`WebActivity.kt` 未提交改动）—— **方向正确，但尚未构建/装机 ⇒ 本轮不予判过**

写本报告时发现工作树里有一份**未提交**的 `WebActivity.kt` 改动（`+18/−8`，HEAD `f5c4c8fb` 之上），
它**正是针对 FINDING-1 的修法**，采用了我的建议 1+3 组合：

```diff
- "var isOv=false;"
+ "var isOv=false,ovRole=false;"
  ... if(role==='menu'||...){isOv=true;ovRole=true;} ...
- "if(w>vw*0.5&&h>vh*0.5){ ...transparent... }"
- "else if(isOv){ ...0.92... }"
+ "if(isOv&&(ovRole||!(w>vw*0.5&&h>vh*0.5))){ ...0.92... }"
+ "else if(w>vw*0.5&&h>vh*0.5){ ...transparent... }"
```

**判定：本轮不能判它通过**，理由两条（都不是推测）：
1. **未构建、未装机** —— 设备上跑的是 `versionCode=77`（来自已提交的 `59c9c2d`），我全部实测都是**改动之前**的行为。
   要验这份修复，必须走构建+装机（`dsh-app-verify.ps1`，**非本任务范围、且需 lead 发起**）。
2. **本轮证据只对 `59c9c2d` 有效** —— 报告结论 `FAIL` 的对象是**已装机的那一版**，与源码工作树无关。

**🔮 读码预判的一条残余风险（**未实测**，供 developer 复查，不构成判据）**：
真实菜单是**两层**：内层 `[role=listbox]`（257x392，`ovRole=true` ⇒ **修后恒 0.92 ✅**）
与外层 `_surface_ri079_1.Z9Jnlq_menu`（265x400，`absolute z=100`，**无 role**）。
外层走几何分支 ⇒ `isOv=true` 但 `ovRole=false`，而 `265>180 && 400>335.5` **两条同时成立**
⇒ `!(...)` 为 false ⇒ **外层仍会落进 `transparent` 分支**。
由于内层比外层小 4px（四周各 2px），**视觉上只影响外层那圈约 2px 的边**，预计**观感无碍**；
但**这正是"尺寸阈值"留下的最后一点不对称**，建议 developer 顺手确认（或把外层也纳入 `ovRole` 的传承担保）。
**附加建议**：修复后请**在阈值上下都测** —— developer 自述"上轮只测到矮菜单（257x172，未过阈值）才误以为修好"，
与我的实测（392 高，越过 335.5）完全吻合；**阈值两侧的几何必须各测一次**，这是本轮最省钱的回归。

**本轮必须的复验清单（交回 tester，≥5 次采样）**：
1. **QA-P11**：`[role=listbox]` 表层**每次**都必须 0.92（U-6：连跑 ≥5 次，记录 `h@lastApply`）；
2. **QA-P12**：大容器仍 `transparent`、壁纸整页透出、`#dsh-theme-veil` 仍 **0.45**；
3. **QA-A29**：非目标 `fixed/absolute` 零误伤（尤其 veil 不得被提亮）；
4. **QA-C11 / QA-C12**：菜单点项、点外收起仍正常（本轮已建立 PASS 基线，不得回退）。

---

## 8. 交付物与复现

| 产物 | 路径 |
|---|---|
| 本报告 | `verify/QA-ROUND-v1.32.11.md` |
| 主探针（P11/P12/P13/A29） | `verify/qa-overlay-probe.mjs`（24,488 B，纯 ASCII） |
| **分层探针（本轮新增，答 lead 的祖先链问题）** | `verify/qa-overlay-layers.mjs`（纯 ASCII，含 `::before/::after` 与 `background-image` 采集） |
| Run A JSON（alpha=0） | `F:\work\work_dsh\tmp\qa-overlay-run2.json` |
| Run B JSON（alpha=0.92 + 21 层全表） | `F:\work\work_dsh\tmp\layers-report2.json` |
| 截图 | `qa-P11-slash-menu.png`(985,987) / `qa-P11-slash-menu-layers.png`(642,746) / `qa-P12-wallpaper.png`(947,510) / `qa-P13-sidebar-expanded.png`(792,304) / `qa-C12-after-outside-tap.png`(1,011,365) / `qa-A29-fixed-sweep.png`(986,089) |
| 改前对照（用户真机） | `F:\work\work_dsh\tmp\shots\qa\v1.32.11-before-user-report.jpg`(322,712 B) |

```powershell
# 复现（编排机 → 笔电）；token 从 ~/.dsh/web.log 最后一条 'dsh web:' 现取（DSH 重启必换）
powershell -File verify\emu-gpu-verdict.ps1        # 期望 exit 0
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-overlay-probe.mjs `"<URL>`" G:\Android\qa-overlay"
ssh user@<tailnet-laptop> "D:\Program\nodejs\node.exe G:\Android\qa-overlay-layers.mjs `"<URL>`" G:\Android\qa-overlay"
```

**下一步**：FINDING-1 是 **P1** ⇒ 按 task-7 判据 **FAIL，打回 developer**。
修完请**连跑 ≥5 次**确认 alpha **恒为 0.92**（U-6），并**必须复跑 QA-P12 + QA-A29** 确认壁纸通道与 veil 未被弄坏。
**发布继续暂停**（与我此前一致）。
