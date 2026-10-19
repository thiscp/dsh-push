# Spec Delta

## Purpose
定义自研 Android App（iQOO 13 / Android 16）的行为：订阅保活、原生渲染、一键作答、无 GMS 依赖。

## ADDED Requirements

### Requirement: 原生渲染事件
App SHALL 解析 ntfy 消息中的 JSON 载荷并按事件类型渲染。

#### Scenario: 提问事件
- **WHEN** 收到 `event=question` 的消息
- **THEN** 通知展示问题文本，通知栏提供各选项 action，应用内展示完整问题与选项列表

#### Scenario: 轮次事件
- **WHEN** 收到 `event=turn` 的消息
- **THEN** 展示普通完成通知（会话标识+工作目录）

### Requirement: 一键作答
用户在 App 中选择选项后，App SHALL 向 answer-relay 提交答案并得到结果反馈。

#### Scenario: 作答成功
- **WHEN** 用户点选某选项且 nonce 有效
- **THEN** 答案送达 DSH Web，任务继续执行，App 显示"已提交"

#### Scenario: nonce 已失效
- **WHEN** 提交时 nonce 已被消费或过期
- **THEN** App 提示失效并给出浏览器兜底链接，不重复提交

### Requirement: 后台到达与补推
前台服务存活时消息 SHALL 5 秒内到达；服务被系统冻结时，打开 App SHALL 补齐未读消息。

#### Scenario: 服务存活
- **WHEN** 前台服务与 WebSocket 在线且服务端发布消息
- **THEN** 5 秒内弹出通知

#### Scenario: 冻结后补推
- **WHEN** App 被 vivo 后台管控冻结期间有消息发布
- **THEN** 用户打开 App 时按时间序补推全部未读消息

### Requirement: 无 GMS 依赖
App 的推送与作答链路 SHALL 不依赖 Google Play 服务。

#### Scenario: 无 GMS 设备
- **WHEN** 在无 Google 服务的 iQOO 13 上安装运行
- **THEN** 订阅、通知、作答全部正常
