# Proposal: web-instance-label

## Why
App 内置网页窗口的标题栏写死「DSH 网页」。两台 DSH（台式机 + 工作 VM）都推送后，从卡片、常驻通知或「DSH 入口」进窗口，标题一模一样——用户分不清当前页面到底是哪台机器（真机截图实锤：标题只有「DSH 网页」）。最近任务卡片同样全叫同一个名，多开时更分不清。

## What Changes
- **标题栏显示实例名**：网页窗口标题改为「DSH 网页 · <实例名>」。实例名按 `host:port` 反查 v1.29 的实例清单（名称来自推送 `#name` 或用户改名），查不到退化为 `host:port`。
- **随导航刷新**：打开、窗口复用换新链接、页内跳去别的机器（`onPageStarted`）时标题都跟着换。
- **最近任务同步**：Activity `title` 同步设为「DSH · <实例名>」，最近任务卡片也能分清哪张是哪台。
- 不改任何入口语义与链接来源，纯展示层。

## Impact
- Affected specs: `companion-app`（MODIFIED：网页直达按钮——窗口标题标识实例）
- Affected code: `WebActivity.kt`（标题栏引用 + `applyInstanceLabel` + `onPageStarted`）；版本 1.30.0 / versionCode 64
