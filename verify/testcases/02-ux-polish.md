# 体验与观感用例（UX / polish）

这一组不看"功能有没有坏"，只看**用户用起来顺不顺、看着舒不舒服**：间距、对齐、字号层级、水印透出、命中区、空态、文案一致性、动画过渡。这类问题常常是用户真正抱怨的东西（例如"面板背后文字串上来"就是这一组先发现的）。

判定方式同样要求截图 + 同一时刻 DOM 复核；涉及可点区域时用 DOM 矩形量命中区（≥40px 才算够），不要靠感觉。

---

### QA-P01 间距与对齐
- **场景**: 用户扫视侧栏找会话，条目参差不齐会显得"没做完"。
- **前置**: 展开侧栏（浮层）。
- **步骤**:
  1. `screencap` `qa-P01-spacing.png`
  2. CDP 量：左侧头像/图标列 x、标题 x、右侧时间戳右边界，各条目应成列
- **预期**: 图标、标题、时间戳三者各自对齐成列；行距一致；面板左右内边距对称。
- **实际**: （待填） / **结果**: （待填） / **证据**: （待填）

### QA-P02 字号与层级
- **前置**: 展开侧栏 + 会话正文同屏。
- **步骤**: 1. `screencap` `qa-P02-type.png` 2. CDP 量标题/正文字号与行高
- **预期**: 标题明显大于正文；没有 11px 以下不可读文字；按钮内文字不贴边。
- **实际**: （待填） / **结果**: （待填） / **证据**: （待填）

### QA-P03 展开面板底色的"水印透出"残留
- **场景**: v1.32.4 去掉毛玻璃后，背后聊天文字会串上来；v1.32.5 把展开态底色调到 0.92。
- **前置**: 展开侧栏，且背后会话有较长中文正文。
- **步骤**:
  1. `screencap` `qa-P03-watermark.png`
  2. CDP 复核面板背景 alpha
  3. 目视判断：背后文字与小字时间戳**是否还能看清**到影响阅读侧栏条目
- **预期**: 侧栏条目完全主导视觉；背后文字充其量是极淡水印，不应形成"两层文字叠在一起"的观感。
- **实际**: （待填） / **结果**: （待填） / **证据**: （待填）

### QA-P04 按钮命中区
> ⚠️ **几何基线已作废（tester 标注 2026-10-14，本轮 task-2）**：下面「实际」里的 28×28 / 23×23 / 17×23 / 行高 28 等数字
> 是在**旧 411 CSS px 视口**下量的。CSS360 基线（`innerWidth=360` / `dpr=4`）下**不可对照**；
> **下轮 QA 首跑必须重打**（依据 `verify\TESTER.md` 附录 A.1）。断言（≥40×40、相邻间距 ≥8px）仍有效，只有数字作废。
- **前置**: 收起态 rail + 展开态面板都可测。
- **步骤**:
  1. CDP 量 rail 上按钮（展开/收起/搜索/新建/设置）与面板内按钮的 `getBoundingClientRect()`
  2. 对 <40px 的记下来；并实测点边缘附近是否命中
- **预期**: 主要图标按钮命中区 ≥40×40；相邻按钮不会互相误触（间距 ≥8px）。
- **实际（v1.32.14 CSS360 基线重打，2026-10-15）**: `expandedCount=25`；`<40px` 的主要图标：`Search sessions`/`View options`/`Add workspace` 32x40、`Agent Team` 28x40、`Open in File Explorer` 23x40、`More ways to open` 20x40、`More actions`/`Open right sidebar`/`Copy` 28x28；会话条目行高 28；`Show N more sessions` 256x28。⇒ CSS360 下大量按钮 <40px（窄屏更挤）。
- **实际（v1.32.7 旧 411 宽，数字作废）**: 25 个可点元素里 7 个高度 <40px，且基本都是图标按钮：`Collapse sidebar`/`Search sessions`/`View options`/`Add workspace`/`Agent Team` 28×28、`Open in File Explorer` 23×23、`More ways to open` 17×23；会话条目行高 28。

### QA-P05 加载空态与反馈
- **前置**: force-stop 后重新打开内置浏览器。
- **步骤**:
  1. `am start` 后每 2 秒截一张（共 3 张）`qa-P05-load-1..3.png`
  2. 记录首屏出现内容的时间
- **预期**: 加载期间有可见反馈（骨架/进度/错误提示），不要长时间纯白屏无反馈；首次可用内容 ≤10 秒（模拟器真 GPU）。
- **实际**: （待填） / **结果**: （待填） / **证据**: （待填）

### QA-P06 文案一致性
- **前置**: 展开侧栏 + 主界面都看一遍。
- **步骤**: 1. 截图 `qa-P06-copy.png` 2. 列出所有中英混用/大小写/标点不一致处
- **预期**: 同一产品内术语一致（例如 `New Session` 与"新建会话"不要同屏混用）；标点统一（中文用全角）。
- **实际**: （待填） / **结果**: （待填） / **证据**: （待填）

### QA-P07 深色主题下的壁纸/立绘对比
- **前置**: `cmd uimode night yes` 后打开内置浏览器。
- **步骤**: 1. `screencap` `qa-P07-dark-art.png` 2. 观察壁纸/立绘与文字、玻璃层的对比
- **预期**: 立绘不被面板压成一片；深色下正文与底色的对比度足够（灰字压深灰底算不通过）。
- **实际**: （待填） / **结果**: （待填） / **证据**: （待填）

### QA-P08 溢出与滚动条的视觉
- **前置**: 展开侧栏（有 "Show 13 more sessions" 的长列表）。
- **步骤**: 1. `screencap` `qa-P08-overflow.png` 2. 检查是否有横向滚动条、内容被切一半、文字压边
- **预期**: 不出现横向滚动条；长标题以省略号截断而不是硬切；面板底部内容不被裁。
- **实际**: （待填） / **结果**: （待填） / **证据**: （待填）

### QA-P09 动画与过渡
- **前置**: 展开/收起反复各 3 次。
- **步骤**: 1. 在过渡中途截图 2 张 `qa-P09-transition-1..2.png` 2. 目视是否有跳变/闪白/卡顿
- **预期**: 过渡顺滑、无闪白；中途状态不出现"面板一半 + 内容压过来"的破图。
- **实际**: （待填） / **结果**: （待填） / **证据**: （待填）

### QA-P10 可点击反馈与"点了没反应"
- **前置**: 展开侧栏。
- **步骤**:
  1. 逐个点面板内可见元素（会话条目、Plugins、Workspaces、Settings、Show more）
  2. 每个记录"有无视觉反馈 / 有无导航"
- **预期**: 看起来可点的元素都要有反馈；纯装饰元素不应有 pointer 光标/按下态误导用户。
- **实际**: （待填） / **结果**: （待填） / **证据**: （待填）

---

## 浮层不透明度组（QA-P11~P13，v1.32.11 用户反馈「选择传文件的控件背景透明度是否太低了点」）

> **需求来源（用户原话）**：「**选择传文件的控件背景透明度是否太低了点**」。
> 指输入框上方那个 **slash 指令菜单浮层**（`添加文件 / 目标 goal / 计划 plan / 反馈 feedback / 指令 / 写入 / 压缩 compact / 权限 permission / 模型 model / 下载日志 export` 一列）：
> 背景太透、**立绘与底层聊天文字直接透上来，菜单项文字发花**。
>
> **改前基准证据（lead 提供，用户真机截图）**：`F:\work\work_dsh\tmp\shots\qa\v1.32.11-before-user-report.jpg`（322,712 B，1440x3168）。
> 肉眼可见：浮层区域内底层聊天正文（`思考 · I need to find where the session …`、`运行命令 · List deepseek-ai packages`）**与立绘直接叠在菜单项文字上**，
> `添加`/`文件`/`目标 goal`/`计划 plan`/`模型 model` 等标签**明显发花**。
>
> **代码判据（改前）**：`android-app/.../WebActivity.kt:339-379` 的玻璃化注入里，除「大容器」→ `transparent` 与
> 「窄屏展开态侧栏」→ `0.92`（`bwPanelBg()`）外，**所有**匹配元素一律被压到 `rgba(...,0.45)`；**浮层/菜单没有例外** ⇒ 浮层 alpha = **0.45**。
> **修复目标**：浮层 alpha **≥ 0.92**。

> **执行探针（task-7 预热已备好）**：`verify\qa-overlay-probe.mjs`（笔电上跑：`node qa-overlay-probe.mjs "<带token的URL>" G:\Android\qa-overlay`）。
> 它**内建 H-1 纪律**（起页前 `adb root` + `whoami` 断言 + fail-closed throw，且 root 排在**任何 forward 之前**），一次跑完 QA-P11/P12/P13/QA-A29 的**计算值**部分并落 `overlay-report.json` + 各张 >100KB 截图；
> **但计算值只是判据的一半** —— 每张图仍必须由 tester **自己 `read_image` 看整页**后才算数（`TESTER.md` §3 第 1/2 条）。
> 注意：CDP `returnByValue:true` **无法回传 DOM 节点**，探针因此把节点挂在 `window.__qaOverlay`、只回传 JSON 描述（踩过：直接回传节点会拿到 `undefined`，正好落进"跑了没量到"的坑）。

### QA-P11 slash 指令菜单浮层不透明度 ≥0.92（**v1.32.11 主验收**）
- **场景**: 用户输入 `/` 调出指令菜单准备传文件／切模型。浮层太透 → 底层聊天文字与立绘透上来，菜单项文字发花、看不清该选哪个。本轮修的就是它。
- **前置**: v1.32.11 装机（预期 `versionName=1.32.11` / `versionCode=77`，以 `dumpsys package` 实测为准）；
  **`adb root` 且 `whoami` == `root`**（H-1：`am start .WebActivity` 需 root；**顺序=先 root 再建 forward**，见 `TESTER.md` §2 与 `STATUS-READY-2026-10-14.md` §8）；
  真 GPU（`verify\emu-gpu-verdict.ps1` **exit 0**）。
- **步骤**:
  1. `am force-stop xyz.cpyh.dshpush` → `am start -n xyz.cpyh.dshpush/.WebActivity --es url "<带 token 的 URL>"`；等页面到达 DSH shell（`[class*='BynINW_frame']` 在）。
  2. CDP 在输入框（`textarea` / `[contenteditable]`）**真输入 `/`**（`Input.insertText` 或 `Input.dispatchKeyEvent`；**不要用 JS 直接改 `value`**——要的是真实交互路径），等浮层出现。
  3. **定位浮层（把选择器写进报告，别猜）**：扫 `document.querySelectorAll('*')`，取 `position` 为 `fixed|absolute`、`offsetWidth/offsetHeight > 0`、
     且 `textContent` 同时含 ≥3 个指令 token（`compact` / `plan` / `feedback` / `model` / `permission` / `goal`）的**最小**容器（最小 = 浮层本体而非某个祖先）。记录 `tagName` + `className` + `getBoundingClientRect()`。
  4. 读该浮层 `getComputedStyle(el).backgroundColor`，解析 alpha。
  5. **断言 alpha ≥ 0.92**（改前 0.45）。
  6. `adb shell screencap -p /sdcard/qa-P11-slash-menu.png` + `adb pull`（**文件须 >100KB**）+ **我自己 `read_image` 看整页**。
  7. **几何（条件项）**：**若本轮动了浮层尺寸/内边距**，按 `TESTER.md` §3 第 6 条做完整三步
     （命中框 vs 视觉体两组矩形 → `elementFromPoint` 逐点 → owner≠target 的点用 CDP `Input.dispatchMouseEvent` 真点一次）；
     **未动几何就明确写「未涉及」**，不要跳过不写。
- **预期**: 浮层 alpha **≥0.92**；整页截图肉眼判：菜单项文字**清晰不发花**、底层聊天正文与立绘**不再透上来**干扰阅读；
  浮层底色与页面主题协调（深色页深纱 / 浅色页白纱），不是死白也不是死黑。
- **实际**: **v1.32.11 FAIL（P1，2026-10-15 00:06–00:12 两次独立实测）** ——
  **同一版本、同设备、同一操作，表层 alpha 不稳定（n=2）**：

  | 跑次 | `[role=listbox]` 表层（257x392，25 项） | 内联 | 整页肉眼 |
  |---|---|---|---|
  | **Run A** | **`rgba(0,0,0,0)` ⇒ alpha = 0** | `transparent !important` | 底层正文（`The contents of this turn's changes…`、`六、一句话`）+ 立绘照旧叠上来、**发花＝用户投诉原状** |
  | **Run B** | **`rgba(255,255,255,0.92)` ⇒ alpha = 0.92** | `rgba(255,255,255,0.92) !important` | 底色到位，背后文字**仅淡淡可见**（8% 透射，P2 残余） |

 外层 `_surface_ri079_1 Z9Jnlq_menu`(265x400, absolute, z=100) **两跑都仍是 `rgba(0,0,0,0)`**。
  **根因（已定位到行 + 算术）**：`WebActivity.kt:392` 的**大容器分支（`w>vw*0.5 && h>vh*0.5` → `transparent`）排在 `:394` 的 `else if(isOv)` 之前**；
  阈值恰为 `180 / 335.5`，而菜单 `257x392`（**只超 56.5px**）⇒ 高度一长就两条同时成立 ⇒ 被设成 `transparent`。
  `apply()` 会跑多次（首跑 + 1500ms + 4000ms + MutationObserver），菜单**渐进渲染**，
  **最后一次 `apply()` 读到的高度决定终态**：`h≤335.5` → 0.92 ✅，`h>335.5` → transparent ❌ ⇒ **这就是"掷硬币"**。
  ⇒ **不是"没命中"、也不是"少一层"，是"命中了却被前面的分支按尺寸抢走并设成透明"**。
  **菜单子树全量扫描证实：真正上色的只有 2 个元素**（表层 + 唯一高亮项），**没有隐藏的第三层**（详见报告 §3）。
- **复测（v1.32.14，2026-10-15）**: **PASS** —— 3 轮采样 `alpha=0.96` 恒定（`inlineBg=rgba(255,255,255,0.96) !important`），菜单 257x392 仍 0.96（v1.32.11 的 `transparent` 分支已修）；祖先链分层正确；整页肉眼菜单项清晰不发花。`overlay-report.json`×3
- **结果（v1.32.11）**: **FAIL（P1）**（详见 `verify/QA-ROUND-v1.32.11.md` FINDING-1）
- **证据**: 改前 `F:\work\work_dsh\tmp\shots\qa\v1.32.11-before-user-report.jpg`（用户真机，322,712 B）｜
  Run A `F:\work\work_dsh\tmp\shots\qa\qa-P11-slash-menu.png`（985,987 B）+ `F:\work\work_dsh\tmp\qa-overlay-run2.json`｜
  Run B `F:\work\work_dsh\tmp\shots\qa\qa-P11-slash-menu-layers.png`（642,746 B）+ `F:\work\work_dsh\tmp\layers-report2.json`

- **⚠️ 单次测量会骗人（本轮最重要的教训，写进纪律）**：
  我第一次只跑了 Run A，就写下"根因＝大容器分支恒赢、alpha **恒为 0**"——**Run B 推翻了它**（实测 0.92）。
  ⇒ **凡"随机/竞态"类观感缺陷，必须 `n≥3` 采样后再下结论**；判据要同时记录
  **`h@lastApply` 与终态 alpha**，否则会把"不稳定"误判成"稳定坏"或"已修好"。
  本仓既有纪律「不确定就复现两次」（`TESTER.md` §3 第 5 条）正是为此 —— 本轮若只跑一次就会误判。
- **🔧 定位方法校准（v1.32.11 实测后回填，下轮照做）**：**`role` 优先**，顺序
  `listbox → menu → dialog → alertdialog → tooltip`，命中即用（实测 `how="role=listbox"`、`aria-label="Trigger suggestions"`、25 个可见子项）。
  **优于**"扫最小 fixed/absolute + 含 ≥3 个指令 token"（后者会把装饰/动画容器也扫进来）。
- **🔧 输入路径校准（同一轮实测，**推翻 developer 的结论**）**：
  **CDP 合成鼠标点击会抢走键盘焦点**（点击后 `document.activeElement` → `SECTION._tabHost_*`）⇒
  之后 `adb shell input text "/"`、`input keyevent 76`、CDP KeyEvent 三元组**全都插 0 字符**。
  **可用路径 = `el.focus()`（不点击）+ `Input.insertText("/")`**（实测成功：文本变 `/`、`[role=listbox]` 出现）。
  ⚠️ 别用"先点击再输入"的姿势，否则会误判成"菜单弹不出来"。
- **备注**: 若 alpha 达标但肉眼**仍发花**（例如浮层上还有其它半透层叠加、或缺少 `backdrop-filter` 导致对比不足），
  **以肉眼判为准记 P1** —— 本仓铁律：`getComputedStyle` 单独通过不算数（`TESTER.md` §3 第 2 条）。

### QA-P12 壁纸通道回归：大容器必须仍 transparent（v1.32.6 教训）
- **场景**: v1.32.6 踩过——玻璃化重构丢了 `else`，大容器被 45% 白覆盖、多层叠成 ~91% 白，**壁纸整个消失**；
  而当时**只看面板截图没看出来**。本轮给浮层加例外规则，最容易顺手把这套通道改坏。
- **前置**: 同 QA-P11（v1.32.11 装机 + `adb root` + 真 GPU）；壁纸/立绘已由 App 原生层设置（非空白）。
- **步骤**:
  1. CDP 读三个关键容器的 `getComputedStyle().backgroundColor`：大容器 `[class*='BynINW_frame']`、中心列 `[class*='BynINW_centerCol']`、`html`/`body`
     → **必须仍是 `rgba(0, 0, 0, 0)` / `transparent`**（不得被新规则改成不透明）。
  2. `adb shell screencap -p /sdcard/qa-P12-wallpaper.png` + `pull`（>100KB）+ **`read_image` 看整页**：
     **原生壁纸与立绘必须仍然透出**（不是被白纱/深纱整体盖住）。**只看面板截图不算**——必须整页看。
  3. 断言 `#dsh-theme-veil` 仍在，且 alpha **仍为 0.45**（它也是 `position:fixed`，**是"fixed 一律提亮"这类粗暴规则最大的误伤目标**——
     被提到 0.92 就会把壁纸盖掉；与 **QA-A29** 呼应）。
- **预期**: 大容器 + 中心列 + body 仍 `transparent`；整页壁纸/立绘正常透出；`#dsh-theme-veil` alpha 仍 0.45。
- **实际**: **v1.32.11 PASS（两跑一致）**：`BynINW_frame` / `BynINW_centerCol` / `html` / `body` **全部 `rgba(0,0,0,0)`**
  （frame/html/body 内联 `transparent !important`）；整页图肉眼判：**壁纸 + 云朵 + 立绘完整透出**，未被白纱/深纱盖住 ✅。
  **`#dsh-theme-veil` = `rgba(255,255,255,0.45)`、alpha 0.45、`z-index:-1`、360x671** ⇒
  **lead 档案 §3 的读码推演（veil 因 `z-index<10` + 面积>90% 被判 `isOv=false`）由实测独立证实** ✅。
- **复测（v1.32.14，2026-10-15）**: **PASS** —— `veil=0.45`（`position=fixed`/`z-index=-1`/360x671）、`frame`/`centerCol`/`html`/`body` 全 0；overlay-probe 3 轮一致。
- **结果（v1.32.11）**: **PASS**
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-P12-wallpaper.png`（947,510 B，我 `read_image` 看过整页）｜
  `F:\work\work_dsh\tmp\qa-overlay-run2.json` → `cases.QA-P12`

### QA-P13 展开态侧栏仍 ≈0.92（`bwPanelBg()` 未被破坏）
- **场景**: 窄屏（≤1023）侧栏展开态面板本来是 `0.92`（`bwPanelBg()` 这一支例外）。本轮加浮层例外时可能把这一支改坏或改重。
- **前置**: 同 QA-P11；窄屏基线 CSS360（`innerWidth=360`，见 `TESTER.md` §2）。
- **步骤**:
  1. CDP 触发「Open sidebar」真点（或点 rail 上的展开按钮），等展开态稳定。
  2. 读侧栏面板 `[class*='_2H3hWW_root']` 的 `width` / `position` / `backgroundColor` → **width ≈280、`position=fixed`、alpha ≈0.92**（三者同时成立）。
  3. 收起（再点一次或点浮层外）→ 轨道宽 **≈56px**、半透明态与改前一致（不受新规则影响）。
  4. 两张截图（展开/收起）各自 `read_image` 看整页：展开态面板**背后文字不串上来**、收起态无被裁碎片。
- **预期**: 展开态 alpha ≈0.92、width ≈280、`position=fixed`；收起态 ≈56px；`bwPanelBg()` 行为与 v1.32.10 一致。
- **实际**: **v1.32.11 PASS**：展开态 **alpha=0.92**、`rgba(249,250,251,0.92)` 内联 `important`、
  **w=280**、**`position=fixed`**、`z-index=60`；收起态 **alpha=0.45**、w=55.5、`collapsed=true`
  ⇒ **`bwPanelBg()` 行为与 v1.32.10 一致，未被本轮浮层规则破坏** ✅。
  整页图肉眼判：面板 280px 完整、条目文字清晰、背后正文仅淡淡透出、无被裁碎片。
- **🔧 展开入口校准（踩过，下轮照做）**：`Open sidebar` 按钮（`_2H3hWW_iconButton _2H3hWW_toggle` @24,36）
  **用 JS `dispatchEvent(new MouseEvent('click'))` 才能展开**；**CDP 合成点击会被 `_tab_*` 抢走目标**
  （`elementFromPoint` 的 owner ≠ 按钮）⇒ 上一次跑因此误判为 BLOCKED。
  与 QA-P11 的「合成点击抢焦点」是同一个坑（见 `verify/README.md` 新增条）。
- **复测（v1.32.14，2026-10-15）**: **PASS** —— 展开 `alpha=0.92`/`w=280`/`position=fixed`/`z-index=60`；收起 `0.45`/`55.5`；overlay-probe + doc-panel 3 轮一致。
- **结果（v1.32.11）**: **PASS**
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-P13-sidebar-expanded.png`（792,304 B，整页）｜
  `F:\work\work_dsh\tmp\layers-report2.json` → `sidebarExpanded` / `sidebarExpandedPanel` / `sidebarCollapsed`
