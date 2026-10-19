# dsh-question-notify 变更

## MODIFIED Requirements

### Requirement: 提问待答触发推送

DSH 调用 `ask_user_question`（或经同一问题 seam 的计划审批）时，主机侧实现（`PreToolUse` 钩子或宿主插件的
`user-questions/request` 监听）SHALL 向该主机配置的 ntfy topic 发布结构化提问推送。

#### Scenario: 选择题提问

- **WHEN** DSH 通过 `ask_user_question` 提问并等待
- **THEN** 推送载荷含 `event=question`、问题文本、`options[]`、`tool_use_id`、一次性 `nonce`、`web_url` 兜底链接

#### Scenario: 计划审批

- **WHEN** DSH 通过 `exit_plan_mode` 请求批准计划
- **THEN** 推送 `event=question`，选项为批准/拒绝语义

#### Scenario: 宿主插件路径

- **WHEN** 提问由宿主插件的 waterfall 监听器接管
- **THEN** 推送正文含问题文本、`📱 作答` 链接、`#qid`、单问题 2–3 选项时的 `#opts`，priority 为 4，且该问题已按 `hostId` 注册到 relay

### Requirement: 工具结束回声

提问工具的结束时刻 SHALL 发布 priority=1 的 `#ans <tool_use_id|callId> <答案摘要>` 消息（摘要取各题
`selected[0]` 或 `custom`，" / " 连接，取不到则"已作答"），使**任意端**（含 DSH Web 聊天界面）作答后订阅端都能
撤通知入已答态；发布失败 MUST 静默。结果为 `{pending: true}`（等待超时尚未作答）时 MUST NOT 发布回声——
该问题仍可从手机作答，误发回声会把卡片错误地置为已答。

#### Scenario: 聊天界面作答

- **WHEN** 用户在 DSH Web 聊天界面点选项作答（不经 answer-relay）
- **THEN** 工具结束时钩子发出 `#ans`，手机通知消失、卡片入已答态

#### Scenario: 与 relay 回声叠加

- **WHEN** 答案经 relay 提交（relay 已发一条 `#ans`），工具结束钩子再发一条
- **THEN** 两条回声幂等，订阅端行为不变

#### Scenario: 超时未答

- **WHEN** timed 等待超时，工具返回 `{pending: true}` 且用户尚未作答
- **THEN** 不发布 `#ans`，手机卡片保持可作答（旧 hook 在此会误发，属已修正缺陷）

#### Scenario: 宿主插件路径

- **WHEN** 宿主插件在 `tools/post-execute` 看到提问工具带着答案返回
- **THEN** 插件发布 `#ans`（priority 1），且与插件自身答案落地时的回声按 `callId` 幂等
