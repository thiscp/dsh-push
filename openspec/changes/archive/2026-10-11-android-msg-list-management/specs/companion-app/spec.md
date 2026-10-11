# companion-app delta

## ADDED Requirements

### Requirement: 消息列表管理
主界面消息列表 SHALL 区分未读与已读：新到达消息为未读，未读卡片 SHALL 以强调色圆点标识并 SHALL 在状态区显示未读计数；用户打开 App 看到列表后 SHALL 自动将全部标记为已读。列表 SHALL 提供"清空消息"入口（带确认），确认后清空全部消息记录；消息保留上限 SHALL 为 30 条。

#### Scenario: 未读标识
- **WHEN** 有消息自上次打开 App 后新到达
- **THEN** 该卡片标题前显示强调色圆点，状态区显示"N 条未读"

#### Scenario: 打开即读
- **WHEN** 用户打开主界面看到列表
- **THEN** 约 1.2 秒后全部消息转为已读，圆点与计数在下次渲染时消失，不重复打扰

#### Scenario: 清空消息
- **WHEN** 用户点"清空消息"并在确认框点确定
- **THEN** 消息记录全部清除、显示空状态；取消则不动

#### Scenario: 容量上限
- **WHEN** 消息数超过 30 条
- **THEN** 只保留最近 30 条
