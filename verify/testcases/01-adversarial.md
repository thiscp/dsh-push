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
