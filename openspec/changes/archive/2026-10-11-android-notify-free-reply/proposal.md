# Proposal: android-notify-free-reply

## Why

调研 P0（docs/research-2026-10-11.md）：RemoteInput 是纯平台 API（API 24+，SystemUI 渲染输入框，与 GMS 无关），上游 ntfy 官方 App 至今没有通知内自由作答（issue #1412）。当前自由输入必须进"肥鱼快答"界面（两跳：点按钮→列表里选"自己输入…"→再弹输入框）；RemoteInput 让**点按钮直接弹输入框，一次提交**，还能挂选项 chips 一键选。

## What Changes

- **"肥鱼快答" action 挂 RemoteInput**：点击直接弹 SystemUI 输入框（clipLabel"自由作答"，choices=前 3 个选项标签做成可点 chips，点 chip 即提交），提交走 AnswerReceiver 广播 → 以 `{id, selected:[], custom:text}` 协议提交（与快答"自己输入"完全同协议，服务端零改动）→ 撤通知 + 已答态 + toast。
- **优雅降级**：若 vivo SystemUI 不弹输入框（广播到达但 results 为 null），AnswerReceiver 直接拉起 QuickAnswerActivity——行为等同现状，零回归。
- **钩子加 `#qid <首问id>` trailer**（两端）：让 App 无需拉 JSON 就知道自由文本该答给哪个问题。
- 版本 1.11.0 / versionCode 36。

## Impact

- `PushService.kt`（#qid 解析、quickAction 改 reply action + choices、reply PendingIntent FLAG_MUTABLE）、`AnswerReceiver.kt`（取 RemoteInput 结果、custom 提交、null 降级拉快答界面）
- 两端 hook + `deploy/work/dsh-ntfy-push`：`#qid` trailer
- 能力：companion-app（MODIFIED 一键作答）、dsh-question-notify（ADDED 首问 id trailer）
