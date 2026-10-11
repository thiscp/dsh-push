# Spec Delta

## Purpose
定义 DSH 提问/审批待答时的推送契约：触发时机、JSON 结构化载荷与 nonce、失败隔离、去重。

## ADDED Requirements

### Requirement: 提问待答触发推送
DSH 调用 `ask_user_question` 或 `exit_plan_mode`（PreToolUse 时刻）时，SHALL 向 ntfy topic `dsh` 发布 JSON 结构化提问推送。

#### Scenario: 选择题提问
- **WHEN** DSH 通过 `ask_user_question` 提问并等待
- **THEN** 推送载荷含 `event=question`、问题文本、`options[]`、`tool_use_id`、一次性 `nonce`、`web_url` 兜底链接

#### Scenario: 计划审批
- **WHEN** DSH 通过 `exit_plan_mode` 请求批准计划
- **THEN** 推送 `event=question`，选项为批准/拒绝语义

### Requirement: nonce 注册
提问推送发布时，推送脚本 SHALL 向 answer-relay 注册该 nonce 及目标会话回调。

#### Scenario: 注册成功
- **WHEN** 提问推送发出后
- **THEN** answer-relay 持有该 nonce 到 DSH Web 会话的映射，手机可作答

### Requirement: 载荷容错
hook 载荷缺少预期字段时，推送 SHALL 降级而非丢失。

#### Scenario: 字段缺失
- **WHEN** PreToolUse 载荷中问题/选项字段不存在或结构变化
- **THEN** 仍推送兜底文案（"DSH 正在等你选择"）+ `web_url`，脚本 exit 0

### Requirement: 提问去重
同一次提问（同一工具调用 id）SHALL 至多推送一次。

#### Scenario: 钩子重复触发
- **WHEN** 同一 tool_use id 的 PreToolUse 钩子被执行多次
- **THEN** 仅第一次发布消息并注册 nonce
