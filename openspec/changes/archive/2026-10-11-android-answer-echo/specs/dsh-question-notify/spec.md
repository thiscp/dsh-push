# dsh-question-notify delta

## ADDED Requirements

### Requirement: 工具结束回声
提问工具（ask_user_question / exit_plan_mode）的 PostToolUse 钩子 SHALL 发布 priority=1 的 `#ans <tool_use_id> <答案摘要>` 消息（摘要取各题 selected[0] 或 custom，" / " 连接，取不到则"已作答"），使**任意端**（含 DSH Web 聊天界面）作答后订阅端都能撤通知入已答态；发布失败 MUST 静默。

#### Scenario: 聊天界面作答
- **WHEN** 用户在 DSH Web 聊天界面点选项作答（不经 answer-relay）
- **THEN** 工具结束时钩子发出 `#ans`，手机通知消失、卡片入已答态

#### Scenario: 与 relay 回声叠加
- **WHEN** 答案经 relay 提交（relay 已发一条 `#ans`），工具结束钩子再发一条
- **THEN** 两条回声幂等，订阅端行为不变
