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
- **实际**: 2026-10-14 02:35（v1.32.10/vc76）走**消息卡片直答变体**（与 v1.32.9 轮同法）：Lead 真提问 `call_0caa44201aea463cb081a47a`（release-note-v13210 文案二选一，timed=false）已落 App；列表滚动后卡片选项 pill 在屏内（dumpsys bounds 是布局坐标不含滚动偏移，用 200px 网格截图钉死屏幕坐标 (420,2200)）→ 真点 → **~4s** prefs `answered=「完整版：卡片「已读」现在会同时撤掉该条通知——与「全部已读」行为一致」`（码点 0x5B8C0x65740x7248 前缀核验）+ read=true；Lead 侧 web.log 指纹 `answered (foreground)`，答案即时回到 Lead 会话。备注沿用：timed=false → 无折回兜底（`note: no timed wait…`），claimForeground=on 手机作答即时有效。
- **结果**: PASS
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-c02-grid2.png`（点前定位）、`qa-c02-now.png`（卡片态）、`logcat-c02.txt`；Lead web.log `answered (foreground) call_0caa44201aea463cb081a47a`

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

### QA-C09 一键全部已读（状态卡「全部已读」pill，v1.32.9）
- **场景**: 用户攒了一堆未读（任务结束消息、提问回声），不想逐条点「已读」；状态卡片 statusText 下方有「全部已读」pill（仅未读>0 可见），点一下全部翻已读。
- **前置**: v1.32.9+ 装机；`verify\qa-markallread.ps1 -Mode core` 自动推 2 条 `qa-` 前缀 + epoch 唯一串的未读消息（生产 topic，最少条数）。
- **步骤**（断言四件套，脚本全自动）:
  1. `powershell -File verify\qa-markallread.ps1 -Mode core`
  2. **prefs**：tap 前 `run-as cat dshpush.xml` 数出未读 N（判定 `!optBoolean("read",true)`，与 refresh() 一致）；tap 后**全部条目 read=true、未读数=0**
  3. **通知**：`dumpsys notification --noredact` 里自己两条消息的 `key=0|xyz.cpyh.dshpush|<nid>|null|` 消失（nid==mid）；**常驻服务通知 `key=0|xyz.cpyh.dshpush|2|null|` 仍在**（channel dsh_svc）
  4. **toast**：与 tap **同一条远端命令链、中间隔 1 秒**的 `dumpsys notification` 出现 `Toast Queue:` → `TextToastRecord{... text=已全部标为已读（N 条）}`，N==tap 前未读数
  5. **视觉**：tap 前后各一张 `screencap`+pull（>100KB），`read_image` 整页判：「● N 条未读」行消失、**所有**卡片淡化（alpha 0.6 视觉）、pill 自己隐藏、壁纸/立绘不被破坏
- **预期**: 四件套全绿；未答提问的通知也被撤（见 QA-A24）；监督者代答的未读也被翻已读（见 QA-A22）；服务通知与 answered/__expired 徽章态不受影响。
- **实际**: 2026-10-13 20:59 `-Mode core`（tag qa-core1791925178，v1.32.9/vc75/emulator-5554）：tap 前未读 4（含 2 条 qa-core + 2 条历史）；pill 中心 (1136,1324) 352x192；tap 后 prefs 未读=0、两条 read=true；两条消息通知 nid 在 tap+1s 的 dump 与 ~10s 后的 late dump 里都已消失（服务通知 id=2 始终在）；toast `TextToastRecord text=已全部标为已读（4 条）` N==tap 前未读 4；A25 顺带过（进程存活 pid=13626、msgs JSON 完好）。首轮（19:08）曾 3 条 FAIL，根因是**脚本抢跑**：`input tap` 注入即返回，0 延迟 dumpsys 抢在 App 处理前——加 1s 间隔后全绿（硬事实已钉进本用例备注与 README）。
- **结果**: PASS（脚本断言 13/13 + 肉眼整页判前后两张均过）
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-core-before.png` / `qa-core-after.png`（1.1-1.25MB，肉眼判：「● N 条未读」行消失、pill 隐藏、全部卡片淡化、立绘完好，after 里 toast「已全部标为已读（4 条）」入镜）；`acttop-qa-core1791925178-before/after.txt`（pill 可见→消失的结构证据）；`notif-qa-core1791925178-qa-core-after.txt` / `-late.txt`（nid 撤销双时点）；`prefs-qa-core1791925178-*.xml`

> **QA-C09 取证硬事实（2026-10 实测钉死，写脚本前必读；与 README「adb 与 APP 数据」同源）**：
> 1. **MainActivity 上 `uiautomator dump` 必失败**（常驻呼吸/星闪动画挡住 idle，实测 11.4s 超时；`window_animator_scale=0` 也救不回来）→ 按钮坐标一律从 **`adb shell dumpsys activity top`** 视图层级解析：状态卡 = 消息列表 ScrollView 之前最后一个可见（flags 首字符 `V`）的 LinearLayout 兄弟，pill = 卡内第一个可见 clickable（flags 含 `C`）Button，bounds 是**相对父级**的要沿祖先累加成屏幕坐标。
> 2. **toast 文案通道** = `dumpsys notification` 的 `Toast Queue:` / `TextToastRecord{... text=...}`，**只在 toast 存活期（~2s）可见** → 和 `input tap` 串同一条远端命令链、**中间隔 1 秒**（`input tap & ping -n 2 127.0.0.1 >nul & dumpsys notification --noredact`）：`input tap` 注入即返回，App 处理点击→cancel→toast 入队要 0.3~0.8s，0 延迟抢跑会「通知没撤 + toast 没弹」全假 FAIL（v1.32.9 首轮实测）。
> 3. **prefs/dumpsys 走 ssh stdout 捕获**（job 里先 `[Console]::OutputEncoding=UTF8` 再解码，否则中文乱码假失败）；**远端命令里不放设备侧 `>`/`|`**——PS 5.1 递给 ssh 的内嵌引号会丢，远端 cmd 会抢走 `>`。PNG 才走 screencap 落盘+pull+scp。
> 4. 设备 serial 以 `adb devices` 为准（现网 `emulator-5554`；`qa-readstate.ps1` 里写死的 5556 已过时）。
> 5. 消息通知 id = `mid` = `(title+body+ts).hashCode()`；服务通知固定 id=2。
> 6. **推送前必须先拉起 App**（`am start MainActivity`）：force-stop 后 WS 断开，ntfy 发了也没人听（developer 自测收尾常 force-stop，直接推会 40s 假「never arrived」）。

### QA-C10 逐条「已读」按钮（v1.18.0 路径；v1.32.10 起语义=标已读+撤该条通知）
- **场景**: 逐条「已读」按钮（`PushService.markRead`）。v1.32.9 时它只翻 read 不撤通知（QA-ROUND-v1.32.9 FINDING-4 登记的语义不对称）；**用户真机反馈确认逐条也要撤**，v1.32.10 转正为需求：卡片「已读」= 标已读 + 撤该条通知，与「全部已读」一致。回归角度保留：只动自己——别人的未读/通知纹丝不动、不弹「已全部标为已读」toast。
- **前置**: `verify\qa-markallread.ps1 -Mode single`（推 1 条未读，环境里已有其它未读条目时最有说服力——现网夜间监督条目天然提供）。
- **步骤**（脚本全自动）:
  1. tap 前 `dumpsys notification` 快照 + 记下其它未读条目及其 nid
  2. `dumpsys activity top` 取第一卡片（=最新=自己）的「已读」按钮坐标，`input tap`
  3. prefs：未读数只减 1、自己 read=true、其它未读条目仍 read=false
  4. 通知：**自己的 nid 必须已撤**（tap+1s 的 dump 与 ~10s 后 late dump 都无）；其它 nid 状态不变；服务通知仍在
  5. toast：无「已全部标为已读」toast（toastN=-1）；pill 与其它未读行仍可见
- **预期**（v1.32.10）: 只动自己：自己 read=true **且自己通知被撤**；他人未读/通知不变；无 toast。逐条不撤通知=需求未落地（P1）；撤了别人的通知或弹了 toast=越权（P1）。
- **实际**:
  - 2026-10-13 20:59 `-Mode single`（tag qa-single1791925128，**v1.32.9 旧语义**）：tap 后未读 3→2、自己 read=true；自己 nid=1805901831 通知状态**不变**（当时设计如此）；其它两条未读 nid 不变；无 toast；pill 仍可见。首轮曾 1 条 FAIL＝我预期写错（误按新语义要求撤通知），对照源码改回「状态不变」后 PASS。
  - v1.32.10 复跑：2026-10-14 01:55 `-Mode single`（tag qa-single1791942890）：tap 前未读 12（自己 + 2 条 qa-fill 补位 + 夜间监督/developer qa-rm 等 9 条现网条目）；按钮 (304,1956) 352x192；tap 后未读 12→11、自己 read=true、**自己 nid=-297425687 在 tap+1s 与 late dump 双时点都已撤**（新语义落地）；其余 11 条未读条目仍 read=false、各自 nid 状态逐条对照不变；无 mark-all toast；pill+「● 11 条未读」仍可见。肉眼判 after：自己卡淡化无钮、他人未读卡保持蓝点+「已读」钮、状态卡「已连接 (v1.32.10)」。
- **结果**: PASS（v1.32.9 旧语义 + v1.32.10 新语义两轮均 PASS）
- **证据**: `F:\work\work_dsh\tmp\shots\qa\qa-single-before.png` / `qa-single-after.png`（肉眼判：自己卡片淡化且「已读」钮消失、其它未读卡保持蓝点+「已读」钮、pill 与未读行仍在、无 toast）；`notif-qa-single1791925128-pre.txt` / `-qa-single-after.txt`；`acttop-qa-single1791925128-before.txt`

