# QA-ROUND v1.32.7 报告（改动验证轮 · F1 大字体 + F3 命中区）

```
QA-ROUND v1.32.7 结论: FAIL
用例: 跑 7 条（PASS 4 / FAIL 1 / PASS-with-findings 2），未覆盖 4 类（需真机或生产推送）
被测: commit 6279247 自行编译（versionName 仍 1.32.6/vc72，见"被测物"）、
      安装 APK sha256 AF5492C2E8950B0209BEC98817CEBD3A14B432EAA7B890793C6C83BC50E4FE37
环境: emulator-5554 / 真 GPU / 2026-10-13 17:3x
证据: F:\work\work_dsh\tmp\shots\v1327-qa\（11 张图，全部 >100KB，逐张 read_image 看过）
```

**FAIL 的唯一原因是一条新出现的 P1**：F3 用"放大 + 等量负 margin"做命中区，导致**相邻按钮的命中区互相重叠**，其中会话头部两个按钮的重叠让"点 A 触发 B"发生在**图标的视觉正中心**（不是边缘）。功能可用，但会执行错误动作 —— 按章程 P1 判定 → 本轮 FAIL，`-Deploy` 建议暂缓（见文末"给 Lead 的建议"）。

## 被测物（先说清，否则数字无意义）

- 仓库版本号仍是 `versionCode 72 / versionName 1.32.6`（你按规矩把 bump 留给自己），所以**装 v1.32.7 与 v1.32.6 的 versionName 完全一样**，靠版本号无法证明测的是谁。
- 于是我**自己从 6279247 编译**并记录 sha256；另外加了一条硬证据：读注入样式表本身 —— `titleMinWidth=0px / titleShrink=1 / timeShrink=0 / timeMarginLeft=8px / listPadBottom=32px` 三个字体档全部命中，这些规则**只存在于 v1.32.7**（v1.32.6 的样式表里没有 `hIlkoa_time`）。
- 旁证：我编译出的 APK 与你留在笔电上的 `G:\Android\dsh-push.apk`（17:13）**字节数完全相同**（11,068,786）。

---

## FINDING-1 [P1] 会话头部两个按钮命中区重叠 20px，点"Open in File Explorer"的中心会触发"More ways to open"（QA-A14）

- **复现**：窄屏打开会话 → 展开侧栏 → 点右上角"Open in File Explorer"图标的**正中心**。
- **实测几何**（412px 视口，DOM 矩形）:
  - `Open in File Explorer`：命中框 **40×40.2 @x279.3**（图标 13×13 @x292.8，视觉中心 x299.3）
  - `More ways to open`：命中框 **40×40.2 @x299.3**
  - 两者**横向重叠 20px**（x299.3~319.3），因为图标视觉中心只相距 21.5px 却各给了 40px 框（margin -8.5px / -8.5px -11.5px）。
- **证据 1（浏览器命中测试）**：`document.elementFromPoint(Open-in 的视觉中心)` → **owner = More ways to open**。
- **证据 2（真实输入）**：CDP 真点击该点 → `pointerdown/click` 都落在 **More ways to open**（记录器实测，非推断）。
- **预期**：点某个图标的中心必须触发它自己。
- **实际**：触发邻居的菜单；用户点"在文件管理器打开"得到的是"其他打开方式"。
- **证据**: `tmp\shots\v1327-qa\qa-A14-hitboxes.png`（红虚线=放大后的命中框，绿框=图标；可直观看到头部两个框互相压住）、`qa-report-*.json` 的 `QA-A14.dom.probes/realTaps`

## FINDING-2 [P1] Workspaces 行三个图标命中区互叠 8px，边缘点击互相误触（QA-A14）

- **实测几何**: `Search sessions` 40×40 @170、`View options` 40×40 @202、`Add workspace` 40×40 @234 —— 每个框比视觉图标各向外扩 6px，**相邻两两重叠 8px**。
- **真实输入验证（三个方向都中招）**:
  - 点 `Search sessions` 命中框右边缘（x209.5）→ 触发 **View options**
  - 点 `View options` 命中框左边缘（x202.5）→ 触发 **Search sessions**
  - 点 `Add workspace` 命中框左边缘（x234.5）→ 触发 **View options**
- **预期**：放大命中区不该让"点这个图标却打开那个菜单"。
- **实际**：三个按钮两两互抢；用户手指落在图标右侧 2~3px 就会开错面板。
- **影响面**: 这三个是**同一行紧挨着**的高频入口（搜索/视图选项/加工作区），误触概率高于头部那对。
- **建议的最小修法**（任选）: ① 这行的框横向只放到"相邻框相切"（即 40px 高、宽 = 邻居中心距 32px/21.5px），② 或保留 40px 但把图标间距拉开（行内给 gap，把负 margin 收回），③ 或只对"单独一个"的按钮放大、成组的按钮按中心距给宽。

## FINDING-3 [P2] "Agent Team" 命中框宽 97.2px（带标签态），左段落在面板背景上成死区、右侧与邻居打架（QA-A14）

- **实测**: `Agent Team` 命中框 **97.2×40 @x206.4**（它带文字标签，框跟着标签变宽），横向与 `Collapse sidebar`(面板内, 40px) 重叠 40px、与 `Open in File Explorer` 重叠 24.3px、与 `More ways to open` 重叠 4.3px。
- **展开面板时**：x 206~234 这段（它的左段）落在**面板背景**上没有按钮 → 点了没反应（死区）；x 234~274 被面板的 Collapse 按钮抢走。
- **收起态**：面板只剩 56px，标签态按钮完整露出，此时它右侧与头部两个按钮互抢。
- **预期**：命中区放大后不应出现"看着能点、点了没反应"的区段，也不该盖住邻居。
- **证据**: 同上截图（头部那一大块红框就是它）。

## FINDING-4 [P3] F3 只覆盖 7 个按钮，同类小按钮还有一批（QA-P04）

同一次扫描里仍是 <40px 高的（**不在**本次 7 个之内）：`More actions` 28×28、`Open right sidebar` 28×28、`Copy` 28×28（多处）、`Good response`/`Bad response` 28×28、`Branch into a new conversation` 28×28、`Add files or run commands` 28×28、`Access mode` 44×28、`Select model` 135.6×28、`Send message` 34×34、`New session` 24~38 高、`Plugins` 36 高、`Settings` 36 高、`Show 13/90 more sessions` 28 高、`Chat`/`Trajectory` 25 高。
- **归因**: 它们不在 F3 选的 6 个 class 里，所以**不是没做到，而是没覆盖**（范围问题）。
- **提示**: 其中 `More actions`(x336) 与 `Open right sidebar`(x372) 只有 36px 间距 —— **如果照 F3 的手法放大就会重演 FINDING-1/2 的重叠**，建议这批一起重做时按"相邻中心距"给宽度，而不是无脑 40。

---

## 通过的部分（明确记录，免得只看到失败）

| 用例 | 结果 | 关键数字 |
|---|---|---|
| QA-C05 面板基线 | PASS | 展开 `fixed/280/0.92/shadow .35`；点浮层外 `collapsed=true`、宽 55.6、`bg .45`；`patchCount=1` |
| QA-C05 壁纸红线 | PASS | `BynINW_frame = rgba(0,0,0,0)`、`centerCol = rgba(0,0,0,0)`、`chatChild = rgba(0,0,0,0)`、`#dsh-theme-veil` 在；截图里立绘/壁纸**可见**（v1.32.5 那类整层消失没复现） |
| QA-A01 连点 10 次 | PASS | 10 次状态逐次跟随（false/true 交替），末态与最后一次一致；再点一次仍正常回到 280px |
| QA-A02 加载中抢跑 | PASS | 加载 5.09s 时点中，最终展开、`patchCount=1`（无重复注入） |
| QA-A15 收起态轨道 | PASS | 轨道 55.6px 不变；轨道内按钮最大 40×40 且 x≤44 **未顶出 56px 轨道**；纵向行距 32px、40px 框之间留 8px **无纵向重叠** |
| QA-A06 F1 三档 | PASS-with-findings | 三档的钉死规则全部生效（见下）；**1.5 下最后一行仍被 Settings 页脚压约 3.9px** |

**F1 的验证数字（你要的 1.5 字体 DOM 基线，已留档）**

| font_scale | titleMinWidth | titleShrink | timeShrink | timeMarginLeft | listPadBottom | 末行底 vs Settings 顶 |
|---|---|---|---|---|---|---|
| 1.0（日常档） | 0px | 1 | 0 | 8px | 32px | **-7.1px（不压）** |
| 1.3 | 0px | 1 | 0 | 8px | 32px | **-0.5px（刚好不压）** |
| 1.5 | 0px | 1 | 0 | 8px | 32px | **+3.9px（仍压约 4px）** |

- **v1.32.6 → v1.32.7 的肉眼对照**（`tmp\shots\qa\qa-A06-font15.png` vs `tmp\shots\v1327-qa\qa-A06-font15.png`）：标题与时间戳"贴死无间隙"的指纹**消失了**（现在 `GitHub openspe… 4min`、`Tailscale双dsh互… 6h` 都有清晰间隙）✓；末行从"被压掉大半行"变成"只压 4px" ✓ 但**没归零**。
- 位置配对说明：我按"第 i 个 title ↔ 第 i 个 time"配对，`work_dsh`（工作区行，无时间戳）会错配一位，所以"work_dsh gap = -33.5"是**配对假象**，不是真实重叠；真实逐行 gap 见 `qa-report` 里的 `pairs`（`询问模型身份 14px`、`笔记本 14px` 等）。

---

## 未覆盖 / 备注

- 未覆盖：QA-C01~C04（推送/提问卡/通知直答/快答浮窗，需真机或生产推送）、QA-A03/A05（作答竞态，需真实提问）、QA-C08 的推送通道侧表现；体验组 P01/P02/P05~P10 未跑。
- **已知未治（不记成新 bug，与你的备注一致）**：font 1.5 下会话头部文件夹图标压 "Agent Team" 文字（上游布局；v1.32.7 截图里仍是同款指纹）。
- 一次"独立探针"（把头部按钮在收起态再测一遍）挂住超过 600s 且有界化前无法判进度 → 按章程判 **BLOCKED** 未采纳；FINDING-1 的结论来自 A14 已有的**双重证据**（elementFromPoint + 真实输入），不受影响。
- 环境侧：本轮我自己编译了被测 commit（因为版本号未 bump，装哪个 APK 都显示 1.32.6）；设备已复位（font_scale/uimode/wm size/airplane）并 force-stop。

## 给 Lead 的建议（发布决策）

- **建议先不要 -Deploy**：FINDING-1/2 是"点 A 触发 B"这类用户能立刻感知的错误，且**是新引入**的（v1.32.6 时这两个按钮只有 17/28px、不重叠，点中心就是自己）。
- 最小修法：**给成组按钮的命中框按"相邻中心距"限宽**（相切而不重叠），或成组按钮改用"行内 gap + 不放负 margin"；头部那对图标中心距只有 21.5px，物理上无法各自拥有 40px 宽而不重叠 —— 要么接受 21.5×40（高够、宽刚好相切），要么把它们分开。
- F1 若想收尾：1.5 档再补一点列表底部留白（现在 32px 仍差 ~4px，建议 36~40px 或让末行参与滚动）。

---

# QA-ROUND v1.32.7 · 第二轮复验（commit d630128）

```
QA-ROUND v1.32.7(round2) 结论: PASS
用例: 跑 6 条（PASS 6），未覆盖同首轮（需真机/生产推送）
被测: d630128 自行编译 sha256 09ACA78A89311B2C093FAC8DA254DA378DDE696638B8BCACB7FDA3D900D5DF91
环境: emulator-5554 / 真 GPU / 2026-10-13 18:2x
证据: F:\work\work_dsh\tmp\shots\v1327-qa2\（8 张 >100KB，含命中框描边图，逐张 read_image）
```

**首轮的三个 P1/P2 全部关闭**：`centreSelfHit.all = true`、`abutmentOk.all = true`、`railSelfHit.all = true`。

## 逐项对照（Lead 的复验清单）

### ① A14/A15 全套 + 交界点探针 —— PASS
**新几何实测**（412px 视口）：

| 按钮 | 命中框 | margin | 与首轮对比 |
|---|---|---|---|
| Workspaces 三钮（Search / View options / Add workspace） | **32×40**@174 / @206 / @238 | -6 -2 | 首轮 40 宽、互叠 8px → 现**相切、重叠 0** |
| Open in File Explorer | **23×40.2**@287.4（保自然宽） | -8.5 0 | 首轮 40 宽，与邻居叠 20px |
| More ways to open | **20×40.2**@311.7 | -8.5 -3.9 -8.5 **+1.3** | 首轮 40 宽 → 现与左侧**留 1.3px 缝、重叠 -1.3** |
| Agent Team | **28×40**@239（横向扩张已撤） | -6 0 | 首轮 97.2 宽（压面板/邻居） |
| Collapse sidebar / 轨道钮 | 40×40 | -6 | 无同排邻居，保持 |

- **"视觉中心必须命中自己"**（TESTER.md 铁律 6）：`offenders = []` ✓；唯一 "Agent Team->Collapse sidebar" 属**预期**（展开态它落在 280px 浮层之下，上游 overlay 设计，与 v1.32.6 同款，见 ③）。
- **交界点判定**（首轮没测的角度，±2px 内允许任一、之外必须命中自己）：三处交界 `outsideBandOk` **全 true**，逐点实测：
  - `Search sessions | View options`（gap=0 相切）：x204~207 四点 **owner=null（落空）**，x208 起归 View options。→ **判定 PASS**：这 4px 落在两个图标之间的**视觉空隙**里（Search 图标止于 197、View 图标起于 214），既不误触也不吃掉图标本体；"落空"比"误触邻居"更好。
  - `View options | Add workspace`（gap=0）：x236/237 归 View options，x238 起归 Add workspace —— **交界处干净切换**。
  - `Open in File Explorer | More ways to open`（gap=**+1.3**，与自述一致）：x309.7 归 Open-in ✓，x310.7 落空（那 1.3px 缝）✓，x311.7 起归 More-ways ✓ → **"分体钮纯负 margin 必咬 1.3px"这条发现成立**，加正 left margin 后确实留出缝。
- **真实输入复核**：四个侧栏按钮（Collapse/Search/View/Add）**中心点各自命中自己** ✓；头部三钮的中心点在面板展开时会先被面板的 Collapse 抢走（预期，见 ③），**收起态（rail）重测全部 self=true** ✓。
- **A15 收起态轨道**：轨道 **55.6px** 不变；轨道内按钮最大 40×40、右边界 ≤44px **未顶出**；纵向 32px 行距留 8px **无重叠** ✓。
- 证据：`qa-A14-hitboxes.png`（红虚线=命中框、绿框=图标：可直观看到三钮与头部两钮的框**相切不再交叠**）、`qa-A15-rail.png`、`qa-report-*.json`。

### ② F1 归零争议 —— **webview 的容器认定是对的，我修正首轮结论**

- **容器认定核实**：`[class*='_9lTDKa_list']` 在当前页面**确实匹配 2 个元素** —— 外层 `_9lTDKa_listArea`（`scrollHeight==clientHeight==515`，**不可滚**）与真滚动容器 `_9lTDKa_list`（`scrollHeight 580 > clientHeight 475`，**可滚**）。我首轮用 `querySelector`（取第一个）量的是**前者**，且是在 `scrollTop=0` 的中间态量的。
- **滚真容器到底后**：`scrollTop 0 → 105.1 / 111.6 / 116.2`（1.0/1.3/1.5），末行底 vs Settings 顶 **余量 +112.3 / +112.2 / +112.3px**（三档都 ≥0，且远大于 0）✓；`padding-bottom` 实测 **40px**（首轮是 32）。
- **我的修正**：首轮"1.5 下末行仍被 Settings 页脚压 3.9px"这条**结论作废**。真实情况是——列表本身可滚，`scrollTop=0` 时末行被**滚动容器自身的底边**裁切（滚动列表的正常表现，不是被页脚盖住），而修复针对的"滚到底也清不开页脚"已经不存在（现在余量 112px）。**这一条从 P2 降级/撤销，不计入本轮 finding。**
- **新增 QA-A17** 把这件事固化成用例（"查真的滚动容器、滚到底再量余量"），避免下次再被不可滚的外层骗一次。
- 证据：`qa-A17-scrollbottom.png`、`qa-report` 的 `QA-A17.dom`（含两个容器的 `scrollHeight/clientHeight/padding` 三件套）。

### ③ Agent Team 展开态被面板盖 —— 非本次引入，收起态命中自己
- 展开态：它的中心 `(253, 25.2)` 的 owner 是面板的 **Collapse sidebar**、其图标中心被 280px 浮层覆盖 —— 与 **v1.32.6 基线同款**（上游 overlay 设计：浮层就是这个宽度），**不是本次引入**，不计 finding。
- 收起态（rail，浮层只剩 56px）：`railSelfHit.all = true`，**Agent Team 图标中心命中自己** ✓。

### ④ 红线速查 —— 全绿
- **壁纸透明**：`BynINW_frame` / `BynINW_centerCol` / `chatChild` 全 = `rgba(0, 0, 0, 0)`、`#dsh-theme-veil` 在；截图里立绘/壁纸可见 ✓
- **280/0.92**：展开 `position:fixed`、`width:280`、`visibleW:280`、`bg rgba(249,250,251,0.92)`、`shadow .35/8px/32px` ✓；点浮层外收起 → 55.6 / `rgba(…,0.45)` / `shadow:none` ✓
- **`patchCount=1`**（注入仍幂等）✓
- **连点 10 次**：状态逐次跟随、末态与最后一次一致、再点一次仍正常回到 280px ✓

## 本轮环境侧备注（不记成 App bug）
- 真实输入探针会**把输入法弹起来**（某些探针点落在会话输入框上）——它只影响**之后**的量测（视口变矮），本轮各用例的结论都取自弹出前的量测，A15 随后复测轨道仍是 55.6px 说明未受影响。下次把"探针后按 ESC 收起 IME"写进驱动。
- A14 首次复跑被我的断言 BLOCKED 两次：① 未排开"被浮层盖住"的预期项；② 页面里有个 **0×0 的重复 `EBLgjq_trigger` 节点**（无视觉中心）被我当成失败项。两处都是**探针自身**的问题，已修（跳过 0×0 元素、把被覆盖项单独记为 `coveredByPanelExpected`），修完即 clean PASS。

## 结论
**PASS —— 建议可以 -Deploy。** 首轮 FINDING-1/2/3 全部关闭且有 elementFromPoint + 真实输入双证；F1 的争议按容器认定修正（我首轮那条 +3.9 作废）；红线速查全绿。FINDING-4（那批 28px 按钮）本轮按约定未动，已立为 **QA-A16**（要扩先治上游间距）。

---

# QA-ROUND v1.32.7 · 发布后确认轮（线上包）

```
QA-ROUND v1.32.7(post-release) 结论: PASS
被测: 从线上链接下载（不是本地构建）https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=73
      10,989,076 bytes  sha256 A73A01190F63975146F55C2EE61DDD7347B6A78C902E8AE8E208FCD99C119E59
      安装后回读 dumpsys: versionCode=73  versionName=1.32.7
用例: A14 / A15 / C05（快轮 3 条）  环境: emulator-5554 / 真 GPU / 10:3x
证据: F:\work\work_dsh\tmp\shots\v1327-online\（4 张 >100KB，含命中框描边图，逐张 read_image）
```

**线上包与 d630128 行为逐项一致**（数字与第二轮本地构建完全相同）：

| 项 | 线上包实测 | 第二轮（本地构建 d630128） |
|---|---|---|
| A14 视觉中心命中自己 | `centreSelfHit.all = true`（唯一例外 Agent Team 展开态被浮层盖，属预期） | 同 |
| A14 交界带判定 | `abutmentOk.all = true`；三处交界行值与第二轮逐点相同（`Search\|View` gap=0 四点落空→x208 起归 View；`View\|Add` 在 0 处切换；`Open-in\|More-ways` gap=**+1.3**，缝内落空、缝外各归各） | 同 |
| A14 命中框几何 | 三钮 **32×40**（@174/@206/@238）、Open-in **23×40.2**、More-ways **20×40.2**（margin -8.5 -3.9 -8.5 **+1.3**）、Agent Team **28×40** | 同 |
| A14 收起态 | `railState {w:55.6, collapsed:true}`、`railSelfHit.all = true` | 同 |
| A15 轨道 | 55.6px；轨道内按钮 ≤40 且右边界 ≤44px 未顶出；纵向 8px 间隙无重叠 | 同 |
| C05 面板/收起 | 展开 `fixed/280/visibleW 280/bg 0.92/shadow .35`；点浮层外 → `55.6 / 0.45 / shadow none`；`patchCount=1` | 同 |
| 壁纸红线 | `BynINW_frame` / `BynINW_centerCol` / `chatChild` 全 `rgba(0, 0, 0, 0)`、veil 在；截图里立绘可见 | 同 |

线上包与本地构建**字节数不同**（10,989,076 vs 11,068,832）属正常（发布产物与本地 assembleDebug 的打包差异），因此结论以**实际行为 + versionName/versionCode 双重核对**为准，而非文件哈希。
设备收尾：`font_scale` / `uimode` / `wm size` / `airplane` 已复位、应用已 force-stop。
