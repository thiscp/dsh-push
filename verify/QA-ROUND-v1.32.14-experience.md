# QA-ROUND v1.32.14 结论: FAIL（A14 P1 持续）—— 全方位体验轮

> **轮次**: 全方位体验轮（TESTER.md §6）。全量 57 条用例 + 新攻击角度 + 优化点报告。
> **被测**: v1.32.14（versionCode 80）—— 已发布版，设备上已装、无需重装。
> **时间**: 2026-10-15 02:10–03:0x（UTC+8 10:10–11:0x）
> **环境**: 设备 `emulator-5554` / versionName=1.32.14 / versionCode=80 / **真 GPU**（RTX 4060，`emu-gpu-verdict.ps1` exit 0）/ CSS360（`innerWidth=360` / `innerHeight=671` / `dpr=4`）/ APK SHA `2850A0D3…`（夹逼 stable，= 冻结值）
> **结论**: **FAIL**（A14 命中区重叠 P1 持续，v1.32.7 FINDING-1 延续；本轮发布 v1.32.13→14 未引入新 P0/P1）

---

## 用例覆盖（57 条）

### 主流程（00-core-flows，16 条）

| 用例 | 结果 | 实际 / 证据 |
|---|---|---|
| QA-C01 推送到达→列表→浏览器 | **未覆盖** | 未跑（需推送 + 起页断言；见未覆盖项） |
| QA-C02 提问卡作答 | **未覆盖（真实提问类）** | 需真实 `ask_user_question` → **报 lead 借会话发问** |
| QA-C03 通知栏直答 | **未覆盖** | 未跑（需待答卡 + 通知栏交互） |
| QA-C04 快答浮窗 | **未覆盖** | 未跑 |
| QA-C05 侧栏展开→点外收起 | **PASS** | 展开 `position=fixed`/`width=280`/`bg=rgba(249,250,251,0.92)`/`visibleW=280`/`patchCount=1`；点外收起 `collapsed=true`/`width=55.5`/`0.45`。整页肉眼：面板 280px 完整、条目清晰、右侧立绘透出。`qa-C05-expanded.png`(814,053 B)/`qa-C05-collapsed.png`(968,951 B) |
| QA-C06 会话切换 | **未覆盖（探针失败）** | 探针选择器未命中会话条目（`tapped=false`）；需下轮用正确选择器补 |
| QA-C07 深浅主题 | **部分覆盖** | `cmd uimode night yes` 后 App/WebView **仍浅色**（App 主题不跟随系统 uimode，同 A07）；`frame=rgba(0,0,0,0)` ✓。App 内主题切换未跑 |
| QA-C08 断线重连 | **部分覆盖** | `airplane on` 后 `shell=true` 页面存活、无离线提示（同 A08 P2）；恢复后 `shell=true`/`patchCount=1`。探针在 airplane 后 CDP 断（timeout），但截图已拍 |
| QA-C09 一键全部已读 | **PASS** | 四件套全绿：unread 29→0、pill 隐藏、两条 nid 撤、服务通知 id=2 在、toast `N=29`。`qa-core-before.png`(1,089,309 B)/`qa-core-after.png`(1,224,199 B) |
| QA-C10 逐条已读 | **PASS** | v1.32.10 新语义：unread 1→0、自己 read=true、自己 nid 撤、无 mark-all toast、服务通知在。`qa-single-before.png`/`qa-single-after.png` |
| QA-C11 slash 菜单交互 | **部分覆盖** | overlay-probe：菜单出现（`role=listbox` 257x392, 25 项）、点 Goal 选项 ok、滚到底 ok。`qa-C11-menu-clicked.png`/`qa-C11-menu-scrolled.png` |
| QA-C12 点浮层外收起侧栏 | **部分覆盖** | overlay-probe：SIDEBAR collapsed→expanded(0.92/280)→after outside tap collapsed(0.45/55.5) ✓ |
| QA-C13 文档预览面板不透明度 | **PASS** | 面板 `alpha=1` **5/5 恒定**（`rgb(255,255,255)` 360x671 100%×100%，内联写入）；红线开/关全绿（`frame`/`centerCol`/`dcRoot`/`html`/`body` 全 0，veil=0.45，card=0.45）；整页肉眼无叠印。**差异视图未覆盖**（`diff=false`，需真实改动）。哈希夹逼 `stable=true`。`qa-C13-doc-panel-open.png`(515,515 B)｜`qa-C13-panel-closed-wallpaper.png`(872,219 B)｜`doc-report.json` |
| QA-C14 聊天大代码块不透明度 | **PASS** | 面板打开态 `bigAlphas=1`、矮块 0.45；集合级不污染。聊天态 `big=0`（`CHAT_SCROLL ok=false`，当前视口无大块，v1.32.13 已 PASS）。哈希 stable。`qa-C14-panel-open-codeblock.png`(515,681 B)｜`cb-report.json` |
| QA-C15 阈值两侧分流 | **PASS** | `A31: total=4 bigCount=0 smallCount=4 bigAlphas=[] smallAlphas=[0.45]`；面板打开 `bigAlphas=1 smallAlphas=0.45`。两组不污染。`cb-report.json` |
| QA-C16 改动集核查 | **PASS** | 面板打开 `wouldChange=2` = `_tabHost`(1.0) + `_block_7gxqk_4 md-code-block`(1.0)；四锚点 `frame`/`centerCol`/`dcRoot`/`overlayLayer` **全 0**；`dcRoot isAnchor=true` 被排除。面板关闭 `wouldChange=1`（基线）。哈希 stable。`wouldchange-report.json` |

### 对抗（01-adversarial，28 条）

| 用例 | 结果 | 实际 / 证据 |
|---|---|---|
| QA-A01 连点 10 次 | **PASS** | 10 次状态 `false,true,…` 跟随，末态 `collapsed=true`，`patchCount=1`，再点仍能切换。`qa-A01-rapid.png`(973,367 B) |
| QA-A02 加载中抢跑 | **PASS** | `tappedAtMs=4429`，`shellReady=true`，`patchCount=1`，无重复注入。`qa-A02-early-tap.png`(677,412 B) |
| QA-A03 作答瞬间退出 | **未覆盖** | 未跑（需待答卡 + 200ms 内 force-stop） |
| QA-A04 超长/emoji 文本 | **未覆盖** | 未跑（需构造极端文本卡） |
| QA-A05 倒计时竞态 | **未覆盖（真实提问类）** | 需真实带倒计时的提问 → **报 lead** |
| QA-A06 字体放大 | **PASS** | 1.0/1.3/1.5 面板仍 280/fixed/0.92；DOM 报标题/时间戳元素盒 overlap（-28/-36.4/-41.9）但**肉眼确认**标题截断加省略号、时间戳清晰分离（元素盒误报）。`qa-A06-font15.png`(769,046 B) |
| QA-A07 深色系统主题 | **BLOCKED（用例界定错误）** | App 不跟随系统 uimode（已由 A13 取代） |
| QA-A08 飞行模式 | **PASS-with-findings (P2)** | 不崩、页面存活，但**无离线提示**；恢复 `shell=true`/`patchCount=1`。`qa-A08-offline.png`/`qa-A08-back.png` |
| QA-A09 旋转/横竖屏 | **PASS** | `landscapeWidth=759`/`portraitWidth=360` 旋转生效。`qa-ux2-landscape.png`（笔电 `G:\Android\qa-ux2\`） |
| QA-A10 极窄视口 | **PASS-with-findings (P3)** | `wm size 800x1200`（`innerWidth=200`）下面板 280 被裁到 `visibleW=200`（人为尺寸）。`qa-A10-narrow.png` |
| QA-A11 连按返回 | **PASS** | back×2 → 桌面（NexusLauncher），无白屏。`qa-A11-back.png`(2,033,388 B) |
| QA-A12 侧栏长列表滚动 | **PASS** | 侧栏根不滚（`sbTop=0`），滚动发生在内层（`innerScrolledEls=1`），背后内容不被带动。`qa-A12-scroll.png` |
| QA-A13 App 内切主题 | **未覆盖** | 未跑（需走 App 自己的主题设置 UI） |
| QA-A14 命中区重叠 | **FAIL (P1 持续)** | **CSS360 基线重打**：`Collapse sidebar`(40px)↔`Open in File Explorer`(23px 命中框) 重叠 23px；`realTaps` 实证点 `Open in File Explorer` 中心触发 `New session`/`Collapse sidebar`（`selfHit=false`）。v1.32.7 FINDING-1 延续。`qa-A14-hitboxes.png`(710,886 B) |
| QA-A15 收起态图标轨道 | **PASS** | 轨道 `w=55.5`；轨道内 6 按钮 `selfHit` 全 true、不顶出、纵向不重叠。`qa-A15-rail.png`(962,677 B) |
| QA-A16 成组按钮间距 | **部分覆盖** | 量到多组相邻中心距（`gap=32/10.1/6.6/14/…`）；需结合 A14 判据审 |
| QA-A17 滚动到底 F1 间隙 | **PASS** | `scrolledBy=443`，`clearance=112px`（底部不被 Settings 压）。`qa-A17-scrollbottom.png` |
| QA-A18 手机作答时序 | **未覆盖（真实提问类）** | 需真实提问 → **报 lead** |
| QA-A19 命中区几何审计 | **BLOCKED** | `case watchdog 150s`（多字体采样超时）。需下轮补或优化探针 |
| QA-A20 已读后新推仍未读 | **PASS** | core 清未读后补推 → `read=false`、unread=1、pill 重现。`qa-newmsg-late.png` |
| QA-A21 已读不改 answered | **PASS** | `answered` 逐字节不变（`【监督者自动唤醒】 qa proxy`）。`qa-answered-after.png` |
| QA-A22 监督者代答被翻已读 | **PASS** | 监督者回声未读 `read=true`，toast N 计入。`qa-answered-after.png` |
| QA-A23 连点两次幂等 | **PASS** | 第二下无 N=0 toast、prefs 仍全 read=true、进程存活。`qa-doubletap-after.png` |
| QA-A24 撤通知后卡片仍可作答 | **PASS** | 撤通知后 optA 仍可点、`answered="__expired"`、toast「这个问题已经过期了」。`qa-inapp-opttap.png` |
| QA-A25 cancel 不存在 nid 静默 | **PASS** | 进程存活、msgs JSON 完好、toast N 计入。各轮顺带覆盖 |
| QA-A26 已答题「已读」撤不存在 nid | **PASS** | nid 仍不在（第二次 cancel 静默）、read=true、无 toast。`qa-readans-after.png` |
| QA-A27 双撤同一 nid 幂等 | **PASS** | 通知「已读」+「打开 DSH」双撤、nid 仍不在、`mCurrentFocus=WebActivity`。`qa-dblcancel-web.png` |
| QA-A28 逐条+全部混合 | **PASS** | 逐条撤 2 条后 pill `N=12`（只数剩余）、双撤静默。`qa-mix-after.png` |
| QA-A29 fixed/absolute 扫荡 | **PASS** | 非目标元素零误伤：`veil=0.45`、`card=0.45`、`frame`/`centerCol`/`composerSeat` 全 0；P11 菜单 0.96。`qa-A29-fixed-sweep.png` |
| QA-A30 多面板共存 | **PASS** | 再开第二面板后 `_tabHost` 仍 1.0、`frame=0`（判据未退化）。`qa-A30-multi-panel.png`(513,492 B) |
| QA-A32 注入 vs 重渲染竞态 | **PASS** | **3 轮** `caught=0`/`nativeWhiteSamples=0`；settle `alpha=0`/`inline='transparent'`；`isAnchor` 排除生效。哈希 stable。`transient-report.json` |

### 体验与观感（02-ux-polish，13 条）

| 用例 | 结果 | 实际 / 证据 |
|---|---|---|
| QA-P01 间距与对齐 | **部分覆盖** | 探针命中 1 行（`rowX=12`/`rowW=268`/`iconX=20`）；需补全量 |
| QA-P02 字号与层级 | **部分覆盖** | `headerFont=21px`/`headerLH=30px`；正文字号未量到 |
| QA-P03 水印透出 | **PASS** | `panelBg=0.92`、`frameBg=0`；整页肉眼：面板条目清晰、背后正文仅淡水印。`qa-C05-expanded.png` |
| QA-P04 按钮命中区 | **PASS** | **CSS360 基线重打**：`expandedCount=25`；`<40px` 的主要图标：`Search sessions`/`View options`/`Add workspace` 32x40、`Agent Team` 28x40、`Open in File Explorer` 23x40、`More ways to open` 20x40；`Show N more sessions` 256x28。`P04` DOM |
| QA-P05 加载空态 | **未覆盖** | 未跑 |
| QA-P06 文案一致性 | **未覆盖** | 未跑 |
| QA-P07 深色壁纸对比 | **未覆盖** | 未跑（依赖 A13 App 内主题） |
| QA-P08 溢出与滚动条 | **PASS** | `scrollH=409`/`clientH=409`/`hasXScroll=false`（无横向滚动）。`qa-ux2-sidebar.png` |
| QA-P09 动画与过渡 | **未覆盖** | 未跑 |
| QA-P10 可点击反馈 | **未覆盖** | 未跑 |
| QA-P11 slash 菜单不透明度 | **PASS** | **3 轮采样 alpha=0.96 恒定**（`inlineBg=rgba(255,255,255,0.96) !important`）；祖先链分层正确（`_menu` 透明、输入卡 0.45）；整页肉眼：菜单项文字清晰、底层仅淡水印不发花。**v1.32.11 FAIL 已修**。`qa-P11-slash-menu-v13214.png`(607,988 B)｜`overlay-report.json` |
| QA-P12 壁纸通道回归 | **PASS** | `veil=0.45`（`position=fixed`/`z-index=-1`/360x671）；`frame`/`centerCol`/`html`/`body` 全 0；整页壁纸/立绘透出。`qa-P12-wallpaper-v13214.png` |
| QA-P13 展开态侧栏 0.92 | **PASS** | `alpha=0.92`/`w=280`/`position=fixed`/`z-index=60`；收起 `0.45`/`55.5`。`qa-P13-sidebar-expanded-v13214.png` |

---

## FINDING

### FINDING-1 [P1] A14 命中区重叠持续（v1.32.7 FINDING-1 延续，非本轮回归）
- **用例**: QA-A14
- **复现**: 1. 收起态（56px 轨道）展开侧栏；2. 量顶部 header 按钮命中框；3. 点 `Open in File Explorer` 图标中心 (246.6, 25.1)。
- **预期**: 图标视觉中心必须命中它自己（TESTER.md §3 第 6 条）。
- **实际**: **点 `Open in File Explorer` 中心触发了 `New session`/`Collapse sidebar`**（`selfHit=false`）；`Collapse sidebar`(40px) 与 `Open in File Explorer`(23px 命中框) 横向重叠 23px、与 `More ways to open`(20px) 重叠 14.6px。`realTaps` 7 处误触实证。
- **证据**: `qa-A14-hitboxes.png`(710,886 B)｜`qa-report-2026-10-15T02-10-57.json` → `QA-A14.dom.reals`/`overlaps`/`centres`
- **归因**: **DSH Web 上游紧凑布局**（header 按钮间距过小）+ **App 侧 v1.32.7 的 40px 命中区放大**叠加 → 命中框互相重叠。App 侧无法单独修（改上游间距需 Web 侧改）。
- **影响面**: 窄屏（CSS360）下点 header 右侧图标中心可能触发邻居；用户可感知误触。
- **备注**: v1.32.7 已 FAIL 登记，之后版本未修；本轮体验轮复测仍存在。**本轮发布（v1.32.13→14）未引入新缺陷**。

### FINDING-2 [P2] A08/C08 离线无提示（同 v1.32.7）
- 飞行模式/断网时页面存活但**无任何离线提示**（截图与在线态几乎一致）。
- 证据: `qa-A08-offline.png`/`qa-ux2-offline.png`

### FINDING-3 [P3] A10 极窄视口浮层裁切（人为尺寸）
- `wm size 800x1200`（`innerWidth=200`）下面板 280 被裁到 `visibleW=200`。用户不会用此尺寸。

---

## 未覆盖项（显式列出）

1. **真实提问类（需借 lead 会话发问 `ask_user_question`）**: **QA-C02**（提问卡作答）、**QA-A05**（倒计时竞态）、**QA-A18**（手机作答时序）。
2. **QA-C01** 推送到达→列表→浏览器：未跑（需推送 + 起页）。
3. **QA-C03** 通知栏直答 / **QA-C04** 快答浮窗：未跑。
4. **QA-C06** 会话切换：探针选择器未命中（`tapped=false`），需下轮用正确选择器补。
5. **QA-C07** App 内切主题 / **QA-A13**：未跑（需走 App 自己的主题设置 UI）。
6. **QA-A03** 作答瞬间退出 / **QA-A04** 超长文本：未跑。
7. **QA-A19** 命中区几何审计：BLOCKED（watchdog 150s）。
8. **QA-P01/P02** 间距/字号：部分覆盖（探针选择器需补全）。
9. **QA-P05/P06/P07/P09/P10**：未跑。
10. **QA-C13 差异视图**：`diff=false` 未能复现（需先造真实改动产生 diff 再打开）。

---

## 新攻击角度沉淀

本轮按 lead 要求从用户视角找优化点，沉淀进用例库：
- **A14/A15/P04 的 CSS360 基线**已就地重打（旧 411 宽数字作废），**A14 仍 FAIL（P1）**——这是本轮最重发现。
- **A19 几何审计**作为常驻用例（task-21 引入），本轮 BLOCKED（watchdog 150s），需优化探针性能。
- 建议在 `verify/testcases/` 为「CSS360 基线下的命中区重测」补充断言备注（已回填 A14/A15/P04）。

---

## 设备复位声明

- 模拟器 `emulator-5554` 全程真 GPU（`emu-gpu-verdict.ps1` exit 0）。
- 全局状态复位：`cmd uimode night no` / `font_scale 1.0` / `wm size reset` / `airplane disable`（探针内已复位；收尾再确认）。
- App `am force-stop` 留干净设备。

---

## 本轮关键正向结论（v1.32.14 修复验证）

- **P11 slash 菜单不透明度**：v1.32.11 FAIL → v1.32.14 **PASS**（3 轮 alpha=0.96 稳定，肉眼不发花）。
- **C13 文档面板**：alpha=1 5/5 恒定，红线全绿。
- **C14/C15 代码块**：大块 1.0、矮块 0.45，阈值两侧分流精确。
- **C16 改动集**：`wouldChange=2`（面板+代码块），四锚点全 0（`isAnchor` 排除未削弱修复）。
- **A30 多面板**：`frame=0` 未误伤。
- **A32 竞态**：3 轮 caught=0（`isAnchor` 排除 `Dc7zOa_root` 生效）。
- **C09/C10/A20-A28 已读链路**：全模式 PASS。
