# Spec delta: companion-app

## MODIFIED Requirements

### Requirement: 消息列表管理
主界面消息列表 SHALL 区分未读与已读：新到达消息为未读，未读卡片 SHALL 以强调色圆点标识并 SHALL 在状态区显示未读计数；消息 SHALL 仅经显式入口（通知「已读」按钮、通知「打开 DSH」、卡片「已读」按钮、卡片「DSH 网页」按钮）转为已读，MUST NOT 因打开 App 自动全部已读。列表 SHALL 提供"清空消息"入口（带确认），确认后清空全部消息记录；消息保留上限 SHALL 为 30 条。

#### Scenario: 未读标识
- **WHEN** 有消息自上次处理以来保持未读
- **THEN** 该卡片标题前显示强调色圆点，状态区显示"N 条未读"

#### Scenario: 打开即读
- **WHEN** 用户打开主界面看到列表
- **THEN** 消息 MUST NOT 自动转已读；未读圆点与计数保持，直至逐条经显式入口处理

#### Scenario: 显式已读
- **WHEN** 用户点某条未读卡片的「已读」按钮
- **THEN** 仅该条转为已读（淡化、圆点与计数消失），其余未读不受影响

#### Scenario: 清空消息
- **WHEN** 用户点"清空消息"并在确认框点确定
- **THEN** 消息记录全部清除、显示空状态；取消则不动

#### Scenario: 容量上限
- **WHEN** 消息数超过 30 条
- **THEN** 只保留最近 30 条

## ADDED Requirements

### Requirement: 显式已读入口
任务结束类通知 SHALL 带「已读」动作按钮：点击后该消息标已读并撤销本通知。通知与卡片的「打开 DSH / DSH 网页」入口 SHALL 在打开网页的同时把对应消息标已读，且 v1.18.1 起通知侧入口 SHALL 同时撤销本通知（按钮点击不触发 setAutoCancel，须显式 cancel）。常驻服务通知的网页入口 MUST NOT 携带消息已读 extras。

#### Scenario: 通知已读按钮
- **WHEN** 用户点任务结束通知上的「已读」
- **THEN** 通知立即消失，主界面该条卡片淡化

#### Scenario: 打开 DSH 即读即撤
- **WHEN** 用户点消息通知上的「打开 DSH」
- **THEN** 网页窗口打开、该通知撤销、该条卡片转已读淡化，三件事同一次点击完成

#### Scenario: 常驻通知不误伤
- **WHEN** 用户点常驻服务通知的「打开 DSH」
- **THEN** 仅打开网页，不改任何消息的已读状态、不撤常驻通知
