# Proposal: android-mark-all-read

## Why
任务结束消息一多，未读能堆到十几条，用户要逐条点「已读」（或逐条点通知）才能清空。整屏列表已经扫过一遍，"我都看过了"是一个意图，却要 N 次点击。v1.18.0 退役的是"打开 App 自动全部已读"（静默吞未读），"显式一键"的需求一直没有被满足。

## What Changes
- 状态卡片（statusText 所在卡片）改为竖排盒子：statusText 下加「全部已读」pill 按钮，右对齐；仅未读数 > 0 时 VISIBLE，否则 GONE（可见性在 refresh() 的 unread 计数上顺手控制）。
- `PushService` companion 新增 `markAllRead(ctx): Int`——遍历 prefs("dshpush") 的 msgs，把当前未读的全部置 read=true（未读判定与 MainActivity.refresh() 一致：`!optBoolean("read", true)`，老消息没字段默认已读）；对翻成已读的消息逐条 `NotificationManager.cancel(nid)`（提问消息存 nid，任务结束消息只存 mid——v1.18.0 起两者同哈希，nid 缺失按 mid 兜底，0 则跳过）；写回 prefs 后 `listeners.forEach { it.onNewMsg() }`；返回本次翻条数。
- 点击行为：调 markAllRead → toast「已全部标为已读（N 条）」；列表刷新由 listener 触发 refresh()，不自己再调。
- 产品语义（Lead 拍板）：未答的提问通知也一并撤掉（一键全部已读 = 清未读 + 撤消息通知；未答问题在 App 卡片上仍可作答，不算回归）；监督者代答保持未读（v1.28.0）的消息被一键全部已读翻成已读——用户明确点了 = 看过。
- 常驻服务通知（NOTIF_SERVICE_ID=2）不在 msgs 里，天然不受影响。
- 版本号三处同步：versionCode 74→75、versionName 1.32.8→1.32.9、PushService.APP_VER。

## Impact
- Affected specs: `companion-app`（MODIFIED：消息列表管理——显式已读入口清单加入状态卡片「全部已读」按钮；ADDED：一键全部已读）
- Affected code: `MainActivity.kt`（状态卡片布局 + 按钮可见性 + 点击）、`PushService.kt`（markAllRead + APP_VER）、`app/build.gradle.kts`（版本）
