# 提案：主界面卡片直答（v1.9.1）

## Why

v1.9.0 的直答按钮只长在通知上；横幅几秒后自动收进通知栏（系统行为），用户回到 App 消息列表看到的还是只有"肥鱼快答"，直答能力在应用内不可见、不对称。

## What Changes

- PushService 把 `qid + labels + nid` 随消息存入 msgs 记录
- MainActivity 消息卡片对可直答问题渲染选项胶囊按钮，点击广播给 AnswerReceiver 提交（与通知按钮同一条链路），提交后按钮行消失、对应通知撤销
- "肥鱼快答"保留为自由输入/多问题兜底

## Impact

- capability：`companion-app`（MODIFIED 一键作答，新增应用内直答场景）
- 文件：`PushService.kt`、`MainActivity.kt`；版本 1.9.1 / versionCode 25
