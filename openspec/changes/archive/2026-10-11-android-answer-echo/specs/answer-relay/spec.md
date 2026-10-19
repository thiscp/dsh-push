# answer-relay delta

## ADDED Requirements

### Requirement: 作答回声
answer-relay 收到 `/answer/submit` 且转发成功后，SHALL 向 ntfy topic `dsh` 发布一条 priority=1 的静默消息，正文为 `#ans <callId> <答案摘要>`；发布失败 MUST 静默忽略，MUST NOT 影响提交响应。

#### Scenario: 网页作答回声
- **WHEN** 用户在浏览器作答页提交且转发成功
- **THEN** ntfy 出现 `#ans` 消息，订阅端（App）据此撤销对应通知并标记已答

#### Scenario: 回声失败不影响提交
- **WHEN** ntfy 发布失败（网络/凭据问题）
- **THEN** `/answer/submit` 仍返回原转发结果，无错误注入
