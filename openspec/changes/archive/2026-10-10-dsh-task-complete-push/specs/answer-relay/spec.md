# Spec Delta

## Purpose
定义答案回传通道（阿里云 answer-relay 服务 + 工作机 dsh-answer-bridge 桥接进程）的行为：问题注册、公网作答网页、经 Tailscale 向桥接转发并由桥接注入 DSH Web。

## ADDED Requirements

### Requirement: 问题注册
answer-relay SHALL 接受推送脚本按 callId 的问题注册（携带注册令牌），保存问题文本与选项以供作答页渲染。

#### Scenario: 提问即注册
- **WHEN** 提问推送发出时推送脚本注册 `{callId, agentId, questions[]}`
- **THEN** 返回 200，`GET /answer/<callId>` 立即可渲染该问题

#### Scenario: 未注册即访问
- **WHEN** 访问未注册或已过期 callId 的作答页
- **THEN** 返回 404 并提示改在网页端作答

### Requirement: 公网作答页
answer-relay SHALL 对 `GET /answer/<callId>` 返回移动端可用的作答页（每题渲染选项按钮与自由输入框），提交到 `POST /answer/submit`。

#### Scenario: 手机点推送链接作答
- **WHEN** 用户手机打开推送中的作答链接并选择一个选项提交
- **THEN** 页面显示「已送达，任务继续」

### Requirement: 答案转发到桥接
有效答案 SHALL 携带桥接令牌经 Tailscale POST 到工作机 dsh-answer-bridge；桥接 SHALL 优先用事件流登记的 eventId 走 `$events/result`（open 态），失败时回退 `userQuestions/answer`（continued 态），使任务继续。

#### Scenario: 端到端
- **WHEN** 手机经公网提交有效答案且问题仍在等待
- **THEN** 桥接注入应答，agent 收到答案继续执行

#### Scenario: 桥接不可达
- **WHEN** 转发超时或连接失败
- **THEN** 返回 5xx 并说明转发失败，页面提示错误

#### Scenario: 无对应事件
- **WHEN** 提交的 callId 在桥接无待答事件（如已作答或纯演练）
- **THEN** 返回 4xx 且任务不受影响

### Requirement: 一次性语义
成功送达的答案 SHALL 立即失效，重复提交不再产生第二次注入。

#### Scenario: 重复点击提交
- **WHEN** 同一 callId 答案已成功送达后再次提交
- **THEN** 返回 4xx，agent 不被二次打扰

### Requirement: 旧 nonce 通道兼容
answer-relay SHALL 保留 v1 `{nonce, url}` 注册与 `POST /answer` 转发路径以兼容既有调用方。

#### Scenario: v1 注册
- **WHEN** 以 `{nonce, url}` 形式注册
- **THEN** 返回 200 且 `POST /answer` 路径行为不变
