# Spec delta: companion-app

## ADDED Requirements

### Requirement: 已读消息淡化
主界面消息列表中，已读（`read=true`）或已答（`answered` 非空）的消息卡片 SHALL 整卡淡化（alpha 0.6）；已答卡片同时显示"已答：…"徽章，已读未答卡片 MUST NOT 加徽章。新到达消息（未读）保持全亮并照常播放入场动画。

#### Scenario: 看过即淡
- **WHEN** 用户停留在主界面，某条新消息自动标为已读后列表刷新
- **THEN** 该卡片从全亮变为淡化，与未读卡片形成一眼可辨的层级

#### Scenario: 已答仍带徽章
- **WHEN** 一条消息既已读又已答
- **THEN** 卡片淡化且显示"已答：…"徽章，与仅已读卡片可区分
