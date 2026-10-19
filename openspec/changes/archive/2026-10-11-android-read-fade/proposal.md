# Proposal: android-read-fade

## Why

主界面里"已答"消息整卡淡化（alpha 0.6）+ 徽章，视觉层级清晰；但"已读未答"的老消息只消未读圆点，卡片仍全亮，列表里新旧不分、扫一眼找不到还没看过的事。用户 2026-10-11 中午明确要求"已读的消息也像已作答那样显示"。

## What Changes

- `MainActivity` 消息列表渲染：淡化条件由 `answered 非空` 扩为 `answered 非空 || read==true`（v1.17.0，versionCode 41）
- 已读只淡化、不加徽章；已答仍带"已答：…"徽章（徽章逻辑不动）
- 入场动画不受影响：新消息到达时必为未读，动画照常跑完到全亮；看过 1.2s 自动标已读后下次刷新淡下

## Impact

- 修改：`android-app/.../MainActivity.kt`（一行条件）、版本号
- 无协议、无服务端改动
