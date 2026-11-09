# QA-ROUND v1.32.10 报告（改动验证轮 · 逐条「已读」统一为标已读+撤该条通知）

```
QA-ROUND v1.32.10 结论: PASS（无 P0/P1，不打回）
用例: 本轮跑 15 项：语义变更验收 4（QA-C10 翻转断言 + 新对抗 QA-A26/A27/A28）+
      一键全部已读全套防牵连 7（QA-C09 四件套、QA-A20~A25 在 v1.32.10 上重跑）+
      定向回归 2（qa-readstate 两分支）+ 主流程 2（QA-C01 推送-作答主链、QA-C02 Lead 真提问卡片直答）。
      通过 15 / 首轮阻塞 1（QA-A27 测试侧助手缺陷，复跑 PASS）/ 失败 0。
被测: v1.32.10 / versionCode=76（developer commit 4217d70）；装机 emulator-5554
      lastUpdateTime=2026-10-14 01:11:05，App 状态卡每张截图显示「已连接 (v1.32.10)」
环境: emulator-5554 / 1440x3168@640（CSS360/dpr4，与真机同构）/ adb root / API 36 /
      2026-10-14 01:54–02:40 设备时钟（中途模拟器崩溃一次，Lead 自愈阶梯拉起，见 FINDING-2）
证据: F:\work\work_dsh\tmp\shots\qa\（本轮新增 ~30 张图 + acttop/notif/win/prefs/logcat 取证文本，
      关键图逐张 read_image 看过）；F:\work\work_dsh\tmp\shots\v1329-qa\c01-*.png（C01 链）
      回归 JSON：qa-report-2026-10-14T01-5x-*.json（single/mix/readans/dblcancel/core/newmsg/
      answered/doubletap/inapp 各轮）；主流程 JSON：task17b-c01c06-report.json
```

**结论怎么来的**：v1.32.10 的语义变更（`PushService.markRead` 翻 read 的同时 `nm.cancel` 自己 mid 对应的通知）在三个入口全部落地且互不干扰——卡片「已读」（C10）、已答未读卡「已读」对已消失通知静默（A26）、通知「已读」+「打开 DSH」双撤幂等（A27）；逐条撤两条后一键已读 toast **N 只数剩余**（A28）；一键全部已读全套（C09 + A20~A25）在新代码上重跑**没有一条相对 v1.32.9 基线变坏**；作答即已读两分支（qa-readstate）与推送-作答主链（C01/C02）全绿。没有 P0/P1 → 不判 FAIL。

---

## 1. 被测物身份

| 证据 | 值 | 来源 |
|---|---|---|
| 版本 | `versionName=1.32.10`（dumpsys package + 状态卡文案「已连接 (v1.32.10)」双处一致） | 每轮 VERSION 行 + 每张 App 截图 |
| 装机时间 | `lastUpdateTime=2026-10-14 01:11:05`（developer commit 4217d70 的包） | `dumpsys package` |
| 行为指纹 ① | 逐条「已读」tap 后该条 nid 从 `dumpsys notification` 消失（v1.32.9 不消失） | `notif-qa-single1791942890-pre/-after.txt` |
| 行为指纹 ② | 通知动作按钮「已读」点击 = read 翻 true + 通知撤（AnswerReceiver act=read 路径） | `qa-dblcancel1791943091` 全套 |
| 行为指纹 ③ | 一键已读 toast N 只数剩余（逐条撤过的不计入） | `notif-qa-mix1791942927-qa-mix-pill.txt` |

## 2. 本轮口径（Lead 派单原文映射）

Lead：「跑 v1.32.10 改动验证轮（markRead 语义变更 + 一键已读防牵连回归）：QA-C10（翻转后断言）+ 新对抗项 + 一键全部已读全套（C09/A20~A25，防 markRead 改动牵连）+ qa-readstate 两分支 + 逐条/一键混跑…核心 8 项里至少复跑 C01/C02 推送-作答主链。报告 verify/QA-ROUND-v1.32.10.md，P0/P1=FAIL 打回。测完复位。」

- 语义翻转的断言与三个新对抗角度在 task-6 已写进 `verify\qa-markallread.ps1`（single 翻转 + readans/dblcancel/mix 三模式）与用例文档（QA-C10 重写、QA-A26~A28 新增），本轮执行。
- 规格侧：openspec delta（task-5）Lead 已验 8/8 场景逐字保留 + 新场景，vm1 `--strict` PASS。
- developer 手递两个坑全程遵守：① force-stop 会撤光消息通知 → 所有 BEFORE 断言前只用 `am start`；② 断言按 mid↔NotificationRecord nid（标题 vis=PRIVATE 被 redact）。
- 红线遵守：没跑 `-Deploy`、没改 App 代码/`config.local.ps1`、没切 GPU、崩溃后没自行冷启动（上报 Lead 拉起）、推送全部 qa- 前缀生产 topic 最少条数。

## 3. FINDING 列表

### FINDING-1 [P3→已修] QA-A27 首轮 2 条 FAIL：测试侧助手抢跑（非产品缺陷）
- 现象：通知「已读」按钮点不到 → 「read 翻 true」「通知被撤」两条断言 FAIL。
- 根因：我的 `Tap-NotifReadAction` 先 `collapse-notifications` 再 `input tap` → 坐标落进通知栏背后的 App。
- 修法：**tap 必须在 shade 展开态做**，点完再 collapse。复跑（tag qa-dblcancel1791943091）走真 uiautomator 路径一次 PASS。
- 顺带钉死：通知栏（SystemUI）是 uiautomator 能过的例外（MainActivity 必挂），动作按钮按 text 从 shade dump 找（已进 README）。

### FINDING-2 [info] 模拟器在 C01 补测的 CDP 浏览器步崩溃（外部事件，不挡结论）
- 指纹：CDP `Input.dispatchMouseEvent` 超时（首个症状）→ 随后 `adb devices` 空、笔电 emulator.exe/qemu 全无、笔电本身没重启。
- 崩前 C01 全部所需证据已落盘（App 侧 prefs/焦点/列表截图 + 浏览器 DOM 数据 shellReadyMs=3230/patchCount=1/veil=true + 截图）；崩掉的是本轮范围外的 C06 附加步。
- 处置：按纪律不冷启动，上报 Lead；Lead 自愈阶梯拉起并验 boot_completed=1。

### FINDING-3 [info] 模拟器重启后 adbd 掉回非 root → cleanup 写回静默失败（已进 README）
- 指纹：cleanup 报「dropped 19」但再读仍 19 条；`adb root` 恢复（`restarting adbd as root` + `whoami`=root）后复跑 PASS。
- 教训：跑 cleanup 前先确认 root。

### FINDING-4 [info] `dumpsys activity top` 的 bounds 是布局坐标、不含 ScrollView 滚动偏移（已进 README）
- C02 卡片滚动后选项 pill 布局 y=13102、实际屏 y=2200——直接点布局坐标连点 5 次全空。
- 可靠姿势：给截图画 200px 网格线（System.Drawing 一行循环）肉眼读真屏幕坐标再点；uiautomator 在 MainActivity 依旧必挂（idle 顽疾）。

### FINDING-5 [info] FINDING-4(v1.32.9) 的语义不对称已按需求翻正并验证
- v1.32.9 登记「逐条已读不撤通知 vs 一键撤」→ 用户真机反馈拍板统一 → v1.32.10 落地：C10 双时点撤净、A26/A27 幂等静默，全部 PASS。

## 4. 语义变更验收（QA-C10 翻转 + QA-A26~A28）

| 用例 | 结果 | 关键实测 | 证据（全部肉眼 read_image 判过） |
|---|---|---|---|
| **QA-C10 逐条「已读」= 标已读+撤自己通知** | PASS | tag qa-single1791942890：未读 12→11、自己 read=true、**自己 nid=-297425687 在 tap+1s 与 late dump 双时点都已撤**；其余 11 条未读仍 read=false、各自 nid 状态逐条不变；无 mark-all toast；pill+「● 11 条未读」仍可见。肉眼：自己卡淡化无钮、他人未读卡保持蓝点+「已读」钮 | `qa-single-before/after.png`、`notif-qa-single1791942890-pre/-after.txt`、`acttop-qa-single1791942890-before.txt`（按钮 (304,1956) 352x192） |
| **QA-A26 已答未读卡「已读」对已消失通知静默** | PASS | tag qa-readans1791942967：tap 前 nid=-1747431689 已被回声撤（前提先证）；「已读」(1082,2078) 真点 → read=true、nid 仍不在、无 toast、服务通知仍在、pid=23113 存活、msgs JSON 完好。肉眼：卡片淡化、「已答：【监督者自动唤醒】」徽章保留 | `qa-readans-after.png`、`notif-qa-readans1791942967-pre/-qa-readans-after.txt` |
| **QA-A27 通知「已读」+「打开 DSH」双撤幂等** | PASS（复跑） | tag qa-dblcancel1791943091：shade uiautomator 找到「已读」(676,1445) 展开态真点 → read=true + nid=1072493780 撤；卡片「打开 DSH」→ `mCurrentFocus=…WebActivity`（二次 cancel 内部跑）→ nid 仍不在、pid 存活、read 保持 true、JSON 完好。肉眼：WebActivity 起页 ntfy.cpyh.xyz:443、立绘透出 | `qa-dblcancel-web.png`、`notif-qa-dblcancel1791943091-pre/-act1/-act2.txt`、`win-qa-dblcancel1791943091-web.txt` |
| **QA-A28 逐条撤两条后一键 N 只数剩余** | PASS | tag qa-mix1791942927：三条 nid 全在场；逐条点掉两张「已读」→ 未读 14→13→12、各自 nid 撤、两次无 toast；点 pill → toast **N=12 == 剩余未读**（不是 14）、剩余 nid 撤、未读=0；pid 存活（3 cancel + 2 双撤无异常） | `qa-mix-card1/card2/pill/after.png`、`acttop-qa-mix1791942927-card1/card2/pill.txt`、`notif-qa-mix1791942927-*.txt` |

## 5. 一键全套防牵连重跑 + 定向回归 + 主流程

| 用例 | 结果 | 说明 |
|---|---|---|
| QA-C09 一键四件套（v1.32.10 重跑） | PASS | tag qa-core1791943133：未读→0、nid 双时点撤净、服务通知 id=2 仍在、toast N=2 精确、pill 消失。肉眼：toast「已全部标为已读（2 条）」入镜 | `qa-core-before/after.png` |
| QA-A20 一键后新推仍未读 | PASS | tag qa-newmsg1791943162：late 条目蓝点+「已读」钮、未读=1、pill 重现、旧卡保持淡化 | `qa-newmsg-late.png` |
| QA-A21/A22 徽章逐字节不动 + 监督者代答被翻 | PASS | tag qa-answered1791943195：「【监督者自动唤醒】 qa proxy」前后 `-eq` 全等；read=false→true、toast N 计入 | `qa-answered-after.png` |
| QA-A23 连点两次幂等 | PASS | tag qa-doubletap1791943229：第二下无 N=0 toast、prefs 仍全读、进程存活 | `qa-doubletap-after.png` |
| QA-A24 撤通知后卡片内仍可作答 | PASS | tag qa-inapp1791943262：optA 真点 → `answered=__expired` + 「这个问题已经过期了」toast 入镜（markRead 改动没牵连作答通道） | `qa-inapp-opttap.png` |
| QA-A25 cancel 不存在 nid 静默 | PASS | 每轮天然命中（未读条目数>通知数）；九轮进程存活、msgs JSON 完好 | 各轮断言行 + prefs |
| qa-readstate 两分支 | PASS | A 普通作答→read=true（我自己打的字）；B 监督者代答→read=false 保持（qa28B 三态同框） | `qa-readstate-*.png` |
| QA-C01 推送落库→列表→内置浏览器 | PASS | tag qa-C01-1791943339：推送 ~2s 落库 read=false、ENTRY_COUNT 1、MainActivity 焦点；浏览器 shellReadyMs=3230、patchCount=1、大容器透明+veil（崩前完成，见 FINDING-2） | `c01-msglist.png`（蓝点+「已读」钮）、`c01-browser.png` |
| QA-C02 提问卡作答→会话继续 | PASS | Lead 真提问 `call_0caa44201aea463cb081a47a`（release-note-v13210 二选一，timed=false）：网格定位 pill (420,2200) 真点 → **~4s** prefs `answered=「完整版：卡片「已读」现在会同时撤掉该条通知——与「全部已读」行为一致」`（码点 0x5B8C0x65740x7248 前缀核验）+ read=true；Lead web.log `answered (foreground)`，答案即时回会话。**该答案即 task-8 的 -DeployNote 文案** | `qa-c02-grid2.png`、`qa-c02-now.png`、`logcat-c02.txt` + Lead web.log |
| QA-C06 会话切换 | 未跑 | 本轮范围外（Lead 未点名）；CDP 附加步恰逢模拟器崩溃 | — |

## 6. 没验到的部分（如实）

1. **真机 OriginOS**：全部模拟器（用户真机反馈是本轮需求的来源，但验证在模拟器）。
2. **QA-C03 通知栏直答 / QA-C04 点通知起浮窗**：未跑（A27 已覆盖通知「已读」动作，直答选项路径未动）。
3. **30 条 msgs 满载边界**：一键已读在满载 + 大量已答条目下耗时未量（本轮最多 14 未读）。
4. **桌面 ≥1024px 宽屏**：全程 360 CSS px 窄屏（沿用基线口径）。
5. **QA-C06**：本轮未跑（见上表）。

## 7. 收尾复位（已实测证明）

`font_scale=1.0` / `airplane_mode_on=0` / `Night mode: no` / App force-stop（pidof 空）。prefs 清理三轮全 PASS：`qa-*` 删 19、`*qa28*` 删 2、`*qa-rm*` 删 4（developer 遗留），**保留 5 条真实条目**（3×「DSH 任务结束」、1×「⚠ 会话在跑长工具」、1× Lead 已答提问「DSH 等你选择 [e482b3a1]」）。首轮 cleanup 静默失败 = FINDING-3（adbd 掉 root），`adb root` 后复跑通过。

**到用户真机的推送清单（本轮，全部 qa- 前缀或 QA 会话产生）**：fill 2、single 1、mix 3、readans 1+回声、dblcancel 2（首轮+复跑）、core 2、newmsg 3、answered 1+回声、doubletap 2、inapp 1、readstate 2 提问+1 回声、C01 1——共 ~22 条，prefs 已全部清掉（真机侧通知已撤/已点掉，列表无残留）。

## 8. 给 Lead 的建议

1. **可以发**：markRead 语义统一（C10 + A26~A28）与一键全套防牵连回归无保留意见；FINDING-1 是 QA 侧缺陷已修，FINDING-2/3/4 是环境/取证事实，都不挡 `-Deploy`。
2. **task-8 的 -DeployNote 现成**：C02 答案「完整版：卡片「已读」现在会同时撤掉该条通知——与「全部已读」行为一致」（Lead 拍板的完整版文案，已回会话）。
3. QA 资产更新：`verify\qa-markallread.ps1` 现 10 模式（新增 readans/dblcancel/mix，single 断言已翻转）；README 新增 3 条硬事实（shade uiautomator 例外、force-stop 撤通知、adbd 掉 root、布局坐标网格定位法）。
