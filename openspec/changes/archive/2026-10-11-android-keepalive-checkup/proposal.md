# Proposal: android-keepalive-checkup

## Why

调研 P0（docs/research-2026-10-11.md §3）：OriginOS 杀后台是到达率的地基问题，且 vivo 的开关**不止电池白名单一个**——自启动、后台高耗电、最近任务锁、省流量模式、**睡眠待机优化（夜间断网杀手，vivo 官方 FAQ）**。用户只有一个"电池白名单"按钮，其余全靠记忆。做一个"保活体检"对话框：能程序检测的直接给 ✓/✗，vivo 私有开关给直达跳转（跳不过去兜底到应用详情页）+ 一句话人设说明。

## What Changes

- MainActivity 新增"保活体检"入口（按钮行第 5 胶囊，textSize 再压一档）→ AlertDialog：
  - **自动检测区**：通知权限（`NotificationManager.areNotificationsEnabled`，API 24）、电池白名单（`PowerManager.isIgnoringBatteryOptimizations`）——各带 ✓/✗ 与"去开"跳转
  - **vivo 手动区**（无公开 API，只跳转+说明，不谎报状态）：自启动、后台高耗电、睡眠待机优化（夜间断网元凶）、最近任务锁（说明型，无跳转）
  - 跳转链：试 vivo 已知组件/动作 → 失败兜底 `ACTION_APPLICATION_DETAILS_SETTINGS`（永不崩）
- 版本 1.14.0 / versionCode 38。

## Impact

- `MainActivity.kt`（唯一改动文件）
- 能力：companion-app（ADDED 保活体检）
