# 主流程用例（core flows）

本文件覆盖 DSH 手机伴侣 App（`xyz.cpyh.dshpush`）**用户每天真正会走的主路径**：推送到达 → 点开 → 提问卡作答 → 回会话确认，以及通知栏直答、快答浮窗、侧栏、会话切换、主题、断线重连。

- 一轮里把本文件的用例全过一遍 = Lead 说的"全方位体验"。
- 每条用例的 `实际 / 结果 / 证据` 由 **QA 执行时填写**（本轮没跑的保持"（待填）"，不要凭印象补）。
- 执行纪律见 `verify/TESTER.md`：渲染结论必须 `adb shell screencap` + `adb pull` + 自己看图（`read_image`），且截图同一时刻用 CDP 复核 DOM；截图 >100KB。
- 会到达用户真手机的用例（C01/C02/C03/C04）**每轮少跑几条**，正文带 `qa-<用例id>` 前缀；纯测试推送只用 topic `dsh-verify`。

---

### QA-C01 推送到达 → 消息列表 → 点开进内置浏览器
- **场景**: 用户在电脑前离开，桌面 DSH 需要他拍板；他先看到手机通知，点开进入 App 内置浏览器看内容。
- **前置**: App 已装且 token 就绪；模拟器在线；一条能被识别的测试推送（正文含唯一 epoch，topic 用 `dsh-verify`）。
- **步骤**:
  1. 发测试推送：`curl -X POST <ntfy>/dsh-verify -H "Authorization: Bearer <write>" -H "Title: qa-C01" -d "qa-C01 <epoch>"`
  2. `adb shell cat /data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml` 里能按该 epoch 找到条目，且 `read=false`
  3. 打开 App 主界面（消息列表）→ `adb shell screencap -p /sdcard/qa-C01-list.png`
  4. 点该条消息 → 等内置浏览器加载完（dom 里出现 `[class*='BynINW_frame']`）
  5. `adb shell screencap -p /sdcard/qa-C01-browser.png`
- **预期**: 列表出现该条且未读标记正确；点开后内置浏览器加载出真实会话页面（不是错误页/白屏），首屏内容与推送语义一致。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-C02 提问卡作答（内置浏览器内点选项）→ 回会话确认
- **场景**: 用户在手机内置浏览器里看到提问卡，点一个选项，桌面 DSH 继续干活。
- **前置**: 桌面侧发出一个真实 `ask_user_question`（选项 2~4 个）；模拟器已打开对应会话页面。
- **步骤**:
  1. 等卡片出现（CDP 查 `[class*='mAtvLq_header']`），`screencap` 记一张 `qa-C02-card.png`
  2. 记下卡片 DOM 数字：卡宽/标题宽/标题行数/选项按钮宽
  3. CDP `Input.dispatchMouseEvent` 点第一个选项（页面视口坐标）
  4. 等 2~4 秒，`screencap` → `qa-C02-answered.png`（成功姿态/动画）
  5. 回会话页确认该轮已继续（对话里出现"已作答/继续工作"类痕迹）
- **预期**: 卡片文字横排、标题不被压成竖排；点选项有明确反馈（成功姿态），随后会话继续；选项**只生效一次**，不重复作答。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-C03 通知栏直答
- **场景**: 用户正在用别的 App，直接从通知栏作答，不点进 App。
- **前置**: 待答提问卡存在；通知已出现在通知栏（展开态）。
- **步骤**:
  1. `adb shell cmd statusbar expand-notifications`
  2. `screencap` → `qa-C03-shade.png`
  3. 点通知上的选项按钮（或触发同样的 broadcast，见 `verify/qa-paths.ps1 -Mode notif`）
  4. `screencap` → `qa-C03-answered.png`
- **预期**: 通知栏直答与卡片作答**互斥且一致**：作答后卡片/通知都进入已完成态，不会出现"通知已答、卡片还在等"。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-C04 快答浮窗
- **场景**: 用户点通知后弹出快答浮窗，直接点选项。
- **前置**: 待答提问卡存在；`settings put system ...` 无需；用 `verify/qa-test.ps1` 的路径起浮窗。
- **步骤**:
  1. 起浮窗（`verify/qa-test.ps1` 或通知点击）
  2. `screencap` → `qa-C04-quick.png`
  3. 点第一个选项
  4. `screencap` → `qa-C04-answered.png`
- **预期**: 浮窗选项可点、命中区足够；作答后浮窗自行关闭且不再弹出；成功姿态正常。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-C05 侧栏展开（浮层）→ 点外面收起
- **场景**: 用户在窄屏上展开左侧会话栏找另一个会话。
- **前置**: 内置浏览器已加载会话页；侧栏处于收起态。
- **步骤**:
  1. CDP 点「Open sidebar」（rail 上的按钮）→ 等 2 秒
  2. `screencap` → `qa-C05-expanded.png`；同时 CDP 复核：`position:fixed`、`width:280px`、`visibleWidthPx=280`、背景 alpha≈0.92
  3. CDP 点浮层右侧的内容区（x>280）
  4. `screencap` → `qa-C05-collapsed.png`；复核 `collapsed=true`、宽 55.6
- **预期**: 展开是完整 280px 浮层、会话标题完整不被裁、背后文字不串上来；点浮层之外收起回 56px 图标轨道且无被裁碎片。
- **实际**: 展开：`position=fixed`、`width=280`、`visibleW=280`、`bg=rgba(249,250,251,0.92)`、`shadow=rgba(0,0,0,.35) 0 8px 32px`、`patchCount=1`；点浮层之外 `collapsed=true`。截图：面板 280px 完整、条目与标题无被裁。
- **结果**: PASS（附 P2：0.92 下背后正文仍有可见水印，见 QA-P03）
- **证据**: tmp\shots\qa\qa-C05-expanded.png、qa-C05-collapsed.png

### QA-C06 会话切换
- **场景**: 用户在侧栏里切到另一个会话再切回来。
- **前置**: 侧栏里至少有 3 个会话（含两个不同标题）。
- **步骤**:
  1. 展开侧栏 → 点第 2 个会话 → 等加载 → `screencap` `qa-C06-s1.png`
  2. 再展开 → 点第 1 个会话 → `screencap` `qa-C06-s2.png`
  3. 复核 URL/标题与会话内容对应
- **预期**: 每次切换标题与内容都对得上；切换后侧栏回到收起态或保持可用；没有串会话/串标题。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-C07 深浅主题各跑一遍（壁纸可见 + 可读性）
- **前置**: 内置浏览器已打开。
- **步骤**:
  1. `adb shell cmd uimode night no` → 展开侧栏 → `screencap` `qa-C07-light.png`
  2. `adb shell cmd uimode night yes` → 展开侧栏 → `screencap` `qa-C07-dark.png`
  3. 每张图同时 CDP 复核：大容器（frame/centerCol/chat wrapper）背景必须是 `rgba(0, 0, 0, 0)`，侧栏展开态 alpha≈0.92、收起态≈0.45
- **预期**: 两个主题下**壁纸/立绘都能透出来**（大容器不能叠出不透明白底）；正文文字对比度可读；展开面板底足够实、背后文字不串上来。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）

### QA-C08 断线重连
- **场景**: 用户地铁里断网，出站恢复。
- **前置**: 内置浏览器已打开一个会话。
- **步骤**:
  1. 断网：`adb shell cmd connectivity airplane-mode enable` → 等 10 秒 → `screencap` `qa-C08-offline.png`
  2. 恢复：`adb shell cmd connectivity airplane-mode disable` → 等 15 秒 → `screencap` `qa-C08-back.png`
  3. 复核页面是否仍是"可用的会话页"（`[class*='BynINW_frame']` 在不在）
- **预期**: 断网时给**明确可理解的提示**（错误页/重连中），而不是白屏或静默卡死；恢复后能自己回到可用状态（不需要用户手动清数据）。
- **实际**: （待填）
- **结果**: （待填）
- **证据**: （待填）
