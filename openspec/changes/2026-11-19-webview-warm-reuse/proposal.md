# 网页窗口热复用：再进同一台 DSH 不再整页重载（v1.34.13 / 173，已发布）

## Why

用户 2026-11-19 反馈（m01157）：「我通过点击推送的进入dsh 网页，那么相当于开的一个新的web实例会重新加载，这样很浪费时间，
能不能把已有的缓存起来呢，只有进入之前没进去过的，或者自己手动刷新才重新加载，以此来保证流畅性」；
两分钟后更正范围（m01207）：「不止从推送里面进去时，从任何地方进去对应设备的dsh web都应该使用这套逻辑」
⇒ 判定必须落在 **WebActivity 收 URL 的那一层**（所有入口都汇到这里），不能只挑推送那条路。

取证结论：**问题既不在推送链路，也不在「新实例」**。

- **实例本来就复用**：`AndroidManifest.xml:57-61` 的 WebActivity 早就是 `launchMode="singleTask"` + `configChanges`；
  推送（`PushService.kt:411-420 webAction`，带 `SINGLE_TOP`）、实例选择器（`MainActivity.kt:379` → `:612-620 openWebUrl`）、
  设备卡（`MainActivity.kt:1196`）三条路全落到同一个实例 ⇒ 用户看到的「新开 web 实例」是错觉。
- **真凶一 · onNewIntent 无条件重载**：原 `WebActivity.kt:2234-2243` 只要 intent 带 `url` extra 就 `web?.loadUrl(u)`。
  那台 DSH 明明还在跑、登录 Cookie 还在，也把整套 SPA 从头起一遍：白屏数秒、当前会话与未提交的输入一起丢。
- **真凶二 · 关窗即销毁**：`:2274-2290 onDestroy` 直接 `removeView` + `w.destroy()`，而顶栏「关闭」（`:230`）就是 `finish()`
  ⇒ 上次开过的页面一点关闭就没了，下次必然冷加载，**此前不存在任何跨窗缓存**。
- **判据陷阱（本轮最贵的一条）**：入口 `?token=` 被 **303 重定向到凭 Cookie 的地址**，`onPageStarted`（`:320-328`）
  把 `lastUrl` 覆盖成**不带 token** 的地址，`web.getUrl()` 同理 ⇒ 用它们判 token 轮换永远判不出来，
  热复用会在 DSH 重启（每次重启必换 token）后白挂一个 401 页面。

## What Changes

- 新增 `loadedUrl` / `loadedToken`（`WebActivity.kt:47-53`）：**只在自家 `loadFresh()` 里写**，
  永不参与重定向污染；四处加载点（错误层重试、`scheduleRetry`、`watchNetwork` onAvailable、`onCreate` 首发）全部改走 `loadFresh`。
- 新增 `warmTarget(url)`：web 活着 && `web.url` 是 http && `loadedUrl` 非空 && `!loadErrored` && 错误层没盖着 &&
  `DshHosts.hostOf(当前)==hostOf(来链)` && (token 相等 **||** 来链不带 token **||** `loadedToken` 为空)。
  后两条故意通配：设备卡 `d.web` 常是裸链（`Devices.kt:40`），无 token 入口靠 Cookie 鉴权。
- 新增 `warmJump(url)`：不 `loadUrl`，只 `evaluateJavascript(hashJs(sess))` 改 `location.hash` —— DSH 网页的
  `revealFromHash` 挂着 `hashchange` 监听（被 `recheckRestoreTarget` `:2026-2057` 现成的 `jsForce` 兜底证实），
  改片段即可切会话；随后照旧跑 `recheckRestoreTarget()`（2.5s / 7s 读 `[data-conversation-session]`，不符补切）。
- `onNewIntent` 改二选一：热路 `reuse`（`Log.d("dshwarm","reuse host=… (skip reload)")`）/ 冷路 `reload`
  （打 `tokenChanged=`，行为与旧代码逐字一致）；**revive 语义只在冷路保留**。
- 顶栏新增「刷新」pill → `manualRefresh()`（用户要的「自己手动刷新才重新加载」）；
  「关闭」从 `finish()` 改 `leaveWarm()`（`REORDER_TO_FRONT|SINGLE_TOP` 回主页，网页窗口留在栈下层保温）。
- 注入 JS 助手化：新增 `hashJs(sess)`，MUST NOT 把 JS 字面量写进 `evaluateJavascript` 调用行（语法闸的坑，见 HANDOVER §7.61 第四节）。

## Impact

- 影响面：仅 `android-app/app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt`（134 增 / 13 删，commit `64e30e8`）。
- **用户可见语义变化**：顶栏「关闭」不再销毁网页窗口（彻底关闭 = 最近任务里划卡片）。这是刻意的——
  「缓存起来」的物理载体就是那个没被 `destroy()` 的窗口；与基线需求「桌面图标启动回到上次的现场」同向。
- 不影响：推送语法、问题卡与作答、配对与通行证、宿主插件、跨设备清单。
- 版本：App 1.34.13 / versionCode 173，APK **16927917 B**（1.34.12 = 16926693 B）；
  `ntfy.cpyh.xyz/dl/dsh-push.apk?v=173` 与博客 `dsh-push-latest.apk` 双口 SHA256 比对通过。

## Verification

本轮按 USER.md 的两轮制（首轮只改码 + 编译 + 发包，**不开模拟器**）**未做真机/模拟器实测**，交用户回归，判据：

1. 同一台 DSH 从推送 / 设备卡 / 实例选择器反复进 → 秒开、不白屏、落回上次会话（`adb logcat | grep dshwarm` 见 `reuse`）；
2. DSH 重启换 token 后用旧推送进入 → 应 `reload`，不停留 401；
3. 顶栏「刷新」→ 必重载；4. 点「关闭」再点设备卡 → 应 `reuse`。

已知风险（未实测）：保温页面的 WebSocket 在后台可能被 Chromium 冻结后断开，页面显示「重连中」——点一次「刷新」即恢复；
跨宿主 LRU 池（同时保温两台）本轮未做，一次只保温当前这一台。
