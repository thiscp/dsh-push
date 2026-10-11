# Proposal: android-answered-card-state

## Why

主界面卡片没有"已答"状态：卡片胶囊点击只是本地 removeView，通知按钮/肥鱼快答/网页作答都不回写卡片；已答与未答的卡片外观完全相同，列表一长分不清哪些还欠着，误点才知道过期。

## What Changes

- msgs 每条新增 `answered` 字段（持久化）：任何入口作答成功写入答案摘要（直答=选项标签；快答=各题 selected/custom 以 " / " 连接）；点击时收到 404/410 写入 `__expired`。
- `PushService.markAnswered(ctx, callId, label)` 统一回写：更新 msgs、通知 listeners（主界面开着即时重排）。
- 卡片渲染：已答态显示"已答：xxx"徽章（不可点）、收起选项按钮与肥鱼快答、整卡 alpha 0.6；过期态显示"已过期"徽章同样压暗；"DSH 网页"胶囊保留。
- 版本 1.9.6 / versionCode 30。

## Impact

- `PushService.kt`（markAnswered + APP_VER）、`AnswerReceiver.kt`（ok/过期分支回写）、`QuickAnswerActivity.kt`（提交成功/取题过期回写）、`MainActivity.kt`（已答态渲染与压暗）
- 能力：companion-app（MODIFIED 一键作答）
