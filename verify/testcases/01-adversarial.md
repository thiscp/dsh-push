# 对抗性用例（adversarial）

目标不是"确认功能正常"，而是**故意把 App 弄坏**：连点、抢跑、极端文本、极端视口、断网、退出竞态。这里每条都是真实用户会干的事（手抖、着急、地铁里、字体调到最大）。

- 每条用例的判定都要求**截图 + 同一时刻 DOM 复核**（见 `verify/TESTER.md`）。
- 会改设备全局状态的用例（字体、夜间模式、分辨率、飞行模式）**必须在用例结束前复位**，并在报告里写"已复位"。
- 发现问题时优先给**可复现的最小步骤**，别只给"偶发"。

---

### QA-A01 连点展开/收起 10 次
- **场景**: 用户手指连点侧栏图标 10 次（着急找会话）。
- **前置**: 内置浏览器已加载；侧栏收起。
- **步骤**:
  1. CDP 以 ~150ms 间隔点「Open sidebar」/「Collapse sidebar」交替 10 次
  2. 停 3 秒 → `screencap` `qa-A01-rapid.png`
  3. CDP 复核最终 `collapsed` 与几何；再点一次 toggle 看是否还能正常切换
- **预期**: 最终状态与 DOM 一致（没有"半开"、没有残影、没有两个浮层叠加）；连点后仍能正常切换。
- **实际**: 10 次快速切换每次状态都跟随点击、末态与最后一次点击一致；再点一次仍能正常切换；`patchCount` 恒为 1，无重复浮层。
- **结果**: PASS
- **证据**: tmp\shots\qa\qa-A01-rapid.png、qa-A01-after-toggle.png

### QA-A02 页面加载中就点侧栏
- **场景**: 用户点开 App 后立刻点侧栏（页面还没加载完）。
- **前置**: 已 force-stop 应用；URL 可用。
- **步骤**:
  1. `am start` 起 WebActivity 后**立刻**（0.5 秒内）CDP 点 toggle；若 DOM 还没出来就 200ms 重试直到 6 秒
  2. 等页面加载完 8 秒 → `screencap` `qa-A02-early-tap.png`
  3. 复核 DOM：补丁 `#bw-narrow-fix` 只应存在 **1 个**；侧栏状态与视觉一致
- **预期**: 抢跑点击不会造成重复注入（`narrowFixCount==1`）、不会卡死、不会出现两个浮层；状态最终自洽。
- **实际**: 页面加载到 4.2s 时点中 toggle；最终 `collapsed=false`、`patchCount=1`、`shellReady=true`；抢跑未造成重复注入或卡死。
- **结果**: PASS
- **证据**: tmp\shots\qa\qa-A02-early-tap.png

### QA-A03 作答瞬间退出
- **场景**: 用户点了选项立刻切走/杀掉 App（怕它继续跑）。
- **前置**: 有待答提问卡（真机 e2e）；或用模拟器侧"点选项后立刻 force-stop"。
- **步骤**:
  1. 记下作答前的 pending 状态（prefs/会话）
  2. 点选项 → **200ms 内** `adb shell am force-stop xyz.cpyh.dshpush`
  3. 重进 App → `screencap` `qa-A03-after-kill.png`
  4. 核对：桌面侧是否只收到**一次**作答；重进后卡片是否显示为已完成而不是"还能再答"
- **预期**: 恰好一次作答（不重复、不丢失）；重进后不再出现待答态；桌面会话正常继续。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-A04 超长/emoji/多行/中英混排问题文本
- **场景**: 桌面 agent 提了一个很长、带 emoji、中英混排、带代码块的问题。
- **前置**: 能构造这样的提问卡（`ask_user_question` 或 DOM 复刻注入同结构文本）。
- **步骤**:
  1. 文本用：200+ 字的连续中文 + 🚀✅🧪 emoji + 一个反引号代码片段 + 英文长单词（如 `AskUserQuestionOptionsList`)
  2. `screencap` `qa-A04-longtext.png`
  3. 复核：卡片 `scrollWidth <= clientWidth`（无横向溢出）、标题 `titleLines` 合理、选项按钮宽 > 200px
- **预期**: 文字换行正常、不竖排、不横向溢出；按钮不被挤成一线；emoji 不变成方块；代码片段不撑破卡片。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-A05 倒计时到点前一刻作答
- **场景**: 用户在"10 秒后继续工作"的数字跳到 1 的瞬间点选项。
- **前置**: 待答卡片带倒计时。
- **步骤**:
  1. 等倒计时读到 ≤2 秒
  2. 立刻点选项
  3. `screencap` `qa-A05-race.png` + 桌面侧确认到底采纳了哪个
- **预期**: 只有一种结果被采纳（要么用户选项、要么自动继续），不会两个都发生、不会桌面侧收到两次。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-A06 字体放大（font_scale 1.3 / 1.5）
- **场景**: 老年用户/或随手把系统字体调到最大。
- **前置**: 内置浏览器已加载。
- **步骤**:
  1. `adb shell settings put system font_scale 1.3` → 重载页面 → 展开侧栏 → `screencap` `qa-A06-font130.png`
  2. 改 1.5 → 同样再拍 `qa-A06-font150.png`
  3. 复核：会话标题行数、侧栏条目是否重叠/被裁
  4. **复位** `adb shell settings put system font_scale 1.0`
- **预期**: 大字体下侧栏条目与标题不重叠、不被裁；提问卡文字仍横排可读。
- **实际**: 1.3/1.5 下面板仍 280/fixed/0.92、标题不竖排；但 **1.5 下标题截断后与时间戳相贴**（`Tailscale双dsh互督…3h`、`笔记本GPU占用波…23h`），**面板最后一行 `Untitled` 被 Settings 页脚压住**，放大后背后文字与大号条目并列形成"两层文字"。
- **结果**: PASS-with-findings（P2）
- **证据**: tmp\shots\qa\qa-A06-font13.png、qa-A06-font15.png

### QA-A07 深色系统主题
- **场景**: 用户手机常驻深色模式。
- **前置**: 内置浏览器已加载。
- **步骤**:
  1. `adb shell cmd uimode night yes` → 重载 → 展开侧栏 → `screencap` `qa-A07-dark.png`
  2. 复核 DOM 背景 alpha 与文字色对比度
  3. **复位** `adb shell cmd uimode night no`（或用户原状态）
- **预期**: 深色下壁纸仍透出、玻璃层不是一片死白/死黑；正文可读；面板与背景分层清楚。
- **实际**: `cmd uimode night yes` 后 App 与 WebView **仍是浅色**，截图与浅色态一致 → App/DSH Web 主题不跟随系统 uimode（主题来自 App 自己的设置）。
- **结果**: BLOCKED（用例界定错误：应改测 App 内主题切换）→ 已新增 QA-A13
- **证据**: tmp\shots\qa\qa-A07-dark.png

### QA-A08 飞行模式收推送 / 重连
- **场景**: 用户在飞机上，App 一直连不上。
- **前置**: App 在前台（主界面或内置浏览器）。
- **步骤**:
  1. `adb shell cmd connectivity airplane-mode enable` → 等 15 秒 → `screencap` `qa-A08-offline.png`
  2. 观察是否出现错误页/重连提示；是否有 ANR/崩溃（查 `adb shell dumpsys activity | Select-String 'ANR'` 或 logcat 尾部）
  3. `adb shell cmd connectivity airplane-mode disable` → 等 20 秒 → `screencap` `qa-A08-back.png`
- **预期**: 不崩不 ANR；离线时提示明确；恢复后自动回到可用状态。
- **实际**: 飞行模式下不崩、页面仍完整可用，但**没有任何离线提示**（截图与在线态几乎一致）；恢复后 `shellBack=true`、`patchCount=1`，不需要手动清数据。未覆盖：推送通道（PushService WS）在飞行模式下的表现，需要在主界面看。
- **结果**: PASS-with-findings（P2）
- **证据**: tmp\shots\qa\qa-A08-offline.png、qa-A08-back.png

### QA-A09 旋转/横竖屏切换
- **场景**: 用户横过来看（或误触旋转）。
- **前置**: 内置浏览器已加载；侧栏收起。
- **步骤**:
  1. `adb shell settings put system accelerometer_rotation 0` + `adb shell settings put system user_rotation 1`（横屏）
  2. 等 3 秒 → 展开侧栏 → `screencap` `qa-A09-landscape.png`
  3. 回竖屏 `user_rotation 0` → `screencap` `qa-A09-portrait.png`
- **预期**: 重排正确（侧栏/内容不互相压、卡片不溢出）；回到竖屏后与切换前一致。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-A10 极窄视口（约 300 CSS px）
- **场景**: 分屏/小屏设备上只剩很窄的宽度。
- **前置**: 内置浏览器已加载。
- **步骤**:
  1. `adb shell wm size 800x1200` → 重载页面 → 展开侧栏 → `screencap` `qa-A10-narrow.png`
  2. 复核 `innerWidth` 与卡片/侧栏几何（卡片文字是否仍横排、标题是否被压成竖排）
  3. **复位** `adb shell wm size reset`
- **预期**: 极窄下提问卡文字仍横排可读（不"一列一字"）；侧栏浮层仍可用且不超出视口。
- **实际**: 800x1200（≈305 CSS px）下面板 280px 适配视口、标题用省略号截断、**没有**竖排塌陷；壁纸/立绘被放大后顶到 App 标题栏并与标题文字重叠。
- **结果**: PASS-with-findings（P3，且是人为尺寸）
- **证据**: tmp\shots\qa\qa-A10-narrow.png

### QA-A11 连按返回键/返回手势
- **场景**: 用户习惯性连按两次返回。
- **前置**: 内置浏览器里点进了一个会话。
- **步骤**:
  1. `adb shell input keyevent KEYCODE_BACK` → 观察
  2. 再按一次 `KEYCODE_BACK` → `screencap` `qa-A11-back.png`
  3. `adb shell dumpsys window | Select-String mCurrentFocus` 看当前是不是还在 App
- **预期**: 行为可预期（回上一页/关浏览器/退到桌面），不出现白屏、不留下打不开的空白 WebActivity。
- **实际**: 连按两次返回后落到桌面（App 退出），**没有**白屏或打不开的空白 WebActivity；第一次返回的具体作用未能从证据确认（当轮报告被后一次运行覆盖）。
- **结果**: PASS（行为可预期）；下轮补"只按一次返回"的截图
- **证据**: tmp\shots\qa\qa-A11-back.png

### QA-A12 侧栏面板长列表滚动到底
- **场景**: 用户会话很多（13+ 条 "Show N more sessions"），要在浮层里滚到底。
- **前置**: 展开态浮层。
- **步骤**:
  1. CDP 在浮层内派发滚动/滚轮事件到底部
  2. `screencap` `qa-A12-scroll.png`
  3. 复核浮层 `scrollTop` 与背后内容 `scrollTop`（背后内容**不应**跟着滚）
- **预期**: 浮层内部滚动正常、底部条目可见可点；背后会话内容不被带动滚动。
- **实际**: 面板根 `scrollHeight==clientHeight==777`（根不滚，滚动发生在内层）；滚轮 5 次后"面板之外"有 1 个元素 `scrollTop>0` → **疑滚轮穿透到背后内容**。有界 200s 的复测探针未返回（判 BLOCKED，不硬凑结论）。
- **结果**: BLOCKED（下轮补：带 before/after scrollTop 对照）
- **证据**: tmp\shots\qa\qa-A12-scroll.png

### QA-A13 App 内切主题（深色）→ 可读性与壁纸
- **场景**: 用户把 App 主题切成深色（这是 App 自己的主题设置，**不是**系统 `cmd uimode night`）。
- **前置**: 内置浏览器已加载；知道 App 当前的壁纸/主题设置项在哪（主界面设置或 prefs）。
- **步骤**:
  1. 把 App 主题切成深色（走 App 自己的 UI/prefs，不要用 `cmd uimode night`）
  2. 重载内置浏览器 → 展开侧栏 → `screencap` `qa-A13-darkapp.png`
  3. 复核：面板底 alpha、大容器背景、正文与底色对比；目视壁纸/立绘是否仍可见
  4. 复位成浅色再拍一张对比
- **预期**: 深色主题下正文与底色对比足够、玻璃层不是死白/死黑，壁纸/立绘仍能透出。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

> 备注（2026-10-13 v1.32.6 对抗冒烟产生）：原 QA-A07 用系统 `cmd uimode night` 测深色，实测 App 与 WebView 都**不跟随**系统 uimode（截图与浅色态一致），所以深色必须走 App 自己的主题设置 —— 这条 QA-A13 就是那次"用例界定错误"沉淀下来的新角度。

### QA-A14 命中区放大后的重叠：点 A 会不会触发 B
> ⚠️ **几何基线已作废（tester 标注 2026-10-14，本轮 task-2）**：下面「实际」里的坐标与中心距（279.3 / 299.3 / 32px / 重叠 20px、8px 等）
> 是在**旧 411 CSS px 视口**下量的。CSS360 基线（`innerWidth=360` / `dpr=4`）下**不可对照**；
> **下轮 QA 首跑必须重打**（依据 `verify\TESTER.md` 附录 A.1、`verify\TEAM-START.md` §0.1）。
> 本条的**方法学与断言**仍然有效，只有数字作废。
- **场景**: v1.32.7 把 7 个图标按钮的命中区用"放大 + 等量负 margin"做到 40px —— 相邻按钮的命中框因此互相重叠，用户点某个图标的边缘/中心时可能触发邻居。
- **前置**: 窄屏内置浏览器；侧栏可展开/收起。
- **步骤**:
  1. 在页面里装一个**捕获阶段**的探针：记录 pointerdown/click 的 target 并 stopImmediatePropagation（真实命中测试照跑、但不会真的改动 App 状态）
  2. 对每个目标按钮量两组矩形：命中框（元素自身）与**视觉图标**（内部 svg/img）
  3. 对每个按钮取 7 个探针点：图标中心/左/右/上/下边缘 + 命中框左右边缘，用 document.elementFromPoint 记下 owner
  4. 对 owner≠target 的点用 CDP Input.dispatchMouseEvent **真点一次**，看记录器里实际触发的是谁
  5. 再对每个按钮的**图标中心**真点一次，确认"自己点自己"
- **预期**: 图标中心与图标内的点必须触发它自己；只有"故意点到邻居图标上"才触发邻居。命中框可以重叠，但**不能让 A 的视觉区落在 B 的命中框里**。
- **实际**: v1.32.7 **不满足**：Open in File Explorer(40x40 @279.3) 与 More ways to open(40x40 @299.3) 横向重叠 20px，前者图标视觉中心(299.3) 的 owner 是后者 —— elementFromPoint 与真实输入双重确认"点它的中心打开了邻居的菜单"；Workspaces 行 Search sessions / View options / Add workspace（各 40x40，中心距 32px）两两重叠 8px，点右/左边缘分别触发邻居（真点验证 3 处）。
- **结果**: **FAIL（P1）**，见 verify/QA-ROUND-v1.32.7.md FINDING-1/2
- **证据**: tmp\shots\v1327-qa\qa-A14-hitboxes.png（红=命中框、绿=图标）、qa-report 的 QA-A14.dom.realTaps

### QA-A15 收起态图标轨道：40px 命中框会不会顶出 56px 轨道 / 纵向互叠
> ⚠️ **几何基线已作废（tester 标注 2026-10-14，本轮 task-2）**：下面「实际」里的 55.6px 轨道宽、32px 行距、右边界 ≤44px
> 是在**旧 411 CSS px 视口**下量的。CSS360 基线（`innerWidth=360` / `dpr=4`）下**不可对照**；
> **下轮 QA 首跑必须重打**（依据 `verify\TESTER.md` 附录 A.1）。方法学与断言仍有效，只有数字作废。
- **场景**: 侧栏收起后是 56px 宽图标轨道；新加的 40px 命中区可能横向顶出轨道、或让纵向相邻按钮互叠。
- **前置**: 侧栏收起（w≈55.6）。
- **步骤**:
  1. 收起侧栏 → 量轨道矩形与**轨道内**每个按钮的矩形
  2. 断言：轨道宽仍 ≈55.6；轨道内按钮右边界 ≤ 轨道宽；相邻行纵向不重叠
  3. 截图 qa-A15-rail.png
- **预期**: 轨道宽度不变、按钮不顶出、纵向有间隙；收起态外观与 v1.32.6 一致。
- **实际**: 轨道 55.6px 不变；轨道内按钮（Open sidebar / New session / Plugins / Add workspace / Search sessions / Settings）最大 40x40、右边界 ≤44px **未顶出**；纵向行距 32px、40px 框之间留 8px **无重叠** ✓
- **结果**: PASS
- **证据**: tmp\shots\v1327-qa\qa-A15-rail.png

### QA-A16 成组小按钮扩容前先治上游间距（FINDING-4 沉淀）
- **场景**: 需求是"把图标按钮命中区做到 40px"。但一批 28×28 的按钮**在同一行紧挨着**（间距 36px 甚至更小），照"放大 + 负 margin"直接做必然互相重叠（v1.32.7 的 P1 就是这么来的）。这条用例的作用是**动手前先算账**、动手后按 QA-A14 的手法复核。
- **前置**: 窄屏内置浏览器；侧栏收起或展开（两态都测）。
- **步骤**:
  1. 列出目标小组按钮（当前版本实测仍是 <40px 的一批）：`More actions`、`Open right sidebar`、`Copy`、`Good response`、`Bad response`、`Branch into a new conversation`、`Add files or run commands`、`Access mode`、`Select model`、`Send message`、`New session`、`Plugins`、`Settings`、`Show 13/90 more sessions`、`Chat`、`Trajectory`
  2. 按"同一行/同一容器成组"分组，量每组的**相邻中心距**（`中心距 = next.center - cur.center`）
  3. 断言：`中心距 ≥ 目标命中宽度`。不满足的组**不许直接放大**——必须先改上游间距（行内 gap / 拉开图标），否则重演误触
  4. 放大后按 **QA-A14** 的三步（两组矩形 + elementFromPoint 网格 + 真实输入）复核：每个按钮的**视觉中心必须命中它自己**
  5. 截图：带命中框/视觉框描边的证据图（红虚线=命中框、绿框=图标）
- **预期**: 每个成组按钮的命中框**相切不重叠**（或按中心距封顶宽度）；任一按钮的视觉中心点都必须命中它自己；同组按钮的边缘点要么命中自己、要么落进"都没有按钮"的间隙，**不许命中邻居**。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

> 归因提示（2026-10-13 v1.32.7 FINDING-4）：这批按钮是 **DSH Web 上游**自己排的紧凑布局，不是伴侣 App 的注入造成的；所以"扩命中区"这件事在成组按钮上**要么改上游间距、要么按中心距限宽**，App 侧硬放大是错的路子。

---

## 一键全部已读对抗组（QA-A20~A25，v1.32.9 新增；QA-A26~A28，v1.32.10 逐条已读撤通知新增）

> 这组全部由 `verify\qa-markallread.ps1` 驱动（模式名写在每条步骤里），取证口径与硬事实见 **QA-C09 的备注块**（uiautomator 在 MainActivity 必挂、坐标走 `dumpsys activity top`、toast 走 `dumpsys notification` Toast Queue、prefs/dump 走设备侧 redirect+pull）。
> ID 说明：A17/A18/A19 已在 `qa-round-driver.mjs` 与 v1.32.7/v1.32.8 报告、STATUS-task19 里占用（A19=命中区几何审计常驻用例），所以本组从 **A20** 起。

### QA-A20 一键全部已读之后新推一条必须仍是未读
- **场景**: 用户刚清完未读，桌面 DSH 又交付一个任务——新消息绝不能被"已读态"粘连。
- **前置**: `qa-markallread.ps1 -Mode newmsg`（先跑完 core 序列，再补推 1 条 `qa-` 消息）。
- **步骤**:
  1. core 序列跑完（全部已读、按钮已隐藏）后脚本自动补推第 3 条 `qa-` 消息
  2. prefs：新条目 `read=false`；未读数回到 **1**
  3. `dumpsys activity top`：状态卡里 pill **重新可见**
  4. `screencap` → `read_image`：「● 1 条未读」行重新出现、新卡片不淡化、其余卡片仍淡化
- **预期**: 新消息独立未读；pill 随未读数重新出现；已读过的旧卡片保持淡化不回亮。
- **实际**: 2026-10-13 20:43 `-Mode newmsg`（tag qa-newmsg1791924227）：core 序列全绿后补推 1 条 → 新条目 `read=false`、未读数=1、`dumpsys activity top` 里 pill 重新可见；肉眼判 late 截图：「● 1 条未读」重现、pill 重现、新卡片带蓝点不淡化带「已读」钮、旧卡片保持淡化。
- **结果**: PASS
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-newmsg-late.png`（1.16MB 肉眼判全对）；`acttop-qa-newmsg1791924227-late.txt`（pill 重现）；`prefs-qa-newmsg1791924227-*.xml`

### QA-A21 一键全部已读不得改动 answered/__expired 徽章态
- **场景**: 已答/已过期的卡片带「已答：xxx」「已过期」徽章；一键已读只该动 read 字段，把徽章洗掉就是越权。
- **前置**: `qa-markallread.ps1 -Mode answered`（推 1 条提问 + 监督者代答回声 → 条目 answered 非空且 read=false，是唯一未读）。
- **步骤**:
  1. tap 前记下该条目 `answered` 原文（含监督者前缀）
  2. 点「全部已读」
  3. prefs：`answered` 字段**逐字节不变**；徽章 pill 文案不变（截图肉眼）
  4. 顺带覆盖 __expired：`-Mode inapp` 里选项作答产生的 `answered="__expired"` 条目在截图里徽章仍是「已过期」
- **预期**: read 翻 true、answered/徽章原样；卡片淡化态与徽章共存不冲突。
- **实际**: 2026-10-13 20:44 `-Mode answered`（tag qa-answered1791924270）：tap 前 answered=「【监督者自动唤醒】 qa proxy」且 read=false；tap 后 `answered` **逐字节不变**（脚本 `-eq` 对照，中文经 UTF-8 stdout 捕获链路无损）、read=true；`-Mode inapp`（tag qa-inapp1791924337）里 `answered="__expired"` 条目截图徽章仍是「已过期」且卡片同时淡化（共存不冲突）。
- **结果**: PASS
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-answered-before.png` / `qa-answered-after.png`；`qa-inapp-opttap.png`（「已过期」徽章入镜）；`prefs-qa-answered1791924270-*.xml`

### QA-A22 监督者代答（read=false）应被一键全部已读翻成已读
- **场景**: v1.28.0 起监督者代答保持未读（用户没亲眼见过）；Lead 拍板：用户明确点了「全部已读」= 看过，所以这些也要翻已读。
- **前置**: 同 QA-A21 的 answered 模式（监督者回声条目就是唯一未读）。
- **步骤**:
  1. tap 前 prefs：该条目 `answered` 以「【监督者自动唤醒】」开头且 `read=false`（qa-readstate 两分支之一，先确认没回归）
  2. 点「全部已读」→ prefs：该条目 `read=true`
  3. toast N 必须把这条**计入**（判定 `!optBoolean("read",true)` 与 refresh() 一致）
- **预期**: 监督者代答未读被翻已读；未读行消失；若这条没被翻（或 toast N 少算）= 判定口径与 refresh() 不一致，P1。
- **实际**: 同 `-Mode answered` 轮（tag qa-answered1791924270）：tap 前该条目 answered 以「【监督者自动唤醒】」开头且 read=false（qa-readstate 分支 B 当日也全绿，无回归）；tap 后 read=true；toast N=2 把这条计入（tap 前未读=2 一致）。
- **结果**: PASS
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-answered-after.png`（未读行消失、该卡淡化但徽章保留）；`notif-qa-answered1791924270-qa-answered-after.txt`（toast N=2）；`prefs-qa-answered1791924270-*.xml`

### QA-A23 「全部已读」连点两次幂等
- **场景**: 用户手抖连点，或点完没反应又补一下。
- **前置**: `qa-markallread.ps1 -Mode doubletap`（core 序列 + 同坐标补第二下）。
- **步骤**:
  1. 第一下后 pill 应已隐藏 → 第二下落在 statusText/卡片空白处
  2. 第二次 tap 后 `dumpsys notification`：**不得出现 N=0 的新 toast**（出现=按钮没隐藏，P1）
  3. prefs：仍全部 read=true（无重复写坏）；`pidof` 进程仍在（不崩）
- **预期**: 幂等；第二次点击无副作用。
- **实际**: 2026-10-13 21:00 `-Mode doubletap`（tag qa-doubletap1791925215，Dump-Notif 修复后复跑）：第一下后 pill 隐藏；同坐标第二下后 `dumpsys notification` **无 N=0 toast**（toastN=-1，真实内容断言）；prefs 仍全部 read=true；`pidof` 进程存活 pid=13626。
- **结果**: PASS
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-doubletap-after.png`（1.24MB 肉眼判：全部淡化、pill 隐藏、toast「已全部标为已读（2 条）」入镜）；`notif-qa-doubletap1791925215-tap2.txt`（无 N=0 toast）；`prefs-qa-doubletap1791925215-qa-mard-prefs-tap2.xml`

### QA-A24 未答提问的通知被撤后，App 内卡片选项按钮仍可作答且回声正常
- **场景**: 一键全部已读会连未答提问的通知一起撤掉（Lead 拍板）；但提问本身还活着——用户之后从 App 卡片上点选项必须还能作答，不能因为"通知没了"就断链。
- **前置**: `qa-markallread.ps1 -Mode inapp`（推 1 条带 `#opts q0=optA|optB` 的提问，callId 用不存在的 qa- 串 → 提交必 404 → 落 `__expired`，不碰真实会话）。
- **步骤**:
  1. tap「全部已读」→ `dumpsys notification`：该提问的通知 nid 消失（未答提问通知也撤）
  2. `dumpsys activity top`：卡片里 optA 选项 pill 仍在（已读只淡化不禁用）→ `input tap` 真点
  3. prefs：该条目 `answered="__expired"`（提交链路活着）
  4. toast：`TextToastRecord` 出现「这个问题已经过期了」（回声通道活着）
- **预期**: 撤通知 ≠ 撤作答能力；选项点击仍能提交并得到正确回声。
- **实际**: 2026-10-13 20:45 `-Mode inapp`（tag qa-inapp1791924337）：tap「全部已读」后该提问通知 nid=1579278699 从 dump 消失；`dumpsys activity top` 找到卡片 optA pill (418,1769) 580x192 并 `input tap` 真点 → prefs `answered="__expired"`（提交链路活着）；toast `TextToastRecord` 出现「这个问题已经过期了」（回声通道活着）；肉眼判截图：徽章「已过期」+ toast 入镜、卡片淡化。
- **结果**: PASS
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-inapp-opttap.png`（1.25MB）；`notif-qa-inapp1791924337-qa-inapp-opttap.txt`（过期 toast）；`acttop-qa-inapp1791924337-opts.txt`（optA 坐标）；`prefs-qa-inapp1791924337-*.xml`

### QA-A25 一键已读 cancel 一个早已不存在的通知 nid 必须静默无害（developer 移交角度）
- **场景**: 消息通知早被用户划掉/点掉（AUTO_CANCEL），但 prefs 里该条仍 read=false；一键已读会对这个"不存在的通知" `nm.cancel(nid)`——Android 对不存在的通知是 no-op，但绝不能抛异常或写坏 prefs。
- **前置**: 现网天然存在这种条目（夜间验收推的消息通知早已消失、prefs 仍 read=false）；`qa-markallread.ps1 -Mode core` 每次都会大面积命中这种条目。
- **步骤**:
  1. tap 前 prefs 里未读条目数 > `dumpsys notification` 里 dshpush 消息通知数（差集即"通知已不存在的未读条目"，天然覆盖）
  2. 点「全部已读」
  3. 断言：`pidof` 进程仍在（无崩溃）；tap 后 prefs 的 msgs **仍能整段 JSON 解析**（没写坏）；toast N 仍把这些条目计入
- **预期**: 静默无害；崩溃或 msgs 解析失败 = P0/P1。
- **实际**: 每轮 core 天然大面积命中（tap 前未读 3~6 条 vs dump 里 dshpush 消息通知仅 2~4 条，差集即"通知已不存在的未读条目"，如夜间监督遗留条目）；所有轮次断言：`pidof` 进程始终存活（pid=13626 全程未变）、tap 后 msgs 整段 JSON 仍可解析、toast N 把这些条目全部计入。
- **结果**: PASS（core/newmsg/answered/doubletap/inapp/single 六轮顺带覆盖）
- **证据**: 各轮 `[PASS] A25: app process alive...` / `[PASS] A25: msgs JSON still well-formed...` 日志 + `prefs-qa-*-after.xml`；差集证据见 `notif-qa-core1791925178-qa-core-after.txt`（通知数 < 未读条目数）

### QA-A26 已答题（未读）卡片的「已读」按钮：cancel 一个已被回声撤掉的 nid 必须静默无害（v1.32.10）
- **场景**: 提问被监督者代答：回声已撤掉该条通知（AnswerReceiver 路径），但条目 read=false → 卡片仍显示「已读」按钮（MainActivity 已答未读路径）。v1.32.10 起逐条「已读」也撤通知——点它会对一个**早已不存在的 nid** 再 cancel 一次：必须静默。
- **前置**: `verify\qa-markallread.ps1 -Mode readans`（推提问 + 监督者回声，等 answered+read=false 落定）。
- **步骤**（脚本全自动）:
  1. tap 前 `dumpsys notification`：该条 nid 已不在（回声撤的）——先证「不存在」这个前提成立
  2. `dumpsys activity top` 取第一卡片（已答未读）的「已读」按钮，`input tap`
  3. 断言：条目 read=true；nid 仍不在（第二次 cancel 静默）；无 toast；服务通知仍在；`pidof` 存活；msgs JSON 完好
- **预期**: 静默无害 + read 翻 true。崩溃 / msgs 写坏 / 冒出 toast = P0/P1。
- **实际**: 2026-10-14 01:56 `-Mode readans`（tag qa-readans1791942967，v1.32.10/vc76）：tap 前该条 nid=-1747431689 已从 dump 消失（回声撤的，前提成立）；已答未读卡「已读」按钮 (1082,2078) 352x192 真点 → read=true、nid 仍不在（第二次 cancel 静默）、无 toast、服务通知仍在、pid=23113 存活、msgs JSON 完好。肉眼判截图：卡片淡化、「已答：【监督者自动唤醒】 qa proxy」徽章保留、「已读」钮消失。
- **结果**: PASS
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-readans-after.png`（1.27MB）；`notif-qa-readans1791942967-pre.txt` / `-qa-readans-after.txt`；`acttop-qa-readans1791942967-before.txt`；`prefs-qa-readans1791942967-*.xml`

### QA-A27 通知「已读」按钮与卡片「打开 DSH」双撤同一 nid 必须幂等不崩（v1.32.10）
- **场景**: 带 `#web` 的消息通知有两个动作：「已读」（AnswerReceiver：markRead+cancel）与「打开 DSH」（WebActivity：起页 + 再 cancel 同一 nid + markRead）。v1.32.10 起 markRead 内部也 cancel——同一条消息最多经历**三次**对同一 nid 的 cancel（通知动作 1 次 + 一键已读顺带 + 打开 DSH 1 次）。全部必须幂等。
- **前置**: `verify\qa-markallread.ps1 -Mode dblcancel`（推 1 条 `#web` 消息）。
- **步骤**（脚本全自动）:
  1. 通知在场（nid 快照）→ 触发通知「已读」动作：优先真 UI（`cmd statusbar expand-notifications` + `uiautomator dump` 找「已读」按钮——SystemUI 能 idle，MainActivity 的 dump 顽疾不适用；拿不到就退回发**同款广播** `am broadcast -n …/.AnswerReceiver --es act read --ei mid … --ei nid …`，走应用自己的代码路径）
  2. 断言：read=true、nid 已撤
  3. 回 MainActivity，点该卡片「打开 DSH」→ WebActivity 起页（`mCurrentFocus` 断言）
  4. 断言：nid 仍不在（第二次 cancel 静默）、`pidof` 存活、read 保持 true、msgs JSON 完好
- **预期**: 双撤幂等、WebActivity 正常起页。崩溃 / 通知复活 / JSON 写坏 = P0/P1。
- **实际**: 2026-10-14 01:58 `-Mode dblcancel`（tag qa-dblcancel1791943091，v1.32.10）：通知在场（nid=1072493780）→ **真 UI 路径命中**：`cmd statusbar expand-notifications` + `uiautomator dump` 找到「已读」动作按钮 (676,1445)（SystemUI 能 idle，MainActivity 顽疾不适用）→ 展开态真点 → read=true + nid 撤；回 MainActivity 点卡片「打开 DSH」→ `mCurrentFocus=…WebActivity`（二次 cancel 在其内部跑）→ nid 仍不在、pid=23113 存活、read 保持 true、JSON 完好。肉眼判：WebActivity 起页 ntfy.cpyh.xyz:443、立绘透出。**首轮 2 FAIL 是测试侧缺陷**：助手函数先 collapse 通知栏再 tap → 点了空（已修：tap 在展开态做，之后才 collapse）。
- **结果**: PASS（复跑；首轮 FAIL 为脚本缺陷）
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-dblcancel-web.png`（1.2MB）；`notif-qa-dblcancel1791943091-pre/-act1/-act2.txt`；`win-qa-dblcancel1791943091-web.txt`（mCurrentFocus）；`acttop-qa-dblcancel1791943091-card.txt`

### QA-A28 逐条撤两条后再点「全部已读」：toast N 只数剩余未读，两个已撤 nid 双撤静默（v1.32.10）
- **场景**: 混跑两条路径（接 QA-C09 的四件套姿势）：3 条未读 → 逐条「已读」点掉两条（各自通知被撤）→ 再点「全部已读」pill。markAllRead 的 N 计数与剩余 cancel 必须正确——两个已被逐条撤过的条目此时已 read=true，不该再进 N。
- **前置**: `verify\qa-markallread.ps1 -Mode mix`（推 3 条未读）。
- **步骤**（脚本全自动）:
  1. 三条 nid 都在（pre dump）
  2. 点第一卡片「已读」→ 未读 -1、该 nid 撤、无 toast；再点（此时第一张有按钮的卡片）「已读」→ 未读 -2、该 nid 撤、无 toast
  3. 点 pill → toast **N == 剩余未读数**（不是 3）；剩余 nid 撤；未读=0
  4. `pidof` 存活（3 次 cancel + 2 次双撤）
- **预期**: N 只数剩余；任何环节崩溃 / N 多计 = P1。
- **实际**: 2026-10-14 01:55 `-Mode mix`（tag qa-mix1791942927，v1.32.10）：三条 nid 全在场（1033934136/-1761721313/1794594418）；逐条点掉两张「已读」→ 未读 14→13→12、各自 nid 撤、两次都无 toast；点 pill → toast **N=12 == 剩余未读**（不是 14，两条已读不进 N）、剩余 nid 撤、未读=0；pid=23113 存活（3 cancel + 2 双撤）。肉眼判 after：三张 mix 卡全淡化、pill 隐藏、无未读行。
- **结果**: PASS
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-mix-card1.png` / `qa-mix-card2.png` / `qa-mix-pill.png` / `qa-mix-after.png`（均 >1.1MB）；`acttop-qa-mix1791942927-card1/card2/pill.txt`；`notif-qa-mix1791942927-pre/-qa-mix-card1/-qa-mix-card2/-qa-mix-pill.txt`

### QA-A29 `position:fixed|absolute` 扫荡：新浮层提亮规则有没有误伤别的浮层（v1.32.11 自加对抗角度）
- **场景（本库没有的新角度，为 v1.32.11 浮层不透明度改动专门设计）**：
  改法很可能是「给浮层/菜单加一条例外，把它从 `0.45` 提到 `≥0.92`」。这类**按"是不是浮层"打标签**的规则有两个方向都会坏：
  - **正向误伤（过度提亮）**：页面里其它 `position:fixed|absolute` 元素被同一条规则一起提亮 ——
    `#dsh-theme-veil`（深度纱罩，**必须保持 0.45**，被提到 0.92 会把整张壁纸盖住）、toast、下拉/菜单、dialog、
    提示气泡（tooltip）、通知条（banner/offline bar）。其中 **`#dsh-theme-veil` 是最大目标**：它恰好就是 `position:fixed;inset:0`，
    若规则写成"凡是 fixed 就提亮"，它就是第一个牺牲品，而且**症状与 v1.32.6 的壁纸消失一模一样**。
  - **反向漏亮（该亮的没亮）**：真正的浮层有多个兄弟/嵌套层（外层容器透明 + 内层上色），
    若规则只命中外层（本来就是 `transparent`）或只命中内层而外层仍 0.45，**计算值看着达标、肉眼仍发花**（本仓老坑：computed style 单独通过不算数）。
- **前置**: v1.32.11 装机；`adb root` + `whoami`==root（H-1）；真 GPU（`emu-gpu-verdict.ps1` exit 0）；页面到 DSH shell。
- **步骤**:
  1. **全量枚举快照**：CDP 扫全页，列出**所有** `position` ∈ {`fixed`,`absolute`} 且 `offsetWidth>0 && offsetHeight>0` 的元素，
     每条记录：`tagName` + `className` + `id` + `rect` + **`backgroundColor` 原始值** + **alpha** + 是否被注入改过（比对 `el.style.backgroundColor` 内联值与 computed 值是否一致）。
  2. **对照组断言（关键）**：把清单里**"非浮层"**的元素逐个核对：
     - `#dsh-theme-veil` → alpha **必须仍是 0.45**（**不是** 0.92；这是过度提亮的头号判据）。
     - 其它非浮层半透元素 → alpha **不得被无故提高**（默认 0.45 保持；若原本就是别的值，记录前后是否变化）。
     - 判据：**改动前后该清单里"非目标元素"的 alpha 集合应逐项不变**。
  3. **浮层本体完整性**：对 slash 菜单浮层，断言**其自身 + 其祖先链上所有"上色层"**的 alpha 都 ≥0.92 或为 `transparent`
     （防止"外层仍 0.45、只有内层亮"导致的漏亮假达标）；检查它是否真的应用了 `backdrop-filter`（若有）。
  4. **多浮层共存**：逐一唤出至少 2 种其它浮层（如提示气泡/下拉/dialog——能唤出几个算几个，唤不出的**显式记未覆盖**），
     复核它们没被意外提亮或意外压暗；每步截图。
  5. 每个断言附 `screencap` + `read_image` 整页判（**整页**，不是只看浮层 —— v1.32.6 就是这么漏的）。
- **预期**:
  - 非目标 `fixed/absolute` 元素 alpha **逐项不变**；`#dsh-theme-veil` 稳在 **0.45**、壁纸不被盖；
  - slash 菜单浮层**从内到外**都达到 ≥0.92（没有漏亮的外层）；
  - 其它浮层无意外增亮/压暗。
- **判负**: 出现「veil 被提到 0.92 / 壁纸被盖」= **P1**（视觉回归，等同 v1.32.6）；
  出现「外层仍 0.45 导致肉眼仍发花」= **P1**（假达标）；其它浮层被无故改亮/改暗 = **P2**（视影响面）。
- **实际**: **v1.32.11 实测（2026-10-15 00:06–00:12，n=2）—— 本用例的价值已被验证：它抓到了"不稳定"**：
  - **非目标元素零误伤** ✅：`#dsh-theme-veil` **alpha 0.45**（`z-index:-1` + `inset:0` ⇒ `isOv=false`，两跑一致）、
    同页输入卡 `RlGAzG_card` **0.45**、`BynINW_frame`/`centerCol` **transparent**（壁纸通道保住）。
  - **但"反向漏亮＝假达标"确实发生了，且形式是**随机**而非固定**：菜单表层 `Z9Jnlq_viewport`(257x392)
    **Run A alpha=0（内联 `transparent !important`）｜Run B alpha=0.92** —— 同一版本同一操作，两跑结果相反。
  - **祖先链全量结论（21 层，`background-image` 与 `::before/::after` 都量了）**：
    菜单子树里**真正上色的只有 2 个元素**（表层 + 唯一高亮项 `rgba(38,49,72,0.06)`），
    **不存在"夹在菜单项与面板之间的第三个上色层"** ⇒ **不是分层问题，是判定顺序 + 尺寸阈值问题**
    （详见 `QA-ROUND-v1.32.11.md` FINDING-1）。
  - **顺带抓到一条工具层同类缺陷**：`Dc7zOa_composerSeat` 的底色来自 **`background-image` 渐变**（其 `background-color` 为 0）——
    ⇒ **只用 `getComputedStyle().backgroundColor` 判"这层有没有上色"会漏层**；
    **凡问"哪一层在画背景"，必须同时量 `backgroundImage` + `::before`/`::after`**（已沉淀进 `verify/qa-overlay-layers.mjs`）。
- **结果**: **PASS（作为误伤闸门）**；**同时作为"探雷器"命中 P1**（浮层 alpha 不稳定）
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-A29-fixed-sweep.png`（986,089 B）｜
  `F:\work\work_dsh\tmp\qa-overlay-run2.json` → `cases.QA-A29.sweep` / `QA-A29b-nonoverlays`｜
  `F:\work\work_dsh\tmp\layers-report2.json` → `ancestorChain`（21 层）/ `menuPainters`
- **🔧 强化建议（下轮，必须改）**：本条应改为**多次采样（≥3 跑）**，每跑记录"非目标 alpha 集合 + 目标 alpha"。
  原因：单次测量**无法发现"时好时坏"** —— 本轮若只跑 Run B，会把它误判成 **PASS**（这正是它存在的意义）。
- **去向**: 本轮跑完把结论回填本用例；若发现新缺陷，按 `TESTER.md` §5 格式写 FINDING 进 `QA-ROUND-v1.32.11.md`。

### QA-A30 多面板/多标签共存：结构判据会不会在多一层全屏层后退化（v1.32.12 自加对抗角度）
- **场景（本库没有的新角度，为 v1.32.12「文档预览面板不再全透明」改动专门设计）**：
  该轮的修法引入**结构判据** `isPanel` = 「自身 `position ∈ {absolute,fixed}`，**或**祖先 **8 层内**存在
  `position ∈ {absolute,fixed}` **且覆盖 ≥90%×90% 视口**的元素」。
  而 `BynINW_frame`（壁纸唯一通道）**原生也是 `rgb(255,255,255)`**，与坏面板**同色**
  ⇒ **只能靠结构判据区分**。于是最可能坏的地方是**动态叠加**：
  - **多开一个标签页/面板**时，新面板是否**仍被命中**（仍 1.0）？
  - **更多的全屏 `absolute` 层**在场时，判据会不会**上溯过头**、把 `BynINW_frame` 也判成面板 ⇒ **壁纸整层消失（= v1.32.6 复现）**？
  - 与 **QA-A29 的分工**：A29 是**静态全量扫**"哪些 fixed/absolute 被误伤"；本条是**动态叠加**"多一层之后判据还准不准"，**互补不重复**。
- **前置**: v1.32.12+ 装机；`adb root` + `whoami`==root（H-1，**root 先于任何 forward**）；真 GPU（`emu-gpu-verdict.ps1` exit 0）；页面到 DSH shell。
- **步骤**:
  1. 打开**第一个**文档预览面板（判据：`[class*='_tabHost']` **扫全部匹配取面积最大**那个 —— 有 `0x0` 占位陷阱，`querySelector` 会拿到 0x0 误报"没打开"）；记录其 alpha/尺寸/占比。
  2. **再开第二个**面板/标签页（同一文档或另一文档），确认 `livePanels.count` 增加。
  3. **叠加态断言**：
     - 被注入的 `_tabHost`（最大者）**仍 = 期望 alpha**（v1.32.12 为 **1.0**）；
     - **`BynINW_frame` 仍 `rgba(0,0,0,0)`**（★ 本条的头号判据）；
     - 其余内层（`_tabHostBody`/`_tabHostHeader`）本就透明 ⇒ **保持 `rgba(0,0,0,0)` 是正确的分层**，不算缺陷。
  4. 截图（`screencap` + `pull`，**>100KB**）+ **`read_image` 看整页**：面板实底、壁纸通道未被白纱盖住。
  5. 收尾关闭全部面板，确认面板关闭后通道仍 `rgba(0,0,0,0)`、进程存活。
- **预期**: 多面板共存下，**面板仍被正确命中**（alpha = 期望值）且 **`BynINW_frame` 仍 transparent**；判据**不因层数增加而退化**。
- **判负**: 出现「多开后面板变成透明 / 不再被命中」= **P1**；出现「`BynINW_frame` 被提亮 ⇒ 壁纸被盖」= **P1**（等同 v1.32.6）；内层透明属**正确分层**，**不判负**。
- **实际**: **v1.32.12 实测 PASS（2026-10-15 05:4x）**：
  ```
  secondOpenAttempt = opened            // 成功再开第二个
  after.count = 3 个 live _tabHost
    _tabHost_6nhg2_162 _pane_…   alpha=1  bg=rgb(255,255,255)  360x671   ← 仍被正确命中 ✅
    _tabHostBody_6nhg2_181 …     alpha=0  bg=rgba(0,0,0,0)     360x633   ← 内层滚动体（正确分层）
    _tabHostHeader_6nhg2_177     alpha=0  bg=rgba(0,0,0,0)     360x38    ← 抬头容器（正确分层）
  frame = rgba(0,0,0,0) alpha=0          ← ★ 多面板下壁纸通道仍未被误伤 ✅
  ```
  ⇒ **结构判据在多面板叠加下没有退化**，也未把 `BynINW_frame` 误判成面板（本轮核心风险点的动态复核）。
- **结果**: **PASS**
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-A30-multi-panel.png`（515,509 B，整页）｜
  `F:\work\work_dsh\tmp\doc-report.json` → `a30_multiPanel.before/after`｜详见 `verify/QA-ROUND-v1.32.12.md` §4
- **🔧 复用要点（下轮照做）**：①这条对**任何"按结构/几何打标签"的新规则**都适用 —— 思路是"**把层级叠上去看判据还准不准**"；
  ②`_tabHost` 类名有多个匹配（含 0x0）⇒ **必须取面积最大**；③截图路径**硬编码**（别当位置参数传，会被静默跳过）。

### QA-A32 注入 vs 重渲染竞态：内联样式被换节点抹掉后会不会瞬时露出"原生白"（v1.32.13 自加对抗角度）
- **场景（本库没有的新角度，**这一条在本轮真抓到了缺陷**）**：
  玻璃化注入是**一次性把 `background-color` 写成内联 `!important`**，而页面是 **React 应用、会替换 DOM 节点**：
  **新节点不带内联样式** ⇒ 在**下一次 `apply()` 到达之前**（MutationObserver + 400ms 防抖），
  该节点显示的是**原生色**。**若原生是不透明白**，这段窗口内**壁纸/立绘就会被盖住**。
  **为什么本库必测**：v1.32.6 的"壁纸整层消失"就是因为**某个大容器变成不透明**；
  而本轮实测 `Dc7zOa_root`（聊天根，`304x671`）**原生就是 `rgb(255,255,255)`**
  ⇒ **它一旦在某一轮被写成不透明白，就等价于把壁纸通道关掉一瞬**。
  **这是"注入类改动"的通用一类风险**（此前用例只测"注入后的稳态"，**没测"注入之间的缝隙"**）。
- **前置**: 任意注入版本装机；`adb root` + `whoami`==root；真 GPU；页面前往**含重渲染**的聊天（滚动/流式渲染会触发）。
- **步骤**:
  1. **高频轮询**目标层（建议 100–200ms）读 `getComputedStyle().backgroundColor` + **`el.style.backgroundColor`（内联）** + 尺寸。
  2. **扰动**：周期性改变滚动位置（`scrollTop`）以**逼出 React 重渲染**。
  3. **判定"未注入/被抹掉"状态**：**内联为空 `''` 且 computed `alpha==1`**（显示原生色）。
     —— 注意与"注入写的白"区分：**内联带值 `rgb(255,255,255)` 也危险**（见下"两种白"）。
  4. **命中即截图**（`screencap` + `pull`，**>100KB**）+ **`read_image` 亲看**：**壁纸/立绘是否被盖**。
  5. **收尾复测**：等 4s+（过 `apply()` 末次）再读 ⇒ **应回到 `transparent`**（证明可自愈）。
  6. 记录**命中次数**与**窗口时长**（连续命中次数 × 轮询间隔）。
- **预期**: 任何时刻目标层都不应出现"不透明白"；若出现，**必须可自愈**且**记为 finding**。
- **判负**:
  - 出现**持久**不透明白（settle 后仍是 `alpha=1`）= **P1**（等同 v1.32.6 回归）；
  - 出现**瞬时**不透明白（settle 后自愈）= **P2**（用户可见、可自愈、非持久）；
  - **内联带值 `rgb(255,255,255)`**（注入自己写的白）比"内联为空"更值得注意 ⇒ 一并记入 finding。
- **实际**: **v1.32.13 命中（P2）** —— `Dc7zOa_root` 存在 **≈2s 的原生白窗口**：
  - 时间线（500ms 轮询）：`t=2987/3498ms alpha=1 inline='rgb(255,255,255)'`（**注入写的白**，`touched=8` 尚未铺开）
    → **`t=4191ms alpha=0 inline='transparent'`**（`touched=32`，首次正确注入）
    → **`t=4712–6265ms alpha=1 inline=''`（内联被抹掉 ⇒ 原生白，≈2.0s）**
    → **`t=6773ms` 起 `alpha=0 inline='transparent'` 自愈**；
  - **settle 后连续 5 次读数恒为 `rgba(0,0,0,0)`** ⇒ **非持久、非 v1.32.6 回归**；
  - **高频抓捕复现 2 次**（同一会话内 `caught=2`，两次独立运行都命中）⇒ **不是偶发**；
  - **视觉实锤**：瞬时帧 `qa-C14-dcroot-nativewhite-1/2.png` 里**壁纸/立绘被盖住**；
    而 settle 帧 `qa-C14-settled-chat.png` 里**壁纸/立绘完整透出** —— 同会话同滚动位的两态对照。
- **结果**: **命中，记 P2 FINDING-1**（不触发 FAIL；`TESTER.md` §5：只有 P2/P3 ⇒ PASS-with-findings）
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-C14-dcroot-nativewhite-1.png`(341,694 B) / `-2.png`(341,562 B)（**瞬时实锤**）｜
  `qa-C14-settled-chat.png`(961,019 B)（settle 对照）｜
  `F:\work\work_dsh\tmp\settle-report.json`（时间线）｜`F:\work\work_dsh\tmp\transient-report.json`（抓捕统计）｜
  详见 `verify/QA-ROUND-v1.32.13.md` §7
- **🔧 复用要点（下轮照做）**：
  ①**测"注入类改动"必须测缝隙**：只测 settle 后稳态会**漏掉整类缺陷**（本轮就是这样抓到的）；
  ②**区分两种"白"**：内联为空（节点被替换）vs 内联带值（注入自己写的）——**处置方向不同**；
  ③命中后**必须同时给"瞬时帧 + settle 帧"两张图**，否则无法证明"可自愈"；
  ④把"扰动 N 次、统计命中次数与窗口时长"固定成常驻统计，便于跨版本回归对比。
- **去向**: 已登记为 P2；建议 lead 单开一轮修（方向：给**布局/滚动容器**排除在"取原生色相回写"路径之外，
  或改在 MutationObserver 回调内**同步**写回，或对该层改用**样式表 + 高特异性**而非内联）。
- **✅ 复验（v1.32.14，`task-15`，2026-10-15 03:1x）—— 已修，判 PASS**：
  - **修法**：`083de4f` —— `isAnchor` 追加 `cn.indexOf('Dc7zOa_root')>=0`
    （该闸门**同时**是「取原生色相回写」与 `isCB` 的入口 ⇒ 布局容器**永不**被写不透明底）。
  - **主判据**：同探针 `qa-dcroot-transient.mjs`（220 次轮询 120ms + 滚动扰动）**三轮独立运行
    `caught=0` / `nativeWhiteSamples=0` / `windows=[]`**；改前为 **2 次/轮**（**阳性对照**）。
  - **settle**：`SETTLED_REPEATS [0,0,0,0,0]`（连续 5 次 `rgba(0,0,0,0)`）；
    **且不再出现"注入写的白"**（v1.32.13 曾 `t=2987ms` 读到 `inline=rgb(255,255,255)` **带值**；
    v1.32.14 `t=3147ms` 读到 `inline=''` **空** ⇒ 原生态、非我们所写）。
  - **锚点**：`BynINW_frame`/`centerCol`/`Dc7zOa_root`/`overlayLayer` **全 `alpha=0`**；
    其中 **`frame` 与 `Dc7zOa_root` 原生同为 `rgb(255,255,255)`**（最能暴露"颜色判据误伤"的两个样本）
    **双双安全** ⇒ **排除未削弱修复**（`_tabHost` 与 大代码块仍各 `1.0`）。
  - `hashStable=true`（8 次独立夹逼读数全同值）｜详见 `verify/QA-ROUND-v1.32.14.md`
  - **🔧 本轮新增复用要点**：
    **⑤ 零命中必须有"阳性对照"才可信** —— 拿**同一探针在修复前版本**上跑一遍证明它**能命中**，
    否则"0 次"可能只是探针失灵（本条本轮已做：2 次/轮 → 0 次/轮）；
    **⑥ 排除布局容器后必须复跑 `wouldChange`**，确认**内容块仍在改动集内**（别把修复一起排除掉）。
