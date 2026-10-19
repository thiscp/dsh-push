# QA-ROUND v1.32.6 报告（对抗性冒烟 · 首轮）

```
QA-ROUND v1.32.6 结论: PASS-with-findings
用例: 跑 10 条（PASS 4 / PASS-with-findings 4 / BLOCKED 2），未覆盖 6 类（需真机或生产推送）
环境: emulator-5554 / versionName=1.32.6 / versionCode 72 / 真 GPU / 2026-10-13 14:33-14:39 (+ 补充轮)
证据: F:\work\work_dsh\tmp\shots\qa\（14 张图，全部 >100KB）
```

无 **P0 / P1**：核心流程（推送→点开→会话→侧栏展开/点外收起）在这轮**没有**被打坏。

---

## 通过（无 finding）

| 用例 | 结果 | 关键数字 |
|---|---|---|
| QA-C05 侧栏展开 → 点浮层外收起 | PASS | 展开 `position:fixed, width=280, visibleW=280, bg=rgba(249,250,251,0.92), shadow=.35/8px/32px`；收起 `collapsed=true`；`patchCount=1` |
| QA-A01 连点展开/收起 10 次 | PASS | 10 次状态逐次跟随、末态与最后一次点击一致；再点一次仍正常；无重复浮层 |
| QA-A02 加载中（4.2s）点侧栏 | PASS | 抢跑后仍 `collapsed=false`、**`patchCount=1`**（无重复注入）、最终自洽 |
| QA-A11 连按两次返回 | PASS | 落到桌面、无白屏、无空白 WebActivity（备注见下） |

---

## FINDING-1 [P2] 大字体下侧栏标题与时间戳相贴、末行被页脚压住（QA-A06）

- **复现**: `adb shell settings put system font_scale 1.5` → 重载内置浏览器 → 展开侧栏。
- **预期**: 大字体下条目与时间戳各自成列、不重叠，最后一行完整可见。
- **实际**: 标题被截断后与时间戳**贴在一起**（截图中 `Tailscale双dsh互督…3h`、`笔记本GPU占用波…23h`，`…` 与时间戳之间没有留白）；面板底部最后一行 `Untitled` 被 **Settings 页脚压住**（只露出上半行）。同时因为字号变大，背后聊天文字与水印在同一视觉高度并列，形成"两层文字打架"的观感。
- **证据**: `tmp\shots\qa\qa-A06-font13.png`、`qa-A06-font15.png`
- **影响面**: 系统字体调到 1.3~1.5 的用户（老年用户、视力不佳者）在侧栏找会话时会看错行；低频但体验差。
- **归因**: 标题截断 + 时间戳布局是 **DSH Web 上游**自身的 sidebar 布局，放大后没给时间戳预留空间；我们的窄屏补丁可以针对条目加 `padding-right` / 让标题 `min-width:0` 并让时间戳 `flex-shrink:0` 缓解。
- **建议**: 归到"窄屏补丁顺手治上游"的清单里；如果你要，我可以补一版"1.5 字体下的 DOM 数字（标题/clientWidth/时间戳 left）"作为修完的对照基线。

## FINDING-2 [P2] 飞行模式下没有任何离线提示（QA-A08）

- **复现**: 内置浏览器已加载 → `adb shell cmd connectivity airplane-mode enable` → 等 6 秒。
- **预期**: 至少有一个可理解的"离线/重连中"标识。
- **实际**: 页面**完全保持原样**（旧内容 + 可点的输入框），截图与在线态几乎无法区分；用户会以为还连着，可能发出注定失败的消息。恢复网络后页面能继续用（`shellBack=true`、`patchCount=1`）。
- **证据**: `tmp\shots\qa\qa-A08-offline.png`、`qa-A08-back.png`
- **影响面**: 地铁/电梯/飞机上常见。
- **归因**: 伴侣 App 侧（WebActivity 已有错误页，但只在**加载失败**时出现；已加载页面没有网络状态指示）。
- **建议**: WebView 顶部加一条 `离线 / 重连中` 细条（App 侧注入即可），或在页面右上角放个小状态点。

## FINDING-3 [P2] 图标按钮命中区偏小（QA-P04）

- **实测（DOM 矩形，25 个可点元素中 7 个 <40px 高）**:
  `Collapse sidebar` 28×28、`Search sessions` 28×28、`View options` 28×28、`Add workspace` 28×28、`Agent team` 28×28、`Open in File Explorer` 23×23、`More ways to open` 17×23；会话条目行高 28。
- **预期**: 主要图标按钮命中区 ≥40×40（移动端惯例 44~48）。
- **实际**: 28×28，边缘点击容易落空/误触相邻按钮（同一行三个图标间距也很紧）。
- **证据**: 无截图（DOM-only 用例）；数字见 `qa-report.json` 的 `QA-P04.actual.dom`
- **影响面**: 所有人，手指粗/戴手套/走路时更明显。
- **归因**: 大部分是 **DSH Web 上游**的按钮；伴侣 App 侧可在窄屏补丁里给这些按钮加 padding（视觉不变、命中区变大）。

---

## BLOCKED / 未覆盖（如实记录，不硬凑）

- **QA-A07 深色（系统 uimode）→ 界定错误**: `cmd uimode night yes` 后 App 与 WebView **都不跟随**（截图与浅色态一致）—— 主题来自 App 自己的设置。已沉淀为 **新用例 QA-A13（App 内切主题）**，下轮测。
- **QA-A12 面板滚轮穿透 → BLOCKED**: 面板根 `scrollHeight==clientHeight==777`（根本身不滚），滚轮 5 次后"面板之外"有 1 个元素 `scrollTop>0` → **疑似滚轮穿透把背后内容滚了**。有界 200s 的复测探针无返回，按纪律放弃、下轮补带 before/after 对照的版本。
- **QA-A11 备注**: 连按两次返回落到桌面是"可预期"行为，但**第一次返回**的具体作用没能从证据确认（首轮报告被第二轮覆盖，DOM 证据丢失）。下轮补"只按一次返回"的截图。
- **未覆盖（需真机或生产推送）**: QA-C01/C02/C03/C04（推送到达、提问卡作答、通知栏直答、快答浮窗）、QA-A03（作答瞬间退出）、QA-A04（超长/emoji 问题文本）、QA-A05（倒计时抢答）—— 这些要真机 e2e 或发真实 `ask_user_question`，本轮按纪律没动用户手机。
- **未覆盖（需要新探针）**: QA-C08/A08 的**推送通道**侧表现（PushService WebSocket 在飞行模式下的状态显示）需要在主界面（消息列表）截图，本轮只测了内置浏览器。
- **QA-P01/P02/P05/P06/P07/P08/P09/P10 本轮未跑**（体验组留给"全方位体验"轮）。

---

## 环境侧备注（不记成 App bug）

- 首轮 10 条用例里 QA-A02/A06 首跑 BLOCKED（`pidof` 空、`Runtime.evaluate` 超时），修驱动后复跑通过；原因是**驱动**在页面重载/应用重启后没有重连，不是 App 的问题。
- 一次远端探针挂住 10 分钟：`ssh` 不返回、且有界化前无法判断进度 —— 已写进 `verify/TESTER.md` 的轮次纪律（远端动作一律 `Wait-Job -Timeout` 包围）。
- 设备收尾：`font_scale`/`uimode`/`wm size`/`airplane` 全部复位，App 已 force-stop。
