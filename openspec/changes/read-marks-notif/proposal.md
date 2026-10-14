# Proposal: read-marks-notif

## Why
用户真机反馈（v1.32.9）+ QA FINDING-4：逐条点卡片上的「已读」只清未读，通知栏里那条通知不消失，还得手动划掉；而「一键全部已读」（v1.32.9）和通知侧「已读」/「打开 DSH」入口都会撤通知。同一个意图（"这条我看过了"）在不同入口行为不一致，是已知的不对称。产品取向已拍：逐条也要撤。

## What Changes
- `PushService.markRead(ctx, mid, ts)` 统一语义：翻 read 与撤销该条通知在同一次调用完成——通知 id 优先取 `nid`，缺失按 `mid` 兜底（v1.18.0 起两者同哈希，任务结束消息只存 mid），都没有（0）跳过；cancel 幂等，已答题通知本就已撤、静默无害（QA-A25 已证）。
- 撤通知逻辑从 `AnswerReceiver`（act=read 分支的显式 cancel）与 `WebActivity`（markMsgRead 的 mnid 自撤）收拢进 markRead 内部，两处重复自撤删除（双撤本就幂等，删后行为不变）。
- MainActivity 两处卡片「已读」按钮调用点不变；逐条保持无 toast；其余各条通知与常驻服务通知（ID=2）不受影响。
- 版本号三处同步：versionCode 75→76、versionName 1.32.9→1.32.10、PushService.APP_VER。

## Impact
- Affected specs: `companion-app`（MODIFIED：消息列表管理——显式已读入口同时撤销该条通知，新增场景「单条已读撤通知」）
- Affected code: `PushService.kt`（markRead + APP_VER）、`AnswerReceiver.kt`（删重复自撤）、`WebActivity.kt`（删重复自撤 + 清理 import）、`app/build.gradle.kts`（版本）
- 归档顺序：先归档 `android-mark-all-read`（v1.32.9 发布时），再归档本变更——MODIFIED 块以归档后的「消息列表管理」文本为基线（含状态卡片「全部已读」按钮条目）。
