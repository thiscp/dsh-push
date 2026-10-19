# Proposal: android-msg-list-management

## Why

消息列表只进不管：没有未读/已读之分（打开 App 分不清哪几条是新来的）、没有清空入口（旧消息越堆越多，且上限只有 10 条）、卡片无法单条删除。

## What Changes

- **未读机制**：新消息默认未读；主界面未读卡片标题前带强调色圆点，状态卡片上方显示"N 条未读"；打开 App 后约 1.2 秒自动全部标记已读（用户已看到）。
- **清空**：底部按钮行新增"清空消息"胶囊，弹确认框后清空消息记录（不影响通知栏已弹通知）。
- **扩容**：消息保留上限 10 → 30 条。
- 版本 1.9.9 / versionCode 33。

## Impact

- `MainActivity.kt`（未读渲染/计数/清空按钮/延迟标已读）、`PushService.kt`（新消息写入 `read:false`、上限 30、APP_VER）
- 能力：companion-app（ADDED 消息列表管理）
