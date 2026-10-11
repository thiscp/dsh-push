# 消息 mid 掺入时间戳，同内容推送不再互相牵连

## Why

消息主键 `mid = (title + body).hashCode()`，同标题正文的推送（典型：连续两轮 DSH 任务结束，正文都是"目录: …"）mid 完全相同，违反既有规格「仅该条转为已读，其余未读不受影响」：

- 点其中一条「已读」→ 所有同 mid 消息一起变已读
- 通知 nid 同源 → 后一条通知顶掉前一条，用户看不到"来了两条"

Android 16 模拟器上以 run-as dump prefs 实证：三条同内容消息 mid 全部为 -1157411409。

## What Changes

- `PushService.handleMessage`：`nid = (title + body + ts).hashCode()`，ts 为 ntfy 秒级时间戳——同内容不同时刻的推送获得独立 mid/nid
- 已读互不牵连、通知逐条独立弹出
- 老消息存量 mid 不变，markRead 按 mid 匹配逻辑不动，向后兼容

## Impact

- 受影响 spec：`companion-app`（消息列表管理——补"同内容重复推送独立成条"场景）
- 版本：v1.21.0（versionCode 49）
