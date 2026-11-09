# answer-relay 变更

## MODIFIED Requirements

### Requirement: 答案转发到桥接
有效答案 SHALL 携带桥接令牌 POST 到最近接入主机的 dsh-answer-bridge（经 Tailscale 或公网入口）；桥接 SHALL 优先用事件流登记的 eventId 走 `$events/result`（open 态），失败时回退 `userQuestions/answer`（continued 态），使任务继续；注册表未命中该 agentId 时 SHALL 转发上游主机桥接并原样回传其响应。

#### Scenario: 端到端
- **WHEN** 手机经公网提交有效答案且问题仍在等待
- **THEN** 桥接注入应答，agent 收到答案继续执行

#### Scenario: 桥接不可达
- **WHEN** 转发超时或连接失败
- **THEN** 返回 5xx 并说明转发失败，页面提示错误

#### Scenario: 无对应事件
- **WHEN** 提交的 callId 在桥接无待答事件（如已作答或纯演练）
- **THEN** 返回 4xx 且任务不受影响

#### Scenario: 跨主机路由
- **WHEN** 答案的 callId 属主机不在本桥接事件流登记（agentId 未命中）
- **THEN** 请求带桥接令牌转发上游桥接，上游的 2xx/4xx 原样回传，本桥接不注入
