# 内置浏览器网络感知（v1.32.8）

## Why

用户真机反复遇到"手机打开 DSH 网页要手点『点击重试』才连上"，以及 4G 下首连偶发失败后页面
停在错误页不动；断网期间页面也没有任何提示（v1.32.6 QA 轮 F2 遗留：飞行模式无离线横幅）。
根因是 App 对网络状态完全无感：WebView 首连失败只停在 chrome-error 页等人手点，网络恢复
也不会触发任何重载。

## What Changes

- **断网横幅**：`ConnectivityManager.NetworkCallback` 注册后，断网 ≤2s 向页面注入顶部固定横幅
  「网络已断开，正在等待恢复…」（DOM 注入、`position:fixed` 顶部、`pointer-events:none`，
  不吞任何点击；注册时 `activeNetwork==null` 也立即补横幅）。恢复后横幅自动移除。
- **恢复自动重载**：`onAvailable` 时若页面处于断开态，取消退避排期、清零计数并
  `loadUrl(当前地址)`（URL+token 不变），全程零手点。
- **首连退避重试**：主文档加载失败（`onReceivedError`）按 1s/2s/4s…封顶 30s 退避自动重试；
  `onPageFinished` 对错误页也会触发，用 `loadErrored` 标记区分"真成功"才清零计数。
- **手点重试降为兜底**：用户手点时取消自动排期并清零，避免与自动重试双重加载；
  `onDestroy` 取消排期防泄漏。
- 已知取舍（QA 报告 P3 记录）：恢复即重载会丢弃离线期间未提交的输入——断网时 WS 已死、
  草稿本就发不出去，可靠性优先。
- 版本号三处同步：versionCode 74 / versionName 1.32.8 / APP_VER 1.32.8。

## Impact

- 影响面：仅 `android-app/.../WebActivity.kt`（+143/-7，commit e637659）；问题卡、面板、
  推送逻辑一行未碰（QA 回归 11 条逐项与 v1.32.7 基线相同）。
- 不影响：推送语法、relay 契约、宿主插件。
- 验收：`verify/QA-ROUND-v1.32.8.md`（ec6498f）PASS-with-findings——N1 横幅 381ms、
  N2 恢复 1629ms 零手点、N3/N1b 退避 3066/4160ms 自动回页、N4 横幅在场 8 按钮视觉中心
  全命中自己 + 真实点击复核；回归无回归。
