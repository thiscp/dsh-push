# 交接索引（HANDOVER）

> **谁读这个**：新开对话的 leader（以及他 spawn 的 developer/tester）。
> **怎么用**：先看「当前轮次状态」，再按角色跳到你需要的交接产物；本文件只做索引与状态快照，
> **细节在各自产物里**（`verify/QA-ROUND-*.md`、`openspec/changes/*`、`host-plugin/README.md`、本 skill）。
> **谁维护**：leader（每轮收尾登记一行；developer/tester 只写自己的产物，不改本文件）。
> 纪律与产物清单见 skill `dsh-push-app-dev` §5。

---

## 1. 当前轮次状态（快照）

| 字段 | 值 |
|---|---|
| **✅ host-plugin 0.2.3 已发布（2026-10-17 13:5x，修「网页已开着时点另一条推送不切会话」）** | 用户真机实遇：「我刚刚同时开两个对话，一个执行长任务、一个执行短任务……短任务的会话结束推送到 APP，我去 APP 对应标签进入 dsh 网页，结果进入的是我之前在的那个长任务的对话呢」。**服务端是对的**（实测 App 收到的那条 `web` 带的正是短任务会话 `#session-6e1cc422-…-713eb41d2c59`，与标题 `[b41d2c59]` 对得上）；坏在浏览器半：**`WebActivity` 是 `launchMode="singleTask"`，`onNewIntent` 虽然 `loadUrl(新链接)`，但新链接与当前页只差一个 `#片段` ⇒ WebView 做的是同文档跳转、不重载页面**，而 `revealFromHash` 只在模块加载那一刻跑一次 ⇒ 根本没再执行。我之前的测试每次都 `--fresh` 冷启动，所以没暴露这个。修法：`window.addEventListener("hashchange", …)` + **每次现读 hash**；之所以每次都能触发，是因为成功后会把片段 `replaceState` 抹掉（`replaceState` 不产生 hashchange，不自激），常态地址是无片段的 ⇒ 再点同一张卡片也一定产生变化。**VM1 与笔电都按「页面开着、只改片段」复现验收**：1.2 秒切到目标会话、片段自动抹掉、`done:true`。提交 **`d720c39`** |
| **🧬 `ctx.effect(fn)` 的 fn 是**立即执行**的效果体，返回的那个函数才是清理器** | 加 hashchange 监听的第一版写成 `ctx.effect(() => { stop(); removeEventListener(); }, "…")` ⇒ **挂上监听的同一刻就被摘掉**，实测 `location.hash` 变了但 `DIAG` 停在 `tries:0 / hash:""`（监听根本没跑）。正确写法是本文件上面那处的形状：**`ctx.effect(() => () => { 清理 }, "…")`**。另记一条排查法：插件 client 里挂 `window.__DSHPUSH_CLIENT__ = {hash, tries, opened, rowSeen, clicks, done}`，一眼分清「没跑 / 没拿到 hash / 没找到行 / 点了没切」 |
| **✅ host-plugin 0.2.2 已发布：VM1 + 笔电生产都装上，用户真机验收通过（2026-10-17 13:2x，点推送直达来源会话）** | 用户原话：「我目前通过消息通知上的卡片的dsh网页按钮进入网页后，似乎是之前默认的对话，能进入后直接进入推送通知的那个对话吗」。**两半都在插件里，App 一行没动、不用发版**：服务端 `webUrl(sessionId)` 把来源会话 id 作为 **URL fragment** 拼到 `#web` 链接尾（提问 + 任务结束两条推送路径都带；id 不是 `session-<uuid>` 形态就不拼）；浏览器半 `lib/client.js:revealFromHash(ctx)` 读 hash、按语义化选择器把主视图切过去。**为什么是 fragment 不是查询参数**（实测）：`?token=` 入口回的是 `303 See Other → Location: ./`，查询串在这一步被丢掉，而 fragment 跨跳转保留；网页客户端**没有路由**（bundle 里 `createRouter` 0 命中、`pushState`/`popstate` 命中都在 lodash 注释里），路径和查询串都没人读。**VM1 实测三证**：① 真点卡片「DSH 网页」⇒ 落地标题「只回复一个字」= 该推送所属会话（2s 到位、hash 已自动抹掉）② App 收到的那条 `web` 字段 = `http://<tailnet-vm1>:3080/?token=…#session-8538a20c-…`（按条存 ✓）③ 不带 hash 时仍落在记住的上一个会话（无回归）。抓手全是语义化属性：当前会话 `[data-conversation-session]`、侧栏行 `[data-row-key="session:<id>"]`、`button[aria-label="Open sidebar"]`、`Show N more sessions`、`aria-expanded=false` 分组。selftest **101→104**（3 条 fragment 断言）。提交 **`553e792`** + **`a9d9403`**（已推 gitee）。
**笔电生产部署（13:2x）**：覆盖 `C:\Users\<user>\.dsh\profiles\web\node_modules\dsh-push-host\lib\{index.js,client.js}`
+ `package.json`（备份后缀 `.bak-20261017-132217`，md5 与源仓逐字节一致），再用
`~\.dsh\skills\dsh-self-restart\scripts\restart-dsh-self.ps1` 注册一次性计划任务重启（**我这轮被砍断是预期行为**）；
验收：`dsh-net-restart-once.log` 末行 `post-restart status exit code = 0` + `self-registered task removed`、
3081 换了 pid（41784）、**token 必换**（新 `z2R15…`）、web.log 出现 `[dsh-push-host] relay ready host=laptop`。
**笔电网页端直达实测**：带 `#session-94e45254…` 加载 ⇒ 落地标题「你好」、2.5s 到位、片段已抹掉；
不带片段仍落记住的上一个会话（无回归）。**服务端半铁证**：本次提问推送在 App 存的
`web = http://<tailnet-laptop>:3080/?token=z2R15…#session-500f90e6-…-641ccbec9605`（就是当前对话）。
用户选择「**直达了，验收通过**」。openspec 已追平并归档：`archive/2026-10-17-push-web-deep-link`
⇒ `dsh-host-plugin` **REQ 13→14 / SCN 52→56**（sha 前缀 `003567cb74c50703`，vm1 往返一次通过） |
| **🧬 插件 client 的 `apply` 跑得很早，「只点一次」会被吞；模拟器时区 GMT 会让 DSH 拒掉一切网页 prompt** | 第一版只点一次 `Open sidebar` ⇒ 自带诊断（`window.__DSHPUSH_CLIENT__`）显示 `hash` 有、`rowSeen:false`：那一下点击被尚未挂好 handler 的界面吃了。修法：**每一拍按当前状态决定动作**，且按 `aria-label` 判断方向——侧栏已开时 `Open sidebar` 这个按钮就不存在了，所以重复点安全（不会反过来把它关掉）。另：模拟器 `persist.sys.timezone=GMT` ⇒ WebView 的 `Intl.DateTimeFormat().resolvedOptions().timeZone` 报 `+00:00`（不是 IANA 名）⇒ DSH 以 `session/invalid-time-zone` **拒绝任何 prompt**（新建会话也一样，极易误判成插件坏了）；`setprop persist.sys.timezone Asia/Shanghai` + `settings put global time_zone` 后正常。真机是 IANA 名，不受影响 |
| **✅ v1.32.29 / 95 已发布（2026-10-17 11:2x，主页按钮精简）** | 内层流水线 **`SUMMARY: 10/10`**（四态矩阵 PASS）；apk **10,999,784 B**；`?v=95`，更新通知 id **mys3lXcD1fBa**。用户原话：「我感觉主页的按钮太多了，能只保留常用的吗，其他的可以做个设置菜单放里面」。改动：主页**三行 7 颗 → 一行 2 颗**（清空消息 / 调试浮层）；顶栏「换主题」胶囊换成「**设置**」；启动·停止服务 / 电池优化白名单 / 保活体检 / 换主题 / 调试浮层收进 `showSettings()`（setItems 菜单，**条目带实时状态**：后台服务显示 `PushService.state`、白名单显示 `isIgnoringBatteryOptimizations`）。 |
| **🧬 菜单里切换、主页那颗按钮要跟着改文案（`diagBtnRef`）** | 主页「调试浮层：关」的文案是 onCreate 时写死的；若菜单里切换不回写，就会出现「菜单说已开、主页还写已关」。做法：onCreate 把按钮存进字段 `diagBtnRef`，菜单分支里 `diagBtnRef?.text = ...`。**实测**：菜单点一下 ⇒ prefs `diagHud="true"` 且主页按钮当场翻成「调试浮层：开」；再点回 `false` ✓。 |
| **⚠️ 本轮欠的 spec 账（等用户验收布局后再补，别直接改 specs/）** | 这次 UI 重组碰到现网 `companion-app` spec 三条条款：**L108** scenario 点名「换主题」按钮（已不在顶栏）、**L186**「在主界面『换主题』入口选择任一主题」（现经「设置」）、**L324**「主界面 SHALL 提供保活体检入口」（现在在设置菜单里，仍在主界面一屏内但深一层）；**v1.32.32 又添一条：L684「一键全部已读」要求按钮在状态文本**下方**右对齐，现已挪到卡片右上角与未读计数同行**（用户要为消息列表省垂直空间）——归档时这四条 MUST 一起改。⇒ 用户确认布局后 MUST 走一个 openspec change（MODIFIED 这三条，**按 scenario 标题名抄全现网**）再归档。 |
| **✅ openspec 追平 + 公开仓同步（2026-10-17 12:3x，用户「验证通过」后收账）** | 新建并归档 **`app-home-actions-diet`** ⇒ `archive/2026-10-17-app-home-actions-diet`：MODIFIED 4 条（小清新视觉主题 / 应用内主题切换 / 保活体检 / 一键全部已读）+ ADDED 1 条「主页操作收纳与设置菜单」（含调试浮层默认关与 `onResume` 即时生效）。**companion-app REQ 34→35、SCN 183→187**，in-flight 归零。delta 用脚本从现网**逐字抽块、只改指定行** ⇒ scenario 标题名必然一致，**一次过闸门**（`--changes --strict` 1/1 绿 → 归档 → `--specs --strict` 只剩 dsh-host-plugin 那条既有 >500 字 WARNING、`--archived` 43 过 / 7 失败全是 2026-10-10~13 老件）。vm1 与本地 spec **sha 逐字节一致**（`d9ae9d03…`）。私有 **`73e31f8`**；公开仓 gitee/github/origin 三远端 **`c056d37`**、版本号 100/1.32.34 一致、in-flight 0、真值泄漏 0（唯一 IP 命中仍是 `QA-ROUND-v1.32.17-RC.md:50` 那句描述脱敏动作的原文）。 |
| **✅ v1.32.33/99 + v1.32.34/100 已发布（2026-10-17 12:1x，状态卡片改竖排胶囊）** | 用户「现在的按钮是里面文字是水平布局的，能否改为垂直布局，如我图中红色位置这样的布局。以此来把上面那行的空间也节省出来」。最终：两颗胶囊**竖排文字**（`全\n部\n已\n读` / `清\n空\n消\n息`）贴在正文右侧、垂直居中，正文独占整高、首行取消。99 是半成品（见下行），**100 才是成品**：id **`puwzFwS9736n`**、apk 10,999,672 B、`?v=100`、`SUMMARY: 10/10`。**实测**：胶囊 112×278px、正文列 896px 五行**不折行**；第一张消息卡片顶边 y **v96 1580 → v98 1433 → v99 1634（宽 bug）→ v100 1273**，本轮再省 **160px=40dp**、累计省 **307px=77dp**。未读=0 分支实测：「全部已读」隐藏、「清空消息」仍贴右（1312）、正文列自动扩到 1136、高降到 300px ✓。配套把文案改短（服务器去 `https://`、白名单去「电池优化」前缀与长说明）以免窄列折行吃掉收益。 |
| **🧬 Button 样式的 minHeight=48dp 与 minWidth=88dp 都压不住；另 `lineSpacingMultiplier` 是只读属性** | v1.32.33 只硬定了高度没管宽度 ⇒ 竖排胶囊被 **minWidth=88dp 撑成 352px 宽**、正文列只剩 416px、每行折行，**反而比上一版高 201px**（1634 vs 1433），全靠装机 dump 才抓到。正解：`LinearLayout.LayoutParams(dp(28), -2)` 给**确切宽度**（→112px）。另外 `p.lineSpacingMultiplier = 0.92f` 编译报 **`Val cannot be reassigned`**（TextView 只有 `setLineSpacing(add, mult)` 方法）⇒ 用 `p.setLineSpacing(0f, 0.92f)`。**改控件尺寸 MUST 同时硬定宽高并装机量 bounds。** |
| **🩺 `push-received` FAIL 的甄别法（v99 首轮 5/8 就是这么停的，不是回归）** | 症状：`PUSH_HTTP=200` 但 `entries with unique body: 0`、`mid-unique`/`entry-unread` 连带 FAIL，screenshot 却 PASS（它只查文件存在，那张图是**空状态**）。⇒ 先 `adb shell run-as PKG cat shared_prefs/dshpush.xml` 看那条 body 在不在库里：**在** ⇒ 只是 WS 重连比流水线窗口慢、消息随后补播进来（vivo/模拟器装完包重启常见），**重跑同一条 release 即可**（v99 重跑就 10/10）。crash buffer 空 + 进程在 + PushService 在 ⇒ 不是崩。好消息：流水线 FAIL 会**在 deploy 前 ABORT**，所以坏版本不会推给手机。轮询日志时记得**按日志名过滤**，否则会匹到上一份旧 SUMMARY。 |
| **✅ v1.32.31/97 + v1.32.32/98 已发布（2026-10-17 11:4x，状态卡片瘦身）** | 用户「清空消息的按钮能否在框内右上角，我这样改是为了增加垂直空间上的显示空间」。最终布局：状态卡片**首行** = 左「● N 条未读」+ 右「全部已读」「清空消息」两颗胶囊（右上角），下面 4 行状态文本，页面底部无按钮行。两轮流水线各 **`SUMMARY: 10/10`**；97 id `PBKhuU2wQFbu`、98 id **`b1DyhP6xECT3`**，apk 10,999,696 B，`?v=98`。**实测收益**：胶囊高 192px→**136px**，第一张消息卡片顶边 y **1580→1433**，省出 **147px = 37dp**（dpr4）。未读=0 分支实测：「全部已读」隐藏、「清空消息」仍贴右（右边缘 1312）、首行左侧 TextView 为空 ✓。 |
| **🧬 Button 的 48dp 最小高度压不住，MUST 用 LayoutParams 硬定（v1.32.31→32 返工）** | 想压扁胶囊先写 `p.minimumHeight = dp(30)` + 减小 padding ⇒ **v1.32.31 装机实测仍是 192px（=48dp）**；`bg_pill.xml` 是无内边距的 shape，192 来自 Button 样式的 minHeight。改成 `LinearLayout.LayoutParams(-2, dp(34))` 给**确切高度**才生效（136px）。⇒ 教训：**改尺寸 MUST 装机 dump 量 bounds**，别信「代码里设了」——我 97 就是这么发出去的。 |
| **✅ openspec 剩余 5 个 change 全部归档，in-flight 清零（2026-10-16 22:4x，用户「归档吧」）** | `webview-network-awareness`(v1.32.8) / `plugin-timed-switch` / `dsh-push-web-link-out-of-box`(插件 0.1.1) / `app-narrow-sidebar-discovery` / `app-narrow-hitbox-overlap` ⇒ `archive/2026-10-17-*`；**companion-app REQ 32→34、SCN 165→183**，**dsh-host-plugin REQ 11→13、SCN 41→52**；vm1 与笔电两侧 sha256 逐一核对一致（`93050730…` / `35cd7b2f…`），archive 共 **49** 件、in-flight **0**。commit **`1fb3e53`**。 |
| **⚠️ 这批归档带来的两个口径，别当已了结** | **① A14 的 P1 未销**：`app-narrow-hitbox-overlap` 一归档，spec 就声称「窄屏命中区不重叠」，而 QA 用例 **A14**（FINDING-1：`Collapse sidebar` 40px ↔ `Open in File Explorer` 23px 横向重叠 **23px**、`realTaps` 7 处误触实证）**自 v1.32.14 之后没再复测** ⇒ spec 现在写的是**目标行为**，下轮 MUST 复跑 A14 探针再定要不要回改。**② 新增 1 条 WARNING**：`dsh-host-plugin` 的「提问推送（宿主插件路径）」正文 **390→577 字**（>500 字**风格 WARNING，不是 ERROR**，由 `dsh-push-web-link-out-of-box` 的 MODIFIED 块带来；要消得单开一轮拆措辞）。另记一笔诚实账：本轮的补齐脚本因括号笔误 SyntaxError **一行没跑**，但这 5 个 delta 的 MODIFIED 块本来就抄全了现网 scenario ⇒ 闸门没触发、结果不受影响——**可信的是 CLI 的闸门，不是我的脚本**。 |
| **✅ openspec 归档 4 个玻璃化 change（2026-10-16 22:1x，用户「可以」）** | `app-overlay-opacity`(v1.32.11) / `app-doc-panel-opacity`(12) / `app-content-block-opacity`(13) / `app-glass-layout-chain`(15) ⇒ `openspec/changes/archive/2026-10-17-*`；`companion-app` spec **REQ 25→32、SCN 126→165、600→789 行**。终检 `validate --changes --strict` **5/5**、`--specs --strict` **7/7** 全过，正文 >500 字的 WARNING 归零；`--archived` 的 7 条失败全是 2026-10-10~13 的老归档件（无 tasks.md，先前就有）。commit **`df08143`**。 |
| **🔴 openspec archive 的 MODIFIED 闸门：delta 必须抄全「归档那一刻」的现网 scenario（本轮撞三次）** | MODIFIED 是**整块替换**，CLI 见到「现网有、delta 没有」的 scenario 就报 **`archive_spec_update_failed`** 并**原子回滚**（`No files were changed`，不会写坏一半）。这四个 delta 都是按**更早**的 spec 状态写的 ⇒ 顺序归档时后者缺前者刚写进现网的那条：doc-panel 缺 overlay 的「浮层判定不依赖 CSS-module 哈希」，glass-layout-chain 还额外缺 content-block 的「聊天里的大代码块不被大容器分支抹成全透明」。⇒ 归档前 MUST 按 **scenario 标题名**与现网 spec 精确对照补齐（**别用「文件里出现过这个词」**——我先用这条把两个其实缺的误判成已存在）。补齐后逐字节核对：现网 requirement 块 == 归档 delta 块（5954 字符）才算合并忠实。 |
| **🧰 openspec 只能在 vm1 跑，姿势是「干净副本 + tar 回灌」** | vm1 `openspec 1.14.1`（笔电/台式机无 CLI）。**别用 vm1 那个仓**（`92147dd` 陈旧脏快照）⇒ `mkdir ~/osp94` + `scp -r 笔电的 openspec` 进去，`list / validate / archive` 全在 `~/osp94` 里跑（**不需要 git**）；跑完 `tar czf` 回灌、整目录替换（**两侧文件数与 sha256 一致**才算过：本轮 170 文件 / `c4f97045…`）。ssh 侧三条纪律：① 脚本落盘 scp 再 `bash 文件 < /dev/null`（**内联引号会挂死 ssh**，本轮挂过一次 120s）；② awk 用 `-f 文件`，别在 bash 里拼 awk；③ 每条远端调用带硬超时。 |
| **✅ 公开仓已同步到 v1.32.28（独立复查过，不是只看脚本自报）** | `export-public.ps1`：先 `-DryRun` 过闸门（486 个文本文件、机器名/IP/token 全替换）⇒ 正式跑 **gitee / github / origin 三远端 sha 全 = `8c08d6a`**；公开仓 `versionCode=94 / 1.32.28` 与私有一致；泄漏复查 **0 条真值**（`hk_hosttoken0000000000000000` 是 selftest 合成夹具、`regToken` 全是字段名与文档占位）。⚠️ **`Start-Process -ArgumentList` 在 PS 5.1 下不给含空格的参数加引号** ⇒ `-Msg "…"` 被拆成位置参数、`-Private` 抢到 `v1.32.28` 报 `Push-Location 找不到路径`；必须自己用 `[char]34` 把值包起来。 |
| **✅ v1.32.28 / 94 已发布（2026-10-16 21:3x，诊断 HUD 改为可选开关）** | 内层流水线 **`SUMMARY: 10/10`**（四态矩阵 PASS）；apk **10,999,916 B**；`?v=94`，更新通知 id **iNaVTBACu3XK**。用户原话：「打印可以关掉吗，或者做个开启关闭打印的开关，这样下次出现问题也好调试」。改动：HUD **默认关**；主界面第三行新增 **「调试浮层：关/开」** 按钮（新文件 `DiagPrefs.kt`，存 `shared_prefs/dshpush.xml` 的 `diagHud`）；注入脚本时把开关值**烘进字符串**，切完回页面由 `onResume` 里的 `window.__dshDiagSet()` **热改**，不必重开页面。 **用户 2026-10-16「验收通过」**（v93 的灰带修复也在前一版被用户确认：用户「这次的正常了」）。 |
| **🧬 诊断开关的三条链路（模拟器实测，不是看代码）** | ① 默认（prefs 里无 key）⇒ 页面 **无 `#dsh-diag`**；② 开关 ON 后新开页面 ⇒ HUD 在（`dshDiagOn=true` 烘进脚本）；③ 页面活着时把开关切 OFF 再回页面 ⇒ `onResume` 推 `__dshDiagSet(false)`，HUD 当场消失。页内 CDP 探针（`runjs.mjs`）：`typeof window.__dshDiagSet === 'function'`、`set(true)` 出 HUD（首行 `vh=671 vv=671 vw=360`）、`set(false)` 移除。开关本身也走真 UI 验证：主界面点按钮 ⇒ prefs `diagHud="true"`、按钮文字变「调试浮层：开」。 |
| **🧰 模拟器上点按钮的取证法（uiautomator 被常驻动画卡死）** | 主界面有**永不停止**的呼吸/闪烁 `ObjectAnimator` ⇒ `uiautomator dump` 直接报 **`ERROR: could not get idle state`**，而 `dumpsys activity top` 给的 bounds 是**相对父容器**的（自己算绝对坐标极易错一屏）。可行姿势：`settings put global window_animation_scale 0` + `transition_animation_scale 0` + **`animator_duration_scale 0`** ⇒ 再 dump 就成功，且给**绝对屏幕 bounds**（本轮「调试浮层」= `[72,2668][1368,2860]`）。**用完三个 scale 都要恢复 1**。教训：别拿缩放预览图目测坐标去点（本轮目测 1856 全落空，实际在 2764）。 |
| **✅ v1.32.27 / 93 已发布（2026-10-16 21:1x，灰带真因命中）** | 内层流水线 **`SUMMARY: 10/10`**（四态矩阵 PASS）；apk 见日志；`?v=93`，更新通知 id **JYZ84gaxp9d7**。改动：`cbmEl` 改用 **`_card` 类名锚点**定位卡片 + 几何兜底改**绝对像素阈值**，并清掉键盘态误写的那层。 **用户已确认灰带消失**（原话「这次的正常了」）。 |
| **🔴 灰带真因（v92 的临时 HUD 一击命中，实拍证据）** | 真机键盘弹起时 HUD 打出：**`vh=363 vv=364 vw=360`**、`row rgba(0, 0, 0, 0.15) why=bg15 RlGAzG_grow`。⇒ 卡片定位用的是 `cbmR.height>vh*0.08` 这个**随视口变化**的阈值：vh 从 690 掉到 363，阈值 55px→**29px**，于是 **36px 高的输入行先被当成卡片**，被写成 `rgba(0,0,0,0.15)`（它原生是**黑色**）＝一条 15% 黑纱，就是用户看到的灰带。模拟器 vh=671（阈值 54px）时输入行过不了 ⇒ **只有真机键盘态会犯**，这也是前两版改错方向的原因。 |
| **⛔ 新硬规矩：分辨「卡片 vs 输入行」MUST NOT 用视口相对阈值** | 凡判据里出现 `vh*0.xx` / `vw*0.xx` 来划尺寸边界，都要先问「键盘弹起/分屏/旋转时这个阈值会变成多少」。本轮教训：`vh*0.08` 在键盘态直接腰斩 ⇒ 把输入行判成卡片。正确做法：**结构化锚点优先**（类名片段 `_card`，hash 无关），几何只做**绝对像素兜底**（宽>半屏 + 高 48~240）。另外：键盘态 WebView **会 resize**（690→363），凡是「只在键盘态出现」的问题，第一反应就该是「某个 vh/vw 判据变了」。 |
| **🧬 临时 HUD 的价值（可复用套路）** | 模拟器复现不了真机时才用：往页面注入一个 `position:fixed` 的 `#dsh-diag`（每秒刷新，11px 等宽字，深底白字），打印 `vh/vv/vw`、`.dshOv` 列表、以及目标元素+4 层祖先的 computed 底色 / `__dshWhy` / 是否被标记；各上色分支写 `e.__dshWhy`（ov / bg15 / bg45 / clr）。用户截一张图即定位，省掉 2-3 轮瞎猜。**HUD 自身要加进快速通道类名闸**（`dsh-diag`），**定位完必须删**。 |
| **⚠️ v1.32.26 / 92 = 临时诊断版（2026-10-16 20:4x）** | v91 的「键盘态 composer 误判浮层」修法**没解决**用户报的灰带（用户 20:41 截图仍在）。改法：① 0.45 通道也排除「输入框的祖先」（只留 cbmEl 走 0.15）；② 各分支写 `__dshWhy`（ov/bg15/bg45）；③ 页面左上角注入 **`#dsh-diag` 临时 HUD**，每秒打印 `vh/vv/vw`、`.dshOv` 列表、card/row/inp 与 4 层祖先的 computed 底色 + `why` + 是否被标记 ⇒ **让用户截图即定位**（模拟器键盘不 resize，复现不了）。装包：`?v=92`，通知 id **HKVhdAt3TgHF**。**下一版必须删掉 HUD**。 |
| **✅ v1.32.25 / 91 已发布（2026-10-16 19:4x，键盘态输入框变实板）** | 内层流水线 **`SUMMARY: 10/10`**（含四态矩阵）；apk **10,998,148 B**；更新通知 id **2Wm0gZ9RlFvs**；`?v=91`。 |
| **🔴 真机现象与机制：键盘弹起 ⇒ composer 被判成浮层 ⇒ 输入框变实板** | 用户 19:21/19:23 截图：「刚进来正常，一点输入框就变这样」。机制：键盘弹起时 WebView **resize**（视口降到 ~300 CSS 高），页面把 composer 改成 **position:fixed + 高 z** 贴到键盘上；它下面有 **+/权限/模型/发送 4 个可交互子项** ⇒ 正好命中浮层几何臂（fixed + z≥10 + ≤90%×90% + 可交互子项≥3）⇒ 被判成浮层 ⇒ 要么加 `.dshOv`（盖 0.60 遮罩）、要么被 ovRole 分支放行而保留**原生不透明白**，两种都让输入框变成实板。**v90 把 seat 白纸拿掉之前这层被盖着看不见**，属同一根因链第二段。 |
| **🧬 修法：两处入口同一道闸 ——「含聊天输入框的元素一律不是浮层」** | ① 主循环 isOv 判定加 `!(cbmT&&e.contains&&e.contains(cbmT))`；② 快速通道 `fastOv` 加 `querySelector('[contenteditable=true]')` 命中即 return，另加 **composerSeat / composerStack 名字保险**（wrapper 可能先插入、后把 composer 搬进来）。判据用「包含输入框」而非类名：键盘态下 React 可能把 composer 挪进新 wrapper/portal，但祖先里总有那个 contenteditable。⛔ 模拟器**复现不了**：它的键盘是**盖在页面上**（不 resize、composer 不 fixed）⇒ 只能机制推理 + 真机验证。 |
| **⚠️ 红线复核：「+」菜单遮罩未被这道闸误伤** | 修复后重跑 + 菜单探针：最外层 `_surface_ri079_1 Z9Jnlq_menu` 仍是 **`rgba(255,255,255,0.6)`**、内层 viewport 透明 ✓（菜单里没有 contenteditable，故不受影响）。 |
| **✅ v1.32.24 / 90 已发布（2026-10-16 18:3x，底部实底真因命中）** | 内层流水线 **`SUMMARY: 10/10`**（含四态矩阵）；apk **10,998,092 B**；更新通知 id **FhIvET2kqIuQ**；链接 `?v=90`。改动：把页面自己的 **`composerSeat` 白渐变**用样式表置 none。 |
| **🔴 真因：底部那块白不是我们补的底色，是页面自己的「白纸」** | `Dc7zOa_composerSeat`（297×128，`position:sticky`，z-index 7）带 `linear-gradient(color(srgb 0 0 0 / 0) 0px, rgb(255, 255, 255) 36px)` —— **36px 以下是纯白不透明**。它就在输入框卡片正后方 ⇒ 白盖白，**我们给卡片写的任何 alpha 都不可能被看见**。用户「还是老样子」完全正确，我上一版的验证（只看计算值）是错的。 |
| **🧬 判据：同一区域逐点 A/B（强制重绘后），模拟器与真机同分辨率 1380×3036** | 卡片内联底色 **0.15 与 0.45：72540 个采样点里 0 个不同**；把 seat 渐变置 none：**33984 个点变化**，底部均值 **L 244.0 → 232.3**；受控同页实验细节透出比 **0.729 → 0.791**（聊天区作对照）。用户真机同指纹：越靠下越白（透出比 0.334 → 0.257 → 0.179，最下面 mean L 251 ≈ 纯白）⇒ 真机效果会比模拟器明显得多（模拟器壁纸是平灰）。 |
| **⚠️ 取证陷阱（本轮连踩两次）：模拟器 `screencap` 会拿到陈旧的合成帧** | 改完样式立刻抓图，**红/绿标记当场看不见**（我因此误判「改了没变化」）。必须**触发重绘**再抓：① `adb shell wm size <w>x<h>` 变更一次（也顺便把模拟器设成真机分辨率，方便逐点对齐）；② 或改一处相邻样式（实测：恢复 seat 的 `background-image` 后，之前设的红色才出现）。＝任何「改样式 → 抓图比较」的结论都必须先证明这一帧是新画的。 |
| **🎚️ 现在的可调档（用户一句话就能改）** | ① **seat 白渐变**：`none`（现档，底部与聊天区一致）→ 也可给 `linear-gradient(transparent, rgba(255,255,255,0.30))` 留一点衬底保可读性；② **卡片 alpha**（seat 关掉后才看得见）：0 = 45%、**0.15 = 53.3%**（现档）、0.30 = 61.5%。 |
| **⚠️ 教训：改颜色前先确认「谁在画这一片」** | 判据不是「该元素的 computed background-color 是多少」，而是**逐点 A/B 或涂色标记实测**（谁涂红，红就出现在谁的地盘）。本轮 `isOv`/卡片/veil 三层里，真正画底部的是**没被我们碰过的 seat**。同一坑还适用于：伪元素、`background-image` 渐变、`box-shadow` 大扩散、以及「白盖白 ⇒ 改动不可见」。 |
| **✅ v1.32.23 / 89 已发布（2026-10-16 16:3x，底部实底断根）** | `release.ps1 -Version 1.32.23 -VersionCode 89` ⇒ 内层流水线 **`SUMMARY: 10/10`**（含四态矩阵 `states=4 fails=0`）；apk **10,998,056 B**，线上 `?v=89` curl 回来**字节完全一致**；更新通知 id **Hfpr0GCvkIYe**。改动只有一处：**输入框卡片** 0.45 → **0.15**（`if(isCbm)ga=0.15;`）。 |
| **🧬 底部「实底」真因：卡片与整页 veil 各 0.45 ⇒ 叠成 69.8%（可复用判据）** | 逐层探针（祖先链 + 全部 `position:fixed` 覆盖层，乘 (1−a)）实测：卡片 `ragba(255,255,255,0.45)` × veil `ragba(255,255,255,0.45)` = **69.8%**，与用户真机截图沿卡片顶边（x=1150）L **144.3 → 231.2** 反推的 **0.70** 完全对上。降到 0.15 后 **53.3%**（聊天区只有 veil = 45%，所以底部原来明显更实）。⛔ `document.elementsFromPoint` **跳过 `pointer-events:none`** 的元素，会漏掉 veil（它正是 `pe:none; z:-1; fixed`）⇒ 命中栈探针**少算一层**，必须走「祖先链 + 固定层枚举」。 |
| **🎚️ 0.15 的备选档（用户一句话就能改）** | 只改 `if(isCbm)ga=0.15` 那一个数字：**0** = 与聊天区完全一致（45%，卡片只剩边框）；**0.15** = 现档（**53.3%**，留一点卡片轮廓）；**0.30** = 更实（**61.5%**）。改完重跑 `release.ps1`（约 2 分钟）。 |
| **⚠️ 本轮三条硬坑（判据照抄）** | **① 幂等闸门会永久锁死卡片**：`if(!isOv&&!(big&&isPanel)&&!isCB&&!isLayout&&a0<1)continue;` ⇒ 卡片被写过 0.45 后 `a0<1` 恒成立，之后怎么改 alpha 都落不到它身上（实测：把内联改成哨兵色，**2.8s 无人重写**）⇒ 必须给它 `!isCbm` 放行（只对这一个元素，重写同值幂等）。**② 判据 MUST NOT 依赖布局位置**：`bottom>vh*0.72` 在冷启动那一轮为 false（卡片还没落位），而**布局位移不触发 MutationObserver** ⇒ 永远不会补第二轮，卡片停在 0.45 ⇒ 改成「从整页唯一的 `contenteditable` 往上取第一个『宽>半屏、高 8%~50% 视口』的祖先」，循环外一次算好。**③ `var` 不能落在别的函数体里**：把 `var cbmEl` 插进 `_cbn(){…}` 内，外层 `e===cbmEl` 直接 **ReferenceError，整段注入当场全废**（症状与语法错一样：卡片实底 a=1、veil 不存在、侧栏 alpha=1、矩阵 collapsed FAIL）。 |
| **⚠️ 拆行写 if(...) 会漏右括号，而括号审计会被字符串里的 ) 骗过** | `.indexOf(',0.15)')>=0` 里的 `)` 在**字符串字面量内**，按字符计数的审计脚本会报「平衡」而 JS 实际 SyntaxError。规矩：**每个 JS 片段行自己括号自平衡**；另 `})());` 比原来的 `})();` 多一个 `)` 同样能让整段注入静默全废。 |
| **⚠️ 两条工具面（本轮各卡一次）** | **① `verify/release.ps1` 没有 `-Deploy` 参数**——它内部本来就调 `-Deploy`；多传一个 ⇒ 报 `Missing an argument for parameter 'DeployNote'`，且**脚本一行都没跑**（输出 0 字节）⇒ rc 别信，认**内层流水线自己的 `verify-*.log`**（本轮 B TSUMMARY: 10/10` 就在那儿）。**② `release.ps1` 用 Write-Host 打印**，PS 5.1 下 `2>&1 \| Out-File` **抓不到**（文件 0 字节）⇒ 要用 `*>&1`。 |
| **⚠️ 模拟器会整台消失（不是 offline）** | 症状：两台机器 `adb devices` 都列不到设备、矩阵 `verdict=ENV states=2`。根因是笔电上的模拟器进程死了 ⇒ 用计划任务拉回：`schtasks /Run /TN dsh-emu`（动作 = `G:\Android\run-emu.cmd`），约 8s 后 `emulator-5554` 出现（本轮实测）。⚠️ 冷启动后**应用数据会被洗掉**（`shared_prefs/dshpush.xml` 不存在 ⇒ 页面停在配置页）⇒ 必须重跑一次流水线把 prefs 种回去。另：PowerShell **变量名不区分大小写**，循环变量 `$a` 会把 `$A`（adb 路径）覆盖成任务动作对象 ⇒ 报 `MSFT_TaskExecAction 不是 cmdlet`。 |
| **✅ 真机确认：0.60 遮罩定案，不再调档（用户 15:24 截图）** | 用户原话「**效果很不错，这才是我最初想要的效果**」。截图口径：菜单条目（文件/目标/计划/反馈/压缩/权限/模型/下载日志）全部读得清，背后正文（「已编辑 8 个文件」「E:/work/work_dsh/dsh-push/ve…」）只剩**淡影**不再压字，卡片边沿是**软过渡**、没有 v1.32.20 那种硬色差，标题行「添加」那一圈也在遮罩内。**⇒ 这条缺陷链（v1.32.11 → 19 → 20 → 21 → 22）到此关闭；0.45 / 0.72 两个备选档的实测数据已登记在上面，日后要调只改 CSS 里那一个数。** |
| **✅ v1.32.22 / 88 已发布并真机确认（2026-10-16 15:2x）** | release.ps1 -Version 1.32.22 -VersionCode 88 -Deploy ⇒ **SUMMARY: 10/10**；apk **10,997,812 B**，线上 ?v=88 的 Content-Length 逐位相同；更新通知 id **WMdp8FEzwkpg**。改的只有一件事：浮层补一层 **0.60 深色遮罩**（深色主题 rgba(18,24,40,.60)，浅色主题给白），并**当帧**上色。提交 **5900e35**。 |
| **🔴 「不填充」的代价兑现了：背后正文透上来** | 用户 14:24 真机截图：菜单透明后，背后整排正文（「深度求索中，用时9分…」「已压缩59条历史…」）直接透到菜单条目上，白字压黑字读不清。⇒ 原生那层约 **18% 减光**只够挡壁纸、不够挡字。**「不填充」只对了一半：色差确实断了，可读性反而更差。** |
| **🧬 遮罩浓度四档真合成实测，拐点在 0.45~0.60（可复用判据）** | 模拟器**浅灰壁纸=最坏情形**（背后黑字鬼影最重）。同一区域 42064 个采样点的高频边缘能量（越高=越透）：**0 遮罩 26.90 / 0.45 → 18.15（−32%）/ 0.60 → 16.36（−39%）/ 0.72 → 15.45（−43%）**；0.45→0.72 只再多压 15% 却把壁纸压成暗块 ⇒ 取 **0.60**。装机后实测 **16.36 / meanLum 77.9**，与选定的单层 0.60 档**逐位相同**。 |
| **🔴 backdrop-filter 在透明 WebView 上完全无效（别再试磨砂）** | 给浮层加 blur(16px) 后与不加做真合成逐点对照：**857 个采样点 0 个不同**。原因：Chromium 的 backdrop root 在**透明页**上是空的，糊不了原生壁纸、也糊不到页内内容。⇒ 输入框卡片那条 blur(12px) 同样是白花的（只有它的 0.45 底色在起作用）。**唯一的杠杆就是遮罩 alpha。** |
| **⚠️ 遮罩改成「打标记 + CSS」，不在 JS 里写色（防双层叠加）** | 实测菜单插入时**外层定位壳与内滚区会被同时判成浮层**，各写一层 0.60 会叠成 **0.84**（比实测最好的档深一大截）。改成 JS 只加 .dshOv、颜色交给 #dsh-ov-style 里的一条规则，选择器 **.dshOv:not(.dshOv .dshOv)**（不在另一个 .dshOv 里面的那个）保证**只有最外层卡片**上色，且后加的后代会自动把色「让」过去，无需重排顺序。CSS 文本从 Kotlin 串里拼出来逐字符核对过：花括号净深度 0、important 两处。 |
| **⚠️ 快速通道两条必须有的闸（各配一次实测失败）** | **① 类名闸**：侧栏是我们自己改成 position:fixed + z-index:60 的，尺寸与可交互子项数**全都过闸**，不排就被盖成实底 ⇒ geom-matrix 报「侧栏 alpha 1 不在 [0.4,0.5]」；主循环靠类名排除，快速通道 MUST 同样排除 byninw_ / 2h3hww_root / dc7zoa_root / dsh-theme-veil。**② 上色时机**：全量 apply() 一轮本身 ~780ms，防抖怎么调都救不回，必须在观察器回调里**同步**打标记 ⇒ 实测遮罩比记录器发现菜单还早一帧（**−79ms**），用户抱怨的「等几百 ms」彻底消失。 |
| **⚠️ Kotlin 串里写 CSS/正则的三条硬规矩（本轮连踩四次）** | **① 单个 { 就合法，别写 **{{**（那是别的语言的插值写法）**，写成双括号会把 {{ 原样发进 CSS 把规则弄坏；**② 跨行拼接的 JS 字符串段里别各自带引号**，拼出 'a''b' 就是语法错；**③ 正则括号必须闭合**——例如把 (\d+),\s*(\d+) 写成 (\d+,\s*\d+ 少一个右括号，在 JS 里就是 Unterminated group，**整段注入脚本静默不执行**（表现是「什么都没上色、inlineBg 空、veil (none)」，极易误判成装机没生效）。审计要先把 Kotlin 的 \\ 反转义再数括号，否则连一直在跑的旧行也会被误报。 |
| **✅ v1.32.21 真机确认（用户 14:24 截图，「不填充」是对的）** | 用户：「也有色差，不过是透明的不明显；上一版不透明所以比较明显」——与像素取证完全对上（x=900 竖切，壁纸连续处）：菜单**外** L≈145（145/156/152/145/145/141）、菜单**内** L≈119（连续 7 行平台段）⇒ **菜单自身那层本来就有约 18% 的减光**，不是抗锯齿假象，这正是「正文不会透上来」的来源。上一版**明显**的色差 = 我们那层不透明底色与原生发丝线打架；现在残留的「不明显色差」= DSH Web 原生设计本身 ⇒ **不再动** |
| **✅ v1.32.21 / 87 已发布（2026-10-16 14:2x，用户提出「直接不填充」后断根）** | 用户真机反馈 v1.32.20 仍是「边沿色差不一样、等几百 ms 才填充好」，并给出关键判断「**本来就不会把文字透上来的**」⇒ **浮层一律不再补底色**（撤掉 v1.32.11 起的补色、v1.32.20 的去发丝线与快速通道，净删 52 行）。实测：菜单内联底色为空、**原生 0.5px 白发丝线回归且与原生底色配套**；真合成像素菜单区一路 `rgb(139,141,152)` **内外同色无环**。`SUMMARY: 10/10 passed`、四态矩阵 PASS、`?v=87`、apk **10,997,152 B**、ntfy id **`o5NajBRxQDhr`**；commit **`25d94b8`** |
| **🔴 断根结论：色差与延迟**同源**，都是「我们补的那层底色」** | 色差 = 补的底色与浮层自带的发丝线不配套（那条线是配**原生**底色调的）；延迟 = 补色要等全量 `apply()` 一轮（模拟器 ~780ms、真机更慢，快速通道也只是提前一帧）。**不补 ⇒ 两个一起消失**，浮层恢复 DSH Web 原生外观。回头看：v1.32.11 补 0.92 → v1.32.19 补几何豁免 → v1.32.20 alpha=1+去线+快速通道，**三个版本都在给一个不该存在的补色打补丁**。⇒ 以后遇到「浮层背景不对」，**先问「能不能不补」**再问补什么档位 |
| **⚠️ `isOv` 分支的真正作用不是上色，是互斥闸门（别删）** | 命中后浮层不会落到 `isLayout`（写 transparent）/ `isPanel`（写原生色相）/ `isCB` 三条通道——删掉分支会让菜单被写 transparent 或错误色相，**比不补更糟**。现在分支体只留 `e.__dshGlass=0;` 认领。`ovFallback`/`bm`/`blum` 降级为**备用代码**（就地标注，回滚点 commit `18a768d`）；观察器撤掉 `hasOv`/`fastOv` 回到最初的 400ms 防抖 |
| **⚠️ 「不填充」的代价与判据（真机为准）** | 菜单现在**透出壁纸**。模拟器壁纸是**浅灰平色** ⇒ 模拟器上菜单呈浅灰底、白字对比度差，**这是模拟器壁纸所致，不代表真机**；真机壁纸暗时无碍，但**亮壁纸区（浅色立绘的白裙等）压在菜单后面时会降低正文对比度**。用户本人当测试员，以真机观感定；若嫌透，回滚点 `18a768d`（alpha=1 版）或折中「只在浮层出现 N ms 后补」 |
| **⚠️ 开源同步「半同步」根因（已修进脚本，判据照抄）** | export-public.ps1 原来只推 **origin + gitee**，而这个公开克隆里 **origin 与 gitee 都指向 Gitee，GitHub 是第三个 remote github** ⇒ **脚本从来没推过 GitHub**，却照样打印 exported to GitHub + Gitee public（v1.32.20、v1.32.21 连着两次落后一整版，我手工补推 0cf3d19..0fe08bf、0fe08bf..61fd20f）。**已修**：改成遍历 git remote 逐个推，再对每个 remote 跑 git ls-remote <r> master 与本地 HEAD 比对，不一致就 throw ⇒ 那句成功语现在可信了，但验收仍以 ref 为准。两条独立坑仍在：① **别在 run_code 里进程内 & 调它**——脚本内 ErrorActionPreference=Stop，PS 5.1 把 Gitee 横幅（stderr）升级成终止错误会打断后半程；用 cmd /c "powershell -File … > f 2>&1" 起子进程。② -Msg **别穿引号层**（实测被吞后消息第二个词漏进 -Private ⇒ Push-Location … popup PathNotFound），把消息写进生成的 ASCII 包装脚本最稳 |
| **✅ v1.32.20 / 86 已发布（2026-10-16 14:0x，用户真机三轮反馈后定案）** | 上传菜单背景「没铺满」三处同修：① 浮层底色 alpha 0.96 → **完全不透明 `rgb()`**；② 丢掉浮层自带的 **0.5px 白 0.16 发丝描边**（`box-shadow` 第一段，两段黑色投影保留）；③ 新浮层**当帧上色**快速通道。`release.ps1 -Version 1.32.20 -VersionCode 86` ⇒ **`SUMMARY: 10/10 passed`**、四态矩阵 `states=4 fails=0`、apk **10,997,824 B**、`?v=86`、更新通知 id **`ouIpqvQ0BesZ`**；commit **`18a768d`** 已推 `origin/master` |
| **🔴 本轮三个真因（全部实测，非推测）** | **① alpha 0.96 仍透底**：压在亮壁纸/白正文上，4% 透光就能看到底层内容淡影（v1.32.12 阅读面板当年也是实测 0.96 留淡影才定成 1，同一个道理）。**② 内沿浅色环**：`boxShadow` 第一段 `rgba(255,255,255,0.16) 0px 0px 0px 0.5px` 是配**原生底色**调的发丝线，dpr 3.75 下 ≈2 物理 px；真机实测内沿 `rgb(38,45,58)` vs 内部 `rgb(18,25,41)` ⇒ 用户读成「底色没涂到边、内沿一圈颜色不一样」（**不是透，是色差**）。**③ 上色延迟**：页内 rAF（16ms 精度）实测点击后 **112–161ms** 菜单已存在（absolute/z=100），底色却要 **784ms** 后才写上 |
| **🧬 可复用配方：浮层「先透后实」的量化与修法** | 时序**别用 CDP 往返采样**（单次 90–900ms 抖动，量不准）：页内 **rAF 逐帧轮询**记 `点击 / 首次存在 / 首次有底色` 三个 `performance.now()`。**瓶颈往往不是 400ms 防抖，而是全量 `apply()` 一轮本身 ~780ms** ⇒ 加**快速通道**：观察器发现新插入的定位浮层**当场补色**，不等全量轮。判据**两选一**（可交互子项数 **或** 类名线索 `menu\|surface\|overlay\|dialog\|popover\|dropdown\|popup\|sheet\|listbox`）——菜单刚插入时**子项还是 0 个**（实测条目 t=442ms 才落地），只靠子项数就只能等重试。修完 **12ms** 上色（点击→实心 173ms，原 ~900ms） |
| **⚠️ 快速通道自身的坑：BFS 尺寸闸必须与上色闸完全一致** | `hasOv` 先命中先返回，返回的是外层定位壳 `RlGAzG_overlayAnchor`（**265×0**）；壳过不了 `fastOv` 的 `height>80` ⇒ 快速通道**整轮空转**、仍等全量轮的 266ms。把 `hasOv` 的 `offsetWidth>60&&offsetHeight>40` 抬到与 `fastOv` 相同的 `>100 && >80`，一帧内命中真身（265×343）⇒ 12ms |
| **⚠️ 本轮新踩三条（判据照抄）** | **① CDP `Page.captureScreenshot` 把透明页合成到白底** ⇒ 细窄的未铺区/半透底在截图里**看不见**，v1.32.19 就是这样「验过」却漏到真机 ⇒ 浮层/背景类改动 MUST 用 `adb shell screencap -p /sdcard/x.png` + pull 的**真合成** + 像素取样。**② 模拟器壁纸是浅灰平色** ⇒ 同一个 alpha 在模拟器看不出透底，真机是亮立绘就明显 ⇒「模拟器干净」≠「真机干净」。**③ 探针残留的 `adb forward` 会让流水线假失败**：`geom-matrix` 报 **`verdict=ENV; states=0`**、drive 从 22s 涨到 95s ⇒ 跑流水线前先 `adb forward --remove-all` + `am force-stop`，**别去改代码** |
| **🧾 本轮耗时实测（补进基线）** | 一次「改码 → vm1 编译 → 装机 → 页内复测延迟」闭环 **≈90s**；流水线不带 `-Deploy` **45–52s**（drive 22–95s 波动大，受模拟器负载影响）；`release.ps1 -SkipExport` 端到端 **≈75s**；页内 rAF 探针一轮 **≈18s** |
| **✅ v1.32.19 / 85 已发布（2026-10-16 12:5x，新流程第一次全程跑通）** | 「改代码 → 编译 → 推送」三步一次做完：release.ps1 -Version 1.32.19 -VersionCode 85 ⇒ 内层流水线 **SUMMARY: 10/10 passed**（46s）、四态几何矩阵 **states=4 fails=0**、apk **10,997,168 B**、链接 https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=85 、更新通知 id **a7wKu6X4cFGR**、公开镜像 exported to GitHub + Gitee public。提交 **a6bb489** 已推 gitee。用户只需在手机上点卡片验证一项：**「+」菜单背景是否实心、正文不再叠印**。 |
| **🔴 本轮缺陷与根因（用户截图报「上传文件窗口背景没铺全」）** | 模拟器 CDP 实测（不是推测）：弹层 _surface_ri079_1 Z9Jnlq_menu 自身、::before、::after **全是 rgba(0,0,0,0)**，只有一条 0.5px 描边阴影，内联被我们写成 **transparent !important** 且 __dshGlass=1。判据逐条件重放：absolute ✓ z=100 ✓ 265x343 未超 90% ✓ 8 个可交互子项 ✓ ⇒ **isOv 本该命中**；但 L1004 的豁免只给 role 命中的浮层（v1.32.11 当时假定「真菜单正是 role=listbox」），而这个菜单 **role 属性为空**，只能走几何臂，而它 265x343 = 73.6%vw x 51.1%vh **恰好越过 50% 阈值** ⇒ 整个条件为假 ⇒ 浮层分支被跳过 ⇒ 落到大容器分支写 transparent。**A/B 排除时机**：菜单全开时手动触发变异让 apply() 重跑，底色仍是 transparent ⇒ 是判据漏口不是观察器。修法：几何臂浮层同样豁免，但 >90%x90% 近全屏定位面板除外（继续走 isPanel 取原生色相，保住 v1.32.12 文档预览面板红线）；壁纸通道是 static/relative 进不了 isOv ⇒ v1.32.6 红线不动。 |
| **🧬 可复用配方：CDP 抓「弹层为什么没上色」只要 12s** | 复用 geom-matrix.mjs 的 hostsFromPrefs + openCold，再加三步：① **Emulation.setEmulatedMedia 强制 dark**（见下行坑①）；② 点 composer 的「+」用 **document.elementFromPoint(90,617)** 再往上找最近的 BUTTON（实测命中 RlGAzG_add，aria=Add files or run commands）——**按文案匹配会点到顶栏的 More ways to open**；③ 把注入里的浮层判据**逐条件**在页面上重放一遍（position / zIndex / w,h 与 vw,vh 的比值 / querySelectorAll 计数 / __dshGlass / 内联全文），一次就定位到是哪一条闸门拦住的。弹层匹配条件：position 为 fixed|absolute + 宽高 ≥120 + innerText 短且含 Commands/Export。 |
| **⚠️ 本轮新踩三条（判据照抄）** | **① 模拟器 WebView 默认 prefers-color-scheme = light，而用户真机是 dark**：DSH Web 的主题跟这个走，取证前 MUST 先 Emulation.setEmulatedMedia 模拟 dark，否则截图是浅底、颜色结论全错（CDP 截图对透明背景还额外按白底合成）。**② ntfy 回读卡片不可用**：https://ntfy.cpyh.xyz/dsh?poll=true&… 经边缘层返回的是 **4481 B 网页壳 HTML**（带不带 token、加不加 Accept 都一样），/dsh/json 是**流式不返回**会撞 run_code 截止 ⇒ 卡片送达只认流水线自己的 [PASS] update-notify - id=…。**③ run_code 的 code 参数是逐字插入、不做转义处理**（我此前一直以为会按模板串解义）：所以串里写 \\n 到程序里就是「反斜杠+反斜杠+n」；反过来，**写进 .mjs 的 JS 双引号串里的 \n 会被解成真换行**，放进正则就 SyntaxError ⇒ 表达式里换行一律用 String.fromCharCode(10)，内层选择器只用单引号（外层已是双引号）。一次性探针落盘后 MUST node --check 再跑（本轮 4 次解析错全靠这一步拦住）。 |
| **🧾 本轮耗时实测（补充基线）** | 探针冷启动一轮 **12s**（含 force-stop + am start + 就绪轮询 + 点击 + 截图）；流水线不带 -Deploy 首轮 **60s**（构建 23s、drive 34s 累计、四态矩阵 59s 累计），release 内层带 -Deploy **46s**（构建 10s、drive 19s、矩阵 45s、deploy+通知 46s）；release.ps1 全程含公开镜像同步约 **75s**。瓶颈仍是 agent 读码取证：本轮从截图到定位根因共 6 个探针、约 70s 机器时间。 |
| **✅ v1.32.18 / 84 已发布（2026-10-16 09:39，单人模式首版）** | `dsh-app-verify.ps1 -Deploy` ⇒ **`SUMMARY: 9/9 passed`**；`[PASS] build-vm1 apk 10,997,172 B` → `emulator-up` → `install` → `push-received`（`PUSH_HTTP=200`，body `auto-verify 1792114736`）→ `mid-unique` → `entry-unread` → `screenshot` → `deploy` **`?v=84`** → `update-notify` **id `b1hq0TQHGFzF`**。发版后自检：线上 `?v=84` **HTTP 200 / 10,997,172 B**（与构建字节一致）；ntfy 中文正文 **U+FFFD=0**、含「挤压回归」「一字一行」、prio 4、动作 `?v=84`。发版截图 `verify/rel-v132-18-card.png` 里状态卡片实时显示 **「已连接（v1.32.18）」** ⇒ 纪律 25 在新包上生效。 |
| **🤝 分工变更（2026-10-16 11:5x，用户定）** | 用户令：**之后我只负责改代码 + 编译 + 推送新版本，用户本人当测试员**。⇒ ① 我不再自己跑「真机口径的完整体验轮」，但**模拟器侧的四态几何矩阵 + 10 项流水线照跑**（实测断言只值 ~2s，砍掉它省 2s 却把 P1 直接送进用户手机，v1.32.17 已经付过一次这个账）；② 推送卡片里的验证清单**从 4 项缩到 2 项**，只写真机独有的：**壁纸到边** 与 **真实可读性**（字号/换行/代码块宽度），外加输入法/锁屏后台这类模拟器测不到的；③ 列宽与 alpha 数字（304/360、0.45/0.92、`html` 全透）我在卡片里**附上实测读数**，用户不必再逐项对照。 |
| **⏱️ 流水线提速实测（就绪判据替掉盲等，2026-10-16 12:1x）** | `dsh-app-verify.ps1` 的 drive 模板里 **5 处盲等全换成轮询**：`adb root` 后 2s → 轮询 `id -u`==0（实测 **WAIT=0**）；`pm clear` 后 2s → 轮询数据目录回来（仅 `-Fresh`）；**启动后 8s → 轮询 App 自己的 ESTABLISHED 套接字**（实测 **CONN=up WAIT=2**）；断言轮询间隔 4s → 1s（`HITS=1` 仍第一轮命中）；截图前 3s → 轮询 `dumpsys window` 的 `mCurrentFocus` 含 MainActivity（**WAIT=0**）。**结果：drive 21s → 7s，整条流水线 58s → 45s**（日志 12:16:50→12:17:35，`SUMMARY: 8/8 passed`）。每处判据都**超时后照旧继续**（是优化不是闸门），所以最坏只多等几秒、不会更糟。 |
| **⚠️ 本轮新踩三条（判据照抄）** | **① 这台 Android 的 `ss` 即使加 `-e` 也不输出 `uid=`，且进程名截断到 15 字符**（`xyz.cpyh.dshpush` → `yz.cpyh.dshpush`）⇒ 按 `uid=` 匹配的判据**永远匹配不上**、白烧满 10s 上限（第一版就是这么错的）。⇒ 认进程要匹配**名字尾部** `cpyh.dshpush` 并要求端口 `:https|:443`（DSH Web 那条是 `:3080`，必须排除，否则「连上了」是假的）。**② `dsh-app-verify.ps1` 的开机轮询只在「完全没有设备」时才跑** ⇒ 设备已 attach 但还在开机（自愈梯刚重启过它）就跳过等待，`adb install` 直接死在「Error: device is still booting」，还把 120s 断言轮询耗光（drive 144s 后 ABORT）。⇒ 已在 `EMU_UP=` 之后补 `BOOT_WAIT` 轮询 `sys.boot_completed`。**③ 我这边 `run_code` 超时被杀会连带关掉子进程的 stdout 管道** ⇒ 远端 drive 会话继续跑、本地 powershell 写管道时崩（日志尾部只有 `Host Application:` 转储、**没有 SUMMARY**），极易误判成「脚本自己失败」。⇒ 长流水线一律 `run_in_background` 起作业再等；另外 PS 5.1 的 `> file` 写的是 **UTF-16LE**（读出来满屏空格），要按 utf16le 解或改读脚本自己的 UTF-8 日志。 |
| **🧾 提速后的耗时基线（替代上一行里的旧数字）** | 流水线不带 `-Deploy` **45s**（build 8s / fetch+push 2s / **drive 7s** / 截图 0s / 四态矩阵 27s）；带 `-Deploy` ≈ **47s**；`release.ps1` 全流程（含开源同步 ~25s）≈ **70s**；改完注入 JS → 装机看到截图 **34s**（`bw-iter.ps1`），装机后只出四态数字 **26s**、单宿主两态 **10s**、单态 **7s**。⇒ 「我改完 → 用户手机收到新版」纯机器时间 **≤50s**，瓶颈已完全转移到我的读码与取证。 |
| **🚀 提速轮（2026-10-16 10:1x，用户问「怎么加快开发」）** | 先把耗时**量出来**再动手：`gradle assembleDebug` **只 3s**、整条发布流水线 **40s** ⇒ 构建不是瓶颈；慢在**固定 sleep**（16s+9s+3.5s）与**测量本身**（4 张 1440x3168 截图 ≈8s）。据此做四件事：**①** 新增 `verify/geom-matrix.mjs`（宿主 x 收起/展开四态几何矩阵，**冷跑 25s**；热跑见下面那条——只算烟雾测）；**②** 新增 `verify/extract-injected-js.mjs`（从 Kotlin 抽注入 JS，**按标记定边界**不写行号：实测 L286-674、239 行、漏收 0、11,776 B、`node --check` rc 0）；**③** 矩阵接入 `dsh-app-verify.ps1` 成为**第 10 项检查**（插在 deploy 之前 ⇒ 几何 FAIL 自动挡发版；实测不带 `-Deploy` **`SUMMARY: 8/8`** 且 `[PASS] geom-matrix verdict=PASS states=4`，带 `-Deploy` 则 10/10）；**④** 修 `bw-iter.ps1` 的 `$Repo`（**E: 迁移后一直写死 F: 而静默失效** ⇒ 改 `$PSScriptRoot\..`），`config.local.ps1` 加 `$Node`（与 `qa-round.ps1`/`gate-shot.ps1` 既有参数名一致）。**同文件还有第二处写死 F:**（截图回传那步 scp 到 `F:\work\work_dsh\bw-shot.png`，该目录早已不存在 ⇒ 前 33s 全跑完、最后一步 FATAL 退出码 3），已一并改成脚本自己的 `$OutDir`；复跑 **34s / rc=0 / GOT SHOT / 截图 1,010,252 B 落地** 才算真修好。教训：**修写死路径必须全文搜盘符（`F:` / `E:`），别只修第一处**；判据是跑到底 + 产物落地，不是看某一步过了。**就绪判据**（轮询 `centerCol` 有宽 + body 有文字）实测 **2.6-4.6s** 就绪，替掉 25s 固定 sleep。流水线代价 **+22s**（40s→58s），换来 P1 再也穿不过去。 |
| **📐 task-12 单人收尾：spec 追平代码三轮（2026-10-16 10:4x）** | 新增 `openspec/changes/app-narrow-sidebar-discovery/`（proposal + MODIFIED `内置浏览器提问卡窄屏防塌陷`）。MODIFIED 补入代码里早已存在但 spec 没写的判据：三级优先认侧栏（类名锚点 → 结构臂 → 指纹臂，把手只做否决）、宽度带 **96 ≤ w ≤ vw+2** 与**高度天花板 1.25vh**（正文子树 4.35vh vs 侧栏链 1.00vh）、饥饿兄弟列 **40px 下限**（80×671 算数、8px 把手不算）、**v1.32.18 两道闸**（内容闸 + 轨道下标按元素序号、越界即撤销不钉）、撤销语义与**自锁副作用**、发现与写入分离 + `__bwSbEl` 每轮发布（⇒ 玻璃化 `isSb`/`skipBg` 在 vm1 上开始排除该元素 = 行为变化）、无类名宿主几何观察器**去抖 250ms**、以及「改动窄屏几何 MUST 过四态矩阵」这条验收。**校验**：vm1 `openspec 1.14.1` → `Change 'app-narrow-sidebar-discovery' is valid`（`--strict`），`--all --strict` **12 passed / 0 failed**。 |
| **⚠️ MODIFIED 的自锁坑（本轮最险一次，判据照抄）** | 主规格里那条 requirement 实际有 **15 条 Scenario**，我按 `read` 的窗口只看到 **9 条**，差点就只带 9 条进 MODIFIED ⇒ **归档时会静默删掉另外 6 条**（桌面宽度下视觉不变 / 重复加载不重复注入 / 真机不被裁剪 / 点浮层外才收起 / 面板底够实 / 收起态仍是半透明玻璃）。⇒ **写 MODIFIED 前 MUST 程序化数全**：读基线那条 requirement 的**整个区段**（从 `### Requirement:` 到下一个 `### Requirement:`），按 `#### Scenario:` 切块，逐条比对**标题 + WHEN/THEN 正文**是否与 delta 完全一致（本轮结果 **15/15 逐字一致、0 问题**，delta 共 23 条 = 基线 15 + 新增 8）。别用「读前 N 行」估条数。 |
| **🧰 另两件收尾（用户 2026-10-16 说「可以」后办的）** | **① skill `dsh-push-app-dev` 已更新**：frontmatter 的期望从 `SUMMARY: 9/9` 改成 **10/10**（第 10 项=四态几何矩阵；不带 `-Deploy` 则 8/8）+ 单人模式声明；新增 **§6 开发提速与验收硬事实**（耗时基线、热跑只能当烟雾测的反向对照、vm1 不能当验证机、加检查的两条坑、`__bwSbEl` 是唯一可靠判据、gradle `< /dev/null`、多 dex 扫描、开源同步验收三条）。历史行里的 `9/9` 是 v1.32.15 的记录，**故意保留**。**② 开源镜像已同步**：`export-public.ps1` → 公开 HEAD **`ac234cb`**、公开 `versionCode=84 / 1.32.18`、**GitHub `origin/master` 与 Gitee `gitee/master` sha 相同**、泄漏复查（IP / 机器名 / token）**0 条**；`-DryRun` 先过闸门（483 个文本文件）。**提交信息用 ASCII 英文**——这条链路会把中文按 GBK 写进公开仓库。 |
| **🧪 反向对照把「免 apk 热跑」打回烟雾测（重要，别再当闸门）** | 设想是：从 Kotlin 抽出注入 JS，在已打开的页面上再求值一遍，**5s** 出结论，省掉打包+装机+冷启动。实测**不成立**：把 v1.32.18 的**两道闸全拆**（=D11 原样，正是把聊天列钉成 56px 的那个版本），热跑仍读 **304/PASS**；而同一天所有热跑数字与冷跑**逐格相同**。根因两条：**①** 已装 apk 的注入段自带 **MutationObserver 在持续纠页**，第二次求值的坏代码被已装的正确代码当场修回；**②** 段内有 `if(window.__bwPanelClose)return;`（`WebActivity.kt:660`）这类**幂等闸门**。**教训：叠加式热注入只能证明「页面还活着」，不能证明「新代码是对是错」** ⇒ 判对错只有**冷跑（重新打包装机）**算数，流水线第 10 项用的就是冷跑。顺带一条副产品：**只拆闸 A 时闸 B 单独就能挡住错钉**（序号越界 ⇒ `bwUndo`）⇒ 两道闸对这个失效模式是冗余的。 |
| **⚠️ 本轮新踩两条（下轮直接照办）** | **① `cmd /c` 在多对引号的命令行上会剥掉最外层引号** ⇒ 看门狗自己加的 `> out 2>&1` 变成了 **node 的参数**、`out_bytes=0`、结论读不到（第一次跑第 10 项就是这么假 FAIL 的）。⇒ 走 `Start-Watched`/`Wait-Watched`（**不能用 `Invoke-Watched`**：它在退出码≠0 时 **Abort 整条流水线**，而矩阵 FAIL 退 1、ENV 退 2，应当记成一条 FAIL 而不是炸掉），并且**命令行不带引号**（三条路径都无空格）+ 驱动加 **`--json-out` 文件**取结论。**② 探针认侧栏必须以 App 自己发布的 `window.__bwSbEl` 为准**，按几何扫 `[class*=_root]` 会挑到别的节点（实测挑到 353 宽、alpha 读成 0，把 PASS 误判成 FAIL）。 |
| **🧊 「能不能直接在 vm1 上用它的 DSH Web 开发」已核实为否** | vm1 **没有 `/dev/kvm`**、`/proc/cpuinfo` **无 vmx/svm**（嵌套虚拟化没开）、SDK 里**没有 emulator 也没有 AVD**、显卡是 **VMware SVGA II**（无 3D）⇒ 只能 TCG 软模拟 + swiftshader，而项目红线是 **swiftshader 作废 CSS360 几何与截图时序**（用户也禁 CPU 渲染）。挪过去只省 3 段 scp ≈ **7s**，代价是丢掉唯一能抓住这类回归的设备口径（笔电模拟器 `-gpu host`→RTX 4060、CSS 360/dpr4、与真机同构）。**vm1 的 DSH Web 的正确用途是第二个测试宿主**（哈希命名空间不同 = 类名锚点腐烂探测器），本轮四态矩阵已经在用它。 |
| **🔴 真机回归 + 修复（v1.32.18，本轮最重要）** | 用户 2026-10-16 09:03 **真机截图报障**：App 里「DSH 网页 · 笔电」正文**一字一行**竖排。根因（CDP 实测 + 同 bundle A/B）：D11 把判据①宽度上限 `0.9vw`(324) 放宽到 `vw+2` ⇒ 笔电宿主上 `BynINW_overlayLayer`（**360=100%vw 的全屏空覆盖层，无任何文字**）通过①被认成侧栏；② 把 `col` 取成它自己；③ 新的 40px 下限让 56px 收起轨道被当成饥饿兄弟 ⇒ `expanded=true`；`bwGeomFix` **按宽度找轨道** ⇒ 把 **`centerCol` 那一轨钉成 56px**（frame 内联 `56px 56px minmax(0,1fr)`，计算 56/56/248）。对照臂（`efde4c2`）`__bwW=null`、页面自己 `56px minmax(0,1fr) minmax(0,0)`、`centerCol 304x671` ✓。**修法两道闸**：闸 A `bwSbContent()`（①候选必须真有侧栏内容，空覆盖层出局）、闸 B 轨道下标按「侧栏是外壳第几个元素子节点」定，越界即 `bwUndo()` 不钉（宁可不修不可错修）。**爆炸半径可证**：vm1 的 0.92 走指纹臂、`bwFind` 在 vm1 本就返回 null ⇒ 收紧 `bwFind` 动不到它。**真机四态验收全绿**（笔电收起 304/0.45、笔电展开 304+280/0.92、VM1 收起 304/0.45、VM1 展开 360/0.92，四态页面透明、`__bwSbEl` 均发布）：`verify/fix-{lap,vm1}-{collapsed,expanded}.png`，详见 `GLASS-OVERLAY.md` §11.14。 |
| **⚠️ QA 漏检责任在 lead（下轮起成为验收硬项）** | v1.32.17 那轮六项笔电回归只测了**卡片底色 + 壁纸红线**，**没在笔电宿主上重测列宽/挤压**（B 段 289px 是在 vm1 测的）⇒ 一个 P1 功能性破坏穿过了 QA 到达用户真机。⇒ **凡动 `bwFind`/`bwGeomFix`，验收必须含「每个宿主 × 收起/展开」的聊天列宽 + 侧栏宽四态矩阵**，不能只测底色。另两条本轮自犯：① 只扫 `classes.dex` 漏扫多 dex ⇒ DEX 标记假阴性（真值在 `classes3.dex`）；② `bash -s < 脚本` 时 gradle 吞 stdin ⇒ 脚本后半段静默不跑（**每条 gradle 必须 `< /dev/null`**，`bw-iter.ps1:123` 早写了）。 |
| **✅ v1.32.17 / 83 已发布（2026-10-16 08:59）** | `dsh-app-verify.ps1 -Deploy` ⇒ **`SUMMARY: 9/9 passed`**，链接 `https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=83`，更新通知 id **`AXpEQTt5PB6G`**，日志 `C:\Temp\dsh-verify\verify-20261016-085915.log`。发版后两项自检（上轮被打断，本轮补完）：线上 `?v=83` **HTTP 200 / 10,996,940 B**（与 RC 构建字节一致）；ntfy 正文中文 DeployNote **原文到达、U+FFFD=0、无 mojibake**、prio 4、动作链接 `?v=83` ⇒ **发布链路无缺陷，坏的只是内容**。 |
| **🧭 团队已解散 ⇒ 单人模式（2026-10-16 09:03 起）** | 用户令：**之后不用团队成员**，lead 负责改代码 + 发布，**用户本人当测试员验证**。⇒ 不再 `spawn_teammate`/`subagent` 分工，不再由队友跑 QA 轮；lead 自己在模拟器上做「同 bundle A/B + 四态矩阵 + DEX 字面量」自证，然后 `-Deploy` 推真机给用户验。task-12（openspec MODIFIED delta）随之**搁置**（`openspec archive` 本就约定延到发版成功后）。 |
| **本轮主题（D10 → D11）** | **vm1 展开态侧栏底色 0.45 → 0.92**（用户「继续吧」后 lead 自排的收尾项）。**D10（`3385166`）真机 3/4 FAIL**：`bwFind()` 宽度带 `[96, 0.9vw]`（vw=360 ⇒ 上限 324）在这台宿主上**零候选**——全页 `left≤2 且 h≥0.6vh` 只有正文子树 **353×2922（4.35×vh）** 与侧栏链六个 **360×671（1.00×vh）**。且**不止①坏**：②被 `display:contents` 的 0×0 子包装卡死、③侧栏列与正文列同为 360 凑不出饥饿 ⇒ **只放宽宽度上限不够**（lead 原提议就不够，是 developer 证出来的）。 |
| **✅ D11 已达成（`23a3169`，真机）** | 三级优先发现：**类名锚点 → 结构臂 → 指纹臂**（认我们自己注入的 `0.45 + blur` 内联指纹，零类名）；判据①加**高度天花板 `h ≤ vh×1.25`**；「饥饿兄弟列」加 **40px 下限**（真机被挤正文列 80px 过、8px 把手不过）；**把手只做否决**，判不准就停在 0.45（漏修不错修）。真机：展开 8/8 `__bwSbEl=hHd-Xa_root 360x671` + 内联 `rgba(249,250,251,0.92)` + `bgPrio=important`；收起 8/8 `0.45`、一次收起只翻 1 次、稳态写入 0/0/0。报告 `verify/QA-ROUND-v1.32.17-D10.md`（19,253 B，证据提交 `95051eb`，91 文件）。**lead 独立复核**：自己解析 `qa-d11-d10.json` 逐条证实 + 亲眼看截图（侧栏已近不透明、立绘只在底边淡透）。 |
| **🔴 本轮最重要的一条机制（自锁）** | 旧包里那个 **280px 宽的侧栏是旧几何段自己钉 `width:280px` 的内联残留**；新包不再钉 ⇒ 侧栏回到页面自己的**满屏宽覆盖层（360 = 100%vw）** ⇒ **「按宽度认侧栏」会随我们自己的写入而腐烂**。这正是 D10 合成套件 18 场景全绿、真机 3/4 FAIL 的原因：**合成场景的形状是从上一轮构建的真机读数取的，而那 280px 正是上一轮自己钉出来的**。⇒ 任何仍以宽度为主的判据都要按这条风险复查；合成只能证明「没改坏别的」，**不能**证明「真机生效」。 |
| **⚠️ 两条口径更新（下轮任务书必须带上）** | ① **「收起后 `__bwSbEl` 应为 null」作废**——指纹臂两态都认得住同一节点（收起后缩成 56 宽轨道仍非 null），验收改成「**两态 alpha 正确 + 一次收起只翻 1 次**」；副作用：`__bwSbEl` 现在也由指纹臂发布 ⇒ 玻璃注入的 `isSb`/`skipBg` 在 vm1 上**开始排除该元素**。② **结构臂仍未拿下这个形态**：`__bwW`/`__bwRailW` 在新臂上仍 null，**0.92 完全由指纹臂供** ⇒「修挤压」与「调底色」在这个形态上是**两条互不相干的路径**；要在该形态再动轨道得先补 `bwFind` 的③（外壳 `pI_x6G_frame` 的直接子列只有 `sidebarCol` 一个，`handle` 已被新的 `width>=40` 下限挡掉）。已登记在 `GLASS-OVERLAY.md` §11.12。 |
| **✅ §6.4 显示缺陷已断根（`bd12a59`，纪律 25）** | 状态卡片曾写「已连接（**v1.32.15**）」而设备是 82/1.32.16 —— 根因 `PushService.kt:41 const val APP_VER` 是**编译期常量**，发版只改 `build.gradle.kts` ⇒ **v1.32.16 也是带着错版本号发出去的**（非本轮引入）。修法：删常量 → `appVer(ctx)` 运行时读 `PackageInfo.versionName`，取不到兜底 `"?"` 且**兜底不进缓存**、成功值 `@Volatile` 缓存一次。**纪律 25：版本号唯一真值 = `app/build.gradle.kts` 的 `versionName`，显示处必须运行时派生、禁止写死。** |
| **✅ 发布工具修复（`c2a5711`，lead）** | 做「版本号三处同步」的是 **`verify/release.ps1`**（`APP_VER` 引用 **10 处**），**不是 `dsh-app-verify.ps1`**（后者从不引用 `APP_VER`，只从 `build.gradle.kts` 读 versionCode/Name，L408/L418 ⇒ `-Deploy` 不会被卡）。常量删掉后 `$curAppVer` 变空串：替换匹配不到（**不会写坏文件**）但**校验与报告长期误报** `APP_VER=` 空值 ⇒ 已改成两处并验收：**PS 5.1 解析 0 错、0 非 ASCII、`-DryRun` exit 0**。活文档同步：仓库根 `AGENTS.md`、`README.md`、`verify/README.md`、`GLASS-OVERLAY.md`（含把上面那个文件名错误纠正）。历史 openspec 提案/旧 ANALYSIS 是存档，不回改。 |
| **🔧 当前阶段（历史：RC 已成型，task-15 在跑）** | HEAD **`77389ea`**（gitee `origin/master` 已对齐）= `95051eb` QA 证据 → `bd12a59` §6.4 修复 → `c2a5711` 发布工具 → **`77389ea` bump `versionCode = 83` / `versionName = 「1.32.17」`**。设备现装 **D11 臂 `3104fcaa…5303`（82/1.32.16）**。**待办**：task-15（tester）RC 四项轻验 —— ① 卡片显示 **v1.32.17** ② 推送链路⑥不回归（动了 `PushService.kt`）③ 首屏渲染 ④ D11 复跑（**已删「收起后 null」判据**）；报告 `verify/QA-ROUND-v1.32.17-RC.md`。**判定口径：一条不过就是「不可发版」，不许写「基本达成」。** 通过后由 **lead 唯一执行** `dsh-app-verify.ps1 -Deploy`（期望 `SUMMARY: 9/9`）→ 线上 `?v=83` → `export-public.ps1`。task-12（openspec MODIFIED delta）已解锁待派 developer。 |
| **⚠️ perf 跨时段不可比（已登记）** | 今天同一小时内三臂 jank 挤在 **70~76%**（对照臂 72.53% / D10 臂 70.13~70.61% / D11 臂 76.14%），而上轮 v1.32.16 是 **44.90%** ⇒ **环境变了不是代码变了**；三臂都出现同一个 **4950ms** gpu p95/p99 离群值（**连对照臂也是** = 模拟器 GPU 计时通道固定 stall）；页内 rAF 三臂完全同级（687/686/691 帧，med/p90/p95 全 17ms）⇒ **无代码级回归**。另待观察：D11 臂 rAF 有一个 **1117ms 长帧**落在展开+apply 那一瞬（单次采样分不清是首扫还是近不透明引起的整屏重绘）。**只有同臂同时段对照算数。** |
| **版本基线（2026-10-17 12:3x 更新）** | **线上 = v1.32.34 / versionCode 100**（`?v=100`，更新通知 id **puwzFwS9736n**；主页操作收纳：底部无按钮行、状态卡片正文右侧竖排胶囊、顶栏「设置」五项带实时状态；**用户真机验收通过**）；上一版 v1.32.33 / 99（id `a37Px9XwuUdO`，竖排半成品：minWidth 未硬定）；v1.32.32 / 98（id `b1DyhP6xECT3`）；v1.32.31 / 97（id `PBKhuU2wQFbu`）；v1.32.30 / 96（id `X8Qs6aNxmCx6`）；v1.32.29 / 95（id `mys3lXcD1fBa`）；v1.32.28 / 94（id `iNaVTBACu3XK`，调试 HUD 改可选开关默认关）。模拟器现装 **100**、`diagHud=false`、三个 animation scale 已复原为 1。**openspec in-flight = 0**；`companion-app` spec **REQ 35 / SCN 187**、`dsh-host-plugin` REQ 13 / SCN 52。公开仓三远端**同一 sha**（本轮同步两次，最后一次带上了本行；sha 会随文档提交每次后移一位，所以不写死 —— 现值用 `git -C ../dsh-push-public ls-remote` 现取）。 |
| **🔌 host-plugin 版本线与「根治 pnpm 打回旧版」（2026-10-17 13:5x）** | **笔电生产与 VM1 都是 0.2.3**。此前 profile 的 `package.json` 钉的是旧 tgz（笔电 `…-0.2.1.tgz`、VM1 更脆指 `/tmp/…0.2.1-new.tgz`——**重启就没**），而我部署是直接覆盖 node_modules ⇒ 谁跑一次 `pnpm install` 就把插件打回旧版。**已根治**：本地 `npm pack` 出 `dsh-push-host-0.2.3.tgz`（52,399 B），笔电 profile 指 `file:E:/work/work_dsh/dsh-push/host-plugin/dsh-push-host-0.2.3.tgz`，VM1 把 tgz 挪到持久目录 `~/dsh-pkgs/` 并指它；两边 `pnpm-lock.yaml` 的 specifier（各 5 处）、`integrity`、快照 `version:` 字段一并改到位，备份 `*.bak-023fix`。**integrity 可手写的依据**：pnpm 对 `file:` 依赖记的是 **tgz 字节的 sha512-base64**（我用 0.2.1 的 tgz 反算，与 lock 里记的值逐字符相同 ⇒ 直接写 0.2.3 的值 `sha512-zsLzs…`）。**注意 tgz 不进 git**（`.gitignore` 忽略 `host-plugin/*.tgz`），所以 `file:` 指向的是本地构建产物：换机器要先 `npm pack`。VM1 上没有 `pnpm`（profile 是 DSH 自带的 pnpm 装的），改 lock 只能手写 |。往 VM1 部署的方式是**直接覆盖** `~/.dsh/profiles/web/node_modules/dsh-push-host/lib/{index.js,client.js}` + `package.json`（正式安装才是 tgz + pnpm；profile 的 `package.json` 仍写着 `file:/tmp/dsh-push-host-0.2.1-new.tgz`，下次 pnpm install 会覆盖回去，届时要用 0.2.2 的 tgz）。改完服务端半**必须重启 DSH** 才生效；VM1 用 `bash ~/work/cp_learn_vmware/deepseek-harness/dsh-net.sh restart`（**这台没有 `dsh-net.sh` 在 maxdepth 3**，路径在 `work/cp_learn_vmware/deepseek-harness/` 下）。笔电上重启要用一次性计划任务（`dsh-self-restart` skill：agent 的 shell 就在 `taskkill /T` 要砍的那棵树上） |
| 本轮主题 | **窄屏侧栏挤压 + 隐藏空壳底色（v1.32.15 → v1.32.16）**：用户「继续吧」⇒ 做 **D2**（v1.32.5 那段窄屏补丁按**类名前缀**认元素 ⇒ 换宿主哈希命名后**整段空转**，展开侧栏留在流内吃掉 280px、代码块被压到 **9px**）+ **D3**（零 tab 时隐藏的 `_emptyTabHost_` 被我们写成不透明白） |
| **当前阶段** | ✅ **已发布上线（2026-10-16 03:16）**：task-8 ✅（developer 实现 `efde4c2`：D2 改按**盒模型/几何**四条判据、零类名；D3 跳过 `visibility:hidden`）→ lead 独立复核合成套件（`C:\Users\<user>\Desktop\test\glass-suite-result4.txt` / `glass-d2-probe.txt`：16 个场景只有 S13/S13c/S14 变好，**S1-S12 与 S13b 逐字节不变**）→ task-9 ✅（tester 四轮 QA，判定 **`efde4c2` 可发版**）→ **lead 发布 `05d5c64`（82 / 1.32.16）→ `SUMMARY: 9/9 passed`** → 线上 `https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=82`，更新通知 ntfy id `DUBc9wz16KNZ`。**⏭ 剩：等用户真机回执**；**task-10（D10）已 ready** |
| **v1.32.16 QA 轮结论（task-9）** | ✅ **PASS**（`verify/QA-ROUND-v1.32.16.md`，21,290 B / 155 行）：**D2 真机同 bundle A/B** —— 同一 vm1 前端 bundle、同一会话行、只差 apk：基线臂 `597ff267` 卡片 **9px**（7 个全 9px，`codeblocks` 段 L376）/ 内层 PRE **44px**（`d2.blocks` 段 L526），新臂 `f8b063f0` 两段**全部 289px**；frame 内联 `grid-template-columns: 280px minmax(0px, 1fr) minmax(0px, 0px)` **从有到无**。**D3 两项 PASS**（零 tab 时 `_emptyTabHost_` 的 `inline` 与 `prio` 都是空串 ⇒ 白来自原生；开真 tab 后 `_tabHost_…_pane_…` 仍 `rgb(255,255,255)`）。**六项回归全绿**。**观察器开销 A/B**：janky 46.39%→44.90%、p90 77→69ms、p95 200→150ms、页内 rAF >20ms 帧 10→0 ⇒ **差异在噪声内、方向还偏优**；稳态写入 0 ⇒ 无自激 |
| **✅ D10 残留 → 已由 D11 解决（下面保留 D10 当时的根因作历史）** | vm1 **展开态**侧栏底色停在 `rgba(249,250,251,0.45) !important`，拿不到笔电那侧的 **0.92** ⇒ 窄屏展开时侧栏文字压在壁纸上、两台宿主观感不一致。根因：`bwPanelBg` 只认 `__bwSbEl`（几何段末态已撤销 ⇒ null）+ 类名锚点 `_2H3hWW_root`（vm1 不命中）。修法：把「**找侧栏元素**」与「**修挤压**」**解耦**，让 `bwPanelBg` 自己按几何认侧栏，不依赖 `__bwSbEl` 与任何类名 |
| **🔴 环境事故（对以后所有 QA 轮都值钱）** | 本轮 guest `system_server` 崩过一次：`Can't find service: package`、guest `load average 53`、`device offline`，**qemu 进程本身换了**（28264→33284 整机重启），**非 tester 操作**。可疑原因：模拟器是 **`-gpu host`**，与本地 **Strata 125B 引擎抢同一块 GPU**，引擎满载时 guest 图形链路（composer / allocator HAL 已 92% CPU 空转）被拖慢、可能触发 watchdog ⇒ **以后 QA 轮要么先停引擎、要么当已知抖动；装机前先跑 GPU 闸门 + `pm path` 探活** |
| **全方位体验轮（2026-10-15 10:1x–10:5x）** | ✅ **已完成**（task-1 ✅，commit `ac1ba31`）：57 条用例覆盖 ~40 条；结论 **FAIL（A14 P1 持续 = v1.32.7 FINDING-1 延续，非本轮回归）**；A14/A15/P04 CSS360 基线已重打；新探针 `qa-ux-suite.mjs`/`qa-ux-suite2.mjs`；真实提问类 C02/A05/A18 报 lead 未跑。**tester 收尾时引擎失败（`failed before it finished`）但报告+提交+用例更新全部落盘**；lead 复核发现**设备 airplane 未复位**（报告声明与实况不符）⇒ 已补复位。详见 §3.20.25 |
| **发布证据（本轮）** | `verify\dsh-app-verify.ps1 -Deploy -DeployNote "v1.32.14 …"` → **`SUMMARY: 9/9 passed`**；`LOG: C:\Temp\dsh-verify\verify-20261015-031646.log`；线上 `https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=80` → **http=200 size=10,993,088**、**sha256 = `2850A0D3…`（= 冻结值）**；更新通知 `id: qgCcmpuMrvKX` |
| **v1.32.14 修复（`083de4f`）** | `isAnchor` 追加 **`cn.indexOf('Dc7zOa_root')>=0`** —— 该闸门**同时**封住「取原生色相回写」与 `isCB` 两条路径。**版本三处 → `1.32.14` / code `80`**；openspec 增补场景 + 检查器 **exit 0**（delta 共 **18** 场景）|
| **🔴 FINDING-1 根因（**属本轮引入，已确认**）** | `isCB` 是**运行时判据**（`innerBig` = 后代中 `>50%×50%` 视口的元素数）—— **首屏 / 局部重渲染 / 流式生成中后代尚未撑开 ⇒ `innerBig` 可能临时 ≤2** ⇒ 命中 `Dc7zOa_root`（**原生 `rgb(255,255,255)` 兜底白**）⇒ 按 `pm` 写出不透明白 ⇒ **聊天根在 84%×100% 面积上变不透明白 ≈2s** ⇒ **壁纸被盖**（tester 截图实锤 `qa-C14-dcroot-nativewhite-1.png`，341,694 B），随后 `MutationObserver` 自愈。**tester §7.3 判读成立；lead 先前"与 `isCB` 无关"的推断被推翻**（那条 `panel-open innerBig=41` **只覆盖稳定态**）|
| **v1.32.14 冻结 build** | **`2850a0d3d345c7619db9394993232147380e092356cf979c11159c5ff96f5b9d`**（`10,993,088 B`）—— **四方对齐**（vm1 产物 == 台式机回传 == 笔电 `G:\Android\dsh-push.apk` == 设备 `pm path` base.apk）＋ **DEX 校验**（`Dc7zOa_root`=1 / `isAnchor`=1 / `innerBig`=1 / `isCB`=1 / `BynINW_`=2 / veil=1）；`versionName=1.32.14` / `versionCode=80`；`install -r` = **Success** |
| **v1.32.13 已确认的成果（不得回退）** | **大代码块 `331x524` = `1.0`（5/5 恒定）**、保留原生 `rgb(249,250,251)`；**9 个矮块 `9/9 = 0.45`**（设计内）；**五红线全绿**（四通道 `rgba(0,0,0,0)`、`_tabHost` `1.0`、真菜单 `0.96`、**veil `0.45` 实测**、侧栏 `0.92/0.45`、`RlGAzG_card` `0.45`）；**用户原始投诉（代码透底）已消除** |
| **task-15 复验要点** | ① **★ FINDING-1 复测**（`qa-dcroot-transient.mjs` ≥3 轮）⇒ **白色窗口是否消失**（**唯一判据**）；② **`wouldChange` 复跑 ⇒ 期望仍 = 1**；③ 大块仍 1.0 / 矮块仍 0.45 / `_tabHost` 1.0 / 五红线；④ 整页截图确认壁纸透出；⑤ 哈希夹逼 + ≥5 次采样 |
| **✋ 发布条件** | ✅ **已满足并已发布**（task-15 第 ① 条通过：白窗 3 轮零命中 + 阳性对照）|
| **task-15 QA 结论** | ✅ **PASS**（[QA-ROUND-v1.32.14.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-v1.32.14.md)，15,374 B）：**FINDING-1 已修**（`caught=0/0/0`，改前 **2 次/轮**作阳性对照）；**无 P0/P1/P2**；五红线全绿；哈希夹逼 8 次同值 |
| **⚠️ 我（lead）的一处期望值写错（已被 tester 如实更正）** | task-15 里我写"`wouldChange` 期望仍 = **1**"；**实测 = 2**（面板打开态）——多出的 1 个是 **v1.32.13 已批准的大代码块修复**，**不是新增误伤** ⇒ **"面板那一条"仍是 1**；**结论不变**，但**我的期望值错了**，已在下文更正 |
| **本轮实现 commit** | `8f24fcb`（v1.32.13：`innerBig` 判据 + 放行幂等闸门）、**`083de4f`（v1.32.14：布局容器显式排除）** |
| **本轮新对抗（已沉淀）** | **`QA-A31`** 多代码块同屏 + 阈值两侧分流；**`QA-A32`** 注入 vs 重渲染竞态（**抓到 FINDING-1**）|
| **本轮 5 条可复用纪律（已进 README/TESTER/skill）** | ① 语义特征 ≠ 结构特征（用 `innerBig`，禁用"含 `pre`/`code`"）；② 判据失败方向选**安全侧**（宁可漏修、不可误修）；③ 测注入后样式**必须锁定 settle 之后**（判据 = `inline` 已写入）；④ **"settle" ≠ "读到正确值"**（连续采样）；⑤ **「稳定态测量」≠「动态态安全」**（阈值余量不构成保护）|
| **⚠️ 本轮环境（三次宿主重启 + 模型变更 + developer 引擎失败）** | 会话模型 = **`qwen3.8-flash-next-abl-iq3_s`**（本地引擎）⇒ **异常先怀疑引擎**（`/health` 骗人，§5.4.1）；**宿主重启 3 次**；**developer 子会话连续失败 3 次** ⇒ **task-14 由 lead 直接接手落地** |
| **openspec 归档顺序风险（登记）** | 三个 change 均未 archive：`app-overlay-opacity`(11) / `app-doc-panel-opacity`(14) / `app-content-block-opacity`(**18**)。`archive` 用 delta 覆盖主 spec ⇒ **必须由旧到新**，否则静默挤掉先归档者场景 |
| **上一轮（✅ 已发布且用户回执「验证通过」）** | **v1.32.12 文档预览面板**：发布 `SUMMARY: 9/9`、线上 `?v=78` http=200/10,992,932 B；用户回执**「已经安装最新版，验证通过」**。根因＝`_tabHost` 落进大容器 `transparent` 分支 ⇒ `alpha=0`；修法＝`isPanel` 结构判据 + 三道护栏 ⇒ **`1.0`**。详见 §3.19 |
| **上上轮（✅ 已发布且用户回执「验证通过」）** | **v1.32.11 slash 菜单浮层**：发布 `SUMMARY: 9/9`、线上 `?v=77`；根因＝**分支顺序反了** ＋ **`apply()` 竞态导致间歇**（n=2 跑出 0/0.92）；修法＝浮层判定提前＋互斥＋`role` 豁免几何判定、alpha **0.96**。详见 §3.18 |
| **⚠️ 派活前必做** | 按 §5.6 的"引擎探活"确认本地引擎能真服务（曾踩过：`/health` 200 骗人，引擎挂死 1 小时+，队友反复"崩"） |
| 团队（本轮建立） | lead + **developer**（`android-app|host-plugin|openspec`）+ **tester**（`verify/**`）；**模型均 = spawn 时 Lead 的模型 `Deepseek-V4.1-Flash`，之后无法更改**（见 §3.10 与 `TEAM-READY` §2） |
| 笔电现网（**2026-10-15 变更，看这行**） | `G:\Android\emu-selfheal.ps1` = **加固版 sha256 `26F2CFE123F140F0ADA463E41187C58A9C55EF5FD670317D28BA7916F34184EE`**（源在 `verify/laptop-emu-selfheal.hardened.ps1`，**已同步**）；新增 **F7 闪窗防护**。**两个备份可回滚，均不需重启 DSH**：`emu-selfheal.ps1.bak-hidden-20261015-155150`＝加 F7 前的上一版（`21C1856B…`，**要退闪窗修复就用它**）；`emu-selfheal.ps1.bak-f13`（`BE99A7F9…`）＝更旧的 F1–F3 之前版。选择器 `emu-ladder.gpu=host` |
| **🔴 计划任务闪窗（2026-10-15，已完成并验收）** | 用户报"桌面偶发 cmd 窗口闪一下就没了"⇒ **不是模拟器本体**，是 `\emu-selfheal`（Interactive/session 1、每 5 分钟、`Write-Host` 上屏）＋ `\emu-ladder-rung`。**核心硬事实：`Settings.Hidden=$true` 不给进程窗口设 `SW_HIDE`，无效**（实测由进程内 `IsWindowVisible` 与窗口级 `EnumWindows` 双证）。**修法＝动作改走 `wscript.exe //B "G:\Android\hidden-run.vbs" "<目标>.cmd"`（SW_HIDE）＋保留 Hidden=True＋保留 Interactive**。**两个任务的 `LastResult` 现在都是 0x41301=Running（正常，不是错）**。详情见 [CONSOLE-WINDOW-FIX-2026-10-15.md](E:\work\work_dsh\dsh-push\verify\CONSOLE-WINDOW-FIX-2026-10-15.md) |
| 生产环境（**宿主 = 笔电**，2026-10-15） | 笔电 DSH（profile `web`）：插件 **0.2.1** + `searchProvider: tavily` + `web.log` 最新 `[dsh-push-host] relay ready host=laptop topic=dsh claimForeground=on`（实测 `--dump-config` 1591 行含 `push-host` patch）。token **每次重启必换**，从 `~/.dsh/web.log` 最后一条现取。**台式机 <win-host-b> 已退出 DSH**（`DshNetWeb` Disabled、3080/3081 实测 `TcpTestSucceeded=False`）⇒ 旧「桌面 web」口径**作废**，`verify/config.local.ps1` 的 `$DshWebUrl` 已改指 `<tailnet-laptop>:3080` |
| vm1 环境 | `dsh-net.sh` **运行中**（3080→3081，三地址自检全可用）；`~/.local/bin/node` v22.22.3；**构建工具链齐全**：JDK `17.0.20.1`、Gradle `8.7`（**不在 PATH**）、SDK `/home/user/android-sdk`（见 §3.12/§3.13） |
| 笔电环境 | SSH 通；宿主 GPU **RTX 4060 Laptop / 驱动 616.92**；模拟器 **真 GPU** `1440x3168@640`（`emu-gpu-verdict.ps1` exit 0） |
| 版本基线 | App **v1.32.12 / versionCode 78**（三处一致）；host-plugin **0.2.1**（上一版为 v1.32.11/77） |
| **QA 未完成** | 照旧：task-10 的 **P02–P06 未跑**（P07+P01 已完成，`verify/QA-ROUND-plugin-0.2.0.md`）；另有 tester 早期列出的 **U-1…U-8**（见 `STATUS-READY` / `TEAM-READY` §6）；**A29 多浮层共存**（已做成探针常驻断言）|
| 本轮遗留（新） | **H-1**（QA 起页需 `adbd root`，已修）；**F4/F5/F6 未做**；真 GPU **冷启**基线未重打；`openspec --all --strict` 仍 5 项 WARNING |
| 0.2.0 处置 | **作废、禁止进生产**（详见 §3.5） |
| 0.2.1 产物 | sha256 `59B0A9D9EB7B20148C6AAFB1FEA7F09C5E0FE2742ECF016D4D684F320B456D31`（46,652 B），与 `HEAD` 四文件**逐字节 MATCH**（§3.7）。**首包 `59B0B97C…` 已作废** |
| 回滚路径 | host-plugin：`verify/prod-rollout-plugin.ps1 -Rollback` → `-DispatchRestart` → `-Check`（备份 `*.prodroll-20261014-181419`）；模拟器自愈：`Copy-Item G:\Android\emu-selfheal.ps1.bak-f13 G:\Android\emu-selfheal.ps1 -Force` |
| 新增/更新 skill | **`dsh-team-model-control`**（换队友/子智能体模型）；**`dsh-push-app-dev`** 本轮大改：GPU 判据重写、`emu-gpu-verdict.ps1` 一条命令判据、F1–F3 加固版、**新增 6 条硬事实**（推真机陷阱/QA 起页需 root/vm1 构建易错点/openspec 用法/长脚本下发禁令/.NET 死锁/证据纪律） |
| **本轮环境核查改了什么（2026-10-15 16:5x）** | ① `verify/config.local.ps1` 的 `$DshWebUrl` 由**死链** `<tailnet-windows>:3080` 改指笔电 `<tailnet-laptop>:3080`（token 现取、重启必换）；② skill `dsh-push-app-dev` 的「桌面 web token」行改写为「**DSH Web（宿主=笔电）**」并写入台式机退出 DSH 的判据；③ 补两处环境缺件：笔电**对自己 ssh 的 `known_hosts` 条目**（缺了会让 `verify/emu-gpu-verdict.ps1` 及一切「ssh 自己=模拟器」的 QA 脚本 **BLOCKED exit 4**，修法＝带一次 `-o StrictHostKeyChecking=accept-new`）与 `host-plugin/node_modules/@deepseek-ai/**cosmokit@1.8.5**`（缺了自测 `ERR_MODULE_NOT_FOUND`；根因＝笔电这份 `schemastery` 是把台式机 **junction 目标拷成实体目录**带过来的、兄弟包没跟过来；补完自测 **101/101 exit 0**）；④ 设备侧 **`adb root` 已恢复**（16:04 那次 `-Kill` 冷启把 adbd 打回 `shell`，正是 H-1 那条自动因果链）。**selftest / dsh CLI 的 node 路径在笔电是 `E:\programs\dsh\...`（不是 skill 旧记的 `D:\programs\dsh\...`）**：node = `E:\programs\dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`（v24.21.0），`dsh.cmd` = `E:\programs\dsh\resources\runtime\cli\bin\dsh.cmd`（不在 PATH）。**未做**：v1.32.15 的 ②QA 轮仍未开 |
| **🔴 团队执行模式（2026-10-15 用户拍板，下轮起生效）** | **本地模型开发 ⇒ 同一时刻只允许一个成员在生成**：Lead / developer / tester / 子智能体共用**同一个串行 FIFO 引擎**（取证 [DIAG-member-revive-2026-10-15.md](E:\work\work_dsh\dsh-push\verify\DIAG-member-revive-2026-10-15.md) §7）。任务链 ①→②→③→④ 逐段串行、`blocked_by` 钉依赖、`send_message` 一次只唤醒一个、Lead 派完活即结束回合、`subagent` 一次只发一个；判据 = `list_agents` 里 `running` 成员同一时刻 ≤1。**旧「并行纪律」（developer 动手同时 tester 写用例）已作废**；已同步改写 skill `dsh-push-app-dev` §1/§2 与 [TEAM-START.md](E:\work\work_dsh\dsh-push\verify\TEAM-START.md) §1/§2/§3 || **🔴 本轮（2026-10-15 18:00–22:05）玻璃注入重构 + D1 三轮定点（尚未发布）** | 用户报「连 workVM/vm1 时背景一会儿透明能看见立绘、一会儿不透明，连笔电正常」⇒ 实测**三宿主服务的 bundle 逐字节相同**（同名同哈希 1,476,240 B）⇒ 与构建差异无关；真因 = **App 注入的类名锚点腐烂**（`isAnchor` 只认 `BynINW_`/`_2H3hWW_root`/`Dc7zOa_root`，现行命名是 `_<局部名>_<哈希5>_<行号>`）⇒ 布局容器落进运行时测量分支（`innerBig` 渲染中途失真）⇒ 写白 → 自愈抹回 → 反复翻面；慢宿主撞窗口概率高，笔电 loopback 几乎不撞。**串行四轮**：`674363c`（结构判据 `isLayout` + **单向写** + `isCB` 两轮迟滞）→ `db385d5`（补 `isCode` 内容叶子；自找两缺陷：`isCB`/`pm` **三方环形依赖死锁**、`apply()` **O(N²) 自激** 41 候选 heap OOM≈ANR）→ `4a039ab`（`isCode` 免迟滞 + `__qaCb` 插桩）→ **`5016373`（真根因定案：`isCode` 按渲染盒树判 + 拆 `isLayout` 自锁）**。QA 三轮报告 `verify/QA-ROUND-v1.32.15.md` / `-D1.md` / `-D1b.md`（证据 `qa-v132-15-*` / `qa-d1-*` / `qa-d1b-*`，证据入库 commit `18d5769`，APK 不入库）：最终**两宿主全绿**——卡片 `rgb(249,250,251)`、8×700ms **0 翻转**、六项回归全过、v1.32.6 壁纸红线未放回。**✅ 已发布（22:36）**：`-Deploy` → **`SUMMARY: 9/9`**，线上 `?v=81`（http=200 / 10,993,764 B），用户回执「已安装最新版，验证通过」（日志 `verify/deploy-1.32.15.log`）。开源同步**两仓都到位**（gitee 与 GitHub 均在 `0cf3d19`；23:4x 给 GitHub 账号 `thiscp` 加上笔电那把 `id_ed25519` 后补推成功，未登录访问仓库页 200 ⇒ 确证公开可见；复扫干净，但 scrub map 不含机器名 `<win-host-a>`/`CPHOME`），公开镜像也已从台式机迁建到笔电 `E:\work\work_dsh\dsh-push-public`。遗留 **D2**（v1.32.16 议题：窄屏补丁整体腐烂——vm1 展开侧栏把代码块压到 **9px 宽**、侧栏 0.45 vs 笔电 0.92）、**D3**（无 tab 时 hidden `_emptyTabHost_` 被写不透白）、D6/D8（QA 探针自身）。 |

## 2. 本轮交接产物

| 产物 | 位置 | 内容（下轮必须知道的） |
|---|---|---|
| **根因档案（本轮核心，v1.32.11）** | [ANALYSIS-v1.32.11-overlay-opacity.md](F:\work\work_dsh\dsh-push\verify\ANALYSIS-v1.32.11-overlay-opacity.md) | **§2.0 机制更正**（我初判"被压到 0.45"被实测推翻：真实菜单是 `rgba(0,0,0,0)`、**压根没被注入**）｜决策树两条闸门各自后果｜**§3 `#dsh-theme-veil` 雷区推演**（靠 `z-index≥10` + 面积≤90% 两道门槛才没炸）｜§4 历史护栏（v1.32.6 / v1.32.5）｜§5 目标表（改前值按实测定值）｜**§7 发布前检查单**｜§6 改前证据与局限 |
| **玻璃化浮层手册（App 侧）** | [android-app/GLASS-OVERLAY.md](F:\work\work_dsh\dsh-push\android-app\GLASS-OVERLAY.md) | developer 写：**真实菜单 DOM 表**（`Z9Jnlq_viewport[role=listbox]` / `_surface_ri079_1.Z9Jnlq_menu`）、踩空机制、`isOv` 判定依据、**CDP 输入坑**（`insertText` 插 0 字符 → 用 `adb shell input text`）、验证法。**下轮改这段注入前先读 §1.5/§5** |
| **openspec 变更** | [openspec/changes/app-overlay-opacity/](F:\work\work_dsh\dsh-push\openspec\changes\app-overlay-opacity\proposal.md) | proposal + `companion-app` delta：MODIFIED「浏览器网页全界面玻璃化」**3 场景逐字保留** + 新增 4；ADDED 1 需求 3 场景。检查器 `tools\openspec-modify-check.mjs app-overlay-opacity` → `0 problem(s)` exit 0 |
| **QA 用例与探针（本轮）** | [verify/testcases/](F:\work\work_dsh\dsh-push\verify\testcases) + [qa-overlay-probe.mjs](F:\work\work_dsh\dsh-push\verify\qa-overlay-probe.mjs) | 6 条新用例（**45→51**）：`QA-P11` 主验收 alpha≥0.92｜`QA-P12` 壁纸通道+veil 仍 0.45｜`QA-P13` 侧栏 0.92｜`QA-C11` 菜单交互｜`QA-C12` 点外收起｜**`QA-A29` 对抗扫荡**（过度提亮/反向漏亮双方向）。探针内建 H-1 纪律（root 先于 forward、非 root 报 BLOCKED） |
| **QA 改动验证轮报告** | `verify/QA-ROUND-v1.32.11.md` | tester 出：用例 id → 断言 → 实际 → 证据路径；**BLOCKED/未覆盖显式列出**（**本轮结束时按实际状态填写**）|
| 实现 | [WebActivity.kt](F:\work\work_dsh\dsh-push\android-app\app\src\main\java\xyz\cpyh\dshpush\WebActivity.kt) | 玻璃化注入新增 `isOv` 浮层判定（role / 几何+z-index+子项数）+ **幂等闸门改为只约束非浮层** + 浮层回退纱色（与 veil 同判据）。**大容器 `transparent` 分支与 `skipBg`/`bwPanelBg` 未动** |
| **团队就绪记录** | [TEAM-READY-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\TEAM-READY-2026-10-14.md) | 三角色构成 + **「队友模型不能改」的完整结论**（§2）+ 任务链与串行纪律（§3）+ developer task-1/task-3 结论（§4/§4.7）+ tester task-2 结论（§4.5）+ **H-1**（§4.6）+ 推真机陷阱（§5.5）+ **各角色就绪判据**（§5）+ 总体就绪结论（§5.6）+ 待办诚实清单（§6） |
| **QA 就绪报告** | [STATUS-READY-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\STATUS-READY-2026-10-14.md) + [evidence-ready-2026-10-14/](F:\work\work_dsh\dsh-push\verify\evidence-ready-2026-10-14) | tester 的 A–F 逐条断言/实际/证据 + **U-1…U-8 未覆盖项显式列出** + §7 收笔后记（判定 `RED`→`READY` 的诚实过程）|
| **GPU 判据工具** | [emu-gpu-verdict.ps1](F:\work\work_dsh\dsh-push\verify\emu-gpu-verdict.ps1) | **一条命令判模拟器跑真 GPU 还是 CPU 软渲染**：exit `0`=PASS / `3`=SOFTWARE(违反"禁 CPU"约束) / `4`=BLOCKED。判据 = 客机 `dumpsys SurfaceFlinger` 的 `^GLES:` 行。`-SelfTest` = 6 条合成用例（实测 6/6）。**顺带闸门**：实例真 GPU 但选择器仍 swiftshader 时告警"下次启动会回退" |
| **F1–F3 加固版（✅ 已部署 19:02）** | [laptop-emu-selfheal.hardened.ps1](F:\work\work_dsh\dsh-push\verify\laptop-emu-selfheal.hardened.ps1) | 笔电 `emu-selfheal.ps1` 的**现网版本**（sha256 `21C1856B…`，与 HEAD 逐字节一致）：F1 rung 1 无条件先试（会话检查降为纯日志）｜F2 渲染器纳入健康判据、非真 GPU 即 `VIOLATION` 并纠正、读不到则 **fail closed**｜F3 软渲染只作临时救援、成功后**把选择器重写回 host**。测试钩子 `-DryRun`/`-TestRendererOverride`/`-ForceLadder` 带自锁（不带 `-DryRun` 使用会 exit 2）；**`-SelfTest` 只读**（含**实时**渲染器探测，是防死锁类 bug 的永久回归） |
| **干跑证明脚本** | [drive-hardened-dryrun.ps1](F:\work\work_dsh\dsh-push\verify\drive-hardened-dryrun.ps1) | 在笔电跑 6 场景（真 GPU 健康／软渲染违规／无法识别 fail-closed／rung1 失败→软渲染救援+选择器还原／rung1 成功／测试钩子安全闸）。**实测 `FINAL: PASS - 6/6, machine mutated: NO`**：前后快照逐项相等（qemu pid、选择器哈希**与 mtime**、真阶梯日志行数、渲染器）。**v1 曾有假测**（`-BreakHostRung` 单独用会停在"已健康"闸口、根本没到阶梯）→ v2 加 `-ForceLadder` 才真打到降级分支 |
| **部署驱动脚本** | [deploy-emu-selfheal-f13.ps1](F:\work\work_dsh\dsh-push\verify\deploy-emu-selfheal-f13.ps1) | 在**笔电**执行的步骤 4–5：状态核查 → 降级分支复验 → 安全闸测试 → **幂等**覆盖现网脚本 → **生产模式**跑真任务 + 断言表。**必须 `scp` 后 `powershell -File` 跑，别走 ssh 命令行**（超 ~8191 字符会被截断且静默不执行，本轮踩过） |
| **部署手册** | [RUNBOOK-emu-selfheal-hardening.md](F:\work\work_dsh\dsh-push\verify\RUNBOOK-emu-selfheal-hardening.md) | 把加固版部署到笔电的**五步手册**：备份（记哈希）→ 下发 → **真机 `-DryRun` 复核**（须见 `already healthy ON THE REAL GPU`）→ 复验降级分支 → 覆盖 → **观察一个 5 分钟自愈周期**。含 5 条验收断言、**残留风险如实告知**、回滚（还原备份 + 复查档位，不需重启 DSH）、收尾清单。**已执行完成，保留为复现/换机器/回滚指南** |
| **巡检报告** | [INFRA-HEALTH-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\INFRA-HEALTH-2026-10-14.md) | 三台机器健康实况；CPU 软渲染违规态取证（SurfaceFlinger 渲染器行）；**旧前提「无交互会话⇒真GPU起不来」被证伪的实测**；根因链①–⑤；真 GPU 基线（截图 1.0–1.25s；6s 是 quickboot 非冷启）；**§9 = 实际部署记录 + 生产验收断言表 + §9.4 `Run-Timeout` 死锁根因与修法 + §9.6 假 PASS/假 FAIL 两次工具缺陷** |
| **task-3 复用产物（未进仓）** | `F:\work\work_dsh\tmp\task3-*.{ps1,sh}` + `dev-task3-runbook.md` | 「不发布构建+装机」的手工三件套：总编排 / `clean assembleDebug` / 笔电侧 install（含三段哈希闸门与 `-ExpectSha256`）。**未进仓**；若长期化需与 tester 协调（`verify/**` 是其写入范围） |
| 实现 | [host-plugin/lib/index.js](F:\work\work_dsh\dsh-push\host-plugin\lib\index.js) / [lib/client.js](F:\work\work_dsh\dsh-push\host-plugin\lib\client.js) / [package.json](F:\work\work_dsh\dsh-push\host-plugin\package.json) | volatile 期望态 + `ctx.on('loader/volatile-update')` 触发 + `configEditor.edit` 热改 tool-ask-user + 备份 + 失败回写状态；`dsh.client{platform:"web"}` + `exports "./client"` |
| 规格 | [openspec/changes/plugin-timed-switch/](F:\work\work_dsh\dsh-push\openspec\changes\plugin-timed-switch\proposal.md) | 新 capability `dsh-host-plugin` ADDED 需求 7 场景（vm1 `validate --strict` PASS） |
| 插件文档 | [host-plugin/README.md](F:\work\work_dsh\dsh-push\host-plugin\README.md) | 设置页开关链路表 + 生效范围（新会话立即/老会话代际钉死）+ **selftest 运行时坑** + 网页提问卡生命周期根因；`:267` 记 **101/101** 真基线 |
| 一键安装 | [deploy/windows/install-user.ps1](F:\work\work_dsh\dsh-push\deploy\windows\install-user.ps1) | 无 UI 场景的等价路径；幂等 marker；`[]` 空模板整体替换 |
| QA 用例 | [verify/QA-ROUND-plugin-0.2.0.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-plugin-0.2.0.md) | P01-P06 声明式用例 + 设计期实测事实（设置页入口选择器、Edge headless CDP 链路、scratch 起法） |
| 硬事实 | skill `dsh-push-app-dev` §2 / §2.1 / §5 | GPU 判据与 `emu-gpu-verdict.ps1`；host-plugin 改动专用事实；**本轮新增 6 条**：推真机陷阱、QA 起页需 root、vm1 构建易错点、openspec 用法、长脚本下发禁令、`.NET Process` 死锁、证据纪律 |
| **模型控制** | skill **`dsh-team-model-control`** | 队友（spawn_teammate）与子智能体（subagent/workflow）换模型的分野；`allowedModels` 与设置页开关；实测判据与源码行号。**下一轮若要用"给成员换模型"，开场就读它** |
| 生产上线工具 | [prod-rollout-plugin.ps1](F:\work\work_dsh\dsh-push\verify\prod-rollout-plugin.ps1) + [RUNBOOK-plugin-0.2.1-rollout.md](F:\work\work_dsh\dsh-push\verify\RUNBOOK-plugin-0.2.1-rollout.md) | `-Check/-Install/-DispatchRestart/-Verify/-Rollback` 五模式；验收断言表 |
| vm1 环境与推送 | [vm1-dshnet-check.sh](F:\work\work_dsh\dsh-push\verify\vm1-dshnet-check.sh) / [vm1-host-onboard.sh](F:\work\work_dsh\dsh-push\verify\vm1-host-onboard.sh) / [RUNBOOK-vm1-push-onboarding.md](F:\work\work_dsh\dsh-push\verify\RUNBOOK-vm1-push-onboarding.md) | 零写入回归（带锁）；推送凭据开通（`status/write/restart/verify --probe/cleanup-seed`） |

## 3. 逐轮登记（新→旧）

| 轮次 | 改了什么 | 去哪看 | 遗留 |
|---|---|---|---|
| **v1.32.13 聊天里的大代码块透明（2026-10-15，🔄 进行中）** | 用户指示「**修吧**」⇒ 修 v1.32.12 登记的**已知遗留**：**聊天里的大代码块 `_block_7gxqk_4` + `md-code-block`（`331x524`，占视口 91.8%×78.1%）** 原生 `rgb(249,250,251)` **不透明浅灰**，但**文档面板打开时被压成 `0.45`** ⇒ 代码文字透出底层聊天正文。**⚠️ 本轮难点**：加底的机制现成（v1.32.12 的 `nativeOpaque` 前置 + 原生色相），**缺的是"该不该给"的判据**；且 **`BynINW_frame`/`Dc7zOa_root`（布局容器）原生也是 `rgb(255,255,255)`** ⇒ **"原生不透明"无法区分"内容元素"与"布局容器"** ⇒ 放宽成"凡原生不透明的大容器都给底"会**复现 v1.32.6 壁纸整层消失**。**v1.32.12 的 `isPanel` 判据对它无效**（不是全屏定位覆盖层）⇒ **不许套用，必须新找一条** | [BEFORE-v1.32.13-code-block-transparent.md](F:\work\work_dsh\dsh-push\verify\BEFORE-v1.32.13-code-block-transparent.md)（改前证据 + 侦查清单 + 五红线 + 待查矛盾）、`tmp/v13213-STATUS.md`（续跑状态） | **待查清一个矛盾**：它面板打开时是 `0.45` 而非 `transparent`（若算术两者皆过本应落 `transparent` 分支）⇒ 不查清则修法建立在错因上；版本将升 **1.32.13 / 79** |
| **v1.32.12 文档预览面板透明（2026-10-15 01:2x–，✅ 已发布 9/9 ＋ 用户回执验证通过）** | 用户反馈「对话生成的文档，我打开后背景也是透明的」⇒ 打开对话生成的文档时，**文件预览/差异面板整体无实底**，底层页签栏/聊天正文/文档文字**互相叠印**、长文发花。**根因**：`SECTION._tabHost`（`360x671` = 100%×100%）**落进大容器 `transparent` 分支** ⇒ `alpha=0`；**剥内联看原生 = `rgb(255,255,255)`** ⇒ 应用自己的不透明纯白阅读底**被注入抹成全透明**。**修法**：`isPanel` 结构判据 + 三道护栏（`nativeOpaque` 前置 / 排除锚点 / 按 id 排除 veil）⇒ 阅读面板 **`1.0`**。**🔴 最值钱的一条**：壁纸通道 `BynINW_frame` 原生**也是** `rgb(255,255,255)`（与坏面板同色）⇒ **只能用结构判据，绝不能用原生颜色**（否则复现 v1.32.6 壁纸整层消失）| [ANALYSIS-v1.32.12-doc-panel-transparent.md](F:\work\work_dsh\dsh-push\verify\ANALYSIS-v1.32.12-doc-panel-transparent.md)、[QA-ROUND-v1.32.12.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-v1.32.12.md)、[BEFORE-v1.32.12-doc-panel-transparent.md](F:\work\work_dsh\dsh-push\verify\BEFORE-v1.32.12-doc-panel-transparent.md)、[GLASS-OVERLAY.md](F:\work\work_dsh\dsh-push\android-app\GLASS-OVERLAY.md) §8、本文件 §3.19 | ~~聊天里的大代码块仍透明~~ → **已由用户指示立案 v1.32.13（见上行）**；**差异视图（`+5 -5`）不透明度未亲眼看**（唤不出，U-1）|
| **v1.32.11 浮层可读性（2026-10-15，✅ 已发布且用户回执「验证通过」）** | 用户反馈「选择传文件的控件背景透明度太低了点」⇒ slash 指令菜单浮层发花。**机制比初判更严重**：真实菜单两层表层是 `rgba(0,0,0,0)`、**压根没被注入过**；修后又暴露**分支顺序反了**（大容器分支无条件排在浮层之前 ⇒ 真菜单 `257x392` 被设 `transparent` ⇒ alpha=0），且因 `apply()` 与渐进渲染**竞态**而**时好时坏**。修法：浮层判定提前+互斥+`role` 豁免几何判定；alpha 提到 **0.96** | [ANALYSIS-v1.32.11-overlay-opacity.md](F:\work\work_dsh\dsh-push\verify\ANALYSIS-v1.32.11-overlay-opacity.md)、[QA-ROUND-v1.32.11-r2.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-v1.32.11-r2.md)、[GLASS-OVERLAY.md](F:\work\work_dsh\dsh-push\android-app\GLASS-OVERLAY.md)、本文件 §3.18 | 4px rim（P3，决定不动）；A29 多浮层共存未覆盖 |
| **建团队 + 就绪自检（2026-10-14 19:1x–19:3x）** | 建立三成员团队（lead/developer/tester，模型均继承 Lead=`Deepseek-V4.1-Flash`）；task-1 工具链自检 **READY**；task-2 取证链路 A–E 全绿；task-3 App 端到端 READY；**task-4 修 H-1 FIXED**；**修掉 1 条阻塞 `openspec archive` 的既有 ERROR**（`c215691`）；**拦截「`dsh-app-verify.ps1` 不加 `-Deploy` 也会推用户真机」的陷阱**；纠正 4 条过时硬事实；**20:00 真机验证软渲染自愈拉回 FIXED** | [TEAM-READY-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\TEAM-READY-2026-10-14.md)、[STATUS-READY-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\STATUS-READY-2026-10-14.md)、本文件 §3.11（纠错）+ §3.12（推真机陷阱）+ §3.13（证据纪律）+ §3.14（自愈真机验证） | F4/F5/F6 未做；真 GPU 冷启基线未重打；`openspec --all --strict` 仍 5 项 WARNING |
| **基础设施巡检 + F1–F3 加固部署（2026-10-14 18:4x–19:0x）** | 三台机器巡检；**证伪「无交互会话⇒真 GPU 起不来」旧前提**（实测 console 已断开仍 `-gpu host` OK、渲染器=RTX 4060）；**当场把模拟器从 swiftshader 切回真 GPU**；定位 CPU 档稳态固化根因链；产出 `emu-gpu-verdict.ps1` 一条命令闸门；**加固版 F1–F3 已部署**（含部署途中挖出并修掉的 `Run-Timeout` 死锁 + `-SelfTest` 永久回归） | [INFRA-HEALTH-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\INFRA-HEALTH-2026-10-14.md)、[RUNBOOK-emu-selfheal-hardening.md](F:\work\work_dsh\dsh-push\verify\RUNBOOK-emu-selfheal-hardening.md)、skill `dsh-push-app-dev` §2（GPU 判据重写 + 死锁/ssh 长度两条新坑） | **F4/F5/F6 未做**；「软渲染被拉回」仅干跑证明；真 GPU 冷启基线未重打；截图耗时样本不对称 |
| host-plugin 0.2.0（进行中） | 设置页「手机作答模式」开关；网页提问卡生命周期根因归档；一键安装脚本；deploy 文档 | 本文件 §2 | task-10 执行段未跑；老会话 legacy 僵卡靠「跳过」；DSH 上游补丁（默认 timed + `ask()` AbortController）未提 |
| App v1.32.10 | 逐条「已读」同步撤该条通知（markAllRead 语义统一） | `verify/QA-ROUND-v1.32.10.md`（PASS 15/15）、`openspec/specs/companion-app/spec.md` | QA 报告 §6 未覆盖项（真机 OriginOS、30 条满载、C03/C04） |
| App v1.32.9 | 一键全部已读（状态卡按钮 + `markAllRead`） | `verify/QA-ROUND-v1.32.9.md`（PASS 24/24） | — |

## 3.5 P0 事故记录：0.2.0 反向降级生产配置（2026-10-14）——**上线前必读**

**一句话**：host-plugin 0.2.0 的「手机作答模式」开关在**没有任何用户表态**的情况下，开机自动把生产
`tool-ask-user` 从 `timed` 改写成 `legacy`，并真写了 `cordis.patch.yml`。

| 项 | 内容 |
|---|---|
| 时间线 | 16:11 备份 + 换装 0.2.0（patch 哈希 `D8F12BC0…`）→ 16:12 重启（端口持有者 5452→28772，8/8）→ 启动日志 `[dsh-push-host] 手机作答模式：timed → legacy，已备份 …bak-1791965527486` → 哈希变 `12A0B552…`、文件尾多出 `- id: tool-ask-user / mode: legacy` |
| 根因（读代码定位，行号对 `lib/index.js`） | `:142` `askUserMode` 默认 `'legacy'`；`:873` `desired()` 兜底 `'legacy'`；`:945` 开机即 `sync()` → `:884` 判「需切换」→ `:896-903` 备份 + `configEditor.edit` **真写文件**。即「未表态」被当成「要求 legacy」 |
| 测试盲区 | selftest 14c 只覆盖「legacy 期望 + legacy 实际 = 零写入」，**缺「legacy 期望 + timed 实际」这条降级路径** → 当轮 **82/82** 全绿仍漏网（⚠️ **82/82 是当轮历史数字，已被 101/101 取代，见 §3.11**） |
| 止损 | ① 证据留档（插件自己的备份 `cordis.patch.yml.bak-1791965527486`）；② patch 文件还原为 `D8F12BC0…`（两处 `mode: timed` 健在）；③ 生产插件回滚 **0.2.0 → 0.1.1**（`lib/client.js` 已不在）；④ 再重启一次清掉进程内 legacy 态 |
| 影响面 | 生产 web 提问能力一度降级为 legacy（前台抢答仍可用，失去 timed 的迟到折回与卡片自愈）；**用户真机未受不可逆影响**（作答链路未损，仅配置被改写） |
| 修复 | developer 出 **0.2.1**：永不降级（只允许升 timed）+ `askUserMode` 去默认（未表态=inert）+ edit 前断言 `desired === 'timed'` + 展示读实际态 + selftest 补 4 条回归（含「期望 legacy + 实际 timed → 零写入」） |
| QA 补测 | tester 加 **P07 开机零写入回归**（真实例：哈希逐字节不变 + 无新增 `.bak-*` + 日志不出现切换行），报告单开「P0 事故记录」节 |
| 纪律沉淀 | 「开机自愈式写入」必须**双向覆盖四种组合**（期望×实际），尤其「实际比期望更好」时绝不允许回写；任何写用户配置文件的功能，上线前必须有「未表态 = 零写入」用例 |
| **二次降级（16:13–16:14）** | 只回滚磁盘**不够**：仍在运行的 0.2.0 进程会再次降级——`.bak` 时间戳 16:12:07（开机）、16:13:22、16:14:37，后两次都是我 `Copy-Item` 还原文件后触发的 reconcile 又跑了一遍 sync。⇒ **活体自愈写会把外部修复当成待纠正状态反复覆盖**；修复需加「同进程内同一目标最多成功写一次」 |
| 附带缺陷 | 同一批日志有 `[dsh-push-host] 手机作答模式切换失败：HMR transactions cannot be nested`——在 HMR 事务内调 `configEditor.edit` 会失败，sync 需排队到事务外 |
| 恢复步骤（可复用） | ① 还原 patch 文件；② 回滚插件版本（`Remove-Item node_modules\<pkg>` + `dsh plugin add <旧 tarball>`）；③ **重启宿主**（清进程内存态 + 杀掉会自我重写的旧进程）；④ 复查：哈希 20s 不变 + 无新增 `.bak-*` + 新 boot 日志无「手机作答模式：」切换行 |

## 3.6 vm1 独立验证环境（2026-10-14 建，**验 host-plugin 一律用它，别动生产**）

**为什么有它**：在桌面生产 DSH 上验插件开关＝重启承载 agent 自己的宿主（0.2.0 正是这样打出了生产事故）。
vm1 上现在有**两套**可用环境，**用户已拍板（2026-10-14）：标准验证环境 = 他自己那套 `dsh-net.sh` 服务**
（他已手动把它升到 **0.2.0-rc.2**，与桌面生产同版，且自带代理，设置页 UI 可直接验）。

| | ✅ **标准：vm1 服务**（用户拍板） | 备用：隔离 QA 环境 |
|---|---|---|
| 入口 | `~/work/cp_learn_vmware/deepseek-harness/dsh-net.sh {start\|restart\|status\|version\|pin}` | `verify/vm1-qa-env.sh` |
| 版本 | **0.2.0-rc.2**（npx 缓存 `7eff65a5…` + `~/.dsh/.guard-pin` 钉住） | 0.2.0-rc.2（`~/dsh-qa/node_modules`） |
| DSH_HOME | 真实 `~/.dsh`（profile `web`） | 隔离 `~/dsh-qa/home` |
| 端口 | 3080（代理，isLoopback 改写生效）→ 3081 | 3099（要 UI 得另起代理 3098→3099） |
| 用途 | **验 host-plugin 的主环境**；`profile web` 未装 dsh-push-host（干净基线） | 需要完全隔离、不碰用户 `~/.dsh` 时用 |

### 标准用法（脚本：`verify/vm1-dshnet-check.sh`）

```bash
scp verify/vm1-dshnet-check.sh user@<tailnet-vm1>:/tmp/ && ssh user@<tailnet-vm1> 'sed -i "s/\r$//" /tmp/vm1-dshnet-check.sh'
ssh user@<tailnet-vm1> 'bash /tmp/vm1-dshnet-check.sh status'                       # 服务+profile+哈希+备份数
ssh user@<tailnet-vm1> 'bash /tmp/vm1-dshnet-check.sh check /tmp/<tarball>'          # 装→重启→判定
ssh user@<tailnet-vm1> 'bash /tmp/vm1-dshnet-check.sh cleanup'                       # 卸插件+还原 patch+重启+复查稳定
```

判定四态（exit code 即结论）：**PASS** `boot wrote nothing`(0) / **WRITE DETECTED**(3) / **BLOCKED** `plugin never loaded`(4) / 环境错误(2)。
判据四条同时满足才算 PASS：patch 哈希不变 + 备份数不变 + 日志无「手机作答模式」切换行 + patch 无 `- id: push-host` 条目。
脚本 `check` 会先把 profile 快照成 `<patch>.baseline-check`，`cleanup` 用它**逐字节还原**（插件自己的 `.bak-*` 是 seed 之后拍的，不能当基线）。

### 三条实测硬事实（都踩过）

1. **node 运行时（本次把服务搞挂的坑）**：dsh 0.2.0-rc.2 要求**官方 node 且带 TypeScript stripping**。
   vm1 的 `/usr/bin/node`（Ubuntu 包，v22.22.1）**没有 `stripTypeScriptTypes()`** → dsh 拒绝启动
   （`ERR_NO_TYPESCRIPT`）→ `dsh-net.sh restart` 失败、服务躺下。**必须先**
   `export PATH=$HOME/.local/bin:$PATH`（`~/.local/bin/node` → `~/.hermes/node/bin/node` v22.22.3，可用）。
   脚本已内置 preflight（缺该 API 直接 exit 2 并提示）。
2. **boot 有效性闸**：首轮 `vm1-qa-env.sh` 出现过**假 PASS**——启动参数写成 `--profile <p> web` 被拒
   （`too many arguments … got 1: web`），插件没加载却因「没写入」报 PASS。判据：日志里**没有 `dsh-push-host` 一律 BLOCKED**。
3. **0.2.0 在 vm1 服务上稳定复现生产事故**：`check` 输出 `WRITE DETECTED`、`timed → legacy`、新增 1 个 `.bak`、
   patch 尾部多出 `- id: tool-ask-user / mode: legacy`。**验完已逐字节还原**（sha256 回到 `4a449604…`、138 行、
   0 条 tool-ask-user、插件已卸、我方备份已清）——**动用户 profile 必须留基线并还原**，这是纪律。

**第 3 个缺陷（干净环境暴露）**：插件会把显示用的状态字符串 `askUserStatus` 用 `configEditor.edit` 写进用户 `cordis.patch.yml`：
```yaml
- id: push-host
  name: dsh-push-host
  config:
    askUserStatus: 未找到 tool-ask-user 配置项：…
```
⇒ 即使「无需切换」，插件也会为显示状态而改用户配置文件。修复要求：状态只留 volatile（内存），**落盘只允许发生在真正把 tool-ask-user 改成 timed 那一次**。

## 3.7 0.2.1 放行验证：PASS（2026-10-14，vm1 用户服务）

**结论**：`vm1-dshnet-check.sh check /tmp/dsh-push-host-0.2.1.tgz` → **PASS (exit 0)**，插件在用户自己的
vm1 服务（DSH_HOME=`~/.dsh`，profile `web`，dsh 0.2.0-rc.2）上**开机零写入**。

```
plugin version          : 0.2.1   (client.js=yes)
patch hash before/after : 45717dc5df0e4e0a9e513f1dd58c6f3bed2d764fa264cb06673938197ae61dcc / (same)
backups before/after    : 0 / 0
switch log lines        : 0          (无任何 timed→legacy 之类切换)
patch '- id: push-host' : 0          (状态没落盘 = 第③缺陷已修)
patch mode: timed       : 1
patch mode: legacy      : 0
VERDICT: PASS - boot wrote nothing (hash, backups, switch log, entries all clean)
```

**同环境同脚本对照**（同一把尺子量两版，这是最有力的证据）：
| 版本 | 判定 | 现场 |
|---|---|---|
| 0.2.0 | **WRITE DETECTED (exit 3)** | `手机作答模式：timed → legacy` + 新增 1 个 `.bak` + patch 尾部追加 legacy 块 |
| 0.2.1 | **PASS (exit 0)** | 哈希不变、备份 0/0、切换行 0、push-host 条目 0 |

**最终产物指纹（2026-10-14 定稿）**：`dsh-push-host-0.2.1.tgz`
sha256 **`59B0A9D9EB7B20148C6AAFB1FEA7F09C5E0FE2742ECF016D4D684F320B456D31`**（46,652 B，10 文件）。
**注意有一次重打包**：首版 sha `59B0B97C…`（45,964 B）是 `2c971ec` 打的，之后 `c766f19` 改了 README
而 README **在发布白名单里** → 包内 README 会过期，故从 `c766f19` **重打包**为新 sha。
`2c971ec..c766f19` 对 `lib/**`、`package.json`、`plugin-selftest.mjs` **零改动**（`git diff --stat` 为空），
所以旧 PASS 的行为结论继续成立；但仍以**新包重跑了一遍完整验证**（见下）。

**最终产物 vs HEAD(`c766f19`) 逐字节比对（cmd 重定向取 blob）**：
| 文件 | 结果 | 字节 |
|---|---|---|
| `lib/index.js` | **MATCH** | 47,575 |
| `lib/client.js` | **MATCH** | 5,260 |
| `package.json` | **MATCH** | 1,806（version 0.2.1） |
| `README.md` | **MATCH** | 43,739 |
| `plugin-selftest.mjs` | 不在包内 ✓ | — |

**最终产物在 vm1 服务的复验（同一脚本、带锁）**：`PASS (exit 0)` ——
hash `45717dc5…`→`45717dc5…` 不变、backups 0/0、switch log 0、`- id: push-host` 0、`mode: legacy` 0、
正向 load marker 1、**dangling bundle errors 0**；随后 `cleanup` 输出 `hash stable after 20s = yes`、
patch 还原到 `4a449604…`（138 行 / tool-ask-user 0）、package.json 按 baseline 还原、插件卸载。

**教训（新增闸）**：**改了白名单内的文件（README/LICENSE/cordis.patch.yml）必须重打包并重新核对**，
否则「验过的包」与「发出去的包」内容不一致。首版就是这样过期的。

### 验证脚本自身的三处缺陷（都已修，commit `6b40ae9`）——**工具也会有假判，别只信结论**

1. **日志按整文件计数 → 假 WRITE**：`web.log` 是跨重启**追加**的，我原先在整份日志里数「手机作答模式」行，
   把上一轮 0.2.0 的历史行算进本次，于是干净的 0.2.1 被判 `WRITE DETECTED`。
   修：记录重启前的行号偏移，**只判本次重启窗口**（`tail -n +offset`）。
2. **boot 有效性判据太弱 → 假「已加载」**：原先「日志里出现 `dsh-push-host` 即算加载」，但宿主自己的报错行
   `dsh: skipping profile bundle "dsh-push-host": cannot resolve …` **同样含该字样** ⇒ 插件根本没加载也会被判加载。
   修：改用**正向加载标记**（`relay ready|relay disabled|credentials file`），并新增**悬空 bundle 闸**
   （出现 `skipping profile bundle.*dsh-push-host` 直接 `BLOCKED` exit 4）。
3. **cleanup 不还原 `package.json` → 每次开机报错**：`dsh plugin add` 会同时写 `dependencies` 与
   `dsh.profile.bundles`，只删 `node_modules` 会留下**悬空 bundle 条目**，之后每次启动都打
   `dsh: skipping profile bundle "dsh-push-host"`。修：`check` 同时快照 `package.json.baseline-check`，
   `cleanup` 两者一起逐字节还原。

### 并发撞车（新增串行锁）

vm1 服务是**共享**的：我 cleanup 完（patch 回到 138 行 / 插件卸掉 / 悬空条目清零）后再查，发现又变成
seeded 态 + 0.2.1 已装 + `package.json` 两条条目回来 —— 是 developer 的并发自测在跑，**共享环境无锁会互相踩**，
还会让「谁改了 profile」说不清。修：脚本 `check`/`cleanup` 先抢 `~/.dsh/.vm1-check.lock`
（目录锁，>30 分钟视为陈旧自动抢占，`trap` 保证退出释放）。

**纪律**：共享环境只走脚本（手工 add/改绕过锁＝继续撞车）；`check` 后**必须** `cleanup`；
收尾以「哈希 20s 稳定 + 无新增 `.bak` + 悬空条目 0」为准。

### 放行闸：验证过的产物必须与提交逐字节一致（2026-10-14 新增）

0.2.0 的教训是「验的东西 ≠ 发的东西」。所以 0.2.1 起加一道闸：**把 tarball 解包内容与 git 提交逐字节比对**。

```powershell
# 必须用 git cat-file + cmd 重定向取字节（PowerShell 管道会把行尾改坏 → 假 DIFF，实测踩过）
cmd /c "git cat-file blob HEAD:host-plugin/lib/index.js > $tmp\git-index.js"
(Get-FileHash $tmp\git-index.js).Hash -eq (Get-FileHash "$tar\package\lib\index.js").Hash
```

**0.2.1 实测结果（commit `2c971ec` vs tarball）**：
| 文件 | 结果 | 字节 |
|---|---|---|
| `lib/index.js` | **MATCH** | 47,575 |
| `lib/client.js` | **MATCH** | 5,260 |
| `package.json` | **MATCH** | 1,806（version 0.2.1） |
| `plugin-selftest.mjs` | 不在包里 ✓（`files` 白名单正确） | — |

⇒ 验过的那份 0.2.1，就是提交里的那份。

### vm1 环境已还原到字节级原始态（收尾核验，2026-10-14）

```
patch sha256        : 4a44960459a9af49e95f34369e394eab4e60a209f4778c4af8647c2e13317019
byte-identical      : YES（与介入前一致）
hash stable 20s     : yes
patch lines         : 138   (original 138)
tool-ask-user       : 0     (original 0)
push-host entries   : 0
pkg dsh-push-host   : 0
plugin installed    : no
baselines left      : 0
newest boot window  : 0 处 dsh-push-host 提及（无悬空 bundle 报错）
service             : 运行中（3080 → 3081）
```

**另一条工具坑（亲身踩到）**：PowerShell 管道取 git blob 会把行尾改成 CRLF → 逐字节比对**假报 DIFF**
（我第一轮就这样误判了一次，改用 `cmd /c "git cat-file blob … > file"` 后全部 MATCH）。
凡「逐字节一致」类断言，一律用 cmd 重定向或 .NET 写文件，禁用 PowerShell 文本 cmdlet。

## 3.8 生产上线工具（2026-10-14 备好，**待用户点头才执行**）

0.2.0 是**手工**上线的，因此打出 P0。0.2.1 起上线走脚本 + 手册，全部步骤「先快照、再执行、后比对」：

| 产物 | 用途 |
|---|---|
| [prod-rollout-plugin.ps1](prod-rollout-plugin.ps1) | 五个模式：`-Check`（只读预检+写快照）/ `-Install`（双备份+校验哈希+装+断言版本）/ `-DispatchRestart`（一次性计划任务重启）/ `-Verify`（与快照逐项比对，全过才 PASS）/ `-Rollback`（还原 patch **与** package.json + 卸插件） |
| [RUNBOOK-plugin-0.2.1-rollout.md](RUNBOOK-plugin-0.2.1-rollout.md) | 上线手册：前置条件、五步操作、验收断言表（含「为何每条都要」）、回滚、边界与残余风险 |

**已经跑过的**（2026-10-14 18:06）：
- `-Check` **exit 0** —— patch `D8F12BC0…` == 期望、当前插件 0.1.1、26 个历史备份、3081 持有者 14860、
  tarball sha `59B0A9D9…` 与定稿一致、patch `timed=2 legacy=0`；快照写入
  `F:\work\work_dsh\tmp\prod-rollout-state.json`（`webLogLines: 306` 作为重启窗口偏移）。
- `-Verify` 冒烟（**故意在未安装未重启状态下跑**）→ **exit 3 / FAIL**，如实报「插件 0.1.1、正向加载标记 0、
  端口持有者未变（= 没真重启）」。**这一步是为了证明验收脚本不会假报 PASS。**

**脚本自身的坑（已修）**：运行中的 DSH 占着 `web.log`，`File.ReadAllLines` 会抛
`being used by another process` → 改用 `FileShare.ReadWrite` 共享读，且读失败只告警不中断验收。

**执行顺序（待用户同意重启）**：`-Install` → 通知用户 token 将换 → `-DispatchRestart`（本轮会话当场断，正常）
→ 重置回来跑 `-Verify`（须 exit 0）→ 取新 token 发用户 + 通知 tester 开跑 P02。

## 3.9 vm1 推送开通：完成并 PASS（2026-10-14 18:2x）

**用户症状**：vm1 上装了插件、任务也跑完，**手机收不到 vm1 的任何推送**。

**根因**（不是没装插件，是**推送子系统被凭据缺失整体关掉**）：
```
[dsh-push-host] relay disabled (set host + hostToken, or DSH_PUSH_HOST_TOKEN): push/answer off
```
实测：`relay disabled` **11 行** / `relay ready` **0 行** / `~/.config/dsh-push/credentials.json` **不存在** /
五个 `DSH_PUSH_*` 环境变量**全未设置**。插件的 `apply()` 照常注册钩子、设置页照常出现，但 `host.start()`
在解析不到凭据时**提前返回** ⇒ 提问推送 / 作答轮询 / 回合结束通知三条链路全不存在。**这是 fail-safe 设计，不是 bug。**

**处置（用户批准方案 A：共用 topic `dsh`）**：

| 步骤 | 命令/结果 |
|---|---|
| relay 开号 | `bash /root/vm1-relay-provision.sh vm1 dsh` → host 表从 `[desktop, test1, testhost, work]` 变 `[desktop, test1, testhost, **vm1**, work]`，`vm1 topic=dsh`；载荷落在 relay `/root/vm1-payload.json`（**600，脚本从不打印令牌**） |
| 写凭据 | `vm1-host-onboard.sh write <payload> --web-base http://<tailnet-vm1>:3080` → `~/.config/dsh-push/credentials.json`（**mode 600**）；`host=vm1 topic=dsh`、`webBase=http://<tailnet-vm1>:3080`、`webName=测试VM1`，四个令牌 len 32/32/51/32 齐全 |
| 重启 | `dsh-net.sh restart`（带 node preflight）→ 自检 3 地址全可用 |
| **验收** | `vm1-host-onboard.sh verify --probe` → **PASS (exit 0)**：日志出现 `credentials file: …` 与 **`relay ready host=vm1 topic=dsh poll=3000ms`**；实推 `POST https://ntfy.cpyh.xyz/dsh → HTTP 200` |
| 收尾 | `cleanup-seed`：删掉我留的 2 个 `.baseline-check` 快照与 seed 注释行（**`tool-ask-user: timed` 保留**，手机作答依赖它）→ patch 145 行 / 1 条 tool-ask-user |

**为什么必须给 vm1 独立 host id（不能抄台式机凭据）**：relay 是**按 host 隔离队列**
（`hosts.json {hostId:{token,topic}}`、`queue.json {hostId:[…]}`），插件只轮询**自己 host 的队列**。
若抄 `host: desktop`，两台插件轮询同一队列 → 台式机（3 s 轮询）**抢走 vm1 的作答项**、又因不认识该 callId 丢掉
→ 手机显示「已答」而 vm1 永远等不到答案。**topic 可以共用**（手机 readToken 按 topic 授权）⇒ 免重新配对。
`vm1-host-onboard.sh write` 内置护栏：host id 为 `desktop` 时**直接拒写**。

**本轮新踩的两个工具坑（都已修，`verify/vm1-host-onboard.sh`）**：
1. **verify 判定窗口取错** → 假 NOT SATISFIED：插件的启动行（`credentials file` / `relay ready`）打在
   该次 `dsh web: http…` 标记**之前**，所以「取最后一个标记之后」什么都看不到。
   修：改用**行号顺序比较**（`credentials`/`relay ready` 的最后行号必须 **晚于**最后一条 `relay disabled`）。
2. **探针 URL 漏了 topic** → HTTP 400：凭据里 `relay` 与 `topic` 是**两个字段**，必须拼成 `"$relay/$topic"`；
   打裸 relay 主机会 400（我因此白跑一轮）。

**另注**：在 vm1 手工跑 `dsh-net.sh status/restart` **必须先 `export PATH=$HOME/.local/bin:$PATH`**，
否则 `/usr/bin/node`（v22.22.1，缺 `stripTypeScriptTypes`）会让命令直接报错；服务本身是好的。
`vm1-host-onboard.sh` 顶部已内置该 PATH。

## 3.10 团队/子智能体换模型：能做什么、不能做什么（2026-10-14 查实）

用户下一个需求是"修改 team 成员的模型"。**结论先说：队友的模型改不了，只能靠"先定 Lead 再 spawn"继承。**
完整手册见 skill **`dsh-team-model-control`**；这里只留交接要点。

| 族 | 工具 | 能否指定模型 | 依据（app.asar 解包，行号） |
|---|---|---|---|
| **Agent Teams 队友** | `spawn_teammate` 等 9 个 | ❌ **不能**：入参只有 `name/description/prompt/context`，**没有 `provider`/`model`**；模型 = **spawn 那一刻 Lead 会话的模型**，之后**无任何工具可改**（没有 set-model / kill-member） | `dsh-experimental-tool-agent-team/lib/index.js:242-266`（参数表）；`dsh-experimental-agent-team/lib/index.js:444-458`、`:698`（模型取自 `root.options.model`） |
| **子智能体** | `subagent` / `subagent_fork` / `workflow` | ✅ 能（`provider`+`model`+`reasoning_effort`） | `dsh-tool-subagent/lib/index.js:412-425`（仅在 `modelSelectionEnabled` 时注入 schema） |

**三条会让下轮踩坑的事实**：
1. **`spawn_teammate` 的 `provider` 不是 LLM 路由**——那是子代理 provider（`spawn`/`fork`），填错会报校验失败（`agent-team:557`、`:1302` 只比对它）。
2. **会话代际钉死**：设置改完，**已存在的会话不会拿到** `provider`/`model` 参数（工具 schema 在会话创建时定死）→ 必须**新开会话**。这正是用户"新开对话"这个动作的价值。
3. **实测继承链证据**：本会话前半段 Lead 跑 `strata-local/qwen3.8-flash-next-abl-iq3_s`，spawn 出的 developer/tester 都是它；后半段 Lead 切到 `odys/Deepseek-V4.1-Flash`，**两个队友没变**。

**授权清单位置**（决定"能选什么"）：`~/.dsh/profiles/web/cordis.patch.yml` 的
`subagent-model-selection-settings.allowedModels`（当前三条：`goopencode/deepseek-v4.1-flash`、
`strata-local/qwen3.8-flash-next-abl-iq3_s`、`odys/Deepseek-V4.1-Flash`）；该字段带 `.volatile()`
⇒ 设置页（**设置 → 插件 → 子智能体**）改的是内存值、热生效，**不写回 yml**；顶部总开关关掉即整条策略失效。
**该策略只管子智能体族，不覆盖 Agent Teams 队友。**

**给下一轮 leader 的建议开场**：新对话里**先把 Lead 模型选成目标档 → 再 spawn 队友**（队友随之继承）；
需要"多模型并行"的活直接用 `workflow` 的 `agent(prompt,{provider,model})`（不受会话代际限制）。

## 3.11 就绪自检纠错（2026-10-14 19:1x，developer task-1 + lead 复核）

本轮"建团队→就绪自检"期间由 developer 发现、**lead 亲自复跑确认**的四条纠错。**这些是旧文档里的错，别再照抄**：

| # | 旧记载（作废） | 实测事实（2026-10-14 19:1x） | 判据 |
|---|---|---|---|
| 1 | selftest 真基线 **82/82** | **`101/101 checks passed`（exit 0）** | lead 亲跑 `& "D:\programs\dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" host-plugin\plugin-selftest.mjs`；旁证 `host-plugin/README.md:267` 原文 + commit `2c971ec` 提交信息（该 commit 补「永不降级」4 条回归后 82→101）。**82 是 0.2.0 之前的数字** |
| 2 | selftest node 路径 = `<DSH 安装目录>\resources\runtime\...` | **`D:\programs\dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`**（`app.asar` **不在**路径上；`resources\` 与 `app.asar` 同级） | developer 实测路径；preflight 守卫未触发（exit 0） |
| 3 | `openspec validate --strict` 这样用 | **裸 `validate --strict` 无效**（`Nothing to validate` + exit 1）→ **必须带目标**：`openspec validate --changes --strict` 或 `openspec validate <change> --type change --strict` | developer 实测；这是**用法**问题，别误判成"环境坏" |
| 4 | vm1 仓可直接拿来跑构建/validate | **vm1 仓是陈旧快照**：`HEAD=92147dd`（2026-10-11），与台式机 `f2fbd20` 差 **54 ahead / 198 behind**，且工作树很脏（30+ modified、50+ untracked）、`host-plugin/` 整个不存在 | developer 实测。**⇒ 在 vm1 跑任何构建/校验前，必须确认它已被 scp 同步**，否则结论不可信（流水线本身每次 scp 覆盖 src，属正常设计） |

**顺带确认的两条好消息**（下轮可直接依赖）：
- **vm1 工具链齐全**：JDK17（`openjdk 17.0.20.1`）在 PATH、SDK `/home/user/android-sdk`（build-tools/platforms/platform-tools/licenses 齐）、
  `android-app/gradlew` 存在可执行、`openspec 1.14.1` 在 `/usr/local/bin`、`~/.local/bin/node` v22.22.3 **带 `stripTypeScriptTypes`**。
- **台式机确实没有** node / openspec / JDK（`Get-Command` 全 not found）⇒ 「本地跑不了 gradlew」属实，构建只能在 vm1。

**仍挂红的既有缺陷（交下一轮，非本轮范围）**：
`openspec validate --changes --strict` → **exit 1**，`dsh-push-web-link-out-of-box` 的 MODIFIED 需求
「提问推送（宿主插件路径）」**漏抄现网 scenario `载荷缺字段`**（现网 spec:48），正撞 AGENTS.md 红线
（MODIFIED 整块替换现网 ⇒ 漏抄=删场景 ⇒ `openspec archive` 会被拒）。引入于 `168cd03`。
**developer 已获授权单文件修复中**，本轮结束前会给出修复后的 strict 输出。
> **🔧 本轮已修复（lead 复核并提交 `c215691`）**：逐字补回 `载荷缺字段`（+5 行、零删改），
> 判据 `tools/openspec-modify-check.mjs` exit 0（2 modified / 0 problem）+ vm1 真 CLI `--changes --strict` **3 passed / 0 failed**。
> **残余**：`openspec validate --all --strict` 仍有 6 项失败，其中 5 项为 **WARNING 级**（Purpose 占位/过短、requirement >500 字符）——**未处理**。

## 3.12 ⚠️ 陷阱：跑 `dsh-app-verify.ps1` **不加 `-Deploy` 也会推用户真机**（2026-10-14 发现并拦截）

**由 developer 在 task-3 只读准备时发现，lead 亲自读源码复核成立。** 这条能直接造成"做个自检却惊动用户手机"的事故。

| 事实 | 判据（行号） |
|---|---|
| **第 3 段 `Stage "publish"` 是无条件发推** | `verify/dsh-app-verify.ps1:319` `Stage "publish"` → `:321` `POST ($ntfy + "/" + $topic)`。**不在任何 `$Deploy` 守卫内** |
| **全文只有一处 `$Deploy` 守卫** | `:398` `if ($Deploy -and (...).Count -eq 0) { ... }` —— 只管**上传 aliyun + 更新通知（第 6 段）**，管不到第 3 段的测试推送 |
| **命令行 `-Topic` / `-Ntfy` 改不动它** | `:54` `if (Test-Path config.local.ps1) { . ... }` 在 param 块（`:29-45`）**之后** dot-source；`config.local.ps1` 自己写「Values here override script param defaults (**but also override same-named command-line args**)」 |
| **现值就是生产 topic** | `verify/config.local.ps1`：`$Topic = "dsh"`（原文注释 *"production mirrors to real phone!"*）、`$Ntfy = "https://ntfy.cpyh.xyz"` |

⇒ **只要跑 `dsh-app-verify.ps1`（哪怕完全不传 `-Deploy`、哪怕传了 `-Topic qa-xxx`），用户真机都会收到一条 `auto-verify <epoch>` 卡片。**

**处置（lead 裁决）**：
1. **凡"不发布"的验证（如本轮 task-3 构建+装机自检）→ 不要调这个脚本**，改走**手工最小三件套**：
   vm1 `gradle assembleDebug` → `scp` APK → 笔电 `adb install -r` + `dumpsys package … | grep versionName` + `am force-stop`。**零 ntfy**。
2. 若要**验脚本本身**，必须先编辑 `verify/config.local.ps1` 把 `$Topic` 临时改成 `qa-…`（**改配置属 tester/lead 范围**），验完**还原**。
3. **别指望命令行覆盖**——已被源码证明无效（param 默认值再好看也会被 config.local 压掉）。
4. **纪律不变**：纯测试推送一律 `qa-` 前缀 + epoch 唯一串、最少条数；生产 topic `dsh` 直连用户真机。

**顺带三条环境事实（developer task-3 只读探测，lead 已核实）**：
- **vm1 `gradle` 不在 PATH**（`which gradle` 空）⇒ 必须显式 `export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH`；
  `JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64`（脚本 `:197` 硬编码此路径，实测在位）。
- **`android-app/local.properties` 已含 `sdk.dir=/home/user/android-sdk`** ⇒ SDK 不必再显式给（与 TEAM-START 旧描述的"需显式给"有出入，**以本行为准**）。
- 手工构建前**必须先按脚本 `:191-194` 的顺序同步 src**（`rm -rf android-app/app/src` → `scp -r app\src` → `scp app\build.gradle.kts` → `scp build.gradle.kts settings.gradle.kts gradle.properties`），
  否则**构建的是 vm1 上的陈旧源码**（vm1 仓本身是陈旧快照，见 §3.11）。

## 3.13 证据纪律：两条"命令成功 ≠ 真的做了活"（2026-10-14 developer task-3 自查自曝）

这两条都是 developer **主动报告自己的证据不合格**，价值高于一个漂亮的 PASS。下轮凡做"构建/校验类"断言，先照这两条自检。

| # | 症状 | 真相 | 纪律（判据） |
|---|---|---|---|
| 1 | **弱证据**：`gradle assembleDebug` 报 `BUILD SUCCESSFUL in 8s`，看着像通过了 | 实为 `35 actionable tasks: 1 executed, 34 up-to-date` ⇒ **近乎 no-op，根本不能证明"现在能构建"** | 改 **`clean assembleDebug`** 重跑（`16 executed`），并用 **APK mtime = 构建时刻** 佐证。**判据：构建/校验类证据必须看「实际执行任务数」或产物 mtime，禁止只看 `BUILD SUCCESSFUL` / exit 0**。注意 `from cache` 是 Gradle 缓存、**不等于没跑**，要区分"缓存命中"与"up-to-date 没执行" |
| 2 | **假 FAIL**：报 `LAPTOP APK HASH MISMATCH`（看着像链路断了） | 文件其实**早已 scp 成功**（10,992,184 B）；是取哈希那步用了**嵌套引号** `ssh host "powershell -Command \"…\""`，被 PowerShell/ssh 引号层绞碎（报 `无法将"\"识别为 cmdlet` + `Cannot find path`） | **跨 ssh 传复杂命令一律 `scp` + `-File`**（把哈希闸门合进笔电侧脚本、用 `-ExpectSha256` 参数）。**嵌套引号是坑，与 `-EncodedCommand` 超长截断同源** |

**放大结论（本仓已累计 4 次工具假判：假 PASS / 假 FAIL 各 2 次）**：
凡"判据报错"，**先怀疑判据本身**，再怀疑被测链路。**空值/异常必须判 BLOCKED，绝不当 PASS。**

**task-3 完整结论**见 `TEAM-READY-2026-10-14.md` §4.7：三段哈希闸门（源码/回传/笔电）全绿、`INSTALL: Success`、
`versionName=1.32.10`/`versionCode=76` 与本文 §3.11 相符、**不发布已做机械证明**（三执行文件检索
`ntfy|curl|Deploy|aliyun|POST|adb root` **零命中**）、设备已复位且**未动 `adb root`**（root 态留给 tester task-4）。

## 3.14 ✅ 自愈真机验证 FIXED：SwiftShader 实例被拉回真 GPU（2026-10-14 20:00，用户批准）

**背景**：F1–F3 加固版部署后，「真出现软渲染实例时自愈能否把它拉回真 GPU」**一直只有干跑（注入）证明**。
用户 2026-10-14 批准执行（"可以做验证"）⇒ **这是该链最后一块实测闭环**。**由 lead 执行**
（`verify/TESTER.md` 明令 tester 不得自己切 GPU 模式/冷启笔电）。

### 结论

> **FIXED**：真的造出一个 **SwiftShader（CPU 软渲染）** 实例后，**生产模式**自愈
> （`schtasks /Run /TN emu-selfheal`，**无参数**）自动完成
> `检出 VIOLATION → kill 整树 → 清 AVD 锁 → rung 1 -gpu host → 拉回真 GPU`（**37s**），
> 选择器写回 `host`，任务 **`LastTaskResult=0x0`**。**全程无需人工干预。**

### 时间线与承重判据（权威 = 客机 `dumpsys SurfaceFlinger` 的 `^GLES:` 行）

| 时刻 | 事件 | 判据 |
|---|---|---|
| 19:59:54 | 前态 | pid `34436`、`-gpu host`、渲染器 **NVIDIA RTX 4060**、选择器 `host` |
| 19:59:54 | **故意降级**（kill 整树 + 选择器 `swiftshader_indirect` + 起 rung） | — |
| 20:00:25 (+31s) | 软渲染实例就绪 | 渲染器 = **`Google (Google Inc.) ... Google SwiftShader, OpenGL ES 3.0 (SwiftShader 4.0.0.1)`**，`-gpu swiftshader_indirect`，pid `28596` |
| 20:00:42 | 自愈判 **VIOLATION** → kill | 日志：`VIOLATION: guest is healthy but NOT rendering on the host GPU` + `killing emulator tree, pids 40744,28596` |
| 20:00:54 | 清锁 → **rung 1 无条件先试** | `rung 1: real GPU (-gpu host) -- attempted unconditionally` |
| 20:01:20 (+24s) | 客机起、**渲染器确认 NVIDIA** | `RESULT: host-GPU ladder OK in 24s (real GPU confirmed by renderer)` |
| 20:02+ | 收尾 | `State=Ready`、**`LastTaskResult=0x0`**、选择器 `host`、`-gpu host`、pid `36308`、`boot_completed=1` |

**这张日志同时把 F1/F2/F3 三条修复全部钉死为实测**：
- **F1**：`interactive console session: False` 却仍 `rung 1 ... attempted unconditionally` ⇒ 旧的假前提岔路确实已移除；
- **F2**：`VIOLATION → correcting → kill` ⇒ 渲染器判据**真在决策**（不是只写日志）；且切换前后两轮均正确判 `already healthy ON THE REAL GPU`（**未误判健康实例**）；
- **F3**：选择器被写回 `host` ⇒ 软渲染没变成持久默认。

### 两条必须如实说明的细节

1. **一个"看起来像失败"的中间读数**：步骤 2 刚跑完立刻读任务状态 = `State=Running`、`LastTaskResult=267009`（`0x41301` = **正在运行**，**不是错误码**）；等收尾后复读 = `Ready` / `0x0`。
   ⇒ **纪律：读 Windows 计划任务结果必须等它离开 `Running`**。
2. **用户禁止的稳态窗口 ≈ 23s**（20:00:19→20:00:42 检出），全程 ~86s。已压到最短；**且验证本身即证明该状态不再需要人工脱离**。

### 复位与设备末态（复核通过）

选择器 **`host`**｜`-gpu host`｜渲染器 **NVIDIA RTX 4060**｜`boot_completed=1`｜pid `36308`（全新实例）｜
`adb forward --list` **空**｜`pidof xyz.cpyh.dshpush` **空**｜自愈任务 `Ready` / `0x0`。

**验证脚本**：`F:\work\work_dsh\tmp\t5-swiftshader-correction.ps1`（纯 ASCII、语法通过；`scp` + `-File` 下发，未用 `-EncodedCommand`）。
**完整报告**：`INFRA-HEALTH-2026-10-14.md` **§9.7**（含时间线、日志原文、两条如实说明、复位表）。

### 2.1 🔎 附带实测（2026-10-14 20:02）：自愈重启模拟器**真的会把 adbd 打回非 root**

验证收尾时读到 **`whoami = shell`**（非 root），而验证**开始前是 `root`**（tester task-4 特意复原）。中间只发生一件事：**自愈 kill 旧模拟器 + 重起新实例**。

⇒ **H-1 的因果链被实测坐实**（此前只有 tester 用 `adb unroot` 人工复现）：
```
自愈重启模拟器 → adbd 掉回非 root (whoami=shell)
              → am start .WebActivity 被拒 (SecurityException, Activity 未导出)
              → QA 脚本若没有 requireRoot() 前置 ⇒ 整轮起页 BLOCKED
```
**关键**：这条路径**自动发生**，不需要任何人工 `adb unroot` —— 只要自愈纠正过一次（如本次验证本身），**下一次 QA 轮就会撞上非 root**。
⇒ **task-4 的 `requireRoot()` 不是保险条款，是必需的**；与 §4.6.1「顺序铁律是承重的」是同一条结论的两半。

> **纪律**：**模拟器被自愈重启后，不要假定 adbd 仍是 root**。判据 `adb shell whoami`（QA 脚本已自带断言，非 root 即报 BLOCKED）。

### 2.2 真机验证的末态复核（清理后）

| 项 | 值 |
|---|---|
| 验证脚本残留 | 已清（`validationScriptGone=True`） |
| 加固版本体 / 备份 | `21C1856B…` / `BE99A7F9…` 均在（deliverables 未损） |
| 选择器 / qemu / 渲染器 | **`host`** / `-gpu host` / **NVIDIA RTX 4060**（pid `36308`，`boot_completed=1`） |
| 几何 | `1440x3168` / density `640`，无 override |
| 设备 | `forward --list` 空、`pidof` 空、`font_scale=1.0`、`airplane=0`、`whoami=shell`（见 §2.1，**非缺陷**） |
| 自愈任务 | `State=Ready`、`LastTaskResult=0`、最近窗口 `VIOLATION=False` |

## 3.15 三个仓库与云端同步状态（2026-10-14 20:1x 核对并推送，下轮照此复核）

| 仓库 | 路径 | 云端 remote | 本地 HEAD | 同步 |
|---|---|---|---|---|
| **dsh-push**（私有主仓） | `F:\work\work_dsh\dsh-push` | `origin` = **gitee** `<user>one/dsh-push` | `6fe6ff2` | ✅ **已对齐**（本次推 `141c2da..6fe6ff2`，**129 个提交**此前一直只在本地） |
| **skills**（技能仓） | `C:\Users\<user>\.dsh\skills` | `origin` = **gitee** `<user>one/cp_learn_dsh_skill_windows` | `4dbf432` | ✅ **已对齐**（推 `ec8bb95..4dbf432`） |
| **dsh-push-public**（开源镜像） | `F:\work\work_dsh\dsh-push-public` | `origin` = **GitHub** `thiscp/dsh-push`；`gitee` = `<user>one/pub-dsh-push` | `db65c51` | ✅ **双远端均已对齐** |

### ⚠️ 陷阱：`dsh-push` 的**上游被设成了 `vm1`**，`git status` 会误报"有 217 个提交没推"

`master` 的 upstream 是 **`vm1/master`**（`user@<tailnet-vm1>:work/projects/dsh-push`），而 vm1 那台仓是**陈旧脏快照**（曾 `HEAD 92147dd`，见 §3.11）。
所以 `git status -sb` 会显示 **`ahead 217, behind 54`** —— **这是对 vm1 的差距，不代表云端落后**。
**判据（别被误导）**：
```powershell
git fetch origin; git log --oneline origin/master..HEAD   # 对 gitee 云端：应为空
```
⇒ **要判断"云端是否落后"，一律比 `origin/master`（gitee），不要比 `vm1/master`。**

**本次实际核对结果**：推之前 `origin/master..HEAD` = **129 个提交**（含本轮建团队/就绪自检全部产物 + 上一轮基础设施加固），
以及 `dsh-push-public` 落后私有仓约 9 小时（`b6e755b` 10:58 → 私有 `6fe6ff2` 20:04）。**均已推送对齐。**

### skills 仓本次提交内容（`4dbf432`）

- **新增两个从未入库的 skill**：**`dsh-push-app-dev`**（本轮大幅更新：GPU 一条命令判据、F1–F3 加固+真机验证、6 条新硬事实）、
  **`dsh-team-model-control`**（队友模型不可改 vs 子智能体可指定）。
- 同步 5 个 skill 的更新：`gpu-mode-switch`（+`REFERENCE-strata-engine-startup.md`）、`dsh-peer-supervision`（+`dsh-restart-resume.{cmd,mjs}`）、`aliyun-relay-ops`、`dsh-push-nightly-watch`。
- **提交前做了 diff 级密钥扫描**：新增 660 行中 `tk_*` / `Bearer` / 私钥 **零命中**（`gitee` 仓无 `export-public` 那样的自动脱敏闸门 ⇒ **提交前必须手扫**）。

### 开源同步纪律（重申）

`dsh-push-public` **不是手改的**，一律由私有仓镜像：`verify\export-public.ps1`（`git archive` 私有 HEAD → 脱敏 map → 密钥闸门 → 镜像 → 推 GitHub+Gitee）。
**改完私有仓要同步开源时**：先 `-DryRun` 自证（脱敏命中数 + 闸门，零副作用），再正式跑。**别手工往 public 里改文件**（下次 `/MIR` 会覆盖）。

## 3.16 ⛔ swiftshader 启动器已全面退役：4 个脚本的默认启动器改成加固自愈（2026-10-14 23:1x）

**触发**：另一会话并行更新了 skill（`gpu-mode-switch` `268998f`/`c2f7663`、`dsh-push-app-dev` `19aa3b2`）——
其中 `19aa3b2` 新增硬事实「⛔ 冷启动禁止用 `dsh-emu-sw`」，并列出受影响文件清单，**点出本仓不止文档、连脚本都在真的用它**。

**已核实（lead 亲自读笔电两个 `.cmd`）**：
| 启动器 | 实际内容 | 判定 |
|---|---|---|
| `dsh-emu-sw` → `G:\Android\run-emu-sw.cmd` | **`-gpu swiftshader_indirect`** | ⛔ **CPU 档，禁用**（用户禁止：风扇噪音；且让 CSS360 几何 + 截图耗时全部作废）|
| `dsh-emu` → `G:\Android\run-emu.cmd` | `-gpu host` | ✅ 真 GPU |

**改动（4 个脚本，全部纯 ASCII + `Parser::ParseFile` 语法通过）**：

| 脚本 | 改动 |
|---|---|
| `verify/dsh-app-verify.ps1` | `$avdCm` → `run-emu.cmd`；`$task` → **`emu-selfheal`**；启动前 `Set-Content emu-ladder.gpu "host"`（把 rung 1 钉在真 GPU）；失败日志改读 `emu-ladder-rung.err`；**头注里那条「`dsh-emu` 在非交互会话会崩（glTexImage2D 0x502）」显式标注为 2026-10-14 已证伪** |
| `verify/bw-iter.ps1` | 同上（task / selector / 注释三处） |
| `verify/card-layout-verify.ps1` | 无设备时不再 `schtasks /Run /TN dsh-emu`，改 **`emu-selfheal` + 先钉 selector `host`** |
| `verify/emu-bootstrap.ps1` | **根因脚本**（它就是当初把 swiftshader 设成默认的那个供给脚本）：默认任务从 `dsh-emu-sw` 改为 **`dsh-emu`（`-gpu host`）**；`run-emu-sw.cmd` 降级为**手动最后手段**并加 `rem` 说明；**仍创建该任务但不再启动它**；创建后把 selector 钉成 `host`；被证伪的 0x502 硬事实改写为测量结论 |

**为什么这条重要**：这是**活雷**——发布流水线 `dsh-app-verify.ps1` 只要遇到"模拟器没起"，就会**自动拉起一个 CPU 软渲染实例**，
既违反用户约束、又让几何基线与耗时基线静默作废（而且 `dsh-emu-sw` 起的实例渲染器不是 NVIDIA，会让 `emu-gpu-verdict.ps1` 报 3）。

**判据**：`Select-String -Path verify\*.ps1 -Pattern 'dsh-emu-sw|run-emu-sw'` 的命中**全部落在注释/禁令说明/最后手段**里，**无一处active 启动**。
**唯一权威启动路径** = `emu-selfheal`（读 selector、rung 1 无条件 `-gpu host`、渲染器非 NVIDIA 即 fail-closed）；人工冷启唯一姿势 = `verify\emu-coldstart-real-gpu.ps1`。

**同批修正**：`verify/TESTER.md` 的 §附录 A 第 2 条原教 tester 用 `schtasks /Run /TN dsh-emu-sw` + `tmp\emu-cold-1440.ps1` 冷启（**已被禁**）→
显式作废并改为 `emu-coldstart-real-gpu.ps1 -Kill`；第 1 条补 **F4 已修事实**（`config.ini` 重复键去重、`hw.gpu.enabled=yes`、
复核判据、`hw.gpu.mode=auto` **故意保留**以免绕过 F3 救援分支）。

**实测笔电现状（同期核对）**：`config.ini` 141 行、`hw.lcd.width|height|density` **各只 1 行** = `1440/3168/640`、
`hw.gpu.enabled=yes`、`hw.gpu.mode=auto`、F4 备份 `config.ini.bak-f4-20261014-203537` 在位；
渲染器 **NVIDIA RTX 4060**、`-gpu host`、selector `host`、自愈哈希 `21C1856B…`（未变）。

**推送**：私有仓 `acdcf04..979a114` → gitee；公开镜像重导 → `2ec9015`（GitHub + Gitee 双远端）。

## 3.17 v1.32.11 浮层可读性：机制裁定 + 两条硬纪律（2026-10-14 23:3x–）

### 3.17.1 机制被实测推翻（**这条最值得记住**）

用户反馈「**选择传文件的控件背景透明度是否太低了点**」= 输入框上方 slash 指令菜单浮层发花。

| | lead 初判 | **实测真相（developer CDP 抓真实 DOM）** |
|---|---|---|
| 机制 | 浮层被压到 `rgba(…,0.45)` | 真实菜单两层表层都是 **`rgba(0,0,0,0)`（全透明）** ⇒ 撞注入里 `alpha<1 -> continue` 闸门**被跳过**，**压根没被注入过**；底色来自**样式表/伪元素** |
| 后果 | "0.45 太透" | **完全没底色**（比 0.45 更糟）|

**真实菜单 DOM**（笔电 `emulator-5554`）：
```
div.Z9Jnlq_viewport [role=listbox][aria-label="Trigger suggestions"]  257x172
    bg=rgba(0,0,0,0)  position:static  z:auto
  外层 div._surface_ri079_1.Z9Jnlq_menu   bg=rgba(0,0,0,0)  position:absolute  z-index:100
  菜单项 button.Z9Jnlq_item [role=option]  251x34
```
⇒ **真实哈希是 `Z9Jnlq_*`，正是"没猜到"的那个** ⇒ 再次证明**不能硬编码 CSS-module 哈希**，
本轮靠 `role=listbox` 直接命中 + 外层几何（`absolute` + `z≥10` + 有可交互子项）兜住。

### 3.17.2 纪律一：合成探针能验逻辑，**不能替代真实元素取证**

developer **第一版修复是错的**：只加了 `else if(isOv) → 0.92`，对"已有非透明背景"的浮层有效，
**对真实菜单完全无效**（它进不了那个分支）。
是 **CDP 抓真实 DOM** 才把它抓出来——若只跑合成探针就交付，这一版会「**验过但没修好**」。
⇒ **凡"改注入/改样式"类修复，验收必须落到真实元素的 computed 值**；合成夹具只用于验逻辑分支。

### 3.17.3 纪律二：`#dsh-theme-veil` 是本类改动的头号雷（**靠两道门槛才没炸**）

`#dsh-theme-veil` 是 `position:fixed; inset:0; z-index:-1` 的全屏纱罩（`rgba(…,0.45)`）。
**改前**它靠 `alpha<1` 被跳过；**改后**幂等闸门改成"只约束非浮层"，它**必须不能**被判成浮层。lead 独立沿新代码逐条走：

| 判定条件 | veil 的结果 |
|---|---|
| `role` ∈ {menu,listbox,dialog,…} | **无 role** ✗ |
| `position: fixed\|absolute` | ✅ 通过 |
| **`z-index ≥ 10`** | **`z-index:-1` ⇒ -1 < 10 ✗ 挡住** |
| **面积 ≤ 90% 视口** | **`inset:0` ⇒ 100% ✗ 挡住** |
| ≥3 个可交互子项 | ✗ |

⇒ 两道门槛任一放宽（或改成"凡 `fixed` 就提亮"），veil 会被提到近不透明 ⇒ **整张壁纸被盖住，症状与 v1.32.6 一模一样**。
**⇒ 这两道门槛是承重的，不是装饰。**

### 3.17.4 本轮验收护栏（历史回归）

| 版本 | 当年的坑 | 必须保住 |
|---|---|---|
| **v1.32.6** | 丢了 `else` ⇒ 大容器先 `transparent` 又被 0.45 覆盖 ⇒ 每层 45% 白叠成 ~91% ⇒ **壁纸整层消失**（真机+模拟器复现；**只看面板截图看不出来**）| 大容器走**互斥** `transparent`；**整页**截图验壁纸 |
| **v1.32.5** | 去毛玻璃后侧栏背后文字透上来混在条目里 | `bwPanelBg()` 展开态 **0.92** 不许破坏 |

### 3.17.5 产物与判据

| 产物 | 内容 |
|---|---|
| [ANALYSIS-v1.32.11-overlay-opacity.md](F:\work\work_dsh\dsh-push\verify\ANALYSIS-v1.32.11-overlay-opacity.md) | 根因档案：§2.0 机制更正、决策树两条闸门、veil 雷区推演、历史护栏、**§7 发布前检查单** |
| [GLASS-OVERLAY.md](F:\work\work_dsh\dsh-push\android-app\GLASS-OVERLAY.md) | developer 写：真实菜单 DOM 表、踩空机制、判定依据、**CDP 输入坑**、验证法 |
| `openspec/changes/app-overlay-opacity/` | proposal + `companion-app` delta（MODIFIED 3 场景逐字保留 + 新增 4 / ADDED 1 需求 3 场景）|
| `verify/testcases/` + `verify/qa-overlay-probe.mjs` | 6 条新用例（**45→51**）+ 执行探针（H-1 纪律内建：root 先于 forward、非 root 报 BLOCKED）|

**版本**：**1.32.11 / versionCode 77**（三处一致）。
**openspec**：`tools\openspec-modify-check.mjs app-overlay-opacity` → `0 problem(s)`，**exit 0**（lead 独立复跑）。
**改后 CDP 值**（developer 实测，待 QA 独立复现）：`menu 0.45→0.92`｜`dialog 0.45→0.92`｜
大容器 `transparent→transparent`｜侧栏收起 `0.45→0.45`｜侧栏展开 `0.92→0.92`｜同页输入卡仍 `0.45`（无误伤）。

**⚠️ CDP 输入坑（2026-10-15 **已更正**，原记载是反的）**：
tester 实测四种策略后确认 —— **`el.focus()`（不点击）+ `Input.insertText` 才成功**；
而"**先 CDP 合成点击**"会把焦点抢到 tab 容器（`activeElement` 落到 `SECTION._tabHost_*`），
之后 `Input.insertText` / `adb shell input text` / `keyevent` **全部插 0 字符**。
⇒ **是"合成点击"这个前置动作坏了，不是 `insertText` 坏**（developer 上轮归因颠倒）。
（原记载写的"insertText 插 0 字符、要用 adb IME"**已作废**。）

## 3.18 v1.32.11 复修：根因是**分支顺序**，不是数值 —— 两条新纪律（2026-10-15 00:1x）

### 3.18.1 事故链（四层，每层都被实测抓出来）——**注意第 ④ 层：alpha 是间歇的**

| 层 | 现象 | 真相 |
|---|---|---|
| ① | 用户报"浮层太透、文字发花" | 真菜单两层表层 **`rgba(0,0,0,0)`**，靠 `alpha<1` 闸门**被跳过、压根没被注入** |
| ② | developer 加 `else if(isOv)→0.92` | **对真菜单无效**（它进不了那个分支）；**CDP 抓真实 DOM** 才暴露「验过但没修好」 |
| ③ | 改成"幂等闸门只约束非浮层"后**仍照旧发花** | **分支顺序反了**：`:392` `if(w>vw*0.5&&h>vh*0.5)→transparent` **无条件排在 `isOv` 之前** |
| ④ | **同一版本、同设备、同一操作，n=2 跑出不同结果** | **alpha 是间歇的**：Run A = **0**、Run B = **0.92** ⇒ 根因是 **`apply()` 与菜单渐进渲染的竞态** |

**④ 的机制**（tester 实测钉死）：`apply()` 跑 **4+ 次**（首跑 / `setTimeout 1500` / `setTimeout 4000` / `MutationObserver` 400ms 去抖），
而菜单是**渐进渲染**的（先矮后高）⇒ **最后一次 `apply()` 读到的高度决定终态**：
`h ≤ 335.5` ⇒ 0.92 ✅；`h > 335.5` ⇒ 落进大容器分支 ⇒ `transparent` ❌。
实测菜单高 **392**，**只超阈值 56.5px**（视口 `360x671` ⇒ 阈值 `180 / 335.5`）⇒ **"掷硬币"**。

**⇒ 两个错误结论都被推翻（含 lead 自己的）**：
- lead 的「0.92 只挡 92%、8% 透射不够」❌ —— 我判读的那张图其实是 **Run A（alpha=0，完全没底色）**；
- tester 上版的「根因＝大容器分支恒赢、alpha 恒为 0」❌ —— **tester 主动推翻了自己**。

### 3.18.2 纪律：**合成用例必须覆盖阈值两侧**（本轮最贵的一课）

developer 的合成浮层 **`257x172`**（`172 < 335.5`，未过阈值）⇒ 正确走 0.92 ⇒ **假 PASS**；
**真实菜单 `257x392`**（>50%）⇒ 落进大容器分支。
> ⇒ 凡"按尺寸/面积做分支"的逻辑，**阈值上下各测一次**（`257x172` 与 `257x392` 是两种命运）。

### 3.18.3 纪律：**间歇性缺陷必须多次采样**（新增，U-6）

Run B 单独看就是"绿"的。**单次采样不能证明修好**。
> ⇒ 凡涉及"渲染时机/竞态"的改动（`apply()`、`MutationObserver`、渐进渲染），**验收必须 ≥5 次采样**，
> 确认**恒为**期望值。`task-9` 已把"≥5 次采样"写为硬要求。

### 3.18.4 复修内容与验收

**修法**（`task-8`，已提交 **`f5e4a6b`**）：
```js
if(isOv && (ovRole || !(w>vw*0.5 && h>vh*0.5))) { …alpha… }   // 浮层先判；ovRole=role 命中者豁免全部几何判定
else if(w>vw*0.5 && h>vh*0.5)                     { …'transparent'… }  // v1.32.6 红线，保留
else if(!skipBg)                                  { …0.45… }
```

**🔴 alpha 目标值 = `0.96`（lead 2026-10-15 00:2x 裁定，见 `ANALYSIS` §6.10）**：
- 原为 `0.92`；但 **0.92 = 8% 透光，实测仍能隐约看到底层聊天正文叠印**，而**用户投诉的正是"太透"**
  ⇒ 提到 **`0.96`**（只留 4% 透光，肉眼不再有可辨识叠印）；**不改成全不透明**（保留玻璃质感，与面板档风格一致）。
- **两处必须同步**：`ovFallback`（深/浅纱）与"有色相"分支，即 `WebActivity.kt` 的 `L357-358` 与 `L407`。
- ⚠️ `L643` 另有一处 `rgba(18,24,40,0.92)` 是**短提示条**（非本浮层）——**不要顺手改**。
- **验收断言按 0.96 写**（不是 0.92）。

**⚠️ 采样必须在冻结 build 上进行**：`task-9`（tester）的核心是「≥5 次采样确认恒定」，而本轮风险正是**间歇性**（n=2 跑出 `0` 与 `0.92`）。
若采样横跨两个 build ⇒ **整轮作废**、可能得出假结论。**强制顺序**：developer 提交+装机+报 **APK sha256** 后**停手** →
lead 把 sha256 转 tester 放行 → tester 在该 sha256 上采样 → lead 复验通过才发布。**发布⛔暂停中。**

**红线（复修后必须复跑，本轮是 PASS 的正确基线）**：
- `QA-P12` 壁纸通道：`BynINW_frame`/`centerCol`/`html`/`body` 仍 `rgba(0,0,0,0)`、**整页**壁纸仍透出；
- `QA-A29` **`#dsh-theme-veil` 仍 0.45**（**tester 实测确认 0.45** ⇒ lead §3 的读码推演获得独立实测支撑 ✅）。

**复修后 developer 的 CDP 实测（0.92 版）**：阈值两侧（TALL `257x392` / SHORT `257x172`）**均 0.92**；
真菜单 `role=listbox` `257x392` → 内联 `!important` 生效；三条红线全绿。
**⛔ 但 developer 拿不到"菜单画在屏上"的整页截图**（DOM 说在、`screencap` 里没有）⇒ 交回 tester 取证链
（tester **拍到了** `qa-P11-slash-menu*.png`）。**lead 已独立肉眼判读复修后证据：判据通过**（`ANALYSIS` §6.9）。

### 3.18.5 祖先链实测：**不是分层问题**（tester 的 `qa-overlay-layers.mjs`，21 层）

tester 额外量了 `background-image` 与 `::before/::after`（**关键**：`background-color:transparent !important`
**不会移除渐变背景**，只读 `backgroundColor` 会整层漏掉）：

| d | 元素 | bg(alpha) | background-image | pos/z |
|---|---|---|---|---|
| **0** | `Z9Jnlq_viewport` **[role=listbox]** | **0.92 ✅ / 0 ❌（两跑不同）** | none | static |
| **1** | `_surface_ri079_1 Z9Jnlq_menu` | **0（两跑都是）** ⚠️ | none | absolute z=100 |
| 4 | `RlGAzG_card`（输入卡） | 0.45（预期，无误伤） | none | relative |
| 10 | `Dc7zOa_composerSeat` | 0 ⚠️ **底色是 `linear-gradient`** | **linear-gradient** | sticky z=9 |
| 16/17/20 | `BynINW_centerCol`/`frame`/`body` | **0 transparent ✅ 红线保住** | none | — |

**结论**：菜单子树**真正上色的只有 2 个元素**（表层 + 唯一高亮项 `rgba(38,49,72,0.06)`）⇒
**不存在"夹在菜单项与面板之间的第三个上色层"** ⇒ **不需要补层**；`Dc7zOa_composerSeat` 是**干扰项**
（不属菜单，但证明"只量 `backgroundColor` 会漏层"这条方法论）。

**⚠️ 复修后仍存的残余（tester 读码预判，`task-9` 要求实测）**：外层 `_surface_ri079_1 Z9Jnlq_menu`
（`265x400`，**无 `role`**）走几何分支 ⇒ **仍会被设成 `transparent`**；因内层比它小 4px，**预计只影响约 2px 外边**。

### 3.18.6 工具发现：CDP 合成点击会**抢走输入焦点**

- ❌ 先 CDP 合成点击 → 再 `Input.insertText`／`adb shell input text`／`keyevent 76`／CDP KeyEvent ⇒ **全插 0 字符**
  （点击后 `document.activeElement` 落到 `SECTION._tabHost_*`）。
- ✅ **`el.focus()`（不点击）+ `Input.insertText("/")`** ⇒ 成功（文本变 `/`、菜单弹出 25 项）。
> 这**推翻了 developer 上轮的归因**（他报"insertText 坏、要用 adb IME"）——**先怀疑判据**再次奏效。
> **同源坑**：`Open sidebar` 的合成点击也被 `_tab_*` 吃掉（上版 P13 记 BLOCKED 是**探针问题、非产品缺陷**，已补测 PASS）。

### 3.18.7 本轮产物（截至 2026-10-15 00:3x）

| 产物 | 内容 |
|---|---|
| [QA-ROUND-v1.32.11.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-v1.32.11.md) | **FAIL(P1)** 定稿 + **alpha 间歇性（n=2）**的关键更正 + 逐条用例 + **U-1…U-6 显式列出** + CDP 焦点发现 |
| [ANALYSIS-v1.32.11-overlay-opacity.md](F:\work\work_dsh\dsh-push\verify\ANALYSIS-v1.32.11-overlay-opacity.md) | §2.0 机制更正、§6.4（**被推翻的推理**，保留过程）、§6.5 根因到一行、**§6.6 间歇性竞态**、§6.7 祖先链、§6.8 残余风险、§7 发布检查单 |
| [GLASS-OVERLAY.md](F:\work\work_dsh\dsh-push\android-app\GLASS-OVERLAY.md) | developer 写：真实 DOM、**§1.6 P1 根因/算术/假 PASS 教训/role 豁免/红线**、CDP 输入坑 |
| `verify/qa-overlay-probe.mjs` / `qa-overlay-layers.mjs` / `qa-overlay-r2.mjs` | 执行探针（H-1 纪律内建）+ **祖先链 21 层分层探针** + **r2 复验探针**（≥5 次采样 + 阈值两侧 + **APK sha 夹逼 bracket**） |
| [QA-ROUND-v1.32.11-r2.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-v1.32.11-r2.md) | **复验报告**：Part A（**0.92 build** = `1D77D75A…`）PASS-with-findings、Part B（**0.96 build** = `cb1a4ce8…`）进行中 |
| [TEAM-START.md](F:\work\work_dsh\dsh-push\verify\TEAM-START.md) | §4「已验证 vs 待下轮确认」已按实测刷新（新增 v1.32.11 三条待确认） |
| `tmp/v13211-STATUS.md` | **lead 续跑状态**（宿主重启后靠它恢复断点；含强制四步顺序） |
| `verify/testcases/` | 6 条新用例（**45→51**）；浮层定位法校准为 **role 优先**；A29 强化"须多次采样" |

**任务链状态**：task-6 ✅ / task-7 ✅(FAIL P1) / task-8 ✅(复修已提交) / **task-9 🔄 复验 r2 进行中**（≥5 次采样 + 阈值两侧 + 复跑红线）。
**发布**：⛔ **暂停**，等 task-9 结论。

### 3.18.8 🔴 纪律：**冻结 build 的哈希必须"夹逼"采样**（本轮新增，血的教训）

本轮连续出现**三种同源事故**，全部是"**验了，但验的不是那个版本**"：

| # | 形态 | 实况 |
|---|---|---|
| 1 | **采样横跨换版** | developer 在 tester 采样期间把 `0.92→0.96` ⇒ lead **叫停采样**，避免整轮作废 |
| 2 | **哈希标签张冠李戴** | tester Part A 采样于 `00:06–00:16`（当时设备是 **0.92**，实测 alpha 全 0.92），但哈希读于 `00:22` 装机**之后** ⇒ 读到 0.96 的 `cb1a4ce8…`，据此误判"现在设备仍是 0.92" |
| 3 | **lead 自己的误判** | lead 见"源码 0.96、APK 哈希与 0.92 版相同" ⇒ 怀疑**构建没生效**（方向错了） |

**#3 的判定法（比看哈希/看命令行都硬）：把 APK 里的 `classes*.dex` 抽出来做字面量比对**：
```bash
unzip -o -q app-debug.apk "classes*.dex" -d /tmp/apkx
strings /tmp/apkx/classes*.dex | grep -c "18,24,40,0.96"   # = 1  ✅ 新值确在字节码里
strings /tmp/apkx/classes*.dex | grep -c "18,24,40,0.92"   # = 1  ← L643 短提示条（非本浮层），符合预期
```
⇒ **`cb1a4ce8…` 就是 0.96 build**，构建没问题。

**两个 build 的正确哈希**（**别再用错**）：

| build | sha256 | 证据 |
|---|---|---|
| **0.92**（`f5e4a6b`） | **`1D77D75A…`** | developer 首版装机报告 |
| **0.96**（`49a0ebd`） | **`cb1a4ce8…`** | ✅ DEX 含 `0.96` / `18,24,40,0.96` |

**⇒ 固化为纪律（写进 skill）**：冻结 build 时，**哈希必须在采样前后各读一次（bracket），且与采样同刻**；
"源码已改"、"命令成功"、"产物存在"**都不等于"设备上跑的是新版本"**。
三者须对齐：**commit 源码 ↔ 构建产物 sha256 ↔ 设备 `pm path` 的 base.apk sha256**。

**另一条本轮新增的采样纪律**：**间歇性缺陷必须 ≥5 次采样**（本轮 `alpha` 曾同版本 n=2 跑出 `0` 与 `0.92`）。
tester Part A 已用 **5 次高菜单 + 2 次矮菜单 = 7/7 恒 0.92** 证明**间歇性已消失**（复修把 `role` 命中者彻底豁免几何判定，竞态不再影响它）。

### 3.18.9 本轮最终状态（2026-10-15 01:0x）——**QA 双段全过，具备放行条件**

| 项 | 状态 |
|---|---|
| **冻结版本** | **`cb1a4ce8…` = 0.96 build**（已在设备上；`android-app/**` 自 `49a0ebd` 起未再改动，`git diff` 为空为证）|
| **Part A**（0.92 build） | ✅ **PASS-with-findings**：**7/7 恒 0.92**、间歇性消失、肉眼判"发花已消除"、A29 红线全绿、U-1/U-2 补齐；**P2-1** = 8% 透光淡影（→ 0.96 解决）；**P12 整页目视 BLOCKED**（并发装机杀 App ⇒ 拍到 launcher）|
| **Part B**（0.96 build） | ✅ **PASS**：**7/7 恒 0.96**（高 `257x392` ×5 + 矮 ×2，阈值两侧）、**哈希 bracket `stable=true`**、**肉眼判"淡影已消除"**、P12 含整页目视**补齐**（并用 `P12_ALIVE` 证明 App 活着）、veil **0.45** 未动、P13/C11/C12 未回退。**无 P0/P1/P2；唯一残留 P3 = 4px rim（决定不动）** |
| **测试期插曲** | 采样中途自愈 **fail-closed** 触发过一次 `VIOLATION`（`renderer: (COULD NOT READ)`）⇒ kill + rung1 重启；**只重启模拟器、未换 build**（重启后 sha 仍 `cb1a4ce8…`）；被中断的 2 个样本**已丢弃**，7/7 来自**一次连续未中断运行**。**这是加固版既定行为，非故障**。 |
| **未覆盖（不影响放行）** | **A29 多浮层共存**（`dialog/alertdialog/tooltip/menu` 该页 `present:false` 唤不出）⇒ 已做成**探针常驻断言**；U-3 命中区几何「未涉及」（未动尺寸）；U-5 整轮全量留体验轮 |
| **发布** | ✅ **已发布（2026-10-15 01:08）**：`SUMMARY: 9/9 passed`、线上 `?v=77` http=200/10,992,560 B、开源双远端 `ba8b455` |

### 3.18.10 本轮新增的 4 条 QA 工具纪律（tester 沉淀，建议下轮沿用）

1. **APK 哈希必须 bracket 读**（采样前后各一次且与采样同刻）—— Part A 错标的直接来源；
2. **`connect()` 需有界重试** —— 冷启后 devtools socket 约 **25s** 才出现，单次 `fetch` 会 `fetch failed`；
3. **自愈 fail-closed 会杀模拟器** —— 采样中途 offline，先查 `emu-ladder.log` 的 `VIOLATION` 行，别当产品故障；
4. **P12 整页目视要断言 App 进程活着**（`P12_ALIVE`）—— 并发 `install -r` 会杀进程、截到 launcher（Part A 的 BLOCKED 教训）。

## 3.19 v1.32.12 文档预览面板透明：**颜色判据陷阱** + 两道新增护栏（2026-10-15 01:2x–）

### 3.19.1 根因（实测钉死，**与 v1.32.11 同源但更隐蔽**）

用户反馈「**对话生成的文档，我打开后背景也是透明的**」= 打开对话生成的文档时，
**文件预览/差异面板整体无实底**，底层页签栏/聊天正文/文档文字**三层层叠**、长文发花。

| 项 | 实测值 |
|---|---|
| 被注入的层 | `SECTION._tabHost_6nhg2_162 _pane…`，**`360x671` = 100%×100%** |
| 算术 | `360>180` ✓ 且 `671>335.5` ✓ ⇒ **落进大容器 `transparent` 分支** |
| computed / 内联 | `rgba(0,0,0,0)`（**alpha=0**）／ `transparent !important` |
| **剥内联看原生** | **`rgb(255,255,255)`、`nativeAlpha=1`** ⇒ **应用自己的不透明纯白阅读底，被注入抹成全透明** |
| 链上其余 13 层 | `background-image` 全 `none`、无伪元素底 ⇒ **本例不涉及渐变底坑**（已按要求两项都量）|

⇒ **首要嫌疑证实（大容器分支吞掉）、次要嫌疑排除（不是 0.45 太薄，本屏 `injected045=0`）。**

### 3.19.2 🔴🔴 **颜色判据陷阱**（本轮最值钱的一条）

同屏 **57 个大容器**做同样的"剥内联看原生"枚举：

| cls | 尺寸 | 内联 | **原生** | 锚点 |
|---|---|---|---|---|
| `BynINW_frame` | 360x671 | `transparent` | **`rgb(255,255,255)`** | ★锚点 |
| `Dc7zOa_root`（聊天根） | 304x671 | `transparent` | **`rgb(255,255,255)`** | |
| `_tabHost_6nhg2_162` | 360x671 | `transparent` | **`rgb(255,255,255)`** | ← **就是 bug** |
| `_block_7gxqk_4`（大代码块） | 331x524 | `transparent` | `rgb(249,250,251)` | |

**`BynINW_frame` 原生也是 `rgb(255,255,255)`，与坏掉的面板一模一样！**
⇒ 任何"**原生不透明 ⇒ 就给回不透明**"的判据**会同时把壁纸通道变不透明** ⇒ 多层白叠 ⇒
**壁纸整层消失 = 直接复现 v1.32.6 事故**。
> **⇒ 铁律：容器该透明还是该有底，只能靠「结构/角色」判据，绝不能靠「原生颜色」。**

### 3.19.3 定型修法（三道护栏，全部实测验证）

```
var big      = (w>vw*0.5 && h>vh*0.5);
var isAnchor = cn.indexOf('BynINW_')>=0 || cn.indexOf('_2H3hWW_root')>=0;   // 护栏2
var isPanel  = 自身 absolute|fixed，或祖先 ≤8 层内有 absolute|fixed 且 ≥90%×90% 视口;  // 护栏1（结构判据）
var isVeil   = (e.id === 'dsh-theme-veil');                                  // 护栏3
var pm       = 原生色相（a0>=1 用 m；否则临时摘内联读原生、读完还原）;

if (isOv && (ovRole || !big))                       -> 浮层 0.96     // v1.32.11，一字不动
else if (big && isPanel && pm && !isAnchor && !isVeil) -> 面板 1.0   // ★ 新增（见 §3.19.4）
else if (big)                                       -> transparent  // ★ 通道仍全透
else if (!skipBg)                                   -> 0.45
```

**判据安全性实测**：`panelFlagged=10`、**`wouldChange = 1`**（恰好且仅有 `_tabHost`）；
`BynINW_frame` / `BynINW_centerCol` / `Dc7zOa_root` 的 `isPanel` **全为 `False`** ⇒ 行为逐字节不变。

**两个非显然但必需的细节**（不改就会失败）：
1. **幂等闸门必须给面板放行**：面板上一轮已被写成 `transparent`（`a0=0`），沿用原闸门
   `if(!isOv && a0<1) continue` 会**直接跳过** ⇒ **一次性固化**，永远修不回来；
2. **必须取"原生"色相**：`m`（computed）已是 `rgba(0,0,0,0)`，拿它当色相会写出**透明色**
   ⇒ 需**临时摘掉内联读原生**（读到 `rgb(255,255,255)`）再还原（`restoreOk=True`）。

### 3.19.4 alpha 最终值 = **`1.0`**（lead 裁定，**从 0.96 升**）

developer 先落地 **0.96**，并**如实报保留意见**（"仍可隐约辨认底层淡影"）。
**lead 亲自 `read_image` 看整页图**确认：面板已是实底、**三层层叠已消失**，
**但空白处仍能辨认底层聊天正文淡字**（`判据 + 一条命令 + 自测夹具 + 事故复盘` 等）
⇒ **触发预先定下的升级规则（"整页肉眼判若有任何可辨识透字 ⇒ 升 1.0"）**。

**升 1.0 的三条理由**：
1. **应用原生就是 `rgb(255,255,255)` 不透明纯白阅读页** ⇒ `1.0` 是**还原原生设计**，
   而 `0.96` 是**我们叠加的近似**；
2. **整页长文阅读面板 ≠ 菜单/浮层**：阅读面板的唯一职责是**长时间舒适阅读**；
   浮层是"短暂浮在内容上、需要一点空间线索" ⇒ **两者诉求不同，不必同档**；
3. **三道护栏与 alpha 取值正交** ⇒ 升 `1.0` **不改变任何安全性质**，红线仍由判据保证。

> **档位表（本轮定型）**：阅读面板 **1.0** ｜ 浮层 **0.96** ｜ 展开态侧栏 **0.92** ｜
> 普通面板/卡片/输入卡 **0.45** ｜ 大容器（壁纸通道）**`transparent`** ｜ veil **0.45**。

### 3.19.5 本轮新踩的两个**探针陷阱**（下轮别再交学费）

1. **`[class*='_tabHost']` 有 6 个匹配**（含 `0x0` 占位）⇒ `querySelector` 会拿到 `0x0` 那个，
   把"**面板其实开着**"误报成"**没打开**"。**必须扫全部匹配取最高**（与 v1.32.5 侧栏同类陷阱）。
2. **截图路径不能当第 3 个 argv 传**：`overlay-run.ps1` 只传 `(outJson, tag)`，第 3 个参数恒空
   ⇒ 截图**被静默跳过**，却得出"截不到图"的错误结论（v1.32.11 已这样误报过一次）。**路径必须硬编码。**

### 3.19.6 已知遗留（**登记，不在本轮修**）

| 项 | 内容 | 处置 |
|---|---|---|
| **聊天里的大代码块** | `_block_7gxqk_4 md-code-block`（`331x524`）**同样被抹成透明**、同样伤可读性，但**不是全屏定位面板** ⇒ 新判据不覆盖它 | **本轮不修**（不夹带扩大改动面）；① 探针加**常驻断言**；② 交接登记；③ **在给用户的汇报里显式点出**，由他决定是否下一轮处理 |
| 4px rim（v1.32.11 遗留） | `_surface_*` 每边外扩 4px，仍 `transparent`，整页不可见 | 保持不动（P3）|

## 3.20 v1.32.13 聊天里的大代码块透明：**危险判据的实测反例** + `innerBig` 判据（2026-10-15 02:2x–）

### 3.20.1 立案与目标

用户在接受 v1.32.12 真机验证后指示「**修吧**」⇒ 修上一轮**登记为已知遗留**的那一项：
**聊天正文里的大代码块 `_block_7gxqk_4` + `md-code-block`**（`331x524`，占视口 `91.8%×78.1%`，
**原生 `rgb(249,250,251)` 不透明浅灰**）。

### 3.20.2 🔴 **推翻 lead 任务书的前提**（本轮第二次"队友实测推翻 lead"）

| lead 任务书写 | **developer 实测** |
|---|---|
| 面板打开时 = **`0.45`** | **`transparent`（`alpha=0`）、内联 `transparent !important`** |

**算术核对**（视口 `360x671` ⇒ 阈值 `180/335.5`）：目标 `331x524` **两者皆过** ⇒ 落 `transparent` 分支 ✅。
**那 8 个 `0.45` 的块**（`233x182/163/125/144`、`331x182/87/296/144`）**高度都 `<335.5`** ⇒ 按设计走 `0.45`。
**lead 已独立核验** `cbr.json`(201 KB)/`cbd.json`(92 KB) **原始数据**，结论一致。

**⇒ 目标存在两种坏态，修法必须都治**：

| 坏态 | 成因 |
|---|---|
| **A. `transparent`（alpha=0）** | 全高时被 `apply()` 处理 ⇒ 落进大容器分支 |
| **B. `0.45` 定格** | **在"还矮"时被 `apply()` 处理过 ⇒ 拿到 `0.45`；之后长高仍被幂等闸门挡住 ⇒ 永久定格** |

> **⇒ 纪律再次生效：先取实测，再谈成因与数值。**（第一次是 v1.32.11 的分支顺序。）

### 3.20.3 🔴🔴 **本轮最值钱的一条：危险判据的实测反例**

**"给它加底"的机制是现成的**（v1.32.12 的 `nativeOpaque` 前置 + 原生色相）——
**缺的是"该不该给"的判据**。developer 验了 4 个候选，**实测 `wouldChange`**：

| 候选判据 | 谓词命中 | **wouldChange** | 安全性 |
|---|---|---|---|
| **`innerBig ≤ 2`** | 2 | **1** | ✅ **安全** |
| `md-code-block` 类名 token | 1 | 1 | ✅ 安全但**依赖类名** |
| `md-*` token | 1 | 1 | ✅ 同上 |
| ❌ **含 `pre`/`code` 后代** | **4** | **2** | **⛔ 危险 —— 打到 `Dc7zOa_root`** |

**为什么"含 `pre`/`code` 后代"是坏判据**：
```
Dc7zOa_root   304x671   native=rgb(255,255,255)   innerBig=41   ← 布局容器/聊天根
              hasPreDesc=True  hasCodeDesc=True   ← 整棵聊天树里含代码块 ⇒ 该判据为真
```
⇒ 它把**布局容器**一起命中 ⇒ `wouldChange` 变 **2** ⇒ **多层白叠 ⇒ 壁纸整层消失 = 直接复现 v1.32.6**。
> **⇒ 铁律：不能靠「含代码语义」（内容特征），要靠「是不是内容叶子」（结构特征）。**

### 3.20.4 lead 裁定（三问全批 + **一处判据收紧**）

**① 判据：只用 `innerBig ≤ 2`，不做"类名 OR"**（**lead 改了 developer 的建议**）：
1. **"OR 类名"是在增加一条脆弱路径** —— 与 developer **自己举的 v1.32.5 教训**（上游改 CSS-module 即失效）同源；
   `innerBig` **完全不依赖类名**，天然免疫改名；
2. **单路径更好验证**：`wouldChange=1` 是**单判据**下的实测结果；OR 后须重测 + 重跑五红线，**而本轮无证据表明需要这种冗余**；
3. **余量充足**：目标 `2` vs 容器 `41/42/70` ⇒ **20 倍余量**（不是"刚好卡住"）；
4. **失败方向应偏"漏修"而非"误修"**：万一将来某内容块 `innerBig>2` ⇒ 结果是**漏修**（用户仍见透），
   **不是误修**（壁纸消失）。**本仓漏修可再开一轮，误修等于复现 v1.32.6** ⇒ **宁可漏，不可误**。
（`md-code-block` 类名只作**探针诊断输出**，**不进分支**。）

**② alpha = `1.0`** ✅：它是**内容**（读者要长时间看代码）；且**应用原生就是不透明** ⇒ **`1.0` 是还原原生**，与 v1.32.12 阅读面板同构。

**③ 那 8 个小代码块（`0.45`）确认不动** ✅：**高度未过阈值 ⇒ 按设计走 `0.45`**，属**正常行为**
（登记为**既定行为**，**不记为遗留缺陷**）。要把它们也变实底需**另一条更宽的判据**，**风险更高、收益无证据**。

### 3.20.5 定型修法（三道护栏一字不动，新增**一条互斥分支**）

```
if (isOv && (ovRole || !big))                        -> 浮层 0.96        （v1.32.11，不动）
else if (big && isPanel && pm)                       -> 阅读面板 1.0     （v1.32.12，不动）
else if (big && !isAnchor && pm && innerBig<=2)      -> 内容块 1.0       ★ 新增
else if (big)                                        -> transparent      （通道，红线不动）
else if (!skipBg)                                    -> 0.45
```
**`innerBig`** = **后代中"自身也超过 50%×50% 视口"的元素个数**（本质："这层里面还套着几层大容器"）。

**两个必做细节**：
1. **放行幂等闸门**（治坏态 B，否则**永远修不回来**）：
   ```js
   if(!isOv && !(big&&isPanel) && !(big && !isAnchor && <能取到原生色相>) && a0<1) continue;
   ```
2. **A/B 两态都要能取到 `pm`**（`transparent` 与 `0.45` **都走"摘内联读原生再还原"**）。

**代价控制**：`innerBig` 与"剥内联读原生"**只在 `big && !isAnchor` 成立时才做**（先廉价后昂贵）。

**实测分离度**（`wouldChange=1`，恰好且仅有目标）：
```
CHANGE: _block_7gxqk_4 md-code-block _card_7gxqk_107  331x524
        inline=transparent  computed=rgba(0,0,0,0)  native=rgb(249,250,251)  innerBig=2
锚点命中 0；BynINW_frame/centerCol/Dc7zOa_root 均不在改动集；关面板态零变化
```

### 3.20.6 五红线（改完必须**实测**，不许只推理）

| 红线 | 为何安全 | 要求 |
|---|---|---|
| **v1.32.6 壁纸通道** | 三容器 `innerBig = 70/42/41` ⇒ 进不了 `≤2`；前两者另有 `isAnchor` 排除 | **实测**四通道仍 `rgba(0,0,0,0)` ＋ **整页**壁纸仍透出 |
| **v1.32.12 阅读面板** | `_tabHost` 已在**前一条** `isPanel` 分支处理，新分支在其后**互斥** | **实测**仍 `1.0` |
| **v1.32.11 浮层** | 浮层分支仍**最前**、`role` 豁免一字不动 | **实测**真菜单仍 `0.96` |
| **veil** | developer 推理"原生是 `transparent` ⇒ `pm=null` ⇒ 落回原分支" | ⚠️ **必须实测确认，不许靠推理** |
| **v1.32.5 侧栏 / 零误伤** | `_2H3hWW_root` 宽 `56<180`、`RlGAzG_card` `h=98<335.5` ⇒ 都不是 big 容器 | **实测**仍 `0.92/0.45`、`0.45` |

### 3.20.7 本轮的元教训（**两条，都可复用**）

1. **"语义特征"≠"结构特征"**：`pre`/`code` 是**语义**（内容里有没有代码），
   而**布局容器会因为"整棵树里含代码"而同样为真** ⇒ **必须用"这一层里还套着几层大容器"（`innerBig`）这种纯结构量**。
2. **判据的失败方向要选"安全侧"**：面对不确定，**宁可漏修（用户仍见透、可再开一轮），不可误修（壁纸消失、复现事故）**。

### 3.20.8 本轮环境注意

- **会话模型变为 `qwen3.8-flash-next-abl-iq3_s`**（本地引擎）；v1.32.11/12 是 `Deepseek-V4.1-Flash`。
  **若队友异常先怀疑引擎** —— `HANDOVER` §5.4.1 记过：`/health` 返回 `ok` **是骗人的**
  （引擎可能"活着但无法服务请求"，prefill 不足 ⇒ 请求挂 300s 到 `idle timeout`）。
- **宿主进程重启过 2 次**（`DshRestartResume` 自动唤醒）⇒ **续跑纪律**：先读进度文件 + 任务板、
  **队友在飞探针在 `tmp/` 是资产**（唤醒时让它先读自己上次的文件）、**lead 已提交的产物不重写只续写**、
  **产物边写边落盘**（重启清环境变量与后台任务，但磁盘不丢）。

### 3.20.9 🔴 本轮**新发现**：`Dc7zOa_root` 存在约 **1.5 秒「不透明白」窗口**（2026-10-15 02:5x）

**数据**（`qa-dcroot-settle.mjs` → `tmp/settle-report.json`，**lead 独立读原始时间线**）：

| 时刻(ms) | `dcRoot.bg` | `alpha` | **`inline`** | `touched` | `transparentCount` |
|---|---|---|---|---|---|
| 2987 / 3498 | `rgb(255,255,255)` | 1 | `rgb(255,255,255)` | 8 | 1 |
| **4191** | `rgba(0,0,0,0)` | **0** | `transparent` | 32 | 8 | ← 探针记的 `settledAtMs` |
| **4712 / 5228 / 5748 / 6265** | `rgb(255,255,255)` | **1** | **`""`（空！）** | 31 | 7 | ⚠️ **内联被抹掉** |
| **6773 / 7288** | `rgba(0,0,0,0)` | 0 | `transparent` | 32 | 8 | ✅ 恢复 |

**`settledRepeats` = 连续 5 次全 `rgba(0,0,0,0)`** ⇒ **最终稳定** ✅；`hashStable=true`；`shellAlive=true`。

**机制判读**：`inline` 由 `transparent` 变成 **`""`（空）** ⇒ **我们的内联被抹掉**，
而 `Dc7zOa_root` **原生就是 `rgb(255,255,255)`** ⇒ 该窗口内**显示为不透明白**。
最可能：**页面 React 重渲染替换了节点**（新节点无我们的内联）⇒ `MutationObserver`（去抖 400ms）**重新注入**。

**lead 裁定：不阻塞本轮发布，但必须登记 + 量化**：
1. **不阻塞**：最终态正确（5/5）；窗口在**页面加载初期**；**用户原始投诉已解决且 5/5 恒定**；
2. **强证据"非本轮引入"**：本轮改动**未触碰 `Dc7zOa_root` 任何分支**（`innerBig` 只对新分支生效，
   而 `dcRoot` 的 **`innerBig=41` 进不了 `≤2`**）⇒ 该窗口是**注入时序的固有性质**；
3. **要求 tester 量化**：窗口**是否用户可感知**、**持续多久**、**是否只在首次加载**；
   **并做对照**（关闭新判据 vs 开启，`dcRoot` 时间线是否一致）⇒ 若一致 ⇒ **既有遗留（非本轮回归）**。
4. **已登记进跨轮未决**（§4）。

### 3.20.10 本轮固化的 4 条可复用纪律（**都在 README/TESTER 里落地**）

1. **语义特征 ≠ 结构特征**（§3.20.3）：判据只能用「结构量」（`innerBig`），
   不能用「含 `pre`/`code`」这类**语义特征**（布局容器会因"整棵树含代码"而为真）。
2. **判据失败方向要选安全侧**：**宁可漏修**（可再开一轮），**不可误修**（复现 v1.32.6）。
3. **测"注入后的样式"必须锁定"注入 settle 之后"**：判据是 **`inline` 已被写入**（`inline=""` = 注入未生效）；
   ⇒ 报告"某元素值"时**必须同时报 `inline`**。
4. **"settle"≠"读到一个正确值"**：必须**连续采样确认稳定**（`settledRepeats` 是好做法）。

### 3.20.11 openspec 归档顺序风险（**登记，非本轮阻塞**）

三个 change **都未 `archive`**：`app-overlay-opacity`(11 场景) / `app-doc-panel-opacity`(14) / **本轮(17)**。
**`archive` 是用 delta 覆盖主 spec** ⇒ **归档顺序不对会静默挤掉先归档者的新增场景**
（与两次 `载荷缺字段` 事故同源）。
⇒ **归档必须由旧到新**；或每轮 delta **携带全部 pending 前序场景**（本轮未携带 v1.32.12 的 3 条）。

### 3.20.12 v1.32.13 QA 结论（**PASS-with-findings**，2026-10-15 02:57）

**报告**：[QA-ROUND-v1.32.13.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-v1.32.13.md)（25,439 B）

| 用例 | 断言 | 实测 | 结论 |
|---|---|---|---|
| **QA-C14** 大代码块 alpha | = 1.0（保留原生色相） | **1（5/5）**、`rgb(249,250,251)`、inline `important`、native `restoreOk=True` | ✅ PASS |
| **QA-C14b** 整页肉眼判"代码不再透底" | 无透字 | 行内 code 块**浅灰实底、文字锐利**、底层正文不可见 | ✅ PASS（**主判据**）|
| **QA-C15** 9 个矮块保持 0.45 | 全 0.45 | **9/9 = 0.45**（高度 87–296 全 `<335.5`）| ✅ PASS |
| **QA-A31** 多代码块 + 阈值两侧（**新对抗**） | 大块 1 / 矮块 0.45 | `bigAlphas=[1]`、`smallAlphas=[0.45]`（1+9）| ✅ PASS |
| **QA-A32** 注入 vs 重渲染竞态（**新对抗**） | 无瞬时露白 | **命中 ≈2s 原生白窗口**（截图实锤）| ⚠️ **P2 FINDING-1** |
| 五红线（`QA-P12`/`QA-C13`/`QA-P11`/`QA-A29`/`QA-P13`）| — | 全绿（**veil 0.45** 10+ 次读数、实测量非推理；`_tabHost` 1.0；真菜单 0.96；card 0.45；侧栏 0.92/0.45）| ✅ PASS |

**版本指纹**：`hashStable = true`（4 个探针各自前后两次读，全部 == **`43f2f64e…`**）✅
**未覆盖**：U-1（静止纯聊天 + 大块同屏组合）、U-2（`table`/`blockquote` 仍 transparent，本轮范围外）、
U-3（代码块横滚"无需滚"）、U-4（命中区几何"未涉及"）、U-5（整轮全量）。

### 3.20.13 🔴 FINDING-1 [P2]：`Dc7zOa_root` 瞬时"原生白"窗口 —— **lead 已开 task-14 追查**

**现象**：`Dc7zOa_root`（聊天根，`304x671`，**原生 `rgb(255,255,255)`**）存在 **≈2s 瞬时白窗口**
（`inline` 被 React 换节点抹掉 ⇒ 显示原生白 ⇒ **壁纸被盖**），有**截图实锤**
（`qa-C14-dcroot-nativewhite-1.png`，341,694 B），之后 `MutationObserver`（去抖 400ms）**自愈**。
**settle 后 5/5 恒为 `rgba(0,0,0,0)`** ⇒ **不是持久性 v1.32.6 回归**。

**lead 的疑点（**task-14 的唯一动因**）**：tester 时间线 `t=2987ms` 的 `Dc7zOa_root.inline = rgb(255,255,255)`
（**带值、非空**）—— 若那是**页面自带内联** ⇒ 注入未及 ⇒ 与本轮无关；
**若是我们写的白** ⇒ **`isCB` 曾命中过 `Dc7zOa_root`** ⇒ **属本轮引入**。

**为什么可能命中**：`innerBig` 是**运行时测量**（后代中 `>50%×50%` 视口的元素数）。
**首屏 / 局部渲染 / 流式生成中后代还没撑开 ⇒ `innerBig` 可能临时 ≤2** ⇒ `isCB` 命中聊天根
⇒ 按 `pm = 原生 rgb(255,255,255)` **写出不透明白** ⇒ **盖住壁纸**。**只有本轮的 `isCB` 分支能写出白**
（`isPanel` 不命中它）。⇒ **不能排除"本轮引入"**。

**⇒ 处置**：**发布暂停**；已开 **task-14**（三项判据：`innerBig` 时间演化 / `isCB` 是否命中过 /
**决定性对照实验**：临时关掉 `isCB` 看白色窗口是否消失）。
**无论对照结果如何，都要做这道防御**（遵"宁可漏修、不可误修"）：
**给 `isCB` 加显式排除 —— `Dc7zOa_root` / `BynINW_*` / `_2H3hWW_root` 一律不得进 `isCB`**
（代价极小：内容块不会是聊天根 ⇒ `wouldChange` 仍应是那 1 个代码块）。

### 3.20.14 本轮新对抗的两个用例（**已沉淀**）

- **`QA-A31` 多代码块同屏 + 阈值两侧分流**：同屏 **10 个** `md-code-block`，只有 1 个过阈值。
  抓的是"**判据会不会一刀切**"（把 9 个矮块一起提亮 / 或漏掉那 1 个大块）⇒ 实测**精确分流**。
- **`QA-A32` 注入 vs 重渲染竞态**（**抓到真缺陷**）：注入是**一次性写内联**，而页面是 **React 应用会换节点**
  ⇒ 新节点不带内联 ⇒ 在下次 `apply()` 前显示**原生色**；若原生不透明（`Dc7zOa_root`）⇒ **该窗口盖住壁纸**。
  **这是"注入类改动"的通用风险，本库此前无用例** ⇒ 已沉淀。

### 3.20.15 v1.32.14：FINDING-1 追查闭合 + **lead 直接接手落地**（2026-10-15 03:0x）

#### 追查结论：**FINDING-1 属本轮引入**（我先前的判断被推翻，如实记录）

| 我的先前说法 | 实测/裁定 |
|---|---|
| "与 `isCB` 无关，属注入时序的固有性质" | ❌ **被推翻**。**只有本轮的 `isCB` 分支能写出白**（`isPanel` 不命中 `Dc7zOa_root`） |
| 依据："panel-open 实测 `innerBig=41`，进不了 `≤2`" | ⚠️ **只覆盖稳定态**；该判据是**运行时量**，**过渡态会失真** |

**根因闭合**：`isCB` 依赖 `innerBig`（后代中 `>50%×50%` 视口的元素数）——
**首屏 / 局部重渲染 / 流式生成中后代尚未撑开 ⇒ `innerBig` 临时 ≤2** ⇒ 命中 `Dc7zOa_root`
（**原生 `rgb(255,255,255)`**）⇒ 按 `pm` 写出 `rgb(255,255,255)` ⇒
**聊天根在 84%×100% 面积上变不透明白 ≈2s** ⇒ **壁纸被盖** ⇒ `MutationObserver` 自愈。
**与 tester 观察到的两个相位完全吻合**（`t=2987ms` `inline=rgb(255,255,255)`＝**注入写的白**；
`t=4712ms` `inline=''`＝**React 换节点抹掉内联** ⇒ 显示**原生**白）。
> **⇒ tester 的 §7.3 判读（"注入自己把它写成了不透明白"）成立。**
> **⇒ 我先前据此断言"非本轮引入"是错的** —— 又一次"**先取实测、再下结论**"的教训。

#### 落地（`083de4f`，**developer 引擎侧连续失败 ⇒ lead 直接接手**）

`task-14` 派给 developer 后其子会话**连续 3 次失败**（`failed before it finished`，引擎侧）。
**因该任务是阻塞发布的唯一项、且我已预先裁定"无论对照实验结果如何都要加这道防御"** ⇒ **lead 直接落地**。

```js
"var isAnchor=cn.indexOf('BynINW_')>=0||" +
"cn.indexOf('_2H3hWW_root')>=0||" +
"cn.indexOf('Dc7zOa_root')>=0;" +        // ★ v1.32.14 新增
```
**一处改动同时封住两条路径**（`isAnchor` 是「取原生色相回写」与 `isCB` 的**共用闸门**）。
**版本三处 → `1.32.14` / code `80`**；openspec 增补场景 `布局容器 MUST NOT 被写入不透明底（v1.32.14 追补）`；
检查器 **exit 0**（3 baseline kept, 15 in delta；delta 共 **18** 场景）。

#### 构建 / 装机 / 冻结（**四方对齐 + DEX 校验**）

| 来源 | sha256 |
|---|---|
| vm1 构建产物（`clean assembleDebug`，**`23 executed`** = 真构建） | **`2850a0d3…`** |
| 台式机回传（独立复算） | **`2850A0D3…`** MATCH |
| 笔电 `G:\Android\dsh-push.apk`（`10,993,088 B`，笔电本地复算） | **`2850A0D3…`** |
| 设备 `pm path` → `sha256sum base.apk` | **`2850a0d3…`** |

**DEX**：`Dc7zOa_root`=1（**新增排除确在字节码**）/ `isAnchor`=1 / `innerBig`=1 / `isCB`=1 / `BynINW_`=2 / veil=1。
**装机**：`adb root` → `whoami=root` → `install -r` = **`Success`** → `dumpsys` = **`1.32.14 / 80`** ✅

#### 待验（**task-15**，已放行 tester）

① **★ FINDING-1 复测**（`qa-dcroot-transient.mjs` ≥3 轮）⇒ **白色窗口是否消失**（**唯一判据**）；
② `wouldChange` 复跑 ⇒ **期望仍 = 1**；③ 大块仍 `1.0` / 矮块仍 `0.45` / `_tabHost` `1.0` / 五红线；
④ 整页截图确认壁纸透出；⑤ 哈希夹逼 + ≥5 次采样。
**⇒ ① 通过之前，发布继续暂停。**

### 3.20.16 本轮固化的 **5+1 条可复用纪律**（README / TESTER / skill 三处均已落地）

1. **语义特征 ≠ 结构特征**（§3.20.3）：判据用「结构量」（`innerBig`），**禁用**"含 `pre`/`code`"类语义特征。
2. **判据失败方向选安全侧**：**宁可漏修**（可再开一轮），**不可误修**（复现 v1.32.6）。
3. **测"注入后的样式"必须锁定 settle 之后**：判据是 **`inline` 已被写入**；`inline=''` = 注入未生效。
4. **"settle" ≠ "读到正确值"**：必须**连续采样确认稳定**（`settledRepeats` 连续 5 次）。
5. **「稳定态测量」≠「动态态安全」**（§3.20.15）：**阈值余量不构成保护**；
   凡判据依赖**运行时测量值**，必须另测**过渡态**，并对关键容器**加显式排除**。
6. **注入 vs 框架换节点**：注入**一次性写内联**，而 React **换节点会抹掉内联** ⇒
   **过渡期缺陷只在过渡期可见**（`QA-A32` 就是这么抓到的）。

### 3.20.17 🔧 本轮基础设施事件：**模拟器进程消失 + 恢复 SOP**（2026-10-15 03:06–03:11）

| 时刻 | 事件 |
|---|---|
| `03:06:50` | 自愈日志记 `already healthy ON THE REAL GPU (boot_completed=1) -> nothing to do` ＋ `=== emu-selfheal end ===` |
| `03:0x`（随后） | **模拟器进程消失**：`adb devices` 空、笔电 `qemu*` 计数 **`0`**、选择器仍 `host` |
| `03:11:10` | 下发并执行**真 GPU 冷启** ⇒ `rung 1 host-gpu` ⇒ `boot_completed=1 after 24s` ⇒ **`RESULT: host-GPU ladder OK in 24s`** |
| `03:11:36` | **`VERDICT: PASS - real GPU, booted, geometry asserted`**（`qemu pid=32804 -gpu host`）|
| `03:12` | **实测设备已装 `1.32.14` / code `80`、`base.apk sha256 = 2850a0d3…`（= 冻结值）** ⇒ **无需重装** |

**判据（三件同时成立 ⇒ "不是自愈杀掉的，是进程自己没了"）**：
① `adb devices` 空；② 笔电 `qemu*` 计数 `0`；③ `emu-ladder.gpu` 仍 `host` ＋ 自愈日志尾部是
`already healthy ON THE REAL GPU -> nothing to do`（**自愈 kill 会记 `VIOLATION`**）。

**恢复 SOP（三步，⛔ 不能在台式机跑 —— `G:\Android` 只在笔电存在）**：
1. `scp verify\emu-coldstart-real-gpu.ps1 user@<tailnet-laptop>:G:/Android/`
2. `ssh … "powershell -NoProfile -ExecutionPolicy Bypass -File G:\Android\emu-coldstart-real-gpu.ps1 -Kill"`
3. **判据 = 脚本自己打印 `VERDICT: PASS - real GPU, booted, geometry asserted`**
   （脚本内已断言 `-gpu host` ＋ 渲染器含 **NVIDIA** ＋ `1440x3168@640`）⇒ **fail-closed，可放心信**。

**⚠️ 硬事实**：
- 脚本**依赖 `G:\Android\emu-selfheal.cmd`**（"self-heal ladder 是权威启动器"）⇒ **缺失即 fail-closed**
  （在台式机跑会先报 `DirectoryNotFoundException: G:\Android\emu-ladder.gpu`，**那是"跑错机器"的信号**）；
- **⛔ 禁用 `dsh-emu-sw`**（硬编码 swiftshader = **CPU 档**，**用户明令禁止 CPU 渲染**，风扇噪音）；
- **模拟器重启不会卸载 App** ⇒ 本轮实测已装版本与 `base.apk sha256` **均未变** ⇒ **无需重装**（省一轮装机）；
- **已沉淀进 skill** `dsh-push-app-dev`（§2 硬事实表新增一行，commit `eddc1cc`，已推送）。

### 3.20.18 ✅ v1.32.14 QA 结论：**PASS**（FINDING-1 已修，2026-10-15 03:15）

**报告**：[QA-ROUND-v1.32.14.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-v1.32.14.md)（15,374 B）

| 用例 | 断言 | 实测 | 结论 |
|---|---|---|---|
| **QA-A32 复验**（**FINDING-1**）| 白色窗口消失（命中 0）| **0 / 0 / 0（3 轮）**；**改前 = 2 次/轮**（**阳性对照**）| ✅ **PASS** |
| **QA-C16**（**新**）`wouldChange` | 面板分支未被削弱 | **2** = `_tabHost`(1.0) **+ 大代码块**(1.0)（**均正当**）；四锚点全 `rgba(0,0,0,0)` | ✅ PASS |
| QA-C14 大代码块 | `1.0` | **1（5/5）**、`rgb(249,250,251)` | ✅ PASS |
| QA-C15 矮块 9 个 | `0.45` | **`0.45`（9/9）** | ✅ PASS |
| QA-P12 壁纸通道 | 四通道 0 + 壁纸透出 | 全 `rgba(0,0,0,0)`（开/关两态）＋ 整页图透出 | ✅ PASS |
| QA-C13 `_tabHost` | `1.0` | **1** | ✅ PASS |
| QA-P11 浮层 / QA-A29 | `0.96` / veil `0.45` / card `0.45` | **0.96**（25 项）/**veil 实测 0.45**/**card 0.45** | ✅ PASS |
| QA-P13 侧栏 | `0.92`/`0.45` | **`0.92`/`0.45`** | ✅ PASS |
| 版本指纹 | 哈希夹逼 + ≥5 采样 | **8 次读数全同值**、`hashStable=true`、5 轮 | ✅ PASS |

**最终判定 `PASS`**，**无 P0/P1/P2**（上一轮的 P2 已消除）。

#### ✅ **FINDING-1 关闭的关键证据（两条，缺一不可）**

1. **零命中 + 阳性对照**：同探针 `qa-dcroot-transient.mjs`（220 次轮询 120ms + 滚动扰动）
   **改前 2 次/轮 → 改后 3 轮全 0** ⇒ **"0 次"是可判读结论，不是探针失灵**；
2. **settle 时间线不再有"注入写的白"**：v1.32.13 `t=2987ms` 读到 **`inline=rgb(255,255,255)`（带值）**；
   v1.32.14 `t=3147ms` 读到 **`inline=''`（空）** ⇒ **原生态、非我们所写**；
   此后 `SETTLED_REPEATS [0,0,0,0,0]` 连续 5 次透明。

#### ⚠️ tester 对 lead 的一处**如实更正**（**正确，我采纳**）

lead 在 task-15 写"`wouldChange` 期望仍 = **1**"；**实测 = 2**（面板打开态）。
**差异解释**：多出的那 1 个是 **`_block_7gxqk_4` 大代码块** ——
它是 **v1.32.13 已批准的正当修复**（`QA-C14`），**不是新增误伤** ⇒ **"面板那一条"仍是 1**。
**⇒ 结论不变（PASS），但我的期望值写错了**；已在本文件与 `task-15` 记录更正。

#### 未覆盖（如实登记，**下轮不得当已验**）

`U-1` 静止纯聊天 + 大块同屏的逐帧锁定｜`U-2` `table`/`blockquote` 仍 `transparent`（范围外）｜
`U-3` 代码块横向滚动（只测到"无需横滚"）｜`U-4` 命中区几何（本轮未动尺寸 ⇒ 未涉及）｜
`U-5` 整轮全量（留体验轮）｜**`U-6` 设备在 `03:06:50` 后消失（无 `VIOLATION` 行）** ⇒
已由 lead 冷启恢复、**sha/版本未变、全部探针重跑**，**不影响本轮结论**，但**根因未查明**（建议留意是否复现）。

### 3.20.19 发布（2026-10-15 03:1x）

`verify\dsh-app-verify.ps1 -Deploy -DeployNote "v1.32.14 聊天大代码块透明修复 + 布局容器显式排除(修 FINDING-1 瞬时露白)"`
⇒ **结果待回填**（期望 `SUMMARY: 9/9`）。

### 3.20.19 ✅ 发布完成：**`SUMMARY: 9/9 passed`**（2026-10-15 03:16–03:17）

```
verify\dsh-app-verify.ps1 -Deploy -DeployNote "v1.32.14 聊天大代码块透明修复 + 布局容器显式排除(修 FINDING-1 瞬时露白)"
LOG:   C:\Temp\dsh-verify\verify-20261015-031646.log
SUMMARY: 9/9 passed
```
| 步骤 | 结果 |
|---|---|
| `build-vm1` | ✅ `apk 10993088 bytes`（`10s`）|
| `fetch-apk` / `push-apk` / `drive` | ✅ |
| `emulator-up` | ✅ `serial=emulator-5554 api=36` |
| `install` | ✅ `Performing Streamed Install \| Success` |
| `push-received` / `mid-unique` / `entry-unread` | ✅ `PUSH_HTTP=200 BODY=auto-verify …`、`distinct mids: 465906295` |
| `screenshot` | ✅ `C:\Temp\dsh-verify\verify-031701.png` |
| **`deploy`** | ✅ `https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=80` |
| `update-notify` | ✅ `id: qgCcmpuMrvKX` |

#### ✅ 线上产物核验（lead 独立实测）

| 项 | 值 |
|---|---|
| `curl ?v=80` | **`http=200 size=10,993,088`** |
| **线上 sha256** | **`2850A0D3D345C7619DB9394993232147380E092356CF979C11159C5FF96F5B9D`** |
| 冻结 sha256 | 同值 ⇒ **逐字节一致** ✅ |

**⇒ v1.32.14 已上线。** 用户原始投诉（聊天里的大代码块透明、代码文字透出底层正文）**已修复**；
且**上一轮上线前抓到的 FINDING-1（瞬时露白）已在本版一并修掉**（不是带病发布）。

### 3.20.20 本轮闭环总结（v1.32.12 → v1.32.14）

| 轮 | 问题 | 结果 |
|---|---|---|
| v1.32.12 | 文档预览面板透明 | ✅ 已发布，用户回执**「已经安装最新版，验证通过」** |
| v1.32.13 | **聊天里的大代码块透明**（用户「修吧」）| QA **PASS-with-findings**，抓出 **FINDING-1[P2]** |
| **v1.32.14** | **修 FINDING-1**（布局容器被瞬时写成不透明白 ⇒ 盖住壁纸）| ✅ **QA PASS + 发布 `9/9` + 线上哈希一致** |

**⇒ 全程没有把已知缺陷带进发布版**：v1.32.13 的 QA 抓到 P2 ⇒ **lead 追查确认属本轮引入** ⇒
**当轮修掉、复验通过后才发布**（v1.32.14）。**这正是"QA 前置 + 不放过 P2"的价值实证。**

**⏭ 下轮第一件事**：
1. **等用户真机回执**（`?v=80` 已上线，更新通知 `id: qgCcmpuMrvKX`）；
2. **开源镜像同步**：`verify\export-public.ps1 -Msg "…"`（**在所有文档提交后做**）；
3. **若用户报告壁纸偶发消失** ⇒ 优先查 **`U-6`**（设备曾无故消失）+ **注入 vs 重渲染竞态**的其它层
   （`QA-A32` 已是常驻用例；本轮只修了 `Dc7zOa_root`，**其它原生不透明的容器是否同类风险未逐一验证**）。

### 3.20.21 🔴 开源同步时发现**真实 IP 泄漏**（既有事故，本轮已修 + 加固）— 2026-10-15 03:2x

#### 事故

本轮 `export-public.ps1` 同步后，我用**全文件扫描**（不限扩展名）复查公开镜像，发现：

```
dsh-push-public: verify/vm1-dshnet-check.sh:37: PUBLIC_HOST="<tailnet-vm1>"
```

**⇒ 真实的 vm1 内网 IP 泄漏到了公开仓库**（GitHub `thiscp/dsh-push` + Gitee `<user>one/pub-dsh-push`）。
**起始点**：`db65c51`（"sync from private: emulator GPU verdict gate + …"）⇒ **已泄漏多个版本**，
非本轮引入（`0f1ce6b` 上也存在）。

#### 根因（**静默失效**，两层都漏）

`export-public.ps1` 的清洗与闸门**都用扩展名白名单**：
```powershell
$exts = "*.md","*.ps1","*.py","*.mjs","*.json","*.conf","*.service","*.txt","*.kt","*.xml"
```
**`.sh` 不在白名单里** ⇒ **清洗跳过它**、**闸门也跳过它** ⇒
**闸门照样打印 `exported to GitHub + Gitee public`、退出码 0**（**看起来一切正常**）。

> **⇒ 这是本仓"命令成功 ≠ 真的做了活"的又一实例**：
> **安全闸门的"通过"必须建立在"覆盖面正确"之上** —— 覆盖面错了，闸门越"成功"越危险。

#### 修法（`fde4464`，判据从白名单改为**二进制黑名单**）

1. **扫描对象 = 所有非二进制文本文件**（`$binExt` 黑名单：`png/jpg/jpeg/gif/webp/ico/bmp/apk/jar/
   keystore/jks/so/dex/zip/gz/tgz/tar/7z/pdf/woff*/ttf/otf/mp3/mp4/wav/exe/dll/bin/pyc/class`）⇒
   **不再可能"漏掉没人想起的扩展名"**；
2. **闸门扫"与清洗完全同一批文件"**（原闸门比清洗更窄 —— **这正是 `.sh` 漏网的原因**）；
3. **闸门补上 `<lan-laptop>` / `<vm-lan>` / `<vm-lan>`**（原先只挡 `<lan-laptop>`，
   而 `$map` 里三条 LAN 值**本来就在清洗表里却没有对应闸门项** ⇒ 同样是"闸门窄于清洗"）；
4. **打印覆盖面**：`scrub/gate scope: 339 text file(s) (binary denylist: 31 ext)` ⇒ **可人工确认**。

#### 验证（三步，全部 lead 独立执行）

| 步骤 | 结果 |
|---|---|
| `-DryRun` 自证 | ✅ 通过：`<tailnet-vm1> x24` / `<tailnet-laptop> x39` / `<tailnet-windows> x30` / `<tailnet-work> x7` / `<tailnet-relay> x2` / 三条 LAN 值 全被替换；闸门通过；**未触碰公开目录、未推送** |
| 重跑同步 | ✅ `scrub/gate scope: 339 text file(s)`；提交 `219caf8`；`exported to GitHub + Gitee public` |
| **公开镜像全文件扫描** | ✅ **命中 `0`**（不限扩展名、全 `git ls-files`）；`vm1-dshnet-check.sh:37` 现为 `PUBLIC_HOST="<tailnet-vm1>"` |
| 远端落地 | ✅ `local == origin/master == gitee/master == 219caf8`，`dirty=0` |

#### 固化的纪律（**已写进 README + skill**）

1. **脱敏覆盖面 MUST NOT 用扩展名白名单** —— 一定会漏掉"没人想起要加"的扩展名；
   用**二进制黑名单**（默认扫一切文本）；
2. **安全闸门的扫描集 MUST 等于（或宽于）清洗集** —— **闸门比清洗窄 = 静默失效**；
3. **每次同步后 MUST 独立复查一次公开镜像**（**别只信脚本自己打印的 `exported`**）——
   本轮就是这样抓到已存在多个版本的泄漏；
4. **同步前先 `-DryRun` 自证**（它打印替换计数且不推送）。

### 3.20.22 收官状态（2026-10-15 03:2x）

| 项 | 值 |
|---|---|
| 私有仓 | **`dbdbde9`**（工作树干净，已推送 origin/master） |
| **公开镜像（最终）** | GitHub `thiscp/dsh-push` + Gitee `<user>one/pub-dsh-push` **均已落地**、**工作树干净**｜**判据（不随每次 export 变化的那个）：对公开仓 `git ls-files` 的「全部文件」跑个人值正则 ⇒ `0` 命中** ✅｜`versionName=1.32.14` / `versionCode=80`｜⚠️ **该仓 commit 哈希每次 `export-public.ps1` 都会推进**（本文件自身也被同步过去），**所以别在此处钉哈希，钉"0 命中 + dirty=0"这两个不变量** |
| 线上 APK | `https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=80`、**`http=200`、`size=10,993,088`、`sha256 = 2850A0D3…`（= 冻结值）** |
| 发布 | ✅ **`SUMMARY: 9/9 passed`**（`LOG: C:\Temp\dsh-verify\verify-20261015-031646.log`）｜更新通知 `id: qgCcmpuMrvKX` |
| QA | ✅ **PASS**（`QA-ROUND-v1.32.14.md`）｜**FINDING-1 已修**（白窗 3 轮零命中 + 阳性对照） |
| 用例库 | C 组 **15**（新增 `QA-C16`）｜A 组 **27**（`QA-A32` 已补复验结论） |
| skill | `dsh-push-app-dev` **`9484f70`**（含本轮 3 条硬事实：模拟器恢复 SOP / 脱敏复查纪律 / 稳态≠动态态等） |
| **待用户** | **真机回执**（`?v=80` 已上线，更新通知已推） |

**⇒ 本轮（用户「修吧」⇒ 聊天大代码块透明）已闭环：需求修复 + 上线前抓到的 P2 一并修掉 + 发布 9/9 + 开源同步（并顺带修掉一个存在多个版本的真实 IP 泄漏）。**

### 3.20.23 🔴 事故（2026-10-15 08:2x）：**`odys` 网关 413 ⇒ 成员反复失败**（**非** App 侧问题）

**报告**：[INCIDENT-2026-10-15-odys-413-request-too-large.md](F:\work\work_dsh\dsh-push\verify\INCIDENT-2026-10-15-odys-413-request-too-large.md)（14,713 B）

**触发**：用户看成员面板觉得"状态不太对"，真机截图显示本轮失败 + **`413 INVALID_REQUEST`**、
错误页正文 **`nginx/1.18.0 (Ubuntu)`**。

**结论：成员没坏。**

1. **根因**：请求路由到 **`odys`（`https://api.odys.work`）**，**该网关 nginx 有 ≈8 MiB 请求体上限** ⇒ 413。
   **三条互相印证的铁证**：
   - **413 页正文含 `/odys-cockpit/user-display.js?v=20261014a`** —— **odys 自己的前端资源路径**（上游自报名）；
     且 `nginx/1.18.0 (Ubuntu)` 在**本机全部路由里唯一命中 odys**
     （`aiaaa`=`nginx/1.22.1`、`goopencode`/`dpclub`=`cloudflare`、`strata-local`=`BaseHTTP/Python`）；
   - **主动阈值扫描**：`6MB/7MB → 401`（已穿过 nginx）、**`8MB → 413`**；
   - **失败子会话 `a086a3d5` 的 provider 计数**：`"provider":"odys"` **1123** vs `strata-local` **1**。
   **跨会话扫描 25 个转写**：`413 Request Entity Too Large` **全库只出现在 3 个会话**，全是**重度 odys** 会话
   （odys 计数 1123–3002）；但 **odys 计数高 ≠ 必然 413**（`a0d88e51` odys=1463 而 413=0）
   ⇒ **触发条件是"body 越过 8 MiB"，不是"用了 odys"**。
2. **成员"状态不对" = 宿主重启后成员被重建 + 无在飞回合** ⇒ 面板 `inactive`、模型回落本地模型。
   **设计行为**（成员模型 spawn 时定死、之后无工具可改），**不是故障**；**任务板不受影响**（task-12…15 仍 `completed`）。

**⇒ 处置**：**P0 长上下文会话/子智能体避开 `odys`**；P1 若留 `odys` 只用于短请求 ＋ **加出站 body 预检**
（超 ~7.5 MiB 直接拒绝并提示换路由，**别让 413 只表现为"本轮失败"**）；P2 复核 `allowedModels` 是否保留 `odys`。

**★ 两次事故的共性教训（本文件 §3.20.23 与 `INCIDENT-2026-10-14-…`）**：
**"谁被钉在哪个路由上"决定了他会不会中招** ——
10-14 是**成员钉在本地引擎**（引擎 OOM ⇒ 300s 超时）、10-15 是**成员钉在 `odys`**（网关拒大 body ⇒ 413），
**两次 Lead 都在另一个路由上所以不受影响**。
**⇒ 成员报 "failed before it finished" 时的判据顺序**：**先看该成员钉在哪个 provider**
（`list_agents` 的 `model` 字段 ＋ 会话转写里的 `provider` 计数），**再判是"引擎挂了"还是"上游网关拒了"**
—— **两者症状文本完全不同（超时 vs 413），别一律归因到引擎。**

**★ 两条方法论更正（**已写进报告 §7/§3 头**，值得进 skill）**：
1. **裸数字串搜日志会大量假阳性**：我用 `-match '413'` 得到的"命中"绝大多数是
   **V8 栈地址 `00007FF60A413BAD`**、**token 计数 `4137`**、**`seq: 413`**、**时间戳毫秒 `.413Z`**；
   ⇒ 判据必须是**带上下文的模式**（`413 Request Entity Too Large` / `INVALID_REQUEST`）。
2. **DSH 会话转写是 concatenated-frame zstd**：`Select-String` 与**整块** `zstdDecompressSync`
   **只能解出第一帧（273 字节）** ⇒ **会得出"没有 413"的假阴性**；
   必须**按 zstd magic（`28 B5 2F FD`）切帧逐帧解压再拼接**（脚本 `tmp/zdump2-413.mjs`、`zallsess.mjs`）。

**边界（不得当已验）**：**未测量** 413 那次请求的**真实 `Content-Length`**
（纯文本估算 ≈2.15 MiB < 8 MiB；差额**推断**来自 JSON 转义 / 工具 schema / base64 图片，**未直接测量**）；
未验证 8 MiB 是精确值；未验证每轮失败是否**全部**来自 `odys`。
**本次只诊断，未改配置、未重启服务、未动成员。**

### 3.20.24 🔴 成员"救活"实测：**"叫醒"无效，需结构性处置**（2026-10-15 08:5x）

**报告**：[DIAG-member-revive-2026-10-15.md](F:\work\work_dsh\dsh-push\verify\DIAG-member-revive-2026-10-15.md)（12,574 B）

**用户问**："那现在团队成员能救活吗" ⇒ **实测结论：能救，但不能靠"发消息叫醒"救。**

| 项 | 实测 |
|---|---|
| 队友状态 | `inactive`（= **当前没有回合在执行**），**不是 `failed`、不是坏掉** |
| **发极小探针能救活吗** | ❌ **不能（实测否决）**：探针**送达了**（转写里出现 `ALIVE developer` ×2 / `ALIVE tester` ×2），**但两轮都立刻失败** |
| 为何送达仍失败 | **这两个会话的上下文本身已超 `odys` 的 ≈8 MiB body 上限**：解压实测 **developer 9.28 MiB** / **tester 8.79 MiB** |
| 钉死证据 | **只看最新 6 帧**：仍见 `"provider":"odys"` ＋ **末次错误 = odys 413 页**（`/odys-cockpit/…` + `nginx/1.18.0 (Ubuntu)`） |
| 本地引擎行不行 | ✅ **行**：引擎日志有**刚完成的真实推理**（`prompt 175684 tokens … 168 generated in 2864 ms (58.7 tok/s)`） |

**⚠️ 修正我一处误判**：我以为"发一条极小的消息"能绕开 8 MiB 上限 —— **错**。
**body 大小由「会话历史」决定，不由「这一条消息」决定**；小消息只让**新增部分**小，**回放照旧**。

**✅ 救活配方（三选一，按代价）**：
1. **换路由到 `strata-local`**（本地引擎**无 8 MiB 上限**，**保留现有上下文**）—— **首选**；
2. **压缩/重开**把回放降到 8 MiB 以下（丢部分历史）；
3. **重新 `spawn_teammate`**（新会话上下文小，天然不超限）。
**⇒ 推荐 ①＋③**（旧会话已含 9 MiB 回放，留在 `odys` 上无解）。

**⚠️ 又一处方法论产出（我自己的假阴性）**：我从**lead 自己回合内**直打本地引擎发推理请求 ⇒ **240s 超时**。
原因是 **lead 自己也跑在同一引擎上，而该引擎是串行（FIFO）服务** ⇒ 探测请求**排在我自己之后** ⇒ **自锁**。
**⇒ 纪律：不要从「引擎正在服务的那个会话内部」探活该引擎** —— 必然超时，**该超时推不出任何结论**。
**正确判据**：① 看**另一个独立回合**能否成功；② 看**引擎日志里是否有刚完成的真实推理**；
③ 从引擎客户端集合**之外**探测。

**⚠️ 第三处修正**：**provider 出现次数不能单独当路由证据**（`allowedModels` 会逐请求回显，**灌水**）
⇒ 判"哪个上游拒了"**要看 413 错误页正文指纹**（上游自报名）。**但本案例的路由归属另有硬证据**（最新帧 + 413 页）。

**⚠️ 架构性约束**：**Lead 与全部队友共用一个串行本地引擎**（`127.0.0.1:8080`）
⇒ **无法真并发**（Lead 生成时队友请求只能排队）。
⇒ **派活纪律**：派完活**尽快结束自己回合**把服务槽让给队友；确需并行则把部分成员切到云端路由（**别用 `odys` 做长任务**）。

**边界（不得当已验）**：**未实做**"切到 `strata-local` 后是否真能复活"（依据是"本地无 8 MiB 上限"＋引擎有真实推理日志）；
未验证本地引擎**并发**能力；**未重建成员、未改配置、未重启服务**（处置**待用户决定**）。

### 3.20.25 v1.32.14 全方位体验轮：**FAIL（A14 P1 持续）** + CSS360 基线重打（2026-10-15 10:1x–10:5x）

**报告**：[QA-ROUND-v1.32.14-experience.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-v1.32.14-experience.md)（151 行，commit `ac1ba31`）

**结论**：**FAIL** —— 唯一 P1 是 **A14 命中区重叠持续**（v1.32.7 FINDING-1 延续，**非 v1.32.13→14 本轮回归**）。本轮发布引入的改动（大代码块实底、`isAnchor` 排除）**全部复测通过、无新缺陷**。

| 项 | 结果 |
|---|---|
| **覆盖** | 57 条中 ~40 条（核心 16 中 8、对抗 28 中 20、打磨 13 中 12）；真实提问类 C02/A05/A18 报 lead 未跑（子代理发不了 ask_user_question） |
| **FINDING-1 [P1]** | **A14 命中区重叠**：`Collapse sidebar`(40px) ↔ `Open in File Explorer`(23px 命中框) 横向重叠 **23px**；`realTaps` 7 处误触实证（点 Explorer 中心触发 New session/Collapse）。归因 = **DSH Web 上游紧凑布局**（header 按钮间距过小）＋ **App 侧 v1.32.7 的 40px 命中区放大**叠加。**App 侧能否单独修待评估**（v1.32.7 起挂账未修） |
| **FINDING-2 [P2]** | A08/C08 **离线无提示**：飞行模式页面存活但无任何离线指示（同 v1.32.7） |
| **FINDING-3 [P3]** | A10 极窄视口（`innerWidth=200`，人为尺寸）浮层被裁 —— 用户不会用此尺寸 |
| **CSS360 基线重打** | ✅ A14/A15/P04 已就地重打（旧 411 宽数字作废）；**A14 仍 FAIL（P1）**、A15/P04 PASS |
| **v1.32.14 修复复测** | ✅ P11 菜单 0.96×3 稳定（v1.32.11 FAIL 已修）｜C13 面板 1.0 5/5｜C14/C15 代码块 1.0/0.45 精确分流｜C16 `wouldChange=2` 四锚点全 0｜A30 多面板 `frame=0`｜A32 竞态 3 轮 caught=0｜C09/C10/A20–A28 已读链路全 PASS |
| **新探针** | `verify/qa-ux-suite.mjs` / `qa-ux-suite2.mjs`（综合 UX 探针）+ `verify/qa-ux-polish.mjs`（commit `46b014f`，A04 超长文本 + P01/P02/P05 补全，未跑，下轮工具链）——均为临时产物，长期化需与 tester 协调落 `verify/` |
| **未覆盖（显式登记）** | C01/C03/C04（推送/通知栏/快答）、C06（探针选择器未命中）、A03/A04、A07（用例界定错误，已由 A13 取代）、A13（App 内主题 UI）、A19（watchdog 150s BLOCKED）、P01/P02（部分）、P05/P06/P07/P09/P10、C13 差异视图（`diff=false` 唤不出） |

**⚠️ 本轮成员失败事件（第三次，前两次见 §3.20.23/24）**：tester 完成全部工作并 commit（`ac1ba31`，10:53）后、向 lead 收尾报到之前引擎失败（`failed before it finished`，无 closing message）。
- **三处核查（§5.4.3 纪律）**：git 提交 ✅（`ac1ba31`）｜报告 ✅（151 行完整）｜孤儿产物 ✅（`tmp/qa/overlay-report*.json` 10:23–10:25）⇒ **工作全部落盘，无需重跑**。
- **lead 复核发现报告声明与实况不符**：报告称设备已复位，实测 `airplane_mode_on=1` 仍开着 ⇒ **已补复位**（airplane=0 / font_scale 默认 / wm size 1440x3168）。
- **教训（追加到 §5.4.3）**：**报告里的"复位声明"也要抽验**——本轮报告写了"airplane disable"但实际没生效（可能复位命令在失败路径上没跑到）。判据：`settings get global airplane_mode_on` / `font_scale` / `wm size` 三条命令 10 秒可验。
- **任务板**：task-1 由 lead 代为 complete（工作实质完成）。

## 4. 跨轮未决（在下轮开工前处理或显式推迟）

1. **DSH 上游两条补丁**（源码仓，非本仓）：`tool-ask-user` 默认值 `legacy`→`timed`；`UserQuestionService.ask()` 加完成作用域 AbortController。做掉后连 legacy 会话都不再僵卡，新用户零配置。
2. ~~**A14/A15/P04 命中区基线在 CSS360 下未重打**~~ → ✅ **已收（2026-10-15 体验轮，commit `ac1ba31`）**：三用例基线已就地重打。**A14 仍 FAIL（P1，见 §3.20.25）**、A15/P04 PASS。
3. **GPU 模式下的截图耗时基线未重打**（swiftshader 数字不可对照）。
4. **QA 报告 §6 未覆盖面**：真机 OriginOS 通知栏行为、30 条消息满载、C03/C04 用例。
5. **`claimForeground` 两种设置的用户可感差异**：产品取舍待用户拍板。
6. ~~**⚠️ 聊天里的大代码块 `_block_7gxqk_4`（`331x524`）仍是透明的**~~ → ✅ **已修（v1.32.13/14，`8f24fcb`/`083de4f`）**：`innerBig≤2` 判据 + 幂等闸门放行 + `isAnchor` 排除布局容器；大块 1.0（5/5）、矮块 0.45（9/9）不得回退。详见 §3.20。（历史：v1.32.12 实测被抹透明、`isPanel` 不覆盖、裁定不修 → 用户「修吧」→ v1.32.13 立案）
   它**同样被抹成透明**（面板打开时 `0.45`、原生 `rgb(249,250,251)`）、**同样伤可读性**，
   但**不是全屏定位面板** ⇒ v1.32.12 的 `isPanel` 判据**不覆盖它**。
   **本轮（v1.32.12）已裁定不修**（不夹带扩大改动面，要修需另立判据、风险更高）；
   探针已加**常驻断言**（`codeBlock_a`）；**已在给用户的汇报里显式点出，等用户决定是否下一轮处理**。
7. **差异视图（抬头 `+5 -5`）的不透明度未亲眼看**（v1.32.12 的 U-1）：探针 4 次尝试均**唤不出差异视图**
   （抬头恒为文件名 + `Markdown`）。**推论（非判据）**：实测两视图**共用同一 `_tabHost` 层**
   （差异抬头在 `TdjKvG_header`、正文在 `TdjKvG_preview`，同属该层），而该层 5/5 = `1.0`
   ⇒ **不透明度断言对该层两种视图同等成立**。**下轮补法**：先造真实改动（编辑文档产生 diff）再打开。
8. **`openspec --all --strict` 仍 5 项 WARNING**（Purpose 占位/过短、requirement >500 字符）—— 未处理。
9. **真 GPU 冷启基线未重打**；**host-plugin P02–P06 未跑**（P07+P01 已完成）。

---

## 4.1 本轮未完成清单（分组；带 owner 与可复核判据）

> 上面 §4 的 5 条是**跨轮长期欠账**；这里是**本轮收尾时仍未闭环**的全部条目。
> 细节不在此复制，只给"怎么一条命令确认它还没做/已经做了"。

### A. 会留下真实验证缺口（优先）

| 项 | 现状 | owner | 判据 |
|---|---|---|---|
| **P02–P06 未跑** | task-10 只完成 **P07**（放行闸）+ **P01**；P02/P03/P04/P05/P06 仍是**设计态** | tester | `Select-String '^### P0[2-6] 实际' verify/QA-ROUND-plugin-0.2.0.md` → **空** 即未跑 |
| **U-1** | `gate-shot.ps1` / `card-layout-verify.ps1` 只做过**语法解析**，未真跑整轮 | tester | `STATUS-READY-2026-10-14.md` §4 |
| **U-2** | `qa-round.ps1`/driver 只真跑过 **1 条**最小用例（`QA-C05`） | tester | 同上 |
| **U-3** | `QA-A10`（极窄视口）/`QA-A16`（成组按钮间距）的几何数字**未标注失效** | tester | 重打 CSS360 基线时**必须一并复核**，别直接套用 |
| **U-4** | CDP **真输入**（`Input.dispatchMouseEvent`）未验（本轮只到 `/json/list` + `Runtime.evaluate`） | tester | 留待 QA-A14/A19 真点击链路 |
| **U-5** | 截图耗时未按「剔除预热、n≥3 稳态」重打 | tester | **判档位一律走 `emu-gpu-verdict.ps1`**，不要用耗时数字下结论 |
| **U-6** | 真机 OriginOS（通知栏/后台被杀/深链落点）未覆盖 | 需真机 | 模拟器天然测不了（`README.md` 末节） |
| **U-8** | 本轮 **0 条 ntfy**（按纪律不碰生产 topic） | tester | 活体链路由 **P03** 的提问覆盖 |

### B. 基线 / 规格欠账

| 项 | 现状 | 判据 |
|---|---|---|
| **真 GPU 冷启基线未重打** | 巡检的 6s 是 **quickboot 快照引导**，不可当基线 | 需造冷启再测 |
| **CSS360 下 A14/A15/P04 命中区基线未重打** | 旧 411 宽数字已作废 | skill §3 基线声明 |
| **`openspec --all --strict` 5 项未过** | 实测 **`5 passed, 5 failed`**，**全部 WARNING 级**：`dsh-host-integration`、`dsh-host-plugin`、`dsh-turn-notify`、`push-relay-server` 的 **Purpose 占位或过短**（`dsh-host-plugin` 另有 3 条 requirement **>500 字符**）；`change/plugin-timed-switch` 与 `change/dsh-push-web-link-out-of-box` 均 ✓ | 在 **vm1 仓**跑 `openspec validate --all --strict`（CLI 在 `/usr/local/bin/openspec`）——⚠️ **别用 `npx openspec@1.14.1`：npm 上无该版本，报 `ETARGET`** |
| **F4/F5/F6 未做** | ① AVD `config.ini` 重复键与 `hw.gpu.enabled=no`；② 三个启动器并存；③ 阶梯缺可判据输出 | `TEAM-READY-2026-10-14.md` §6.4 |
| **task-3 复用产物在 `F:\work\work_dsh\tmp\`（未进仓）** | 下轮要长期用需落进 `verify/` —— 那是 **tester 的写入范围，须先协调** | `TEAM-READY` §6.8 |

## 5. 收官盘点（任务板 + 环境终态）

### 5.1 任务板终态

| task | 主题 | 状态 |
|---|---|---|
| task-1 / task-2 / task-3 / task-4 | 一键全部已读（实现 / 用例 / QA 轮 / 发布 v1.32.9） | ✅ 全 completed |
| task-5 / task-6 / task-7 / task-8 | 逐条已读撤通知（实现 / 用例 / QA 轮 / 发布 v1.32.10） | ✅ 全 completed |
| task-9 | host-plugin 设置页开关（openspec + 实现 + selftest） | ✅ completed（`2c971ec` + `c766f19`；selftest 101/101） |
| task-10 | host-plugin 改动验证轮 | ⚠️ **in_progress**：P07+P01 完成，**P02–P06 未跑**（见 §4.1-A） |

> 就绪自检那一轮的 task-1…task-4（工具链/流水线/QA 起页链/修 H-1）见 `TEAM-READY-2026-10-14.md` §3/§6，
> 已全部 completed（H-1 已 FIXED，`44129b4`）。

### 5.2 环境终态——复核命令（不重复数值，值见 §1 与 §3.15）

```powershell
# 生产：插件版本 / patch 哈希 / 端口持有者 / 本 boot 有无切换行
$p = "$env:USERPROFILE\.dsh\profiles\web"
([IO.File]::ReadAllText("$p\node_modules\dsh-push-host\package.json") | ConvertFrom-Json).version
(Get-FileHash "$p\cordis.patch.yml").Hash
(Get-NetTCPConnection -State Listen -LocalPort 3081 | Select-Object -First 1).OwningProcess
Select-String -Path "$env:USERPROFILE\.dsh\web.log" -Pattern '手机作答模式|relay ready' | Select-Object -Last 3

# 生产上线状态复核（与预检快照逐项比对，须 exit 0）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\prod-rollout-plugin.ps1 -Verify

# vm1：服务 + 推送链路（先 export PATH，否则 /usr/bin/node 缺 stripTypeScriptTypes）
ssh user@<tailnet-vm1> 'export PATH=$HOME/.local/bin:$PATH; bash /tmp/vm1-host-onboard.sh verify'

# 三个仓库的云端对齐（判据一律比 origin，**不要比 vm1/master**——那是陈旧脏快照，会误报 ahead 200+）
git -C F:\work\work_dsh\dsh-push        fetch origin; git -C F:\work\work_dsh\dsh-push        rev-list --count origin/master..HEAD
git -C C:\Users\<user>\.dsh\skills        rev-list --count origin/main..HEAD
git -C F:\work\work_dsh\dsh-push-public rev-list --count origin/master..HEAD
```

### 5.3 能不能收工

| 判断 | 结论 |
|---|---|
| **现在能用吗** | ✅ 能：生产 0.2.1 已上线并验收（`-Verify` exit 0 复跑过两次）、vm1 服务与推送可用、三仓云端对齐、团队 READY、**无阻塞项** |
| **能说"全部做完"吗** | ⏳ **正在补**：用户说"继续"后已把剩余项派出去（见 §5.4）；未完成前不能称"全部做完" |
| **影响面** | 不影响当前使用；影响的是**下一轮改动有没有可信基线**。真正会漏掉验证的是 **P02**——它是唯一验「设置页状态行文案」的用例，而该文案依赖 cosmokit 私有符号 `Symbol.for('cosmokit.volatile.write')`（符号若改名 → **状态行不刷新**；**零写入安全的另一条路径已单独验过，不会写坏配置**） |

### 5.4 收尾派工（2026-10-14 18:5x，用户"继续"后）

| task | 主题 | owner | 状态 | 关键约束 |
|---|---|---|---|---|
| **task-10**（已有） | QA 改动验证轮 P02–P06 | tester | **in_progress（已派工，引擎崩过 2 次）** | P02 生产**只读不点**、记录状态行实际文案；**P05 先于 P03**；P03 用 web-app bundle 的 scratch 第二实例；测完复位+设备状态声明。**新纪律：每跑完一个用例立刻 commit**（引擎两连崩，禁止攒到最后一起写） |
| **task-11**（新建） | 修 openspec `--all --strict` 5 项 WARNING | ~~developer~~ → **lead 自收** | ✅ **completed**（`2ef326d`）：**vm1 实测 `10 passed, 0 failed`**（此前 5/5）。改 4 处 Purpose（**必改主 spec**，delta 无效）+ 7 处超 500 字正文搬细节进 **13 条新场景**；**需求名与既有场景零改动**（177 条逐字保留 / 0 altered）。记录：[verify/OPENSPEC-STRICT-FIX-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\OPENSPEC-STRICT-FIX-2026-10-14.md)。⚠️ developer 引擎连崩 2 次（均在动笔前），故 lead 接手 |
| **task-13**（新建） | 修 9 处冷启动配方：`dsh-emu-sw`（CPU 档）→ `emu-coldstart-real-gpu.ps1` | tester | pending，**blocked_by = task-10** | 见 §5.5「F5」行（编号随派工重排） |
| **task-12**（新建） | 修 9 处冷启动配方：`dsh-emu-sw`（CPU 档）→ `emu-coldstart-real-gpu.ps1` | tester | pending，**blocked_by = task-10** | 与 task-10 **写入范围重叠（都是 `verify/**`）必须串行**；**别删** legacy 任务与 `run-emu*.cmd`（模板/夜间监督仍引用其名字）；`.ps1` 纯 ASCII；**不许真跑冷启**（lead 独占） |

**写入范围**：task-10 / task-12 = `verify/**`（**串行**）；task-11 = `openspec/**`。都不碰 `host-plugin/**` 与生产 profile。
**我不动 `host-plugin`**（0.2.1 已上线且零写入验证通过，没有要改的）。

#### 5.4.1 引擎崩溃的应对（本轮实测）

developer 与 tester 的引擎**各崩过**（各留一次 "failed before it finished"）。核实结果：**两次崩溃都发生在"还没动笔"阶段**——
工作树干净、`QA-ROUND-plugin-0.2.0.md` 无 `### P0x 实际`、`openspec/specs/` 无新提交。⇒ **没有半成品残留，无需回滚**。
应对：① 重新派工时明确"**每完成一个用例立刻 commit**"，把崩溃损失上界压到一个用例；
② lead 把**不依赖队友、不依赖设备**的欠账自己收（本轮即用此法做掉真 GPU 冷启基线 + F4 冷启验收）。
**判据（下次崩了照这个查）**：`git status --short` 是否干净 + 目标产物是否出现"实际/证据"小节 + `git log` 有无对应提交。

#### 5.4.2 lead 自己收掉的：真 GPU 冷启基线 + F4 冷启验收（一次冷启同时产出）

新脚本 [emu-coldstart-baseline.ps1](F:\work\work_dsh\dsh-push\verify\emu-coldstart-baseline.ps1)（**纯 ASCII**）：
默认**只打印计划**，`-Force` 才真冷启（**会杀模拟器**，须设备空闲时跑）→ 调 `emu-coldstart-real-gpu.ps1 -Kill`
→ 计时 + 量渲染器/几何/config.ini 键重数 → 写 `verify/STATUS-emu-coldstart-baseline.md`（追加节）
与 `verify/evidence-coldstart/*.json`。**判据**：耗时（exit 0）+ 渲染器含 `NVIDIA` + 几何 `1440x3168`+`640`
+ config.ini 每键**恰好 1 条**（= F4 冷启验收）。**旧 6s 数字作废**（quickboot 快照引导，非冷启）。

#### 5.4.3 ⚠️ **孤儿证据**：引擎崩在"干完活、还没写报告"之间（本轮实际发生，务必照查）

**现象**：用户问"成员的进展"，我按 §5.4.1 的判据查——`git status` 干净、报告无 `### P0x 实际`、
无对应提交 ⇒ **初步结论"什么都没跑"**。**但这个结论是错的。**

**实情**：tester **已经跑完了 P02**（20:52），**证据全部落盘**，只是引擎在**写报告之前**崩了：
```
tmp\shots\p0x\p02-settings.png     (1,416×808, sha256 9aba91b6…)
tmp\shots\p0x\p02-row-dom.txt      ("found":true, 状态行完整文案)
tmp\shots\p0x\p02-modal-text.txt
tmp\p0x\p02-driver.mjs / p02-edge.cmd
```
⇒ 若只看 git 与报告，**一次真实的 PASS 会被当成"没跑"而重跑**，既浪费一轮又会得出错误的过程记录。

**教训（并入 §5.4.1 的判据，补第 3 条）**：查"队友到底做了没有"**必须同时查三处**，
缺任一处都会误判：
1. `git status --short` + `git log` 有无提交；
2. 目标产物（报告）有无"实际/证据"小节；
3. **`tmp\`、`verify\evidence-*\`、`tmp\shots\` 里有无按用例 id 命名的孤儿产物**（含 mtime 落在本轮时间窗内）。
**判据口诀**：*git 干净 ≠ 没干活；产物在 tmp 就说明干过，只是没来得及入账。*

**处置**：Lead 把 P02 的孤儿证据**取回并代为登记**为 PASS（`d88ac75`），并把两份原始证据拷进
`verify/evidence-p0x/` 入库，避免 tmp 被清理后再次丢失。登记时**显式标注两处口径修正**：
① 设计段的按钮文案预期（据 `f8326ce`）**已过时**——0.2.1 的 never-downgrade 守卫使 timed 态
**不存在降级钮**（实测按钮=`「已开启（本开关不降级）」`+`disabled:true`），设计段担心的"再点就是真写入"
**在结构上已不可能**；② `p02-hash.txt` 缺失（tester 没来得及写 H0/B0），故 **"H0==H1"降级为传递证据**
（用 `prod-rollout-state.json` 快照 + `-Verify` exit 0 补强），**不当作"已直接验过"**。

**清理核对（tester 未开工的部分，确认无残留、无需回滚）**：
`~\.dsh\profiles\qa-p03` **不存在**、`~\.dsh\cordis.patch.yml`（home 层）**不存在**、3099 端口**未监听**、
`openspec/specs` 工作区干净 ⇒ **P03/P05/P06 确实一步没走**，且**没有半成品残留**。

#### 5.4.4 成员的"实际进展"到底是多少（2026-10-14 22:1x 核查）

| task | 归属 | 宣称状态 | **实际核查结果** |
|---|---|---|---|
| task-10 | tester | in_progress | **只完成 P02**（PASS，孤儿证据已抢救登记 `d88ac75`）；**P03/P04/P05/P06 未跑**、无残留 |
| task-11 | developer→**lead 自收** | ✅ completed | **lead 完成**（`2ef326d`，vm1 实测 `10 passed, 0 failed`） |
| task-12（=task-13） | tester | pending (blocked_by task-10) | 未开始（被 task-10 阻塞，符合预期） |
| developer | — | 引擎崩 2 次 | **零产出**（两次都在动笔前崩，无残留） |
| tester | — | 引擎崩 1 次 | **1 个用例的产出**（P02，已抢救） |

**⇒ 本轮 4 个提交（`7a4aab9`/`2ef326d`/`c89902e`/`d88ac75`）中，只有 1 个源自队友**（且需我抢救登记），
其余均为 lead 自收。**下轮若继续派活给这两个成员，应预期"引擎随时崩"并据此设计小步提交。**

### 5.5 仍在 backlog（未派工，属"基线欠账"或"需用户拍板"）

| 项 | 为什么留 |
|---|---|
| ~~真 GPU 冷启基线未重打~~ | ✅ **已收（2026-10-14 20:56）**：`emu-coldstart-baseline.ps1 -Force` 真跑一次冷启 → **PASS**。冷启 **49.8 s**（阶梯自身 **24 s**）、渲染器 `NVIDIA RTX 4060`、`-gpu host`、`1440x3168@640`、选择器 `host`。**旧 6s 数字作废**（quickboot 快照引导，非冷启）。证据：`verify/STATUS-emu-coldstart-baseline.md` + `verify/evidence-coldstart/20261014-205633-*.json` |
| ~~F4 冷启验收~~ | ✅ **已收（同一次冷启）**：config.ini 三个 LCD 键**各恰好 1 条**（1440/3168/640）、`hw.gpu.enabled=yes`。⇒ **F4 从"已修"升级为"冷启验证通过"** |
| ~~U-3 里的几何复核~~ | 部分：本次冷启已确认物理几何未被回退；**`innerWidth=360/dpr=4` 的 CDP 复核仍未做**（需 QA 起页链，并入 U-1/U-4 那批） |
| CSS360 的 A14/A15/P04 命中区基线 | 重打几何，属独立一轮；SKILL §3 已声明旧数字作废 |
| U-1（`gate-shot`/`card-layout-verify` 真跑整轮）、U-2（整轮 `qa-round`）、U-4（CDP 真输入）、U-5（截图耗时稳态口径） | QA 侧大工程；U-4 依赖 QA-A14/A19 的真点击链路；等用户决定是否要"体验轮" |
| U-6 真机 OriginOS | 需用户在真机配合 |
| **F5 的 9 处配方修正** | ⏳ **已开 task-12**（owner=tester，blocked_by=task-10）：把文档/脚本里的冷启动姿势从 `dsh-emu-sw`（硬编码 CPU 软渲染）改走 `emu-coldstart-real-gpu.ps1`。**lead 自己的三份已改完**（`TEAM-START.md` §0.1、skill `dsh-push-app-dev` §2、本文件） |
| **F6**（自愈阶梯缺机器可读输出） | 现有 `emu-gpu-verdict.ps1` + `emu-coldstart-real-gpu.ps1 -Status` + `emu-coldstart-baseline.ps1`（写机读 JSON）已覆盖"一条命令判据 + 机读帧"这个需求；**改现网自愈脚本需单独一轮 + 真机回归**，方案见 `INFRA-F4-F5-F6-2026-10-14.md` §3.3 |
| DSH 上游两条补丁 | **不属本仓**（改 DSH 源码仓） |
| `claimForeground` 两种设置的产品取舍 | **等用户拍板** |

> **F5 顺带澄清一条**：`dsh-emu-sw` / `dsh-emu` 两个 legacy 任务 `LastTaskResult=1` **不是缺陷**——它们是
> `Interactive` 身份，**没有 console 会话时不运行**；且 legacy 日志文件可能被幽灵进程锁住（加固版自愈
> `hardened.ps1:269-277` 正是为此**故意绕开**它们）。**保留但降级为"人类手工兜底"**，别删（`emu-bootstrap.ps1`
> 模板与夜间监督仍引用其名字）。

---

## 5.6 本次收官记录（2026-10-14 22:3x）——**后续工作在另一个对话开展**

### 5.6.1 为什么停在这里

用户指示：**"找到问题就行了，成员先停止吧，我们的工作已经是在另一个对话开展的了"**。
⇒ 本轮在此收官：**两个队友已 `interrupt_agent` 停止（现为 `inactive`）**，不再派新活；
**剩余未闭环项全部登记在下方**，由新的对话接手。

**停止时的清理核对（全部实测，无残留）**：

| 检查 | 结果 |
|---|---|
| 队友本轮有无提交 | **0 个**（22:25 后无提交） |
| `~\.dsh\profiles\qa-p03`（P03 scratch） | **不存在** |
| `~\.dsh\cordis.patch.yml`（P05 home 层） | **不存在** |
| 端口 3099 / 3082 / 9224 / 9225 | **全部未监听** |
| 残留 CDP Edge 实例 | **0** |
| 误报的两个 PID（30192 / 26220） | **复核后已不存在**（是查询瞬间的瞬态进程，未做任何终止动作） |
| 工作树 | **干净** |
| 生产 patch 哈希 / 备份数 | **`D8F12BC0…` / 26**（未被触碰） |

⇒ **停止是干净的**：没有半成品、没有需要回滚的写入、没有占用端口的僵尸实例。

### 5.6.2 本次（22:0x–22:3x）真正交付了什么

| 提交 | 内容 |
|---|---|
| `d88ac75` | **抢救 tester 的 P02 孤儿证据并登记为 PASS**（关键项：状态行由 volatile 镜像回写 ⇒ cosmokit 私有符号有效） |
| `1afdf9a` | HANDOVER §5.4.3 **孤儿证据**教训 + §5.4.4 成员实际进展核查表 |
| `bdabc16` | **引擎事故根因定位**（`INCIDENT-2026-10-14-local-engine-prefill-oom.md`） |
| `2ef326d` `c89902e` | openspec strict **10/10 全绿**（4 处 Purpose + 7 处超长正文 → 13 条新场景） |
| `7a4aab9` `753f789` | 真 GPU 冷启基线 **49.8s/24s** + **F4 冷启验收 PASS** |
| `de1f8e2` `af109e8` | F5 关键发现（`dsh-emu-sw` 硬编码 CPU 档）+ `emu-coldstart-real-gpu.ps1` |
| skills `c2f7663` | `gpu-mode-switch` 新增 §0.0 路径/判据更正；`dsh-push-app-dev` 补远端 `.ps1` 纯 ASCII 等硬事实 |

### 5.6.3 未闭环清单（下轮接手，按优先级）

| # | 项 | 归属 | 现状与判据 |
|---|---|---|---|
| 1 | **task-10 的 P03 / P04 / P05 / P06** | tester | **唯一的功能性缺口**。P02 已 PASS。用例设计完整（`QA-ROUND-plugin-0.2.0.md`）；P05 须先于 P03；P03 用 web-app bundle 的 scratch `qa-p03` |
| 2 | **task-12（别名 task-13）：8 处冷启动配方修正** | developer | 已派工但未动笔（被 task-10 阻塞 + 引擎故障）。**lead 自己的三份已改完**（`TEAM-START.md` §0.1、skill `dsh-push-app-dev` §2、HANDOVER §5.5） |
| 3 | CSS360 的 A14/A15/P04 命中区基线重打 | tester | 旧 411 宽数字已作废 |
| 4 | U-1 / U-2 / U-4 / U-5（整轮 QA、CDP 真输入、耗时稳态口径） | tester | QA 侧大工程 |
| 5 | U-6 真机 OriginOS | 需用户 | 模拟器天然测不了 |
| 6 | F6（自愈阶梯机读输出） | lead | 已有替代品；改现网脚本需单独一轮 + 真机回归 |
| 7 | DSH 上游两条补丁 | 非本仓 | `tool-ask-user` 默认 timed；`UserQuestionService.ask()` AbortController |
| 8 | `claimForeground` 产品取舍 | 需用户拍板 | — |

### 5.6.4 ⚠️ **下轮最该先读的一条：本地引擎会"假健康"**

本轮踩过、代价最大的坑（详见 `INCIDENT-2026-10-14-local-engine-prefill-oom.md`）：

- **队友模型 = 本地 `strata-local`；Lead 模型 = 云端** ⇒ **引擎一挂，只死队友**（我全程正常，
  所以很容易误判成"队友不靠谱"）。事实上 developer 崩 3 次、tester 崩 2 次**全是引擎的锅**。
- **`/health` 回 `200 {"status":"ok","loaded":true}` 时引擎可能已经挂了 1 小时**：
  真实症状是每次请求挂满 300s → `pi-ai stream TIMEOUT idle timeout after 300000ms`（重试 5/5 全败）。
- **唯一有效判据**：真发一次 `POST /v1/chat/completions`（小 prompt 即可）；
  **离线判据** = 引擎日志**最后一代际**（用 `engine started` 分代际）里有没有
  `strata serve: prefill: the PLE rows' upload failed: out of memory`。
- **修复**：`F:\AI\strata\scripts\strata-ctl.cmd restart`（**注意真实路径在 `scripts/` 下**，约 16–90s 起来）。
- **预防**：派活前确认 RAM 可用 > 10 GB / 显存余量 > 1.5 GB；**队友会话上下文要控**（本轮 `69.9M tok` 是 OOM 放大器）。
- **连带影响**：引擎挂 ⇒ headless profile 判卷（也是 `strata-local`）挂 ⇒ **卡住的会话叫不醒**。
  修完引擎顺手跑 `C:\Users\<user>\bin\judge-smoke.mjs`。

### 5.6.5 当前环境终态（新对话可直接依赖）

| 对象 | 状态 |
|---|---|
| **生产（桌面 DSH）** | 插件 **0.2.1**；patch `D8F12BC0ED0962126D45DA8EC9CDFFA8128DAA5411E07CA683DFDE79E0563731`（两处 `mode: timed`）；备份 **26**；`-Verify` **exit 0**（本 boot 切换行 0、悬空 bundle 0、正向加载标记 3）。**token 每次重启必换**，取自 `~\.dsh\web.log` 最后一条 `dsh web:` |
| **笔电模拟器** | **真 GPU** RTX 4060（`-gpu host`）、`1440x3168@640`、`boot_completed=1`；自愈脚本哈希 `21C1856B…`（加固版）；**AVD config.ini 重复键已修**（F4，冷启验收 PASS） |
| **本地引擎** | 22:21 重启后**正常服务**（实测 GPU 99%、43.3 tok/s、**0 条 PLE OOM**）；RAM 偏紧（约 1.3 GB 可用） |
| **openspec** | `--all --strict` **10 passed / 0 failed**（vm1 实测） |
| **仓库** | dsh-push / skills / public 三仓**均已推对齐**；工作树**干净** |

### 5.6.6 给新对话 leader 的开场建议

1. 读**本文件**（§1 快照 → §5.6 收官 → §4/§5.5 未决）→ 再读 `verify/INCIDENT-2026-10-14-local-engine-prefill-oom.md`（引擎坑）。
2. 若要用队友：**先按 §5.6.4 探活引擎**，再 `spawn`（队友模型在 spawn 时继承 Lead、之后不可改，见 `dsh-team-model-control`）。
3. 若继续 task-10：**P05 → P03 → P04 → P06**，并要求**每用例即 commit**（引擎抖动环境下把损失上界压到一个用例）。
4. 判断"队友到底做了没有"：**同查三处**（git 提交 / 报告"实际"小节 / `tmp`+`shots`+`evidence` 的孤儿产物）——
   **git 干净 ≠ 没干活**（本轮 P02 就是干完活没来得及入账）。
